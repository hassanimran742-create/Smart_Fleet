import { Injectable } from '@nestjs/common';
import { AlertSeverity, AlertStatus, AlertType, DayCloseStatus, Prisma } from '@prisma/client';
import {
  DAY_SHEET_FORMAT,
  DAY_SHEET_LIMITS,
  type DayEndDayDto,
  type DayEndListItem,
  type DayEndSubmittedContext,
  type DayEndUploadResult,
  type Page,
} from '@smartfleet/shared-types';
import {
  appSaysWhere,
  daySheetStateWords,
  deriveDayCloseDiff,
  formatIsoDay,
  formatNo,
  isIsoDate,
  type BusinessDayOptions,
} from '@smartfleet/shared-utils';
import type { DayEndListQuery, DayEndSubmitInput } from '@smartfleet/shared-validation';
import { randomUUID } from 'crypto';
import type { UserActor } from '../../common/auth/actor';
import { ownDistributorId } from '../../common/auth/own-driver-id';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { alreadyApplied, type IdempotentResponse } from '../../common/idempotency/idempotency';
import { decodeCursor, invalidCursor, toPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LOCKING_TX, type Db, type Tx } from '../orders/support/tx';
import { compareSizes, sizeLabelOf, toCylinderSize } from '../pricing/size-label';
import { DAY_RESOURCE_TYPE, DayEndCore, dbDate, isoDateOf, shopActionsOf, shopOfficeNote, stageOf, type DayRow } from './day-end-core';
import { DayEndFiles } from './day-end-files';
import { appSideOf, applyRowRules, type DistributorCylinder, type SizeOption } from './day-end-rows';
import { buildDaySheetWorkbook, loadDayWorkbook, readAbout, readUploadedRows, type DaySheetRowOut } from './day-end-workbook';
import { inspectZip } from './day-end-zip';

/** Sheet downloads and uploads build or read a workbook inside their transaction: give them room. */
const SHEET_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An upload as multer hands it over. */
export interface DayEndUploadFile {
  buffer: Buffer;
  originalname?: string;
  size?: number;
}

/** The sheet the shop downloads. */
export interface DayEndSheetFile {
  bytes: Buffer;
  fileName: string;
}

/**
 * [Inc 3] The shop's day-end (API_CONTRACT §10.2; DISTRIBUTOR exact, own days): the system-made sheet with
 * one row per cylinder, the upload with its checks and the preview of every difference, and the submit.
 * An upload changes nothing in the holder data, and a refused upload stores nothing. No money, ever; no
 * scan is ever refused because of a day.
 */
