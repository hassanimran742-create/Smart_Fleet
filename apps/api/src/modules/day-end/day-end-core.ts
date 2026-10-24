import { Injectable } from '@nestjs/common';
import { CustodyType, DayCloseDiff, DayCloseStatus, Prisma, type DayClose } from '@prisma/client';
import type {
  AdminDayEndAction,
  DayCloseDifferenceDto,
  DayCloseFix,
  DayCloseState,
  DayEndAction,
  DayEndOfficeNote,
  DayEndStage,
  DayEndSummary,
} from '@smartfleet/shared-types';
import { businessDate, businessDayRange, deriveDayCloseFix, deriveDayEndStage, type BusinessDayOptions } from '@smartfleet/shared-utils';
import { businessDateParamSchema } from '@smartfleet/shared-validation';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { businessDayOptions } from '../orders/support/business-day';
import type { Db, Tx } from '../orders/support/tx';
import { sizeLabelOf } from '../pricing/size-label';
import { SettingsService } from '../settings/settings.service';
import { DayEndClock } from './day-end-clock';
import { countDay, readTotals } from './day-end-summary';

/**
 * [Inc 3] What the shop's and the office's day-end routes share (API_CONTRACT §10.2): the business date
 * of `:date`, the day row and its lock, the derived stage, the office's note, the allowed actions, the
 * summary, and the differing lines as `DayCloseDifferenceDto`. Nothing here writes holder data or money.
 */

/** The `DAY_END_SUBMITTED` alert and the audit rows point at the day (`resourceType`). */
export const DAY_RESOURCE_TYPE = 'DayClose';

/** A day row as the routes read it. */
export type DayRow = DayClose;

/** The fields the stage and the office note read. */
type StageFields = Pick<DayClose, 'status' | 'sentBackAt' | 'reopenedAt' | 'uploadedAt' | 'sheetSnapshotAt'>;

/** `YYYY-MM-DD` of a `@db.Date` value (Prisma reads it as UTC midnight). */
export function isoDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The `@db.Date` value of a `YYYY-MM-DD` business date. */
export function dbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** The stage people see (API_CONTRACT §1.4); NOT_STARTED for a date with no row. */
export function stageOf(day: StageFields | null): DayEndStage {
  return deriveDayEndStage(day);
}

/**
 * The office's latest note: the later of the send-back reason (`sent_back_at`) and the reopen reason
 * (`reopened_at`); null when there is none.
 */
export function latestOfficeNote(day: Pick<DayClose, 'sentBackAt' | 'sentBackReason' | 'reopenedAt' | 'reopenReason'> | null): DayEndOfficeNote | null {
  if (!day) return null;
  const sent = day.sentBackAt?.getTime() ?? -Infinity;
  const reopened = day.reopenedAt?.getTime() ?? -Infinity;
  if (reopened === -Infinity && sent === -Infinity) return null;
  if (reopened > sent && day.reopenedAt) return { kind: 'REOPENED', text: day.reopenReason ?? '', at: day.reopenedAt.toISOString() };
  if (day.sentBackAt) return { kind: 'SENT_BACK', text: day.sentBackReason ?? '', at: day.sentBackAt.toISOString() };
  return null;
}

/** The shop's `officeNote`: set only while the stage is SENT_BACK (API_CONTRACT §10.2). */
export function shopOfficeNote(day: (StageFields & Pick<DayClose, 'sentBackReason' | 'reopenReason'>) | null): DayEndOfficeNote | null {
  return day && stageOf(day) === 'SENT_BACK' ? latestOfficeNote(day) : null;
}

/** The shop's buttons: DOWNLOAD while OPEN or with no row; UPLOAD while OPEN with a sheet made; SUBMIT when READY. */
export function shopActionsOf(day: (StageFields & Pick<DayClose, 'sheetFileId'>) | null): DayEndAction[] {
  if (!day) return ['DOWNLOAD'];
  if (day.status !== DayCloseStatus.OPEN) return [];
  const actions: DayEndAction[] = ['DOWNLOAD'];
  if (day.sheetFileId) actions.push('UPLOAD');
  if (stageOf(day) === 'READY') actions.push('SUBMIT');
  return actions;
}

/** The office's buttons: approve or send back a SUBMITTED day, reopen an APPROVED one. */
export function officeActionsOf(day: Pick<DayClose, 'status'>): AdminDayEndAction[] {
  if (day.status === DayCloseStatus.SUBMITTED) return ['APPROVE', 'SEND_BACK'];
  if (day.status === DayCloseStatus.APPROVED) return ['REOPEN'];
  return [];
}

/** True for a repeat right after a send-back: OPEN, the send-back is the office's latest note, and no upload since. */
export function isRightAfterSendBack(day: DayClose): boolean {
  if (day.status !== DayCloseStatus.OPEN || !day.sentBackAt) return false;
  if (day.reopenedAt && day.reopenedAt.getTime() > day.sentBackAt.getTime()) return false;
  return !day.uploadedAt || day.uploadedAt.getTime() <= day.sentBackAt.getTime();
}

