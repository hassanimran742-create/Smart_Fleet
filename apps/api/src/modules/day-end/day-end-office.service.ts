import { Injectable } from '@nestjs/common';
import {
  AlertStatus,
  AlertType,
  CustodyType,
  CylinderEventSource,
  CylinderEventType,
  CylinderState,
  DayCloseStatus,
  Prisma,
} from '@prisma/client';
import type {
  AdminDayEndDetail,
  AdminDayEndListItem,
  AdminSummaryDto,
  DayCloseTotals,
  DayEndApproveResult,
  IdName,
  Page,
  RegisteredCylinderDto,
} from '@smartfleet/shared-types';
import { businessDayRange, deriveDayCloseFix, formatNo, isIsoDate } from '@smartfleet/shared-utils';
import type { AdminDayEndListQuery, DayEndApproveInput, DayEndReopenInput, DayEndSendBackInput } from '@smartfleet/shared-validation';
import { randomBytes } from 'crypto';
import type { UserActor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { decodeCursor, invalidCursor, toPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { lockCylinderForMove, recordCustodyMove } from '../custody/custody-moves';
import { adjustInventoryLots } from '../custody/inventory-lots';
import { ScanService } from '../custody/scan.service';
import { REFILL_DAY_END_ACTOR_LABEL, finishRefillReceive, planRefillReceive } from '../filling-orders/refill-receive';
import { LOCKING_TX, type Db, type Tx } from '../orders/support/tx';
import { sizeLabelOf } from '../pricing/size-label';
import { SettingsService } from '../settings/settings.service';
import {
  DAY_RESOURCE_TYPE,
  DayEndCore,
  dbDate,
  isRightAfterReopen,
  isRightAfterSendBack,
  isoDateOf,
  latestOfficeNote,
  officeActionsOf,
  stageOf,
  type DayRow,
} from './day-end-core';
import { countDay, frozenTotals } from './day-end-summary';
import { dayEndTodayCard } from './day-end-today';

/** DATA_MODEL §5.4: the approval is one transaction with room for a long sheet (Prisma's default is 5 s). */
const APPROVE_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The reason an ADJUSTED event gets if a differing line somehow has no "Why different" (never in the pilot). */
const FALLBACK_REASON = 'Day-end sheet fix';

/**
 * [Inc 3] The office's day-end (API_CONTRACT §10.2; office exact): the list, the review, and the three
 * actions. Approval applies every listed fix except NOTE_ONLY in one transaction (DATA_MODEL §5.4),
 * skipping a cylinder that moved since the sheet, with one ADJUSTED event (source DAY_END_FIX, the line's
 * reason, the approver) or REGISTERED event per applied line, then locks the day with its totals frozen.
 * No money, ever. A repeated approve, send-back or reopen answers 200 with `X-Already-Applied`.
 */
@Injectable()
export class DayEndOfficeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: DayEndCore,
    private readonly scans: ScanService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
  ) {}

  // ---------- reads ----------

  /** `GET /admin/day-end?status&cursor&limit`: newest business date first. Tabs: SUBMITTED, OPEN, APPROVED. */
  async list(query: AdminDayEndListQuery): Promise<Page<AdminDayEndListItem>> {
    const cursor = decodeCursor(query.cursor, 2);
    if (cursor && (!isIsoDate(cursor[0]) || typeof cursor[1] !== 'string' || !UUID.test(cursor[1]))) throw invalidCursor();
    const rows = await this.prisma.dayClose.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(cursor
          ? { OR: [{ businessDate: { lt: dbDate(String(cursor[0])) } }, { businessDate: dbDate(String(cursor[0])), id: { lt: String(cursor[1]) } }] }
          : {}),
      },
      orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { distributor: { select: { id: true, businessName: true } } },
    });
    const page = toPage(rows, query.limit, (row) => [isoDateOf(row.businessDate), row.id]);
    const [counts, users] = await Promise.all([
      this.core.differenceCounts(this.prisma, page.items.map((row) => row.id)),
      this.userNames(page.items.map((row) => row.uploadedByUserId)),
    ]);
    return {
      items: page.items.map((day) => ({
        id: day.id,
        businessDate: isoDateOf(day.businessDate),
        distributor: { id: day.distributor.id, businessName: day.distributor.businessName },
        status: day.status,
        stage: stageOf(day),
        version: day.uploadVersion,
        differences: counts.get(day.id) ?? 0,
        uploadedAt: day.uploadedAt?.toISOString() ?? null,
        uploadedBy: day.uploadedByUserId ? users.get(day.uploadedByUserId) ?? null : null,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** `GET /admin/day-end/:id`: the review. An unknown id is 404 DAY_NOT_FOUND. */
  async detail(id: string): Promise<AdminDayEndDetail> {
    return this.detailOf(this.prisma, await this.dayOr404(id));
  }

  /** The Today card (`AdminSummaryDto.dayEnd`); see {@link dayEndTodayCard}. */
  todayCard(): Promise<AdminSummaryDto['dayEnd']> {
    return dayEndTodayCard(this.prisma, this.settings);
  }

  // ---------- approve ----------

  /**
   * `POST /admin/day-end/:id/approve { version }`. In order: 404 DAY_NOT_FOUND; OPEN DAY_NOT_SUBMITTED;
   * APPROVED with this version a repeat (200 `X-Already-Applied`), with another version DAY_LOCKED; another
   * version than the latest upload DAY_VERSION_CHANGED. Two approvals at once: the second waits on the day's
   * lock, then answers as a repeat. Allowed before the day's cut-off too.
   */
  async approve(actor: UserActor, id: string, body: DayEndApproveInput): Promise<DayEndApproveResult | IdempotentResponse<DayEndApproveResult>> {
    const found = await this.dayOr404(id);
    if (found.status === DayCloseStatus.OPEN) throw new AppError('DAY_NOT_SUBMITTED');
    if (found.status === DayCloseStatus.APPROVED) {
      if (body.version === found.uploadVersion) return alreadyApplied(await this.approveResult(found, null));
      throw new AppError('DAY_LOCKED');
    }
    if (body.version !== found.uploadVersion) throw new AppError('DAY_VERSION_CHANGED');

    const options = await this.core.options();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const day = await this.core.lockDay(tx, id);
      if (day.status === DayCloseStatus.APPROVED) {
        if (body.version === day.uploadVersion) return { kind: 'ALREADY' as const };
        throw new AppError('DAY_LOCKED');
      }
      if (day.status === DayCloseStatus.OPEN) throw new AppError('DAY_NOT_SUBMITTED');
      if (body.version !== day.uploadVersion) throw new AppError('DAY_VERSION_CHANGED');
      return { kind: 'APPROVED' as const, registered: await this.applyAndLock(tx, actor, day, options) };
    }, APPROVE_TX);

    const day = await this.prisma.dayClose.findUniqueOrThrow({ where: { id } });
    const result = await this.approveResult(day, outcome.kind === 'APPROVED' ? outcome.registered : null);
    return outcome.kind === 'ALREADY' ? alreadyApplied(result) : result;
  }

  /**
   * DATA_MODEL §5.4 under the day's lock: each differing line in sheet order; lock its cylinder; skip it
   * when the cylinder moved since the sheet (`skipped_moved_at`); else apply its fix. Then APPROVED with
   * the frozen totals, the DAY_END_SUBMITTED alert resolved and the `day.approve` audit row.
   */
  private async applyAndLock(tx: Tx, actor: UserActor, day: DayRow, options: { timezone: string; cutoffLocalTime: string }): Promise<RegisteredCylinderDto[]> {
    const distributor = await this.core.distributorOf(tx, day.distributorId);
    const lines = await this.core.differingLines(tx, day.id);
    const fixes: DayCloseTotals['fixes'] = { applied: 0, skipped: 0, unchanged: 0, registered: 0 };
    const registered: RegisteredCylinderDto[] = [];

    for (const line of lines) {
      const plan = deriveDayCloseFix({
        app: line.cylinderId && line.systemPlace && line.systemState ? { place: line.systemPlace, state: line.systemState } : null,
        sheet: { place: line.reportedPlace, state: line.reportedState },
      });
      if (!plan) continue;

      if (plan.fix === 'REGISTER') {
        // An extra number an earlier approval of this day already registered (the day was reopened and the
        // sheet sent again: the line kept its link, day-end-lines.ts) is one physical cylinder, added once.
        if (line.appliedEventId) {
          fixes.unchanged += 1;
          continue;
        }
        const made = await this.registerExtra(tx, actor, distributor, line);
        await tx.dayCloseLine.update({ where: { id: line.id }, data: { appliedEventId: made.eventId } });
        registered.push(made.cylinder);
        fixes.registered += 1;
        continue;
      }

      const cylinder = await lockCylinderForMove(tx, line.cylinderId as string);
      const last = cylinder.last_event_id
        ? await tx.cylinderEvent.findUnique({ where: { id: cylinder.last_event_id }, select: { id: true, createdAt: true } })
        : null;
      // The fix an earlier approval of this day wrote for this line isn't a move since the sheet (the review's
      // `movedSinceSheet` reads it the same way, day-end-core `movedSince`).
      const ownFix = !!last && last.id === line.appliedEventId;
      if (last && !ownFix && day.sheetSnapshotAt && last.createdAt.getTime() > day.sheetSnapshotAt.getTime()) {
        await tx.dayCloseLine.update({ where: { id: line.id }, data: { skippedMovedAt: last.createdAt } });
        fixes.skipped += 1;
        continue;
      }
      if (plan.fix === 'NOTE_ONLY') {
        fixes.unchanged += 1;
        continue;
      }
      const intoStore = plan.fix === 'MOVE_TO_STORE';
      const to = intoStore ? { type: CustodyType.STORE, id: distributor.homeStoreId } : { type: cylinder.custody_type, id: cylinder.custody_id };
      // A cylinder still on an open refill line that the shop counted in its store comes back for its refill,
      // as the store's receive scan would bring it (refill-receive.ts; the cylinder is locked, the refill next).
      const refill = intoStore ? await planRefillReceive(tx, { id: cylinder.id, state: cylinder.state }) : null;
      const toState =
        plan.fix === 'MARK_LOST' ? CylinderState.LOST : ((plan.toState as CylinderState | null) ?? refill?.toState ?? cylinder.state);
      const event = await recordCustodyMove(tx, {
        cylinder,
        eventType: CylinderEventType.ADJUSTED,
        to,
        toState,
        source: CylinderEventSource.DAY_END_FIX,
        actorUserId: actor.userId,
        reason: line.note?.trim() ? line.note : FALLBACK_REASON,
        fillingOrderId: refill?.fillingOrderId ?? null,
      });
      if (refill) {
        // The line becomes RETURNED; the last one back completes the refill (refill.complete, SYSTEM). No money.
        await finishRefillReceive(tx, this.audit, refill, {
          eventId: event.id,
          receivedByUserId: actor.userId,
          at: event.createdAt,
          actorLabel: REFILL_DAY_END_ACTOR_LABEL,
        });
      }
      await tx.dayCloseLine.update({ where: { id: line.id }, data: { appliedEventId: event.id } });
      fixes.applied += 1;
    }

    const date = isoDateOf(day.businessDate);
    const now = new Date();
    const counts = await countDay(tx, { distributorId: day.distributorId, homeStoreId: distributor.homeStoreId, range: businessDayRange(date, options) });
    await tx.dayClose.update({
      where: { id: day.id },
      data: {
        status: DayCloseStatus.APPROVED,
        approvedAt: now,
        approvedByUserId: actor.userId,
        lockedAt: now,
        totals: frozenTotals(counts, fixes, now) as unknown as Prisma.InputJsonValue,
      },
    });
    await resolveSubmittedAlert(tx, day.id, actor.userId, now);
    await this.audit.record(
      {
        action: 'day.approve',
        actor,
        resourceType: DAY_RESOURCE_TYPE,
        resourceId: day.id,
        distributorId: day.distributorId,
        diff: { businessDate: date, version: day.uploadVersion, ...fixes, registeredCodes: registered.map((cylinder) => cylinder.shortCode) },
      },
      tx,
    );
    return registered;
  }

  /**
   * A REGISTER fix: a new cylinder in the home store with the line's size and state and the **next** short
   * number (not the sheet's), with one REGISTERED event (source REGISTRATION), as the bulk register makes it.
   */
  private async registerExtra(
    tx: Tx,
    actor: UserActor,
    distributor: { id: string; code: string; homeStoreId: string },
    line: { cylinderTypeId: string | null; reportedState: CylinderState | null },
  ): Promise<{ eventId: string; cylinder: RegisteredCylinderDto }> {
    if (!line.cylinderTypeId) throw new AppError('INTERNAL_ERROR', { reason: 'DAY_LINE_WITHOUT_SIZE' });
    const type = await tx.cylinderType.findUniqueOrThrow({ where: { id: line.cylinderTypeId }, select: { id: true, code: true, name: true, weightKg: true } });
    const state = line.reportedState ?? CylinderState.FULL;
    const [{ no }] = await tx.$queryRaw<Array<{ no: number }>>`
      UPDATE distributors SET next_cylinder_no = next_cylinder_no + 1, updated_at = (now() AT TIME ZONE 'UTC')
      WHERE id = ${distributor.id}::uuid
      RETURNING next_cylinder_no - 1 AS no`;
    const shortNo = Number(no);
    const code = await freshCode(tx, type.code);
    const cylinder = await tx.cylinder.create({
      data: {
        serial: code,
        qrCode: code,
        distributorId: distributor.id,
        cylinderTypeId: type.id,
        shortNo,
        state,
        custodyType: CustodyType.STORE,
        custodyId: distributor.homeStoreId,
      },
      select: { id: true },
    });
    await this.scans.registerMoves(tx, { actorUserId: actor.userId, storeId: distributor.homeStoreId, cylinderIds: [cylinder.id] });
    const event = await tx.cylinderEvent.findFirstOrThrow({
      where: { cylinderId: cylinder.id, eventType: CylinderEventType.REGISTERED },
      select: { id: true },
    });
    // The legacy inventory lots stay in step, as every move keeps them (damaged and lost aren't counted).
    await adjustInventoryLots(tx, {
      distributorId: distributor.id,
      cylinderTypeId: type.id,
      from: null,
      to: { holderType: CustodyType.STORE, holderId: distributor.homeStoreId, state },
    });
    return {
      eventId: event.id,
      cylinder: {
        id: cylinder.id,
        code,
        shortNo,
        shortCode: formatNo(distributor.code, 'CYLINDER', shortNo),
        sizeLabel: sizeLabelOf(type),
      },
    };
  }

  /** The approve answer: the locked day and the cylinders its approval registered (for their labels). */
  private async approveResult(day: DayRow, registered: RegisteredCylinderDto[] | null): Promise<DayEndApproveResult> {
    return { day: await this.detailOf(this.prisma, day), registered: registered ?? (await this.registeredBy(day)) };
  }

  /** The cylinders an approval of this day registered (a repeat answers with the same list). */
  private async registeredBy(day: DayRow): Promise<RegisteredCylinderDto[]> {
    const lines = await this.prisma.dayCloseLine.findMany({
      where: { dayCloseId: day.id, cylinderId: null, appliedEventId: { not: null } },
      select: {
        appliedEvent: {
          select: {
            cylinder: {
              select: {
                id: true,
                qrCode: true,
                shortNo: true,
                distributor: { select: { code: true } },
                cylinderType: { select: { name: true, weightKg: true } },
              },
            },
          },
        },
      },
    });
    return lines
      .map((line) => line.appliedEvent?.cylinder)
      .filter((cylinder): cylinder is NonNullable<typeof cylinder> => !!cylinder && cylinder.shortNo !== null)
      .sort((a, b) => (a.shortNo as number) - (b.shortNo as number))
      .map((cylinder) => ({
        id: cylinder.id,
        code: cylinder.qrCode,
        shortNo: cylinder.shortNo as number,
        shortCode: formatNo(cylinder.distributor.code, 'CYLINDER', cylinder.shortNo as number),
        sizeLabel: sizeLabelOf(cylinder.cylinderType),
      }));
  }

  // ---------- send back and reopen ----------

  /**
   * `POST /admin/day-end/:id/send-back { reason }`: SUBMITTED → OPEN with the reason (the shop must upload
   * again before it can submit). A repeat right after it (OPEN, no upload since) is 200 `X-Already-Applied`
   * and keeps the first reason. Any other OPEN day is DAY_NOT_SUBMITTED; APPROVED is DAY_LOCKED.
   */
  async sendBack(actor: UserActor, id: string, body: DayEndSendBackInput): Promise<AdminDayEndDetail | IdempotentResponse<AdminDayEndDetail>> {
    await this.dayOr404(id);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const day = await this.core.lockDay(tx, id);
      if (day.status === DayCloseStatus.APPROVED) throw new AppError('DAY_LOCKED');
      if (day.status === DayCloseStatus.OPEN) {
        if (isRightAfterSendBack(day)) return 'ALREADY' as const;
        throw new AppError('DAY_NOT_SUBMITTED');
      }
      const now = new Date();
      await tx.dayClose.update({ where: { id }, data: { status: DayCloseStatus.OPEN, sentBackAt: now, sentBackReason: body.reason } });
      await resolveSubmittedAlert(tx, id, actor.userId, now);
      await this.audit.record(
        {
          action: 'day.send_back',
          actor,
          resourceType: DAY_RESOURCE_TYPE,
          resourceId: id,
          distributorId: day.distributorId,
          reason: body.reason,
          diff: { businessDate: isoDateOf(day.businessDate), version: day.uploadVersion },
        },
        tx,
      );
      return 'SENT_BACK' as const;
    }, LOCKING_TX);
    const detail = await this.detailOf(this.prisma, await this.dayOr404(id));
    return outcome === 'ALREADY' ? alreadyApplied(detail) : detail;
  }

  /**
   * `POST /admin/day-end/:id/reopen { reason }` (rare): APPROVED → OPEN with the reason, `locked_at`
   * cleared; the fixes already applied stay. A repeat right after it (OPEN, no upload since) is 200
   * `X-Already-Applied`. Any other state is 409 CONFLICT_STALE_STATE `{ currentStatus }`.
   */
  async reopen(actor: UserActor, id: string, body: DayEndReopenInput): Promise<AdminDayEndDetail | IdempotentResponse<AdminDayEndDetail>> {
    await this.dayOr404(id);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const day = await this.core.lockDay(tx, id);
      if (day.status !== DayCloseStatus.APPROVED) {
        if (isRightAfterReopen(day)) return 'ALREADY' as const;
        throw new AppError('CONFLICT_STALE_STATE', { currentStatus: day.status });
      }
      await tx.dayClose.update({
        where: { id },
        data: { status: DayCloseStatus.OPEN, reopenedAt: new Date(), reopenReason: body.reason, lockedAt: null },
      });
      await this.audit.record(
        {
          action: 'day.reopen',
          actor,
          resourceType: DAY_RESOURCE_TYPE,
          resourceId: id,
          distributorId: day.distributorId,
          reason: body.reason,
          diff: { businessDate: isoDateOf(day.businessDate), version: day.uploadVersion },
        },
        tx,
      );
      return 'REOPENED' as const;
    }, LOCKING_TX);
    const detail = await this.detailOf(this.prisma, await this.dayOr404(id));
    return outcome === 'ALREADY' ? alreadyApplied(detail) : detail;
  }

  // ---------- the review DTO ----------

  private async dayOr404(id: string): Promise<DayRow> {
    const day = UUID.test(id) ? await this.prisma.dayClose.findUnique({ where: { id } }) : null;
    if (!day) throw new AppError('DAY_NOT_FOUND');
    return day;
  }

  private async detailOf(db: Db, day: DayRow): Promise<AdminDayEndDetail> {
    const date = isoDateOf(day.businessDate);
    const [distributor, options, differences, users] = await Promise.all([
      this.core.distributorOf(db, day.distributorId),
      this.core.options(),
      this.core.differences(db, day, { office: true }),
      this.userNames([day.uploadedByUserId, day.approvedByUserId]),
    ]);
    const summary = await this.core.summary(db, { day, distributorId: day.distributorId, homeStoreId: distributor.homeStoreId, date, options });
    // After a reopen, an extra number this day already registered is listed again but won't be added again.
    const registeredAlready =
      day.status === DayCloseStatus.APPROVED
        ? new Set<string>()
        : new Set(
            (await db.dayCloseLine.findMany({ where: { dayCloseId: day.id, cylinderId: null, appliedEventId: { not: null } }, select: { id: true } })).map(
              (line) => line.id,
            ),
          );
    return {
      id: day.id,
      businessDate: date,
      distributor: { id: distributor.id, businessName: distributor.businessName },
      status: day.status,
      stage: stageOf(day),
      version: day.uploadVersion,
      differences: differences.length,
      uploadedAt: day.uploadedAt?.toISOString() ?? null,
      uploadedBy: day.uploadedByUserId ? users.get(day.uploadedByUserId) ?? null : null,
      summary,
      fixesToApply: differences.filter((line) => line.fix !== 'NOTE_ONLY' && !line.movedSinceSheet && !registeredAlready.has(line.id)),
      lines: differences,
      files: { sheetFileId: day.sheetFileId, uploadFileId: day.uploadFileId },
      submittedAt: day.status !== DayCloseStatus.OPEN && day.submittedAt ? day.submittedAt.toISOString() : null,
      approvedAt: day.status === DayCloseStatus.APPROVED && day.approvedAt ? day.approvedAt.toISOString() : null,
      approvedBy: day.status === DayCloseStatus.APPROVED && day.approvedByUserId ? users.get(day.approvedByUserId) ?? null : null,
      officeNote: latestOfficeNote(day),
      allowedActions: officeActionsOf(day),
    };
  }

  private async userNames(ids: readonly (string | null)[]): Promise<Map<string, IdName>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, { id: user.id, name: user.name }]));
  }
}

/** Approve and send-back resolve the day's DAY_END_SUBMITTED alert (in the same transaction). */
async function resolveSubmittedAlert(tx: Tx, dayId: string, userId: string, at: Date): Promise<void> {
  await tx.alert.updateMany({
    where: {
      alertType: AlertType.DAY_END_SUBMITTED,
      resourceType: DAY_RESOURCE_TYPE,
      resourceId: dayId,
      status: { in: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED] },
    },
    data: { status: AlertStatus.RESOLVED, resolvedAt: at, resolvedByUserId: userId },
  });
}

/** A QR value and serial for a new cylinder, as the bulk register makes them: `<type code>-<8 hex>`, unused. */
async function freshCode(tx: Tx, typeCode: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = `${typeCode}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const used = await tx.cylinder.count({ where: { OR: [{ serial: code }, { qrCode: code }] } });
    if (used === 0) return code;
  }
  throw new AppError('CONFLICT_STALE_STATE');
}
