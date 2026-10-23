import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ExpenseDto, ExpenseSummary, ExpenseSummaryByMonth, ExpenseSummaryByType, Page } from '@smartfleet/shared-types';
import type {
  CreateExpenseInput,
  ExpenseSummaryQuery,
  ExpensesQuery,
  UpdateExpenseInput,
  VoidExpenseInput,
} from '@smartfleet/shared-validation';
import type { UserActor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import {
  alreadyApplied,
  assertSameRequest,
  replayed,
  type IdempotentResponse,
} from '../../common/idempotency/idempotency';
import { decodeCursor, invalidCursor, toPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { FilesService } from '../files/files.service';
import { SettingsService } from '../settings/settings.service';
import { calendarRangeInstants, calendarToday, dateColumn, isoDateOf, resolveRange } from './expense-dates';
import {
  EFFECTIVE_TYPE_SQL,
  EXPENSE_INCLUDE,
  EXPENSE_RESOURCE,
  toExpenseDto,
  typeCodeForCategory,
  UUID,
  type ExpenseRow,
} from './expense-rows';
import { ExpensesClock } from './expenses.clock';

type Db = PrismaService | Prisma.TransactionClient;

/** The fields a retried create is compared on (API_CONTRACT §4.2, G15-02). */
const REQUEST_KEY_FIELDS = ['expenseDate', 'amountPaisa', 'typeId', 'vehicleId', 'driverId'] as const;
type RequestKeyFields = Record<(typeof REQUEST_KEY_FIELDS)[number], string | null | undefined>;

const CLIENT_REQUEST_CONSTRAINT = 'expenses_client_request_id_key';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An expense field as the audit row and the comparison see it. */
type ExpenseField = 'expenseDate' | 'amountPaisa' | 'typeId' | 'vehicleId' | 'driverId' | 'description' | 'receiptFileId';

/**
 * The office's running costs (API_CONTRACT §7.12, ADR-14): vans, drivers, petrol and the rest. Plain
 * inserts and updates on `expenses`, each with its audit row in the same transaction. **Expenses never
 * touch a distributor's wallet or the ledger**: this module has no access to the wallet at all.
 * Removing an expense is a void with a reason, never a delete.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
    private readonly clock: ExpensesClock,
  ) {}

  // ---- reads ---------------------------------------------------------------------------------

  /**
   * `GET /expenses`: newest `expenseDate` first, then newest recorded, cursor-paged. The dates are
   * inclusive and default to this calendar month; removed expenses only with `includeVoided`.
   */
  async list(query: ExpensesQuery): Promise<Page<ExpenseDto>> {
    const { from, to } = resolveRange(query, await this.today());
    const and: Prisma.ExpenseWhereInput[] = [{ expenseDate: { gte: dateColumn(from), lte: dateColumn(to) } }];
    if (!query.includeVoided) and.push({ voidedAt: null });
    if (query.typeId) and.push(await this.typeFilter(query.typeId));
    if (query.vehicleId) and.push({ vehicleId: query.vehicleId });
    if (query.driverId) and.push({ driverId: query.driverId });

    const cursor = decodeCursor(query.cursor, 3);
    if (cursor) {
      const [date, at, id] = cursor;
      const createdAt = new Date(String(at));
      if (typeof date !== 'string' || !ISO_DATE.test(date) || Number.isNaN(createdAt.getTime()) || typeof id !== 'string' || !UUID.test(id)) {
        throw invalidCursor();
      }
      const day = dateColumn(date);
      and.push({
        OR: [
          { expenseDate: { lt: day } },
          { expenseDate: day, createdAt: { lt: createdAt } },
          { expenseDate: day, createdAt, id: { lt: id } },
        ],
      });
    }

    const rows = await this.prisma.expense.findMany({
      where: { AND: and },
      include: EXPENSE_INCLUDE,
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(await this.toDtos(rows), query.limit, (dto) => [dto.expenseDate, dto.createdAt, dto.id]);
  }

  /**
   * `GET /expenses/summary`: totals by type and by month, computed in SQL with removed expenses left
   * out, plus the drivers' fuel logs (`fuel_refills.cost_paisa`) by calendar month of `refill_at`,
   * whatever `features.fuelRefills` says. Fuel logs are reported beside the totals, never inside them.
   */
  async summary(query: ExpenseSummaryQuery): Promise<ExpenseSummary> {
    const timeZone = await this.settings.get('day.timezone');
    const { from, to } = resolveRange(query, calendarToday(this.clock.now(), timeZone));

    const groups = await this.prisma.$queryRaw<
      Array<{ typeId: string; code: string | null; name: string; month: string; totalPaisa: bigint; count: number }>
    >`
      SELECT t.id AS "typeId", t.code, t.name, g.month, g.total AS "totalPaisa", g.count
      FROM (
        SELECT x.type_id, x.month, sum(x.amount)::bigint AS total, count(*)::int AS count
        FROM (
          SELECT ${EFFECTIVE_TYPE_SQL} AS type_id,
                 to_char(e.expense_date, 'YYYY-MM') AS month,
                 e.amount_paisa AS amount
          FROM expenses e
          WHERE e.voided_at IS NULL
            AND e.expense_date >= ${from}::date
            AND e.expense_date <= ${to}::date
        ) x
        GROUP BY x.type_id, x.month
      ) g
      JOIN expense_types t ON t.id = g.type_id
      ORDER BY t.sort_order, t.name, t.id, g.month`;

    const { start, end } = calendarRangeInstants(from, to, timeZone);
    // refill_at is timestamp(3) without time zone holding UTC; months are calendar months in day.timezone.
    const fuel = await this.prisma.$queryRaw<Array<{ month: string; totalPaisa: bigint; count: number }>>`
      SELECT x.month, sum(x.cost)::bigint AS "totalPaisa", count(*)::int AS count
      FROM (
        SELECT to_char((f.refill_at AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM') AS month,
               f.cost_paisa AS cost
        FROM fuel_refills f
        WHERE f.refill_at >= (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC')
          AND f.refill_at < (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      ) x
      GROUP BY x.month
      ORDER BY x.month`;

    const byType = new Map<string, { row: ExpenseSummaryByType; total: bigint }>();
    const byMonth = new Map<string, { total: bigint; types: Map<string, bigint> }>();
    let total = 0n;
    let count = 0;
    for (const group of groups) {
      total += group.totalPaisa;
      count += group.count;
      const type = byType.get(group.typeId) ?? {
        row: { typeId: group.typeId, code: group.code, name: group.name, totalPaisa: '0', count: 0 },
        total: 0n,
      };
      type.total += group.totalPaisa;
      type.row.count += group.count;
      byType.set(group.typeId, type);
      const month = byMonth.get(group.month) ?? { total: 0n, types: new Map<string, bigint>() };
      month.total += group.totalPaisa;
      month.types.set(group.typeId, (month.types.get(group.typeId) ?? 0n) + group.totalPaisa);
      byMonth.set(group.month, month);
    }

    const months: ExpenseSummaryByMonth[] = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({
        month,
        totalPaisa: value.total.toString(),
        byType: [...value.types.entries()].map(([typeId, sum]) => ({ typeId, totalPaisa: sum.toString() })),
      }));

    let fuelTotal = 0n;
    let fuelCount = 0;
    for (const month of fuel) {
      fuelTotal += month.totalPaisa;
      fuelCount += month.count;
    }

    return {
      from,
      to,
      totalPaisa: total.toString(),
      count,
      byType: [...byType.values()].map(({ row, total: sum }) => ({ ...row, totalPaisa: sum.toString() })),
      byMonth: months,
      fuelLogs: {
        totalPaisa: fuelTotal.toString(),
        count: fuelCount,
        byMonth: fuel.map((month) => ({ month: month.month, totalPaisa: month.totalPaisa.toString(), count: month.count })),
      },
    };
  }

  // ---- writes --------------------------------------------------------------------------------

  /**
   * `POST /expenses` (Idempotency-Key). A known key answers with the first expense before any other
   * rule (a replay, 200), or 409 IDEMPOTENCY_CONFLICT when its key fields differ. Then, in order: the
   * date is not after today (Asia/Karachi calendar date), the type exists and is active, the van and
   * the driver exist, and the receipt is an office expense-receipt upload.
   */
  async create(body: CreateExpenseInput, key: string | undefined, actor: UserActor): Promise<ExpenseDto | IdempotentResponse<ExpenseDto>> {
    if (key) {
      const first = await this.findByRequestKey(key);
      if (first) return this.replay(first, body);
    }
    await this.assertNotInFuture(body.expenseDate);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await this.assertActiveType(tx, body.typeId);
        await this.assertReferences(tx, body);
        const created = await tx.expense.create({
          data: {
            expenseDate: dateColumn(body.expenseDate),
            amountPaisa: BigInt(body.amountPaisa),
            typeId: body.typeId,
            vehicleId: body.vehicleId ?? null,
            driverId: body.driverId ?? null,
            description: body.description,
            receiptFileId: body.receiptFileId ?? null,
            clientRequestId: key ?? null,
            recordedByUserId: actor.userId,
          },
          include: EXPENSE_INCLUDE,
        });
        await this.audit.record(
          {
            action: 'expense.create',
            actor,
            resourceType: EXPENSE_RESOURCE,
            resourceId: created.id,
            after: { ...this.fieldsOf(created), typeName: created.type?.name ?? null },
          },
          tx,
        );
        return created;
      });
      return this.toDto(row);
    } catch (error) {
      // The same key sent twice at the same moment: the second insert loses on the unique key, its
      // transaction (audit row included) rolls back, and it answers as a replay of the first.
      if (key && isUniqueViolation(error, CLIENT_REQUEST_CONSTRAINT)) {
        const first = await this.findByRequestKey(key);
        if (first) return this.replay(first, body);
      }
      throw error;
    }
  }

  /**
   * `PATCH /expenses/:id`: the create's fields, each optional (null clears the van, driver or receipt).
   * A removed expense can't change (EXPENSE_ALREADY_VOIDED). Moving to an archived type is refused;
   * keeping the current one, archived or not, is fine. Audited with the changed fields before and after.
   */
  async update(id: string, body: UpdateExpenseInput, actor: UserActor): Promise<ExpenseDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.voidedAt) throw new AppError('EXPENSE_ALREADY_VOIDED');

      const was = this.fieldsOf(current);
      const next: Partial<Record<ExpenseField, string | null>> = {};
      if (body.expenseDate !== undefined && body.expenseDate !== was.expenseDate) {
        await this.assertNotInFuture(body.expenseDate);
        next.expenseDate = body.expenseDate;
      }
      if (body.amountPaisa !== undefined && body.amountPaisa !== was.amountPaisa) next.amountPaisa = body.amountPaisa;
      if (body.typeId !== undefined && body.typeId.toLowerCase() !== was.typeId) {
        await this.assertActiveType(tx, body.typeId);
        next.typeId = body.typeId.toLowerCase();
      }
      if (body.vehicleId !== undefined && (body.vehicleId?.toLowerCase() ?? null) !== was.vehicleId) {
        next.vehicleId = body.vehicleId?.toLowerCase() ?? null;
      }
      if (body.driverId !== undefined && (body.driverId?.toLowerCase() ?? null) !== was.driverId) {
        next.driverId = body.driverId?.toLowerCase() ?? null;
      }
      if (body.description !== undefined && body.description !== was.description) next.description = body.description;
      if (body.receiptFileId !== undefined && (body.receiptFileId?.toLowerCase() ?? null) !== was.receiptFileId) {
        next.receiptFileId = body.receiptFileId?.toLowerCase() ?? null;
      }
      await this.assertReferences(tx, next);

      const changed = Object.keys(next) as ExpenseField[];
      if (changed.length === 0) return current;

      const data: Prisma.ExpenseUncheckedUpdateInput = {};
      if (next.expenseDate !== undefined) data.expenseDate = dateColumn(next.expenseDate as string);
      if (next.amountPaisa !== undefined) data.amountPaisa = BigInt(next.amountPaisa as string);
      if (next.typeId !== undefined) data.typeId = next.typeId as string;
      if (next.vehicleId !== undefined) data.vehicleId = next.vehicleId;
      if (next.driverId !== undefined) data.driverId = next.driverId;
      if (next.description !== undefined) data.description = next.description as string;
      if (next.receiptFileId !== undefined) data.receiptFileId = next.receiptFileId;

      // Guarded by the row lock and by `voided_at IS NULL` (API_CONTRACT §4.1).
      const updated = await tx.expense.updateMany({ where: { id: current.id, voidedAt: null }, data });
      if (updated.count !== 1) throw new AppError('EXPENSE_ALREADY_VOIDED');
      const saved = await tx.expense.findUniqueOrThrow({ where: { id: current.id }, include: EXPENSE_INCLUDE });
      await this.audit.record(
        {
          action: 'expense.update',
          actor,
          resourceType: EXPENSE_RESOURCE,
          resourceId: current.id,
          // The expense as it now reads, for the sentence "Edited Petrol expense Rs 2,500".
          diff: { typeName: saved.type?.name ?? null, amountPaisa: saved.amountPaisa.toString() },
          before: Object.fromEntries(changed.map((field) => [field, was[field]])),
          after: Object.fromEntries(changed.map((field) => [field, next[field]])),
        },
        tx,
      );
      return saved;
    });
    return this.toDto(row);
  }

  /**
   * `POST /expenses/:id/void { reason }`: a logged removal (the row stays, left out of totals). A
   * repeat answers 200 with `X-Already-Applied` and writes nothing.
   */
  async voidExpense(id: string, body: VoidExpenseInput, actor: UserActor): Promise<ExpenseDto | IdempotentResponse<ExpenseDto>> {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.voidedAt) return { row: current, repeated: true };
      const voided = await tx.expense.updateMany({
        where: { id: current.id, voidedAt: null },
        data: { voidedAt: this.clock.now(), voidedByUserId: actor.userId, voidReason: body.reason },
      });
      if (voided.count !== 1) throw new AppError('CONFLICT_STALE_STATE');
      await this.audit.record(
        {
          action: 'expense.void',
          actor,
          resourceType: EXPENSE_RESOURCE,
          resourceId: current.id,
          reason: body.reason,
          diff: {
            expenseDate: isoDateOf(current.expenseDate),
            amountPaisa: current.amountPaisa.toString(),
            typeName: current.type?.name ?? null,
          },
        },
        tx,
      );
      return { row: await tx.expense.findUniqueOrThrow({ where: { id: current.id }, include: EXPENSE_INCLUDE }), repeated: false };
    });
    const dto = await this.toDto(result.row);
    return result.repeated ? alreadyApplied(dto) : dto;
  }

  // ---- rules ---------------------------------------------------------------------------------

  /** Today's calendar date in `day.timezone` (Asia/Karachi), with no 03:00 cut-off (G13-01). */
  private async today(): Promise<string> {
    return calendarToday(this.clock.now(), await this.settings.get('day.timezone'));
  }

  private async assertNotInFuture(expenseDate: string): Promise<void> {
    if (expenseDate > (await this.today())) throw new AppError('EXPENSE_DATE_IN_FUTURE');
  }

  /** The type exists (404 `{field: 'typeId'}`) and isn't archived (EXPENSE_TYPE_ARCHIVED `{name}`). */
  private async assertActiveType(db: Db, typeId: string): Promise<void> {
    const type = await db.expenseType.findUnique({ where: { id: typeId }, select: { name: true, archivedAt: true } });
    if (!type) throw new AppError('NOT_FOUND', { field: 'typeId' });
    if (type.archivedAt) throw new AppError('EXPENSE_TYPE_ARCHIVED', { name: type.name });
  }

  /** The van and the driver exist (404 `{field}`); the receipt is an office expense-receipt upload. */
  private async assertReferences(
    db: Prisma.TransactionClient,
    refs: { vehicleId?: string | null; driverId?: string | null; receiptFileId?: string | null },
  ): Promise<void> {
    if (refs.vehicleId) {
      const vehicle = await db.vehicle.findUnique({ where: { id: refs.vehicleId }, select: { id: true } });
      if (!vehicle) throw new AppError('NOT_FOUND', { field: 'vehicleId' });
    }
    if (refs.driverId) {
      const driver = await db.driver.findUnique({ where: { id: refs.driverId }, select: { id: true } });
      if (!driver) throw new AppError('NOT_FOUND', { field: 'driverId' });
    }
    // EXPENSE_RECEIPT uploads are office only (API_CONTRACT §7.10), so the purpose is the whole check.
    if (refs.receiptFileId) await this.files.assertUsable(refs.receiptFileId, { purpose: 'EXPENSE_RECEIPT' }, db);
  }

  /**
   * A list filter by type. From inc1b every expense has its type (`type_id` NOT NULL: the migration
   * re-derived the rows the old API wrote with only a category), so the type alone decides.
   */
  private async typeFilter(typeId: string): Promise<Prisma.ExpenseWhereInput> {
    return { typeId };
  }

  /** Locks the expense row for this transaction; 404 NOT_FOUND for an unknown or malformed id. */
  private async lock(tx: Prisma.TransactionClient, id: string): Promise<ExpenseRow> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM expenses WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new AppError('NOT_FOUND');
    return tx.expense.findUniqueOrThrow({ where: { id: locked[0].id }, include: EXPENSE_INCLUDE });
  }

  // ---- idempotency ---------------------------------------------------------------------------

  private findByRequestKey(key: string): Promise<ExpenseRow | null> {
    return this.prisma.expense.findUnique({ where: { clientRequestId: key }, include: EXPENSE_INCLUDE });
  }

  /** The first expense of a key, if the retry asks for the same thing (G15-02). */
  private async replay(first: ExpenseRow, body: CreateExpenseInput): Promise<IdempotentResponse<ExpenseDto>> {
    const stored = this.fieldsOf(first);
    const incoming: RequestKeyFields = {
      expenseDate: body.expenseDate,
      amountPaisa: body.amountPaisa,
      typeId: body.typeId.toLowerCase(),
      vehicleId: body.vehicleId?.toLowerCase(),
      driverId: body.driverId?.toLowerCase(),
    };
    assertSameRequest<keyof RequestKeyFields>(stored, incoming, REQUEST_KEY_FIELDS);
    return replayed(await this.toDto(first));
  }

  /** The editable fields of a row, as text (money as a digit string, the date as `YYYY-MM-DD`). */
  private fieldsOf(row: ExpenseRow): Record<ExpenseField, string | null> {
    return {
      expenseDate: isoDateOf(row.expenseDate),
      amountPaisa: row.amountPaisa.toString(),
      typeId: row.typeId,
      vehicleId: row.vehicleId,
      driverId: row.driverId,
      description: row.description,
      receiptFileId: row.receiptFileId,
    };
  }

  // ---- DTOs ----------------------------------------------------------------------------------

  private async toDto(row: ExpenseRow): Promise<ExpenseDto> {
    const [dto] = await this.toDtos([row]);
    return dto;
  }

  private async toDtos(rows: readonly ExpenseRow[]): Promise<ExpenseDto[]> {
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.flatMap((row) => [row.recordedByUserId, row.voidedByUserId]).filter((id): id is string => !!id))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const legacyCodes = [
      ...new Set(rows.filter((row) => !row.type).map((row) => (row.category ? typeCodeForCategory(row.category) : 'OTHER'))),
    ];
    const types =
      legacyCodes.length > 0
        ? await this.prisma.expenseType.findMany({
            where: { code: { in: [...legacyCodes, 'OTHER'] } },
            select: { id: true, code: true, name: true },
          })
        : [];
    const context = {
      names: new Map(users.map((user) => [user.id, user.name])),
      typesByCode: new Map(types.filter((type) => type.code).map((type) => [type.code as string, type])),
      receiptUrl: (file: { storageKey: string }) => this.files.urlFor(file),
    };
    return Promise.all(rows.map((row) => toExpenseDto(row, context)));
  }
}