@Injectable()
export class DayEndService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: DayEndCore,
    private readonly files: DayEndFiles,
    private readonly alerts: AlertsService,
    private readonly audit: AuditLogService,
  ) {}

  // ---------- reads ----------

  /** `GET /day-end`: the caller's days that have a row, newest first. */
  async list(actor: UserActor, query: DayEndListQuery): Promise<Page<DayEndListItem>> {
    const distributorId = ownDistributorId(actor);
    const cursor = decodeCursor(query.cursor, 2);
    if (cursor && (!isIsoDate(cursor[0]) || typeof cursor[1] !== 'string' || !UUID.test(cursor[1]))) throw invalidCursor();
    const rows = await this.prisma.dayClose.findMany({
      where: {
        distributorId,
        ...(cursor
          ? { OR: [{ businessDate: { lt: dbDate(String(cursor[0])) } }, { businessDate: dbDate(String(cursor[0])), id: { lt: String(cursor[1]) } }] }
          : {}),
      },
      orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = toPage(rows, query.limit, (row) => [isoDateOf(row.businessDate), row.id]);
    const counts = await this.core.differenceCounts(this.prisma, page.items.map((row) => row.id));
    return {
      items: page.items.map((day) => ({
        businessDate: isoDateOf(day.businessDate),
        status: day.status,
        stage: stageOf(day),
        submittedAt: day.status !== DayCloseStatus.OPEN && day.submittedAt ? day.submittedAt.toISOString() : null,
        approvedAt: day.status === DayCloseStatus.APPROVED && day.approvedAt ? day.approvedAt.toISOString() : null,
        differences: counts.get(day.id) ?? 0,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** `GET /day-end/:date`. A date with no row reads as OPEN, NOT_STARTED, `lastUpload: null` (and creates nothing). */
  async day(actor: UserActor, rawDate: unknown): Promise<DayEndDayDto> {
    const distributorId = ownDistributorId(actor);
    const { date, options } = await this.core.parseDate(rawDate);
    const distributor = await this.core.distributorOf(this.prisma, distributorId);
    const day = await this.core.findDay(this.prisma, distributorId, date);
    return this.dayDto(this.prisma, { day, distributor, date, options });
  }

  // ---------- the sheet ----------

  /**
   * `GET /day-end/:date/sheet.xlsx`: a new sheet of every cylinder of the caller as it is now (the sheet
   * time), stored as a DAY_END_SHEET file whose id the sheet carries. The first download for a date
   * creates its day row OPEN. Only the newest sheet can be uploaded. Changes no holder data and no lines.
   */
  async sheet(actor: UserActor, rawDate: unknown): Promise<DayEndSheetFile> {
    const distributorId = ownDistributorId(actor);
    const { date } = await this.core.parseDate(rawDate);
    const distributor = await this.core.distributorOf(this.prisma, distributorId);
    assertSheetAllowed(await this.core.findDay(this.prisma, distributorId, date));
    const fileName = `day-end-${distributor.code}-${date}.xlsx`;
    const stored: string[] = [];
    try {
      return await this.prisma.$transaction(async (tx) => {
        const day = await this.core.ensureDayLocked(tx, distributorId, date);
        assertSheetAllowed(day);
        // The sheet time is taken before the cylinders are read: a move written after it is "moved since the sheet".
        const sheetAt = new Date();
        const [rows, sizes] = await Promise.all([this.sheetRows(tx, distributor), sizeOptions(tx)]);
        const fileId = randomUUID();
        const bytes = await buildDaySheetWorkbook({
          about: { format: DAY_SHEET_FORMAT, distributorId, distributorCode: distributor.code, businessDate: date, sheetFileId: fileId },
          rows,
          sizes: sizes.map((size) => size.label),
          createdAt: sheetAt,
        });
        const file = await this.files.store(tx, {
          id: fileId,
          bytes,
          purpose: 'DAY_END_SHEET',
          uploadedByUserId: actor.userId,
          distributorId,
          originalName: fileName,
        });
        stored.push(file.storageKey);
        await tx.dayClose.update({ where: { id: day.id }, data: { sheetFileId: fileId, sheetSnapshotAt: sheetAt } });
        return { bytes, fileName };
      }, SHEET_TX);
    } catch (error) {
      for (const key of stored) await this.files.discard(key);
      throw error;
    }
  }

  /** One row per labelled cylinder of the distributor, by number, with "App says" as the app has it now. */
  private async sheetRows(db: Db, distributor: { id: string; code: string }): Promise<DaySheetRowOut[]> {
    const cylinders = await db.cylinder.findMany({
      where: { distributorId: distributor.id, shortNo: { not: null } },
      orderBy: [{ shortNo: 'asc' }],
      select: { shortNo: true, state: true, custodyType: true, custodyId: true, cylinderType: { select: { name: true, weightKg: true } } },
    });
    const vanIds = [...new Set(cylinders.filter((c) => c.custodyType === 'VEHICLE').map((c) => c.custodyId))];
    const clientIds = [...new Set(cylinders.filter((c) => c.custodyType === 'CLIENT').map((c) => c.custodyId))];
    const [vans, clients] = await Promise.all([
      vanIds.length ? db.vehicle.findMany({ where: { id: { in: vanIds } }, select: { id: true, plateNo: true } }) : [],
      clientIds.length ? db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : [],
    ]);
    const plates = new Map(vans.map((van) => [van.id, van.plateNo]));
    const names = new Map(clients.map((client) => [client.id, client.name]));
    return cylinders.map((cylinder) => {
      const app = appSideOf(cylinder);
      return {
        number: formatNo(distributor.code, 'CYLINDER', cylinder.shortNo as number),
        size: sizeLabelOf(cylinder.cylinderType),
        appWhere: appSaysWhere({
          place: app.place,
          plateNo: app.place === 'VAN' ? plates.get(cylinder.custodyId) ?? null : null,
          customerName: app.place === 'CUSTOMER' ? names.get(cylinder.custodyId) ?? null : null,
        }),
        appState: daySheetStateWords(app.state),
      };
    });
  }

  // ---------- the upload ----------

  /**
   * `POST /day-end/:date/upload` (multipart `file`). The checks run in the contract's order and nothing is
   * stored unless every one passes: size; the day; a real workbook with the "About" format; the shop; the
   * date; the newest sheet; the two sheets and their headers; every row. Then, in one transaction: the file
   * (DAY_END_UPLOAD), the day's lines replaced (one per cylinder plus one per extra row), and the version
   * bumped. The holder data never changes here.
   */
  async upload(actor: UserActor, rawDate: unknown, file: DayEndUploadFile | undefined): Promise<DayEndUploadResult> {
    const distributorId = ownDistributorId(actor);
    if (!file?.buffer) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'file', code: 'REQUIRED', message: validationMessage('REQUIRED') }] });
    }
    // 1. The size (multer already stops a bigger body; this is the same rule for any other caller).
    if (file.buffer.length > DAY_SHEET_LIMITS.maxBytes) throw new AppError('FILE_TOO_LARGE', { maxMb: DAY_SHEET_LIMITS.maxMb });

    // 2. The day.
    const { date, options } = await this.core.parseDate(rawDate);
    const before = await this.core.findDay(this.prisma, distributorId, date);
    assertUploadAllowed(before);

    // 3. A real workbook: the ZIP signature, at most 20 MB unzipped and 20,000 rows a sheet, and "About" with the format.
    const zip = inspectZip(file.buffer, { maxUnzippedBytes: DAY_SHEET_LIMITS.maxUnzippedBytes });
    if (!zip.ok) throw new AppError('DAY_SHEET_UNREADABLE');
    const workbook = await loadDayWorkbook(file.buffer, { maxRows: DAY_SHEET_LIMITS.maxRowsPerSheet });
    if (!workbook) throw new AppError('DAY_SHEET_UNREADABLE');
    const about = readAbout(workbook);
    if (!about || about.format !== DAY_SHEET_FORMAT) throw new AppError('DAY_SHEET_UNREADABLE');

    // 4. The shop. The answer holds nothing of another shop.
    if ((about.distributorId ?? '').toLowerCase() !== distributorId.toLowerCase()) throw new AppError('DAY_SHEET_WRONG_DISTRIBUTOR');

    // 5. The date.
    const sheetDate = about.businessDate ?? '';
    if (!isIsoDate(sheetDate)) throw new AppError('DAY_SHEET_UNREADABLE');
    if (sheetDate !== date) throw new AppError('DAY_SHEET_WRONG_DATE', { sheetDate, date });

    // 6. The newest sheet.
    const sheetFileId = (about.sheetFileId ?? '').toLowerCase();
    if (!before?.sheetFileId || sheetFileId !== before.sheetFileId.toLowerCase()) throw new AppError('DAY_SHEET_OUTDATED');

    // 7. The two sheets with their headers unchanged.
    const uploaded = readUploadedRows(workbook);
    if (!uploaded) throw new AppError('DAY_SHEET_UNREADABLE');

    const distributor = await this.core.distributorOf(this.prisma, distributorId);
    const stored: string[] = [];
    try {
      return await this.prisma.$transaction(async (tx) => {
        const day = await this.core.lockDay(tx, before.id);
        // The same checks under the lock: a submit or a new download may have landed meanwhile.
        assertUploadAllowed(day);
        if (!day.sheetFileId || day.sheetFileId.toLowerCase() !== sheetFileId) throw new AppError('DAY_SHEET_OUTDATED');

        // 8. Every row reads. The cylinders are read once, for the rules and for the lines.
        const [cylinders, sizes] = await Promise.all([distributorCylinders(tx, distributorId), sizeOptions(tx)]);
        const rules = applyRowRules({ distributorCode: distributor.code, cylinders, sizes, sheet: uploaded });
        if (rules.errors.length > 0) {
          throw new AppError('DAY_SHEET_ROW_ERRORS', { rows: rules.errors.slice(0, DAY_SHEET_LIMITS.maxListedRowErrors), total: rules.errors.length });
        }

        const fileId = randomUUID();
        const saved = await this.files.store(tx, {
          id: fileId,
          bytes: file.buffer,
          purpose: 'DAY_END_UPLOAD',
          uploadedByUserId: actor.userId,
          distributorId,
          originalName: file.originalname ?? null,
        });
        stored.push(saved.storageKey);

        const lines: Prisma.DayCloseLineCreateManyInput[] = cylinders.map((cylinder) => {
          const counted = rules.counts.get(cylinder.id);
          const app = appSideOf(cylinder);
          const reportedPlace = counted?.reportedPlace ?? null;
          const reportedState = counted?.reportedState ?? null;
          const diff = deriveDayCloseDiff({ app, sheet: { place: reportedPlace, state: reportedState } });
          return {
            dayCloseId: day.id,
            cylinderId: cylinder.id,
            sheetKey: formatNo(distributor.code, 'CYLINDER', cylinder.shortNo),
            cylinderTypeId: cylinder.cylinderTypeId,
            systemPlace: app.place,
            systemHolderId: cylinder.custodyId,
            systemState: cylinder.state,
            systemLastEventId: cylinder.lastEventId,
            reportedPlace,
            reportedState,
            note: diff === 'MATCH' ? null : counted?.note ?? null,
            diff,
          };
        });
        for (const extra of rules.extras) {
          lines.push({
            dayCloseId: day.id,
            cylinderId: null,
            sheetKey: extra.sheetKey,
            cylinderTypeId: extra.cylinderTypeId,
            reportedPlace: 'STORE',
            reportedState: extra.state,
            diff: 'UNKNOWN_CYLINDER',
          });
        }
        await tx.dayCloseLine.deleteMany({ where: { dayCloseId: day.id } });
        if (lines.length > 0) await tx.dayCloseLine.createMany({ data: lines });
        const updated = await tx.dayClose.update({
          where: { id: day.id },
          data: { uploadFileId: fileId, uploadVersion: { increment: 1 }, uploadedAt: new Date(), uploadedByUserId: actor.userId },
        });

        // The answer is this upload's, read in the same transaction.
        const [differences, summary] = await Promise.all([
          this.core.differences(tx, updated),
          this.core.summary(tx, { day: updated, distributorId, homeStoreId: distributor.homeStoreId, date, options }),
        ]);
        return { version: updated.uploadVersion, differences, summary, checked: lines.length };
      }, SHEET_TX);
    } catch (error) {
      for (const key of stored) await this.files.discard(key);
      throw error;
    }
  }

  // ---------- the submit ----------

  /**
   * `POST /day-end/:date/submit { version, note? }`. In order: the date; APPROVED is DAY_LOCKED; SUBMITTED
   * with this version is a repeat (200 `X-Already-Applied`, nothing written), with another version
   * DAY_ALREADY_SUBMITTED; no upload from the newest sheet since the last send-back or reopen is
   * DAY_SHEET_NOT_UPLOADED; another version is DAY_VERSION_CHANGED. Then one transaction: SUBMITTED, the
   * office's DAY_END_SUBMITTED alert (one per day), and the `day.submit` audit row with the note.
   */
  async submit(actor: UserActor, rawDate: unknown, body: DayEndSubmitInput): Promise<DayEndDayDto | IdempotentResponse<DayEndDayDto>> {
    const distributorId = ownDistributorId(actor);
    const { date, options } = await this.core.parseDate(rawDate);
    const distributor = await this.core.distributorOf(this.prisma, distributorId);
    const found = await this.core.findDay(this.prisma, distributorId, date);
    if (!found) throw new AppError('DAY_SHEET_NOT_UPLOADED');
    const outcome = await this.prisma.$transaction(async (tx) => {
      const day = await this.core.lockDay(tx, found.id);
      if (day.status === DayCloseStatus.APPROVED) throw new AppError('DAY_LOCKED');
      if (day.status === DayCloseStatus.SUBMITTED) {
        if (body.version === day.uploadVersion) return 'ALREADY' as const;
        throw new AppError('DAY_ALREADY_SUBMITTED');
      }
      if (stageOf(day) !== 'READY') throw new AppError('DAY_SHEET_NOT_UPLOADED');
      if (body.version !== day.uploadVersion) throw new AppError('DAY_VERSION_CHANGED');

      await tx.dayClose.update({ where: { id: day.id }, data: { status: DayCloseStatus.SUBMITTED, submittedAt: new Date() } });
      const differences = (await this.core.differenceCounts(tx, [day.id])).get(day.id) ?? 0;
      const note = body.note ?? null;
      await this.raiseSubmitted(tx, { day, distributor, date, differences, note });
      await this.audit.record(
        {
          action: 'day.submit',
          actor,
          resourceType: DAY_RESOURCE_TYPE,
          resourceId: day.id,
          distributorId,
          reason: note,
          diff: { businessDate: date, version: day.uploadVersion, differences },
        },
        tx,
      );
      return 'SUBMITTED' as const;
    }, LOCKING_TX);
    const day = await this.core.findDay(this.prisma, distributorId, date);
    const dto = await this.dayDto(this.prisma, { day, distributor, date, options });
    return outcome === 'ALREADY' ? alreadyApplied(dto) : dto;
  }

  /** The office's alert for a submitted day: one per day (a resubmit after a send-back refreshes it). */
  private async raiseSubmitted(
    tx: Tx,
    p: { day: DayRow; distributor: { id: string; businessName: string }; date: string; differences: number; note: string | null },
  ): Promise<void> {
    const context: DayEndSubmittedContext = {
      dayCloseId: p.day.id,
      distributorId: p.distributor.id,
      businessDate: p.date,
      version: p.day.uploadVersion,
      differences: p.differences,
      note: p.note,
    };
    const day = formatIsoDay(p.date);
    const counted = p.differences === 1 ? '1 difference' : `${p.differences} differences`;
    await this.alerts.raise(
      {
        alertType: AlertType.DAY_END_SUBMITTED,
        severity: AlertSeverity.INFO,
        title: `${p.distributor.businessName} sent the day-end for ${day}`,
        body: `${p.distributor.businessName} sent the day-end for ${day} with ${counted}. Review it and approve it or send it back.`,
        resourceType: DAY_RESOURCE_TYPE,
        resourceId: p.day.id,
        distributorId: p.distributor.id,
        context: context as unknown as Prisma.InputJsonValue,
        dedupeKey: { alertType: AlertType.DAY_END_SUBMITTED, resourceType: DAY_RESOURCE_TYPE, resourceId: p.day.id },
        dedupeStatuses: [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED],
      },
      tx,
    );
  }

  // ---------- the day DTO ----------

  private async dayDto(
    db: Db,
    p: { day: DayRow | null; distributor: { id: string; homeStoreId: string }; date: string; options: Required<BusinessDayOptions> },
  ): Promise<DayEndDayDto> {
    const [counts, summary] = await Promise.all([
      p.day ? this.core.differenceCounts(db, [p.day.id]) : Promise.resolve(new Map<string, number>()),
      this.core.summary(db, { day: p.day, distributorId: p.distributor.id, homeStoreId: p.distributor.homeStoreId, date: p.date, options: p.options }),
    ]);
    const day = p.day;
    return {
      businessDate: p.date,
      status: day?.status ?? DayCloseStatus.OPEN,
      stage: stageOf(day),
      cutoffAt: this.core.cutoffAt(p.date, p.options),
      summary,
      lastUpload:
        day && day.uploadVersion > 0 && day.uploadedAt
          ? { uploadedAt: day.uploadedAt.toISOString(), version: day.uploadVersion, differences: counts.get(day.id) ?? 0 }
          : null,
      officeNote: shopOfficeNote(day),
      allowedActions: shopActionsOf(day),
    };
  }
}

/** Download and upload act only on an OPEN day or a date with no row. */
function assertSheetAllowed(day: DayRow | null): void {
  if (day?.status === DayCloseStatus.SUBMITTED) throw new AppError('DAY_ALREADY_SUBMITTED');
  if (day?.status === DayCloseStatus.APPROVED) throw new AppError('DAY_LOCKED');
}

function assertUploadAllowed(day: DayRow | null): void {
  assertSheetAllowed(day);
}

/** The caller's labelled cylinders as they are now, with their last move's time, by number. */
async function distributorCylinders(db: Db, distributorId: string): Promise<Array<DistributorCylinder & { shortNo: number }>> {
  const rows = await db.cylinder.findMany({
    where: { distributorId, shortNo: { not: null } },
    orderBy: [{ shortNo: 'asc' }],
    select: {
      id: true,
      shortNo: true,
      cylinderTypeId: true,
      state: true,
      custodyType: true,
      custodyId: true,
      lastEventId: true,
      lastEvent: { select: { createdAt: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    shortNo: row.shortNo as number,
    cylinderTypeId: row.cylinderTypeId,
    state: row.state,
    custodyType: row.custodyType,
    custodyId: row.custodyId,
    lastEventId: row.lastEventId,
    lastEventAt: row.lastEvent?.createdAt ?? null,
  }));
}

/** Every cylinder size, lightest first: the Extra cylinders sheet's list. */
async function sizeOptions(db: Db): Promise<SizeOption[]> {
  const types = await db.cylinderType.findMany({ select: { id: true, code: true, name: true, weightKg: true } });
  return types
    .map((type) => ({ type, size: toCylinderSize(type) }))
    .sort((a, b) => compareSizes(a.size, b.size))
    .map(({ type, size }) => ({ cylinderTypeId: type.id, label: size.label, code: type.code, name: type.name, weightKg: size.weightKg }));
}
