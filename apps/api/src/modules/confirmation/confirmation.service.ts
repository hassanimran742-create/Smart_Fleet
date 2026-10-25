import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AlertSeverity,
  AlertStatus,
  AlertType,
  ConfirmationStatus,
  MessageChannel,
  MessageStatus,
  OrderStatus,
  Prisma,
  StopCylinderDirection,
  UserRole,
} from '@prisma/client';
import type {
  ConfirmationReach,
  ConfirmationResponse,
  ConfirmationShareResult,
  ConfirmationShareVia,
  ConfirmationSnapshot,
  ConfirmationView,
  CustomerProblemContext,
  OrderConfirmationSummary,
} from '@smartfleet/shared-types';
import { formatNo, formatPkPhone, normalizePkPhone } from '@smartfleet/shared-utils';
import { cleanCustomerComment, CUSTOMER_OTHER_COMMENT_MIN } from '@smartfleet/shared-validation';
import { customerActor, type UserActor } from '../../common/auth/actor';
import { ownDistributorId } from '../../common/auth/own-driver-id';
import { AppError } from '../../common/errors/app-error';
import { replayed, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  DELIVERY_CONFIRM_TEMPLATE,
  MESSAGING_PROVIDER,
  MessagingService,
  type MessagingProvider,
} from '../messaging/messaging.contract';
import { redactLinkToken, renderSms, smsShopName, type RenderedSms } from '../messaging/sms-text';
import { SettingsService } from '../settings/settings.service';
import { confirmationUrl, smsUrl, whatsappUrl } from './confirmation-links';
import { buildSnapshot, readSnapshot, type ReturnState } from './confirmation-snapshot';
import { confirmationTokenHash, confirmLinkSecret, deriveConfirmationToken } from './confirmation-token';
import {
  ConfirmationService,
  type ConfirmationDb,
  type IssueConfirmationInput,
  type IssuedConfirmation,
  type RecordAnswerResult,
} from './confirmation.contract';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR_MS = 3_600_000;
/** A QUEUED SMS older than this counts as not sent: the process died before the send (CUSTOMER_PAGE §8). */
export const QUEUED_LOST_AFTER_MS = 2 * 60_000;
/** At most this many share rows per order in any 60 minutes (API_CONTRACT §9.7). */
export const SHARES_PER_HOUR = 20;
/**
 * [review23 security-05] The texts a shop or the office asks the platform to send with a new link
 * (`new-link { send: 'SMS' }`, link version 2 and up; the delivery's own first SMS doesn't count): at most
 * this many per order, and per shop, in any 60 minutes (API_CONTRACT §9.7, §3.6).
 */
export const NEW_LINK_SMS_PER_ORDER_PER_HOUR = 3;
export const NEW_LINK_SMS_PER_SHOP_PER_HOUR = 20;
/** Transactions that take row locks may wait behind a racing one. */
const LOCKING_TX = { maxWait: 10_000, timeout: 20_000 } as const;

const RETURN_STATES: readonly ReturnState[] = ['EMPTY', 'PART_FILLED', 'FULL'];

/** `share-<via>`: the provider column of a share row, and back. */
const SHARE_PROVIDER: Record<ConfirmationShareVia, string> = {
  WHATSAPP: 'share-whatsapp',
  SMS: 'share-sms',
  SHARE_SHEET: 'share-sheet',
  COPY: 'share-copy',
};
const VIA_OF_PROVIDER: Record<string, ConfirmationShareVia> = Object.fromEntries(
  Object.entries(SHARE_PROVIDER).map(([via, provider]) => [provider, via as ConfirmationShareVia]),
);

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  distributorId: true,
  clientId: true,
  client: { select: { name: true, phone: true } },
  distributor: { select: { code: true } },
} satisfies Prisma.OrderSelect;
type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

const CONFIRMATION_SELECT = {
  id: true,
  orderId: true,
  distributorId: true,
  tokenVersion: true,
  lastNewLinkKey: true,
  status: true,
  expiresAt: true,
  phoneE164: true,
  snapshot: true,
  response: true,
  comment: true,
  respondedAt: true,
} satisfies Prisma.DeliveryConfirmationSelect;
type ConfirmationRow = Prisma.DeliveryConfirmationGetPayload<{ select: typeof CONFIRMATION_SELECT }>;

