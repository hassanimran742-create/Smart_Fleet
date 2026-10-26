import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type DistributorStatus, type PaymentStatus } from '@prisma/client';
import {
  type AdminTopupsDto,
  type AppEnvironment,
  type IdName,
  type InitiateTopupResponse,
  type PayerChannel,
  type PaymentDto,
  type TopupApproveResult,
  type TopupInfoDto,
  type TopupRejectReason,
} from '@smartfleet/shared-types';
import type {
  AdminTopupsQuery,
  ApproveTopupInput,
  RejectTopupInput,
  TopupInput,
  TopupRequestInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { canSeePayment, type PolicyCaller } from '../../common/auth/policies';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { assertSameRequest } from '../../common/idempotency/idempotency';
import { decodeCursor, invalidCursor, pageLimit, toPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { FilesService } from '../files/files.service';
import { SettingsService } from '../settings/settings.service';
import { currentBusinessDay } from '../wallet/business-day';
import { isUuid, WalletService } from '../wallet/wallet.service';
import { PAYMENT_INCLUDE, topupShortCode, toPaymentDto, type PaymentRow, type PaymentView } from './payment.dto';
import { BankManualProvider } from './providers/bank-manual.provider';
import {
  assertTopupAmount,
  assertUnderCap,
  isBankTimeInFuture,
  roomUnderCap,
  TAB_STATUSES,
  topupSearchWhere,
  type TopupLimits,
} from './topup.rules';

/** The payer channels the shop app offers, in this order (API_CONTRACT §7.9). */
const PAYER_CHANNELS: PayerChannel[] = ['EASYPAISA_APP', 'BANK_APP', 'OTHER'];

/** `GET /payments/mine` keeps the installed app's limit. */
const MINE_LIMIT = 100;

/** The note a legacy verify rejection carries, and the audit reason it writes (G02-04). */
export const LEGACY_VERIFY_REJECT_NOTE = 'Call the office for the reason.';
export const LEGACY_VERIFY_AUDIT_REASON = 'Rejected through the legacy verify route';

/** A request about to be created: the new "tell us you paid" body or the legacy one. */
interface PendingRequest {
  amountPaisa: bigint;
  payerName: string | null;
  payerChannel: PayerChannel | null;
  transactionId: string | null;
  proofFileId: string | null;
}

/** A result and whether it repeats an earlier one (a replayed create, or an action already applied). */
export interface Repeatable<T> {
  body: T;
  repeated: boolean;
}

/**
 * Requests approved (completed) between two instants, with the credited amounts summed (API_CONTRACT
 * §7.9 `approvedToday`). Exported so the office summary can run the very same query; pass the bounds of
 * `currentBusinessDay()` (G14-02).
 */
export async function approvedTopupsInRange(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  range: { start: Date; end: Date },
): Promise<{ count: number; totalPaisa: bigint }> {
  // Dates bind as timestamptz; the column is timestamp(3) in UTC, so compare in UTC (any session time zone).
  const rows = await db.$queryRaw<Array<{ count: number; total: bigint }>>`
    SELECT count(*)::int AS count, COALESCE(sum(COALESCE(bank_amount_paisa, amount_paisa)), 0)::bigint AS total
    FROM payments
    WHERE status = 'SUCCESS'
      AND completed_at >= (${range.start}::timestamptz AT TIME ZONE 'UTC')
      AND completed_at < (${range.end}::timestamptz AT TIME ZONE 'UTC')`;
  return { count: Number(rows[0]?.count ?? 0), totalPaisa: rows[0]?.total ?? 0n };
}

/**
 * Manual bank top-ups (API_CONTRACT §5.7, §7.9, §8.2): the distributor tells us it paid, the office
 * approves against the company bank app by typing the bank reference (usable once ever), and only then
 * is the wallet credited, once, through WalletService. Nothing here writes a balance or a ledger row.
 */
@Injectable()
export class TopupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService,
    private readonly bank: BankManualProvider,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Distributor

  /** `GET /payments/topup-info`: where to pay and the limits now; 503 while no company account is set. */
  async info(distributorId: string): Promise<TopupInfoDto> {
    const account = await this.bank.account();
    const [summary, limits, quick, checkingHours, supportPhone, supportHours] = await Promise.all([
      this.wallet.summary(distributorId),
      this.limits(),
      this.settings.get('topup.quickAmountsPaisa'),
      this.settings.get('topup.checkingHours'),
      this.settings.get('support.phone'),
      this.settings.get('support.hours'),
    ]);
    const cap = summary.capPaisa === null ? null : BigInt(summary.capPaisa);
    const room = roomUnderCap(cap, BigInt(summary.balancePaisa), BigInt(summary.pendingTopupPaisa));
    return {
      account,
      limits: {
        minPaisa: limits.minPaisa.toString(),
        maxPaisa: limits.maxPaisa.toString(),
        maxNowPaisa: room === null ? null : room.toString(),
      },
      quickAmountsPaisa: quick.map((amount) => String(amount)),
      payerChannels: [...PAYER_CHANNELS],
      checkingHours: { from: checkingHours.from, to: checkingHours.to },
      support: { phone: supportPhone, hours: supportHours },
      pending: { count: summary.pendingTopupCount, totalPaisa: summary.pendingTopupPaisa },
      training: this.environment() === 'training',
    };
  }

  /** `POST /payments/topup-requests`: 201 PaymentDto; the same Idempotency-Key replays the first request. */
  async createRequest(actor: UserActor, body: TopupRequestInput, idempotencyKey?: string): Promise<Repeatable<PaymentDto>> {
    const { payment, repeated } = await this.createPending(
      actor,
      {
        amountPaisa: BigInt(body.amountPaisa),
        payerName: body.payerName,
        payerChannel: body.payerChannel as PayerChannel,
        transactionId: body.transactionId ?? null,
        proofFileId: body.proofFileId?.toLowerCase() ?? null,
      },
      idempotencyKey,
    );
    return { body: await this.toDto(payment, 'DISTRIBUTOR'), repeated };
  }

  /**
   * Legacy `POST /payments/topup` for the installed app: BANK_MANUAL only, rules 1–5 of the new route,
   * no payer name, and the old answer `{ paymentId, formFields: { instructions } }`.
   */
  async legacyTopup(actor: UserActor, body: TopupInput, idempotencyKey?: string): Promise<Repeatable<InitiateTopupResponse>> {
    if (body.provider !== 'BANK_MANUAL') throw new AppError('PAYMENT_WEBHOOK_DISABLED');
    const { payment, repeated } = await this.createPending(
      actor,
      { amountPaisa: BigInt(body.amountPaisa), payerName: null, payerChannel: null, transactionId: null, proofFileId: null },
      idempotencyKey,
    );
    const instructions = await this.bank.instructions({
      distributorId: payment.distributorId,
      amountPaisa: payment.amountPaisa,
      reference: topupShortCode(payment.distributor.code, payment.requestNo),
    });
    return { body: { paymentId: payment.id, formFields: { instructions: instructions.text } }, repeated };
  }

  /** `GET /payments/mine`: the distributor's requests, newest first, a bare array. */
  async mine(distributorId: string): Promise<PaymentDto[]> {
    const rows = await this.prisma.payment.findMany({
      where: { distributorId },
      include: PAYMENT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MINE_LIMIT,
    });
    return this.toDtos(rows, 'DISTRIBUTOR');
  }

  /** `GET /payments/:id`: the office or the owning distributor (`canSeePayment`); anyone else 404. */
  async byId(caller: PolicyCaller, paymentId: string): Promise<PaymentDto> {
    const row = isUuid(paymentId)
      ? await this.prisma.payment.findUnique({ where: { id: paymentId }, include: PAYMENT_INCLUDE })
      : null;
    const payment = canSeePayment(caller, row);
    return this.toDto(payment, caller.role === 'SUPER_ADMIN' ? 'OFFICE' : 'DISTRIBUTOR');
  }

  /**
   * Legacy `POST /payments/:id/bank-proof`: the caller's own request (404), still being checked
   * (TOPUP_NOT_PENDING), and `proofUrl` must name an upload the caller made (FILE_NOT_FOUND).
   */
  async attachLegacyProof(actor: UserActor, paymentId: string, proofUrl: string): Promise<PaymentDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, paymentId);
      if (!payment || payment.distributorId !== actor.distributorId) throw new AppError('NOT_FOUND');
      if (payment.status !== 'PENDING') throw await this.notPending(tx, payment);
      const file = await this.files.assertUsableUrl(proofUrl, { purpose: 'TOPUP_PROOF', uploadedByUserId: actor.userId }, tx);
      return tx.payment.update({ where: { id: payment.id }, data: { proofFileId: file.id }, include: PAYMENT_INCLUDE });
    });
    return this.toDto(updated, 'DISTRIBUTOR');
  }

  // ---------------------------------------------------------------------------------------------
  // Office

  /** `GET /admin/topups?tab&q&cursor&limit`: the queue, its counts and today's approvals. */
  async adminList(query: AdminTopupsQuery): Promise<AdminTopupsDto> {
    const limit = pageLimit(query.limit);
    const ascending = query.tab === 'to-check';
    const statuses = TAB_STATUSES[query.tab];
    const and: Prisma.PaymentWhereInput[] = [];
    if (statuses) and.push({ status: { in: [...statuses] } });
    if (query.q) and.push(topupSearchWhere(query.q));
    const cursor = decodeCursor(query.cursor, 2);
    if (cursor) {
      const [at, id] = cursor;
      const atDate = new Date(String(at));
      if (Number.isNaN(atDate.getTime()) || !isUuid(id)) throw invalidCursor();
      and.push(
        ascending
          ? { OR: [{ createdAt: { gt: atDate } }, { createdAt: atDate, id: { gt: id } }] }
          : { OR: [{ createdAt: { lt: atDate } }, { createdAt: atDate, id: { lt: id } }] },
      );
    }
    const direction = ascending ? 'asc' : 'desc';
    const today = await currentBusinessDay(this.settings);
    const [rows, grouped, approvedToday] = await Promise.all([
      this.prisma.payment.findMany({
        where: and.length > 0 ? { AND: and } : {},
        include: PAYMENT_INCLUDE,
        orderBy: [{ createdAt: direction }, { id: direction }],
        take: limit + 1,
      }),
      this.prisma.payment.groupBy({ by: ['status'], _count: { _all: true } }),
      approvedTopupsInRange(this.prisma, today),
    ]);
    const count = (...wanted: PaymentStatus[]) =>
      grouped.filter((row) => wanted.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
    const items = await this.toDtos(rows, 'OFFICE');
    const page = toPage(items, limit, (item) => [item.createdAt, item.id]);
    return {
      counts: { toCheck: count('PENDING'), approved: count('SUCCESS'), rejected: count('REJECTED', 'FAILED') },
      approvedToday: { count: approvedToday.count, totalPaisa: approvedToday.totalPaisa.toString() },
      items: page.items,
      nextCursor: page.nextCursor,
    };
  }

  /** Today's approvals (count and credited total), the figure `GET /admin/summary` shows too. */
  async approvedToday(): Promise<{ count: number; totalPaisa: bigint }> {
    return approvedTopupsInRange(this.prisma, await currentBusinessDay(this.settings));
  }

  /**
   * `POST /payments/:id/approve` (API_CONTRACT §7.9), in one transaction:
   * 1. lock the request; PENDING, or already SUCCESS with this reference (a repeat: X-Already-Applied);
   *    it must be a manual bank top-up;
   * 2. the reference was normalised by the body schema (A–Z0–9, 3–40);
   * 3. the bank time at most 5 minutes ahead of the server clock;
   * 4. the bank amount within the limits;
   * 5. a different amount follows `topup.onAmountMismatch`;
   * 6. the cap, against the credited amount;
   * 7. the reference unused anywhere (the unique key backs this check), then the guarded update, the
   *    credit through WalletService and the audit row.
   * The distributor's status doesn't matter: the money is already in the bank.
   */
  async approve(actor: UserActor, paymentId: string, body: ApproveTopupInput): Promise<Repeatable<TopupApproveResult>> {
    const key = body.bankReferenceKey;
    const bankAmount = BigInt(body.bankAmountPaisa);
    const bankTime = new Date(body.bankTime);
    let outcome: { paymentId: string; repeated: boolean };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const payment = await this.lockPayment(tx, paymentId);
        if (!payment) throw new AppError('NOT_FOUND');
        if (payment.status === 'SUCCESS' && payment.bankReferenceKey === key) return { paymentId: payment.id, repeated: true };
        if (payment.status !== 'PENDING') throw await this.notPending(tx, payment);
        if (payment.provider !== 'BANK_MANUAL') throw new AppError('PAYMENT_WEBHOOK_DISABLED');

        if (isBankTimeInFuture(bankTime)) throw new AppError('TOPUP_BANK_TIME_IN_FUTURE');
        assertTopupAmount(bankAmount, await this.limits());
        const amountDiffered = bankAmount !== payment.amountPaisa;
        if (amountDiffered && (await this.settings.get('topup.onAmountMismatch')) === 'REJECT') {
          throw new AppError('TOPUP_AMOUNT_MISMATCH');
        }
        const locked = await this.wallet.lockBalance(tx, payment.distributorId);
        if (!locked) throw new AppError('NOT_FOUND');
        assertUnderCap(await this.cap(), locked.balancePaisa, 0n, bankAmount);

        const holder = await tx.payment.findUnique({ where: { bankReferenceKey: key }, include: PAYMENT_INCLUDE });
        if (holder) throw this.referenceUsed(holder);
        const updated = await tx.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: {
            status: 'SUCCESS',
            bankReference: body.bankReference,
            bankReferenceKey: key,
            bankAmountPaisa: bankAmount,
            bankReceivedAt: bankTime,
            verifiedByUserId: actor.userId,
            completedAt: new Date(),
          },
        });
        if (updated.count !== 1) throw new AppError('CONFLICT_STALE_STATE');
        await this.wallet.creditTopup(tx, { distributorId: payment.distributorId, paymentId: payment.id, amountPaisa: bankAmount, actor });
        await this.audit.record(
          {
            action: 'topup.approve',
            actor,
            resourceType: 'Payment',
            resourceId: payment.id,
            distributorId: payment.distributorId,
            diff: {
              shortCode: topupShortCode(payment.distributor.code, payment.requestNo),
              distributor: payment.distributor.businessName,
              amountPaisa: payment.amountPaisa,
              creditedPaisa: bankAmount,
              bankReference: body.bankReference,
              amountDiffered,
            },
          },
          tx,
        );
        return { paymentId: payment.id, repeated: false };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'payments_bank_reference_key_key')) {
        // Another request took this reference while this one waited: name it, as the pre-check would.
        const holder = await this.prisma.payment.findUnique({ where: { bankReferenceKey: key }, include: PAYMENT_INCLUDE });
        if (holder) throw this.referenceUsed(holder);
      }
      throw error;
    }

    const row = await this.prisma.payment.findUniqueOrThrow({ where: { id: outcome.paymentId }, include: PAYMENT_INCLUDE });
    const [payment, wallet] = await Promise.all([this.toDto(row, 'OFFICE'), this.wallet.summary(row.distributorId)]);
    const credited = row.bankAmountPaisa ?? row.amountPaisa;
    return { body: { payment, wallet, amountDiffered: credited !== row.amountPaisa }, repeated: outcome.repeated };
  }

  /**
   * `POST /payments/:id/reject`: a guarded update from PENDING to REJECTED with the reason, no money.
   * A repeat on a rejected request answers it unchanged (X-Already-Applied, no audit row); an approved
   * request is 409 TOPUP_NOT_PENDING. `auditReason` is for the legacy verify route (G02-04).
   */
  async reject(
    actor: UserActor,
    paymentId: string,
    body: RejectTopupInput,
    options: { auditReason?: string } = {},
  ): Promise<Repeatable<{ payment: PaymentDto }>> {
    const note = body.note ?? null;
    const outcome = await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, paymentId);
      if (!payment) throw new AppError('NOT_FOUND');
      if (payment.status === 'REJECTED' || payment.status === 'FAILED') return { paymentId: payment.id, repeated: true };
      if (payment.status !== 'PENDING') throw await this.notPending(tx, payment);
      const updated = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          rejectReasonCode: body.reasonCode,
          rejectNote: note,
          verifiedByUserId: actor.userId,
          completedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new AppError('CONFLICT_STALE_STATE');
      await this.audit.record(
        {
          action: 'topup.reject',
          actor,
          resourceType: 'Payment',
          resourceId: payment.id,
          distributorId: payment.distributorId,
          reason: options.auditReason ?? note ?? body.reasonCode,
          diff: {
            shortCode: topupShortCode(payment.distributor.code, payment.requestNo),
            distributor: payment.distributor.businessName,
            amountPaisa: payment.amountPaisa,
            reasonCode: body.reasonCode as TopupRejectReason,
            ...(note ? { note } : {}),
          },
        },
        tx,
      );
      return { paymentId: payment.id, repeated: false };
    });
    const row = await this.prisma.payment.findUniqueOrThrow({ where: { id: outcome.paymentId }, include: PAYMENT_INCLUDE });
    return { body: { payment: await this.toDto(row, 'OFFICE') }, repeated: outcome.repeated };
  }

  /**
   * Legacy `POST /payments/:id/verify` (office): `true` can't approve without the bank details
   * (TOPUP_BANK_REFERENCE_REQUIRED); `false` rejects with reason OTHER (G02-04).
   */
  async legacyVerify(actor: UserActor, paymentId: string, approve: boolean): Promise<Repeatable<{ payment: PaymentDto }>> {
    if (approve) throw new AppError('TOPUP_BANK_REFERENCE_REQUIRED');
    return this.reject(actor, paymentId, { reasonCode: 'OTHER', note: LEGACY_VERIFY_REJECT_NOTE }, { auditReason: LEGACY_VERIFY_AUDIT_REASON });
  }

  /** Legacy `GET /payments?status=` (office, kept for one release): the old row shape, safe fields only. */
  async legacyList(status?: PaymentStatus): Promise<LegacyPaymentRow[]> {
    // The old screen's "Rejected" filter asks for FAILED; new rejections are REJECTED.
    const statuses: PaymentStatus[] | undefined = status === undefined ? undefined : status === 'FAILED' ? ['FAILED', 'REJECTED'] : [status];
    const rows = await this.prisma.payment.findMany({
      where: statuses ? { status: { in: statuses } } : {},
      include: {
        proofFile: { select: { storageKey: true } },
        distributor: { select: { id: true, businessName: true, code: true, user: { select: { name: true, phone: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        distributorId: row.distributorId,
        amountPaisa: row.amountPaisa.toString(),
        provider: row.provider,
        status: row.status,
        proofUrl: await this.proofUrlOf(row),
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        distributor: {
          id: row.distributor.id,
          businessName: row.distributor.businessName,
          code: row.distributor.code,
          user: { name: row.distributor.user.name, phone: row.distributor.user.phone },
        },
      })),
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Internals

  /**
   * Rules 1–7 of `POST /payments/topup-requests` (API_CONTRACT §7.9), after the body schema and the
   * Idempotency-Key lookup: the account, the distributor ACTIVE, the limits, the cap, the pending count,
   * the proof file, then the insert and the `topup.request` audit row. The checks run under the
   * distributor's row lock (taken first, before the request is numbered), so two requests can't both
   * slip under a limit, and a twin with the same key is replayed without using up a number. A refused
   * request writes nothing and leaves the Idempotency-Key free.
   */
  private async createPending(
    actor: UserActor,
    request: PendingRequest,
    idempotencyKey: string | undefined,
  ): Promise<{ payment: PaymentRow; repeated: boolean }> {
    const distributorId = actor.distributorId;
    if (!distributorId) throw new AppError('PERMISSION_DENIED');
    if (idempotencyKey) {
      const existing = await this.findRequest(this.prisma, distributorId, idempotencyKey);
      if (existing) return { payment: this.sameRequest(existing, request), repeated: true };
    }
    await this.bank.account();

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the distributor before numbering, so a twin that waited here is answered before it takes
        // a number: a replay never uses up an AG-T number (ADR-22).
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM distributors WHERE id = ${distributorId}::uuid FOR UPDATE`;
        if (locked.length !== 1) throw new AppError('NOT_FOUND');
        if (idempotencyKey) {
          // A twin sent with the same key committed while this one waited for the lock.
          const twin = await this.findRequest(tx, distributorId, idempotencyKey);
          if (twin) return { payment: this.sameRequest(twin, request), repeated: true };
        }
        const numbered = await tx.$queryRaw<Array<{ no: number; status: DistributorStatus; balance: bigint }>>`
          UPDATE distributors SET next_topup_no = next_topup_no + 1
          WHERE id = ${distributorId}::uuid
          RETURNING next_topup_no - 1 AS no, status, advance_balance_paisa AS balance`;
        if (numbered.length !== 1) throw new AppError('NOT_FOUND');
        const { no, status, balance } = numbered[0];
        if (status !== 'ACTIVE') throw new AppError('DISTRIBUTOR_NOT_ACTIVE');
        assertTopupAmount(request.amountPaisa, await this.limits());
        const pending = await tx.payment.aggregate({
          where: { distributorId, status: 'PENDING' },
          _sum: { amountPaisa: true },
          _count: { _all: true },
        });
        assertUnderCap(await this.cap(), balance, pending._sum.amountPaisa ?? 0n, request.amountPaisa);
        const maxPending = await this.settings.get('topup.maxPendingPerDistributor');
        if (pending._count._all >= maxPending) throw new AppError('TOPUP_TOO_MANY_PENDING', { count: pending._count._all });
        if (request.proofFileId) {
          await this.files.assertUsable(request.proofFileId, { purpose: 'TOPUP_PROOF', uploadedByUserId: actor.userId }, tx);
        }

        const payment = await tx.payment.create({
          data: {
            distributorId,
            requestNo: Number(no),
            clientRequestId: idempotencyKey ?? null,
            amountPaisa: request.amountPaisa,
            provider: 'BANK_MANUAL',
            providerTxnId: null,
            status: 'PENDING',
            payerName: request.payerName,
            payerChannel: request.payerChannel,
            transactionId: request.transactionId,
            proofFileId: request.proofFileId,
          },
          include: PAYMENT_INCLUDE,
        });
        await this.audit.record(
          {
            action: 'topup.request',
            actor,
            resourceType: 'Payment',
            resourceId: payment.id,
            distributorId,
            diff: {
              shortCode: topupShortCode(payment.distributor.code, payment.requestNo),
              distributor: payment.distributor.businessName,
              amountPaisa: payment.amountPaisa,
              ...(request.payerChannel ? { payerChannel: request.payerChannel } : {}),
            },
          },
          tx,
        );
        return { payment, repeated: false };
      });
    } catch (error) {
      if (idempotencyKey && isUniqueViolation(error, 'payments_distributor_id_client_request_id_key')) {
        const existing = await this.findRequest(this.prisma, distributorId, idempotencyKey);
        if (existing) return { payment: this.sameRequest(existing, request), repeated: true };
      }
      throw error;
    }
  }

  private findRequest(
    db: Pick<Prisma.TransactionClient, 'payment'>,
    distributorId: string,
    clientRequestId: string,
  ): Promise<PaymentRow | null> {
    return db.payment.findUnique({
      where: { distributorId_clientRequestId: { distributorId, clientRequestId } },
      include: PAYMENT_INCLUDE,
    });
  }

  /** A retried request must match on amount, payer name and channel (G15-02), else IDEMPOTENCY_CONFLICT. */
  private sameRequest(stored: PaymentRow, request: PendingRequest): PaymentRow {
    assertSameRequest(
      { amountPaisa: stored.amountPaisa, payerName: stored.payerName, payerChannel: stored.payerChannel },
      { amountPaisa: request.amountPaisa, payerName: request.payerName, payerChannel: request.payerChannel },
      ['amountPaisa', 'payerName', 'payerChannel'],
    );
    return stored;
  }

  /** Locks one request (`SELECT … FOR UPDATE`) and loads it; null when it doesn't exist. */
  private async lockPayment(tx: Prisma.TransactionClient, paymentId: string): Promise<PaymentRow | null> {
    if (!isUuid(paymentId)) return null;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    return tx.payment.findUnique({ where: { id: locked[0].id }, include: PAYMENT_INCLUDE });
  }

  /** 409 TOPUP_NOT_PENDING `{status, reviewedBy, reviewedAt}` for a request someone already decided. */
  private async notPending(tx: Prisma.TransactionClient, payment: PaymentRow): Promise<AppError<'TOPUP_NOT_PENDING'>> {
    const reviewer = payment.verifiedByUserId
      ? await tx.user.findUnique({ where: { id: payment.verifiedByUserId }, select: { id: true, name: true } })
      : null;
    return new AppError('TOPUP_NOT_PENDING', {
      status: payment.status,
      reviewedBy: reviewer ? { id: reviewer.id, name: reviewer.name } : null,
      reviewedAt: payment.completedAt ? payment.completedAt.toISOString() : null,
    });
  }

  /** 409 TOPUP_BANK_REFERENCE_USED naming the request that already used the reference. */
  private referenceUsed(holder: PaymentRow): AppError<'TOPUP_BANK_REFERENCE_USED'> {
    return new AppError('TOPUP_BANK_REFERENCE_USED', {
      paymentShortCode: topupShortCode(holder.distributor.code, holder.requestNo),
      distributorName: holder.distributor.businessName,
      approvedAt: holder.completedAt ? holder.completedAt.toISOString() : null,
    });
  }

  private async limits(): Promise<TopupLimits> {
    const [min, max] = await Promise.all([this.settings.get('topup.minPaisa'), this.settings.get('topup.maxPaisa')]);
    return { minPaisa: BigInt(min), maxPaisa: BigInt(max) };
  }

  private async cap(): Promise<bigint | null> {
    const cap = await this.settings.get('wallet.maxBalancePaisa');
    return cap === null ? null : BigInt(cap);
  }

  private environment(): AppEnvironment {
    return (this.config.get<AppEnvironment>('app.environment') ?? 'development') as AppEnvironment;
  }

  /** The screenshot, signed for an hour: the stored file, else an old row's slip URL. */
  private async proofUrlOf(row: { proofFile: { storageKey: string } | null; proofUrl: string | null }): Promise<string | null> {
    if (row.proofFile) return this.files.urlFor(row.proofFile);
    return this.files.signStoredUrl(row.proofUrl);
  }

  private async toDto(row: PaymentRow, view: PaymentView): Promise<PaymentDto> {
    const [dto] = await this.toDtos([row], view);
    return dto;
  }

  private async toDtos(rows: PaymentRow[], view: PaymentView): Promise<PaymentDto[]> {
    const reviewers = new Map<string, IdName>();
    if (view === 'OFFICE') {
      const ids = [...new Set(rows.map((row) => row.verifiedByUserId).filter((id): id is string => !!id))];
      if (ids.length > 0) {
        const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
        for (const user of users) reviewers.set(user.id, { id: user.id, name: user.name });
      }
    }
    return Promise.all(
      rows.map(async (row) =>
        toPaymentDto(row, view, {
          proofUrl: await this.proofUrlOf(row),
          reviewer: row.verifiedByUserId ? reviewers.get(row.verifiedByUserId) ?? null : null,
        }),
      ),
    );
  }
}

/** One row of the legacy `GET /payments?status=` (the old office screen's shape, without secrets). */
export interface LegacyPaymentRow {
  id: string;
  distributorId: string;
  amountPaisa: string;
  provider: string;
  status: PaymentStatus;
  proofUrl: string | null;
  createdAt: string;
  completedAt: string | null;
  distributor: { id: string; businessName: string; code: string | null; user: { name: string; phone: string } };
}