/** True for a repeat right after a reopen: OPEN, the reopen is the office's latest note, and no upload since. */
export function isRightAfterReopen(day: DayClose): boolean {
  if (day.status !== DayCloseStatus.OPEN || !day.reopenedAt) return false;
  if (day.sentBackAt && day.sentBackAt.getTime() > day.reopenedAt.getTime()) return false;
  return !day.uploadedAt || day.uploadedAt.getTime() <= day.reopenedAt.getTime();
}

/** A differing line with what the DTOs need: its cylinder (number, last move) and its size. */
const LINE_INCLUDE = {
  cylinder: { select: { shortNo: true, lastEvent: { select: { id: true, createdAt: true } } } },
  cylinderType: { select: { name: true, weightKg: true } },
} satisfies Prisma.DayCloseLineInclude;

type LineWithRefs = Prisma.DayCloseLineGetPayload<{ include: typeof LINE_INCLUDE }>;

/** A line's fix (G09-03): it isn't stored, it follows from the line's stored values. */
export function fixOf(line: Pick<LineWithRefs, 'cylinderId' | 'systemPlace' | 'systemState' | 'reportedPlace' | 'reportedState'>): DayCloseFix | null {
  const plan = deriveDayCloseFix({
    app: line.cylinderId && line.systemPlace && line.systemState ? { place: line.systemPlace, state: line.systemState } : null,
    sheet: { place: line.reportedPlace, state: line.reportedState },
  });
  return plan ? plan.fix : null;
}

/**
 * True when the line's cylinder moved after the sheet was made (its last move is newer than the sheet
 * time). The move an approval wrote for this very line doesn't count: an applied fix isn't a move "since".
 */
export function movedSince(line: Pick<LineWithRefs, 'cylinder' | 'appliedEventId'>, sheetAt: Date | null): boolean {
  const last = line.cylinder?.lastEvent;
  if (!last || !sheetAt) return false;
  if (line.appliedEventId && last.id === line.appliedEventId) return false;
  return last.createdAt.getTime() > sheetAt.getTime();
}

/** Sheet order: the listed cylinders by number, then the extra numbers. */
function sheetOrder(a: LineWithRefs, b: LineWithRefs): number {
  const an = a.cylinder?.shortNo ?? null;
  const bn = b.cylinder?.shortNo ?? null;
  if (an !== null && bn !== null) return an - bn;
  if (an !== null) return -1;
  if (bn !== null) return 1;
  return a.sheetKey.localeCompare(b.sheetKey);
}

@Injectable()
export class DayEndCore {
  constructor(
    readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: DayEndClock,
  ) {}

  /** `day.timezone` and `day.cutoffLocalTime`, read fresh (G12-03). */
  options(): Promise<Required<BusinessDayOptions>> {
    return businessDayOptions(this.settings);
  }

  /** The current business date (the clock's instant, the day settings). */
  async today(options?: Required<BusinessDayOptions>): Promise<string> {
    return businessDate(this.clock.now(), options ?? (await this.options()));
  }

  /**
   * `:date` of the shop's routes: a real `YYYY-MM-DD` no later than the current business date, else
   * 404 DAY_NOT_FOUND (never 400).
   */
  async parseDate(raw: unknown): Promise<{ date: string; options: Required<BusinessDayOptions> }> {
    const parsed = businessDateParamSchema.safeParse(raw);
    if (!parsed.success) throw new AppError('DAY_NOT_FOUND');
    const options = await this.options();
    if (parsed.data > (await this.today(options))) throw new AppError('DAY_NOT_FOUND');
    return { date: parsed.data, options };
  }

  /** The end of a business day (the next cut-off): `cutoffAt`. */
  cutoffAt(date: string, options: Required<BusinessDayOptions>): string {
    return businessDayRange(date, options).end.toISOString();
  }

  /** The distributor's day row for a date, or null (a read never creates one). */
  findDay(db: Db, distributorId: string, date: string): Promise<DayRow | null> {
    return db.dayClose.findUnique({ where: { distributorId_businessDate: { distributorId, businessDate: dbDate(date) } } });
  }

  /** Locks a day row `FOR UPDATE` and reads it again. */
  async lockDay(tx: Tx, dayId: string): Promise<DayRow> {
    await tx.$queryRaw`SELECT id FROM day_closes WHERE id = ${dayId}::uuid FOR UPDATE`;
    return tx.dayClose.findUniqueOrThrow({ where: { id: dayId } });
  }

  /**
   * The day row for a sheet download, created OPEN when the date has none, then locked. Two downloads at
   * once still make one row (day_closes_distributor_id_business_date_key: the second waits, then finds it).
   */
  async ensureDayLocked(tx: Tx, distributorId: string, date: string): Promise<DayRow> {
    await tx.$executeRaw`
      INSERT INTO day_closes (id, distributor_id, business_date, status, upload_version, created_at, updated_at)
      VALUES (gen_random_uuid(), ${distributorId}::uuid, ${date}::date, 'OPEN', 0, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      ON CONFLICT (distributor_id, business_date) DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM day_closes WHERE distributor_id = ${distributorId}::uuid AND business_date = ${date}::date FOR UPDATE`;
    return tx.dayClose.findUniqueOrThrow({ where: { id: rows[0].id } });
  }