/** A link as the public page reads it: the row's state and the frozen snapshot. */
export type LinkRow = ConfirmationRow;

/** The state a link answers with: the stored status, except that a PENDING link past its expiry is EXPIRED. */
export function effectiveStatus(row: { status: ConfirmationStatus; expiresAt: Date }, now = new Date()): ConfirmationStatus {
  if (row.status === ConfirmationStatus.PENDING && now.getTime() >= row.expiresAt.getTime()) return ConfirmationStatus.EXPIRED;
  return row.status;
}

/** How far the current link got (CUSTOMER_PAGE §10), from the newest message row of its version. */
export function reachOf(
  latest: { channel: MessageChannel; status: MessageStatus; createdAt: Date } | null,
  now = new Date(),
): ConfirmationReach {
  if (!latest) return 'NOT_SENT';
  if (latest.channel === MessageChannel.SHARE_LINK) return 'SHARED';
  switch (latest.status) {
    case MessageStatus.QUEUED:
      return now.getTime() - latest.createdAt.getTime() < QUEUED_LOST_AFTER_MS ? 'SMS_SENDING' : 'NOT_SENT';
    case MessageStatus.SENT:
    case MessageStatus.DELIVERED:
      return 'SMS_SENT';
    case MessageStatus.FAILED:
      return 'SMS_FAILED';
    default:
      return 'NOT_SENT';
  }
}

/**
 * The customer confirmation (CUSTOMER_PAGE.md, API_CONTRACT §9.7; ADR-15): one link per delivered order,
 * shared by the shop or the office (never the driver), answered once on the public page. A record only:
 * **nothing here reaches the wallet or the ledger**, and an answer at most opens a case.
 *
 * - Issuing runs inside the delivering write's transaction and does nothing while
 *   `confirmation.enabled` is off; switching it on never back-fills.
 * - The token is derived (never stored): the row keeps its sha256. A new link bumps the version, so
 *   the old link stops working; the expiry never moves.
 * - The answer, its `confirmation.answer` audit row (actor CUSTOMER, no IP or user agent) and its case
 *   commit together, or not at all.
 */
@Injectable()
export class ConfirmationServiceImpl extends ConfirmationService {
  private readonly logger = new Logger('Confirmations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
    private readonly alerts: AlertsService,
    private readonly messaging: MessagingService,
    @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider,
  ) {
    super();
    // Staging and production refuse to start without a real link secret (also a boot guard).
    confirmLinkSecret();
  }

  // ---------- issuing (inside the delivering transaction) ----------

  async issueForDeliveredOrder(tx: ConfirmationDb, input: IssueConfirmationInput): Promise<IssuedConfirmation | null> {
    if (!(await this.settings.get('confirmation.enabled'))) return null;
    const { orderId, stopId, deliveredAt } = input;

    const existing = await tx.deliveryConfirmation.findUnique({ where: { orderId }, select: { id: true } });
    if (existing) return { confirmationId: existing.id, orderId, messageId: null, created: false };

    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        orderNo: true,
        distributorId: true,
        client: { select: { phone: true } },
        distributor: { select: { code: true, businessName: true, user: { select: { phone: true } } } },
      },
    });
    if (!order) throw new AppError('NOT_FOUND');

    const weight = { cylinderType: { select: { weightKg: true } } } as const;
    const given = await tx.stopCylinder.findMany({
      where: { tripStopId: stopId, orderId, direction: StopCylinderDirection.GIVEN },
      select: { cylinderTypeId: true, ...weight },
    });
    const takenBack = await tx.stopCylinder.findMany({
      where: { tripStopId: stopId, orderId, direction: StopCylinderDirection.TAKEN_BACK },
      select: { cylinderTypeId: true, returnState: true, ...weight },
    });
    const unlabelled = await tx.stopUnlabelledReturn.findMany({
      where: { tripStopId: stopId, orderId },
      select: { cylinderTypeId: true, state: true, count: true, ...weight },
    });

    const orderNo = formatNo(order.distributor.code, 'ORDER', order.orderNo);
    const snapshot = buildSnapshot({
      shop: { name: order.distributor.businessName, phoneE164: normalizePkPhone(order.distributor.user.phone) ?? order.distributor.user.phone },
      orderNo,
      deliveredAt,
      given: given.map((row) => ({ cylinderTypeId: row.cylinderTypeId, weightKg: row.cylinderType.weightKg })),
      takenBack: takenBack
        .filter((row) => RETURN_STATES.includes(row.returnState as ReturnState))
        .map((row) => ({ cylinderTypeId: row.cylinderTypeId, weightKg: row.cylinderType.weightKg, state: row.returnState as ReturnState })),
      unlabelled: unlabelled
        .filter((row) => RETURN_STATES.includes(row.state as ReturnState))
        .map((row) => ({ cylinderTypeId: row.cylinderTypeId, weightKg: row.cylinderType.weightKg, state: row.state as ReturnState, count: row.count })),
    });

    const ttlHours = await this.settings.get('confirmation.linkTtlHours');
    const expiresAt = new Date(deliveredAt.getTime() + ttlHours * HOUR_MS);
    const id = randomUUID();
    const token = deriveConfirmationToken(confirmLinkSecret(), id, 1);
    const phoneE164 = normalizePkPhone(order.client.phone);

    // ON CONFLICT DO NOTHING: a racing issue for the same order never aborts the delivering transaction.
    const inserted = await tx.deliveryConfirmation.createMany({
      data: [
        {
          id,
          orderId,
          distributorId: order.distributorId,
          tokenHash: confirmationTokenHash(token),
          tokenVersion: 1,
          status: ConfirmationStatus.PENDING,
          expiresAt,
          phoneE164,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      const row = await tx.deliveryConfirmation.findUnique({ where: { orderId }, select: { id: true } });
      if (!row) throw new AppError('CONFLICT_STALE_STATE');
      return { confirmationId: row.id, orderId, messageId: null, created: false };
    }

    let messageId: string | null = null;
    if (phoneE164) {
      messageId = await this.queueSms(tx, {
        confirmationId: id,
        orderId,
        distributorId: order.distributorId,
        tokenVersion: 1,
        token,
        snapshot,
        toPhoneE164: phoneE164,
        createdByUserId: null,
      });
    }
    return { confirmationId: id, orderId, messageId, created: true };
  }

  async sendIssued(issued: IssuedConfirmation | null): Promise<void> {
    if (!issued?.messageId) return;
    await this.sendMessage(issued.messageId);
  }

  // ---------- the shop and office routes ----------

  async view(orderId: string, actor: UserActor): Promise<ConfirmationView> {
    await this.assertSwitchOn();
    const { order, confirmation } = await this.findForCaller(orderId, actor);
    return this.toView(order, confirmation);
  }

  async share(
    orderId: string,
    via: ConfirmationShareVia,
    idempotencyKey: string | undefined,
    actor: UserActor,
  ): Promise<ConfirmationShareResult | IdempotentResponse<ConfirmationShareResult>> {
    await this.assertSwitchOn();
    const { order, confirmation } = await this.findForCaller(orderId, actor);
    const key = `share:${orderId}:${idempotencyKey ?? randomUUID()}`;

    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockConfirmation(tx, confirmation.id);
      if (idempotencyKey) {
        const earlier = await tx.outboundMessage.findUnique({ where: { idempotencyKey: key }, select: { provider: true, tokenVersion: true } });
        if (earlier) {
          if (earlier.provider !== SHARE_PROVIDER[via]) throw new AppError('IDEMPOTENCY_CONFLICT');
          return { replay: true, tokenVersion: earlier.tokenVersion ?? locked.tokenVersion, row: locked };
        }
      }
      const now = new Date();
      if (effectiveStatus(locked, now) !== ConfirmationStatus.PENDING) throw new AppError('CONFIRM_CLOSED');
      const since = new Date(now.getTime() - HOUR_MS);
      const recent = await tx.outboundMessage.findMany({
        where: { orderId, channel: MessageChannel.SHARE_LINK, createdAt: { gt: since } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      if (recent.length >= SHARES_PER_HOUR) {
        const freeAt = recent[recent.length - SHARES_PER_HOUR].createdAt.getTime() + HOUR_MS;
        throw new AppError('RATE_LIMITED', { minutes: Math.max(1, Math.ceil((freeAt - now.getTime()) / 60_000)) });
      }
      const token = deriveConfirmationToken(confirmLinkSecret(), locked.id, locked.tokenVersion);
      const message = this.messageFor(readSnapshot(locked.snapshot), token);
      await this.messaging.record(tx, {
        channel: MessageChannel.SHARE_LINK,
        provider: SHARE_PROVIDER[via],
        toPhoneE164: locked.phoneE164,
        templateKey: DELIVERY_CONFIRM_TEMPLATE,
        bodyRedacted: redactLinkToken(message.text, token),
        status: MessageStatus.SENT,
        idempotencyKey: key,
        confirmationId: locked.id,
        tokenVersion: locked.tokenVersion,
        orderId,
        distributorId: order.distributorId,
        createdByUserId: actor.userId,
      });
      return { replay: false, tokenVersion: locked.tokenVersion, row: locked };
    }, LOCKING_TX);

    const token = deriveConfirmationToken(confirmLinkSecret(), outcome.row.id, outcome.tokenVersion);
    const message = this.messageFor(readSnapshot(outcome.row.snapshot), token);
    const phone = outcome.row.phoneE164;
    const result: ConfirmationShareResult = {
      url: confirmationUrl(token),
      message: message.text,
      whatsappUrl: phone ? whatsappUrl(phone, message.text) : null,
      smsUrl: phone ? smsUrl(phone, message.text) : null,
      expiresAt: outcome.row.expiresAt.toISOString(),
    };
    return outcome.replay ? replayed(result) : result;
  }

  async newLink(
    orderId: string,
    p: { send?: 'SMS'; idempotencyKey?: string },
    actor: UserActor,
  ): Promise<ConfirmationView | IdempotentResponse<ConfirmationView>> {
    await this.assertSwitchOn();
    const { order, confirmation } = await this.findForCaller(orderId, actor);
    const key = p.idempotencyKey ?? null;
    if (key && confirmation.lastNewLinkKey === key) return replayed(await this.toView(order, confirmation));
    if (effectiveStatus(confirmation) !== ConfirmationStatus.PENDING) throw new AppError('CONFIRM_CLOSED');
    const phoneE164 = normalizePkPhone(order.client.phone);
    if (p.send === 'SMS' && !phoneE164) throw new AppError('CLIENT_PHONE_INVALID');

    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockConfirmation(tx, confirmation.id);
      if (key && locked.lastNewLinkKey === key) return { replay: true as const, messageId: null };
      if (effectiveStatus(locked) !== ConfirmationStatus.PENDING) throw new AppError('CONFIRM_CLOSED');
      if (p.send === 'SMS') await this.assertNewLinkSmsAllowed(tx, orderId, order.distributorId);
      const version = locked.tokenVersion + 1;
      const token = deriveConfirmationToken(confirmLinkSecret(), locked.id, version);
      await tx.deliveryConfirmation.update({
        where: { id: locked.id },
        data: { tokenVersion: version, tokenHash: confirmationTokenHash(token), phoneE164, lastNewLinkKey: key },
      });
      await this.audit.record(
        {
          action: 'confirmation.new_link',
          actor,
          resourceType: 'Order',
          resourceId: orderId,
          distributorId: order.distributorId,
          diff: { tokenVersion: version, send: p.send ?? null, no: formatNo(order.distributor.code, 'ORDER', order.orderNo ?? 0) },
        },
        tx,
      );
      let messageId: string | null = null;
      if (p.send === 'SMS' && phoneE164) {
        messageId = await this.queueSms(tx, {
          confirmationId: locked.id,
          orderId,
          distributorId: order.distributorId,
          tokenVersion: version,
          token,
          snapshot: readSnapshot(locked.snapshot),
          toPhoneE164: phoneE164,
          createdByUserId: actor.userId,
        });
      }
      return { replay: false as const, messageId };
    }, LOCKING_TX);

    // After commit: the SMS (if any) goes out on its own; the answer doesn't wait for the provider.
    if (outcome.messageId) void this.sendMessage(outcome.messageId);
    const fresh = await this.prisma.deliveryConfirmation.findUniqueOrThrow({ where: { id: confirmation.id }, select: CONFIRMATION_SELECT });
    const view = await this.toView(order, fresh);
    return outcome.replay ? replayed(view) : view;
  }

  // ---------- the public page ----------

  /** The link of a token, for the page (no lock). Null when no link has this token. */
  async findLink(token: string): Promise<LinkRow | null> {
    return this.prisma.deliveryConfirmation.findUnique({ where: { tokenHash: confirmationTokenHash(token) }, select: CONFIRMATION_SELECT });
  }

  async record(token: string, answer: ConfirmationResponse, comment: string | null): Promise<RecordAnswerResult> {
    const tokenHash = confirmationTokenHash(token);
    const enabled = await this.settings.get('confirmation.enabled');
    const caseOnAnswers = await this.settings.get('confirmation.caseOnAnswers');
    const note = cleanCustomerComment(comment);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; orderId: string; distributorId: string; status: string; response: string | null; expiresAt: Date; snapshot: unknown }>
      >`SELECT id, order_id AS "orderId", distributor_id AS "distributorId", status::text AS status, response::text AS response,
               expires_at AS "expiresAt", snapshot
        FROM delivery_confirmations WHERE token_hash = ${tokenHash} FOR UPDATE`;
      const row = rows[0];
      // The state order of CUSTOMER_PAGE §4, re-checked under the lock.
      if (!row) throw new AppError('CONFIRM_LINK_INVALID');
      if (!enabled) throw new AppError('CONFIRM_LINK_INACTIVE');
      if (row.status === ConfirmationStatus.ANSWERED) {
        if (row.response === answer) return { answer, recorded: false };
        throw new AppError('CONFIRM_ALREADY_ANSWERED');
      }
      if (row.status === ConfirmationStatus.CANCELLED) throw new AppError('CONFIRM_LINK_INACTIVE');
      const now = new Date();
      if (row.status === ConfirmationStatus.EXPIRED || now.getTime() >= row.expiresAt.getTime()) throw new AppError('CONFIRM_LINK_EXPIRED');
      if (answer === 'OTHER' && (note === null || Array.from(note).length < CUSTOMER_OTHER_COMMENT_MIN)) {
        throw new AppError('CONFIRM_NOTE_REQUIRED');
      }

      const updated = await tx.deliveryConfirmation.updateMany({
        where: { id: row.id, status: ConfirmationStatus.PENDING },
        data: { status: ConfirmationStatus.ANSWERED, response: answer, comment: note, respondedAt: now },
      });
      if (updated.count !== 1) throw new AppError('CONFLICT_STALE_STATE');

      const snapshot = readSnapshot(row.snapshot);
      await this.audit.record(
        {
          action: 'confirmation.answer',
          actor: customerActor(`link:${snapshot.orderNo}`),
          resourceType: 'Order',
          resourceId: row.orderId,
          distributorId: row.distributorId,
          diff: { response: answer, no: snapshot.orderNo },
        },
        tx,
      );
      if ((caseOnAnswers as readonly string[]).includes(answer)) {
        const context: CustomerProblemContext = {
          orderId: row.orderId,
          orderShortCode: snapshot.orderNo,
          distributorId: row.distributorId,
          answer,
          comment: note,
        };
        // In the answer's own transaction: if the case can't open, the answer rolls back too.
        await this.alerts.raise(
          {
            alertType: AlertType.CUSTOMER_PROBLEM,
            severity: answer === 'PARTLY' ? AlertSeverity.INFO : AlertSeverity.WARNING,
            title: `Customer problem: ${snapshot.orderNo}`,
            body: `The customer answered "${ANSWER_WORDS[answer]}" for ${snapshot.orderNo}.`,
            resourceType: 'Order',
            resourceId: row.orderId,
            distributorId: row.distributorId,
            context: context as unknown as Prisma.InputJsonValue,
            dedupeKey: { resourceType: 'Order', resourceId: row.orderId, alertType: AlertType.CUSTOMER_PROBLEM },
          },
          tx,
        );
      }
      return { answer, recorded: true };
    }, LOCKING_TX);
  }

  // ---------- jobs and lists ----------

  async expireDue(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.deliveryConfirmation.updateMany({
      where: { status: ConfirmationStatus.PENDING, expiresAt: { lte: now } },
      data: { status: ConfirmationStatus.EXPIRED },
    });
    return expired.count;
  }

  async summariesFor(orderIds: readonly string[], db: ConfirmationDb = this.prisma): Promise<Map<string, OrderConfirmationSummary>> {
    const ids = [...new Set(orderIds)].filter((id) => UUID.test(id));
    const out = new Map<string, OrderConfirmationSummary>();
    if (ids.length === 0) return out;
    const rows = await db.$queryRaw<Array<{ orderId: string; status: ConfirmationStatus; response: ConfirmationResponse | null; expiresAt: Date; caseOpen: boolean }>>`
      SELECT dc.order_id AS "orderId", dc.status::text AS status, dc.response::text AS response, dc.expires_at AS "expiresAt",
             EXISTS (SELECT 1 FROM alerts a
                     WHERE a.alert_type::text = 'CUSTOMER_PROBLEM' AND a.status::text = 'OPEN'
                       AND a.resource_type = 'Order' AND a.resource_id = dc.order_id) AS "caseOpen"
      FROM delivery_confirmations dc
      WHERE dc.order_id = ANY(${ids}::uuid[])`;
    const now = new Date();
    for (const row of rows) {
      out.set(row.orderId, { status: effectiveStatus(row, now), response: row.response, caseOpen: row.caseOpen });
    }
    return out;
  }

  async hasPendingForClient(clientId: string, db: ConfirmationDb = this.prisma): Promise<boolean> {
    if (!UUID.test(clientId)) return false;
    const pending = await db.deliveryConfirmation.count({
      where: { status: ConfirmationStatus.PENDING, expiresAt: { gt: new Date() }, order: { clientId } },
    });
    return pending > 0;
  }

  /** True when the order has an OPEN customer-problem case (the view's `caseOpen`, the shop card's line). */
  async caseOpenFor(orderId: string): Promise<boolean> {
    const open = await this.prisma.alert.count({
      where: { alertType: AlertType.CUSTOMER_PROBLEM, status: AlertStatus.OPEN, resourceType: 'Order', resourceId: orderId },
    });
    return open > 0;
  }

  // ---------- helpers ----------

  /** The route's switch, again in the service: a caller outside the guarded routes gets the same 403. */
  private async assertSwitchOn(): Promise<void> {
    if (!(await this.settings.get('confirmation.enabled'))) throw new AppError('FEATURE_DISABLED');
  }

  /**
   * The common checks after the switch (API_CONTRACT §9.7): a driver or another distributor 404; not
   * DELIVERED 409 CONFIRM_NOT_READY; no confirmation row (delivered while off) 404 NOT_FOUND.
   */
  private async findForCaller(orderId: string, actor: UserActor): Promise<{ order: OrderRow; confirmation: ConfirmationRow }> {
    if (actor.role === UserRole.DRIVER) throw new AppError('NOT_FOUND');
    const office = actor.role === UserRole.SUPER_ADMIN;
    const own = actor.role === UserRole.DISTRIBUTOR ? ownDistributorId(actor) : null;
    if (!office && !own) throw new AppError('NOT_FOUND');
    if (!UUID.test(orderId)) throw new AppError('NOT_FOUND');
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
    if (!order || (!office && order.distributorId !== own)) throw new AppError('NOT_FOUND');
    if (order.status !== OrderStatus.DELIVERED) throw new AppError('CONFIRM_NOT_READY');
    const confirmation = await this.prisma.deliveryConfirmation.findUnique({ where: { orderId }, select: CONFIRMATION_SELECT });
    if (!confirmation) throw new AppError('NOT_FOUND');
    return { order, confirmation };
  }

  /** Locks the confirmation row (`SELECT … FOR UPDATE`) and reads it fresh. */
  private async lockConfirmation(tx: Prisma.TransactionClient, id: string): Promise<ConfirmationRow> {
    await tx.$queryRaw`SELECT id FROM delivery_confirmations WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.deliveryConfirmation.findUniqueOrThrow({ where: { id }, select: CONFIRMATION_SELECT });
  }

  private async toView(order: OrderRow, row: ConfirmationRow, now = new Date()): Promise<ConfirmationView> {
    const latest = await this.prisma.outboundMessage.findFirst({
      where: { confirmationId: row.id, tokenVersion: row.tokenVersion },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { channel: true, status: true, errorCode: true, provider: true, createdAt: true, sentAt: true, createdByUserId: true },
    });
    const byName = latest?.createdByUserId
      ? ((await this.prisma.user.findUnique({ where: { id: latest.createdByUserId }, select: { name: true } }))?.name ?? null)
      : null;
    const status = effectiveStatus(row, now);
    const snapshot = readSnapshot(row.snapshot);
    return {
      orderId: order.id,
      orderShortCode: formatNo(order.distributor.code, 'ORDER', order.orderNo),
      status,
      response: row.response,
      comment: row.comment,
      respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
      expiresAt: row.expiresAt.toISOString(),
      reach: reachOf(latest, now),
      lastMessage: latest
        ? {
            channel: latest.channel,
            status: latest.status,
            errorCode: latest.errorCode,
            at: (latest.sentAt ?? latest.createdAt).toISOString(),
            byName,
            via: latest.channel === MessageChannel.SHARE_LINK ? (VIA_OF_PROVIDER[latest.provider] ?? null) : null,
          }
        : null,
      customer: {
        name: order.client.name,
        phoneDisplay: formatPkPhone(row.phoneE164 ?? order.client.phone, 'local'),
        phoneValid: row.phoneE164 !== null,
      },
      delivered: snapshot.delivered.map((line) => ({ size: line.size, count: line.count })),
      takenBack: snapshot.takenBack.map((line) => ({ size: line.size, state: line.state, count: line.count, unlabelled: line.unlabelled })),
      caseOpen: await this.caseOpenFor(order.id),
      allowedActions: status === ConfirmationStatus.PENDING ? ['SHARE', 'NEW_LINK'] : [],
    };
  }

  /**
   * The link's text (CUSTOMER_PAGE §9), for the SMS and every share. When the SMS can't fit (a link host
   * far longer than the pilot's) a share still gets the plain sentence; an SMS isn't queued then.
   */
  private messageFor(snapshot: ConfirmationSnapshot, token: string): RenderedSms {
    const link = confirmationUrl(token);
    const phone = snapshot.shop.phoneE164 ? formatPkPhone(snapshot.shop.phoneE164, 'compact') : '';
    try {
      return renderSms({ shop: snapshot.shop.name, orderNo: snapshot.orderNo, link, phone });
    } catch {
      const shop = smsShopName(snapshot.shop.name);
      return { text: `${shop}: Order ${snapshot.orderNo} delivered. Did you get it? Tap ${link}`, params: { shop, orderNo: snapshot.orderNo, link, phone: '' }, helpDropped: true };
    }
  }

  /** Writes the QUEUED SMS row of a link version (`confirm:<orderId>:v<n>:sms`); null when none can be sent. */
  /**
   * 429 RATE_LIMITED `{ minutes }` once the order, or its shop, has had its new-link texts for the last 60
   * minutes ({@link NEW_LINK_SMS_PER_ORDER_PER_HOUR}, {@link NEW_LINK_SMS_PER_SHOP_PER_HOUR}). The shop's
   * lock makes two rotations at once count each other. A new link without a text is never limited.
   */
  private async assertNewLinkSmsAllowed(tx: Prisma.TransactionClient, orderId: string, distributorId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`confirm-new-link-sms:${distributorId}`}))`;
    const now = Date.now();
    const asked = (where: Prisma.OutboundMessageWhereInput) =>
      tx.outboundMessage.findMany({
        where: { channel: MessageChannel.SMS, tokenVersion: { gt: 1 }, createdAt: { gt: new Date(now - HOUR_MS) }, ...where },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
    /** Milliseconds until one more fits under `limit` (0 when it fits now). */
    const waitFor = (rows: Array<{ createdAt: Date }>, limit: number) =>
      rows.length < limit ? 0 : rows[rows.length - limit].createdAt.getTime() + HOUR_MS - now;
    const wait = Math.max(
      waitFor(await asked({ orderId }), NEW_LINK_SMS_PER_ORDER_PER_HOUR),
      waitFor(await asked({ distributorId }), NEW_LINK_SMS_PER_SHOP_PER_HOUR),
    );
    if (wait > 0) throw new AppError('RATE_LIMITED', { minutes: Math.max(1, Math.ceil(wait / 60_000)) });
  }

  private async queueSms(
    tx: Prisma.TransactionClient,
    p: {
      confirmationId: string;
      orderId: string;
      distributorId: string;
      tokenVersion: number;
      token: string;
      snapshot: ConfirmationSnapshot;
      toPhoneE164: string;
      createdByUserId: string | null;
    },
  ): Promise<string | null> {
    let text: string;
    try {
      text = renderSms({
        shop: p.snapshot.shop.name,
        orderNo: p.snapshot.orderNo,
        link: confirmationUrl(p.token),
        phone: p.snapshot.shop.phoneE164 ? formatPkPhone(p.snapshot.shop.phoneE164, 'compact') : '',
      }).text;
    } catch (error) {
      this.logger.error(`order ${p.orderId}: the confirmation SMS doesn't fit one segment (${(error as Error).message}); no SMS queued`);
      return null;
    }
    const row = await this.messaging.record(tx, {
      channel: MessageChannel.SMS,
      provider: this.provider.name,
      toPhoneE164: p.toPhoneE164,
      templateKey: DELIVERY_CONFIRM_TEMPLATE,
      bodyRedacted: redactLinkToken(text, p.token),
      status: MessageStatus.QUEUED,
      idempotencyKey: `confirm:${p.orderId}:v${p.tokenVersion}:sms`,
      confirmationId: p.confirmationId,
      tokenVersion: p.tokenVersion,
      orderId: p.orderId,
      distributorId: p.distributorId,
      createdByUserId: p.createdByUserId,
    });
    return row.replayed ? null : row.id;
  }

  /** After commit: sends one QUEUED SMS row with its link rebuilt from the row's version. Never throws. */
  private async sendMessage(messageId: string): Promise<void> {
    try {
      const row = await this.prisma.outboundMessage.findUnique({
        where: { id: messageId },
        select: { status: true, channel: true, toPhoneE164: true, tokenVersion: true, confirmation: { select: { id: true, snapshot: true } } },
      });
      if (!row || row.status !== MessageStatus.QUEUED || row.channel !== MessageChannel.SMS) return;
      if (!row.toPhoneE164 || !row.confirmation || row.tokenVersion === null) return;
      const token = deriveConfirmationToken(confirmLinkSecret(), row.confirmation.id, row.tokenVersion);
      const sms = this.messageFor(readSnapshot(row.confirmation.snapshot), token);
      await this.messaging.sendQueued(messageId, {
        channel: 'SMS',
        toE164: row.toPhoneE164,
        templateKey: DELIVERY_CONFIRM_TEMPLATE,
        locale: 'en',
        params: sms.params,
        text: sms.text,
      });
    } catch (error) {
      this.logger.error(`message ${messageId}: the send could not start (${error instanceof Error ? error.name : typeof error})`);
    }
  }
}

/** The answer's words for the alert's English fallback (apps render cases from `context`). */
const ANSWER_WORDS: Record<ConfirmationResponse, string> = {
  YES: 'All received',
  PARTLY: 'Partly received',
  NO: 'Not received',
  OTHER: 'Other problem',
};