  /** The distributor's home store and code. */
  async distributorOf(db: Db, distributorId: string): Promise<{ id: string; code: string; businessName: string; homeStoreId: string; userId: string }> {
    const distributor = await db.distributor.findUnique({
      where: { id: distributorId },
      select: { id: true, code: true, businessName: true, homeStoreId: true, userId: true },
    });
    if (!distributor) throw new AppError('PERMISSION_DENIED');
    return distributor;
  }

  /** The day's summary: frozen on an APPROVED day, live otherwise (a date with no row is live). */
  async summary(
    db: Db,
    p: { day: DayRow | null; distributorId: string; homeStoreId: string; date: string; options: Required<BusinessDayOptions> },
  ): Promise<DayEndSummary> {
    if (p.day?.status === DayCloseStatus.APPROVED) {
      const totals = readTotals(p.day.totals);
      if (totals) return totals.summary;
    }
    const counts = await countDay(db, { distributorId: p.distributorId, homeStoreId: p.homeStoreId, range: businessDayRange(p.date, p.options) });
    return counts.summary;
  }

  /** How many lines of each day differ (diff ≠ MATCH). */
  async differenceCounts(db: Db, dayIds: readonly string[]): Promise<Map<string, number>> {
    if (dayIds.length === 0) return new Map();
    const groups = await db.dayCloseLine.groupBy({
      by: ['dayCloseId'],
      where: { dayCloseId: { in: [...dayIds] }, diff: { not: DayCloseDiff.MATCH } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.dayCloseId, group._count._all]));
  }

  /** The day's differing lines, in sheet order, with their cylinders and sizes. */
  differingLines(db: Db, dayId: string): Promise<LineWithRefs[]> {
    return db.dayCloseLine
      .findMany({ where: { dayCloseId: dayId, diff: { not: DayCloseDiff.MATCH } }, include: LINE_INCLUDE })
      .then((lines) => lines.sort(sheetOrder));
  }

  /**
   * The differing lines as the upload answer and the office review show them (API_CONTRACT §10.2):
   * the app and sheet values, the fix, the reason and `movedSinceSheet`; the office also gets `lastScanAt`
   * (the cylinder's last move).
   */
  async differences(db: Db, day: Pick<DayClose, 'id' | 'sheetSnapshotAt'>, opts: { office?: boolean } = {}): Promise<DayCloseDifferenceDto[]> {
    const lines = await this.differingLines(db, day.id);
    const vanIds = lines.filter((line) => line.systemPlace === 'VAN' && line.systemHolderId).map((line) => line.systemHolderId as string);
    const clientIds = lines.filter((line) => line.systemPlace === 'CUSTOMER' && line.systemHolderId).map((line) => line.systemHolderId as string);
    const [vans, clients] = await Promise.all([
      vanIds.length ? db.vehicle.findMany({ where: { id: { in: [...new Set(vanIds)] } }, select: { id: true, plateNo: true } }) : [],
      clientIds.length ? db.client.findMany({ where: { id: { in: [...new Set(clientIds)] } }, select: { id: true, name: true } }) : [],
    ]);
    const plates = new Map(vans.map((van) => [van.id, van.plateNo]));
    const names = new Map(clients.map((client) => [client.id, client.name]));
    return lines.map((line) => {
      const dto: DayCloseDifferenceDto = {
        id: line.id,
        diff: line.diff as DayCloseDifferenceDto['diff'],
        fix: fixOf(line) ?? 'NOTE_ONLY',
        shortCode: line.sheetKey,
        sizeLabel: line.cylinderType ? sizeLabelOf(line.cylinderType) : null,
        app:
          line.cylinderId && line.systemPlace && line.systemState
            ? {
                place: line.systemPlace,
                state: line.systemState as DayCloseState,
                plateNo: line.systemPlace === 'VAN' && line.systemHolderId ? plates.get(line.systemHolderId) ?? null : null,
                customerName: line.systemPlace === 'CUSTOMER' && line.systemHolderId ? names.get(line.systemHolderId) ?? null : null,
              }
            : null,
        sheet: { place: line.reportedPlace, state: (line.reportedState as DayCloseState | null) ?? null },
        note: line.note,
        movedSinceSheet: movedSince(line, day.sheetSnapshotAt),
      };
      if (opts.office) dto.lastScanAt = line.cylinder?.lastEvent?.createdAt.toISOString() ?? null;
      return dto;
    });
  }
}

/** A cylinder's holder as the comparison and the sheet read it (a legacy DISTRIBUTOR holder is the store). */
export function isStoreHolder(type: CustodyType): boolean {
  return type === CustodyType.STORE || type === CustodyType.DISTRIBUTOR;
}
