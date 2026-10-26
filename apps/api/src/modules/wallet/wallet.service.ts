import { Injectable } from '@nestjs/common';
import { Prisma, type DistributorStatus, type LedgerEntry, type LedgerEntryType } from '@prisma/client';
import type { Page, StatementItem, WalletSummary } from '@smartfleet/shared-types';
import { actorUserId } from '../../common/auth/actor';
import { assertSameRequest } from '../../common/idempotency/idempotency';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, invalidCursor, pageLimit, toPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SettingsService } from '../settings/settings.service';
import { businessDayOptions, statementBound } from './business-day';
import { kindsWhere, STATEMENT_ROW_INCLUDE, toStatementItem, type StatementRow } from './statement';
import {
  walletKeys,
  type CorrectionOutcome,
  type WalletCheck,
  type WalletCorrectionParams,
  type WalletCreditTopupParams,
  type WalletDebitParams,
  type WalletReverseParams,
  type WalletStatementQuery,
  type WalletStatementView,
  type WalletTx,
} from './wallet.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `id` can name a row (ids are UUID columns: anything else is simply not found). */
export function isUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

/**
 * How a balance update is guarded (DATA_MODEL §3.6), each one a single statement:
 * - DEBIT: the distributor is ACTIVE and the balance covers the amount (an order's delivery cost);
 * - COVER: the balance covers the amount, whatever the status (an office TAKE correction);
 * - NONE: money in (top-up credit, cost returned, ADD correction).
 */
type BalanceGuard = 'DEBIT' | 'COVER' | 'NONE';

interface NewLedgerRow {
  distributorId: string;
  entryType: LedgerEntryType;
  /** Signed: + money in, - money out. */
  amountPaisa: bigint;
  balanceAfterPaisa: bigint;
  idempotencyKey: string;
  paymentId?: string | null;
  orderId?: string | null;
  reasonCode?: string | null;
  note?: string | null;
  createdByUserId: string | null;
}

/** A guarded debit is retried once when the refusal it hit was already out of date (a credit landed). */
const DEBIT_ATTEMPTS = 2;

/**
 * Σ DEBIT_ORDER − Σ CREDIT_ORDER_REVERSAL between two instants (`start` inclusive, `end` exclusive):
 * the delivery costs taken, net of costs returned (API_CONTRACT §7.13 `costTakenTodayPaisa`). Exported
 * so the office summary can run the very same query; pass the bounds of `currentBusinessDay()`.
 */
export async function deliveryCostTakenInRange(
  db: Pick<WalletTx, '$queryRaw'>,
  range: { start: Date; end: Date },
): Promise<bigint> {
  // Prisma binds a Date as timestamptz while its columns are timestamp(3) holding UTC: compare in UTC,
  // whatever the session's time zone.
  const rows = await db.$queryRaw<Array<{ taken: bigint }>>`
    SELECT COALESCE(-sum(amount_paisa), 0)::bigint AS taken
    FROM ledger_entries
    WHERE entry_type IN ('DEBIT_ORDER', 'CREDIT_ORDER_REVERSAL')
      AND created_at >= (${range.start}::timestamptz AT TIME ZONE 'UTC')
      AND created_at < (${range.end}::timestamptz AT TIME ZONE 'UTC')`;
  return rows[0]?.taken ?? 0n;
}

/**
 * The only writer of money (API_CONTRACT §5.4, DATA_MODEL §3.6): `distributors.advance_balance_paisa`
 * and `ledger_entries`. Every write is one guarded statement inside the caller's transaction, followed by
 * a signed ledger row with a deterministic idempotency key (`walletKeys`). Invariant: the balance is
 * never negative and equals the sum of the distributor's ledger rows.
 *
 * Ledger rows get a creation time that is strictly increasing per distributor, in the order the balance
 * moved (the guarded update holds the distributor row lock until commit), so the statement's order and
 * its running `balanceAfterPaisa` always agree, even for transactions that started in another order.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Reads

  /** `GET /wallet`: balance, money being checked (pending top-ups), low-balance flag and cap. */
  async summary(distributorId: string): Promise<WalletSummary> {
    if (!isUuid(distributorId)) throw new AppError('NOT_FOUND');
    const [distributor, pending, lowBalancePaisa, capPaisa] = await Promise.all([
      this.prisma.distributor.findUnique({ where: { id: distributorId }, select: { advanceBalancePaisa: true } }),
      this.prisma.payment.aggregate({
        where: { distributorId, status: 'PENDING' },
        _sum: { amountPaisa: true },
        _count: { _all: true },
      }),
      this.settings.get('wallet.lowBalancePaisa'),
      this.settings.get('wallet.maxBalancePaisa'),
    ]);
    if (!distributor) throw new AppError('NOT_FOUND');
    const balance = distributor.advanceBalancePaisa;
    return {
      balancePaisa: balance.toString(),
      pendingTopupPaisa: (pending._sum.amountPaisa ?? 0n).toString(),
      pendingTopupCount: pending._count._all,
      // Strictly below the threshold (G01-07): exactly at it is not low, and a threshold of Rs 0 never warns.
      lowBalance: balance < BigInt(lowBalancePaisa),
      capPaisa: capPaisa === null ? null : String(capPaisa),
    };
  }

  /**
   * The balance under a row lock (`SELECT … FOR UPDATE`), for a caller that must decide on it before
   * moving money in the same transaction, such as the cap check of a top-up approval. Null when the
   * distributor doesn't exist.
   */
  async lockBalance(tx: WalletTx, distributorId: string): Promise<{ balancePaisa: bigint; status: DistributorStatus } | null> {
    if (!isUuid(distributorId)) return null;
    const rows = await tx.$queryRaw<Array<{ balance: bigint; status: DistributorStatus }>>`
      SELECT advance_balance_paisa AS balance, status FROM distributors WHERE id = ${distributorId}::uuid FOR UPDATE`;
    return rows.length > 0 ? { balancePaisa: rows[0].balance, status: rows[0].status } : null;
  }

  /** Wallet history from the ledger only, newest first; the OFFICE view adds `note`, `by` and bank references. */
  async statement(distributorId: string, q: WalletStatementQuery, view: WalletStatementView): Promise<Page<StatementItem>> {
    if (!isUuid(distributorId)) throw new AppError('NOT_FOUND');
    const distributor = await this.prisma.distributor.findUnique({ where: { id: distributorId }, select: { code: true } });
    if (!distributor) throw new AppError('NOT_FOUND');

    const limit = pageLimit(q.limit);
    const and: Prisma.LedgerEntryWhereInput[] = [];
    const kinds = kindsWhere(q.kind);
    if (kinds) and.push(kinds);
    if (q.from || q.to) {
      const options = await businessDayOptions(this.settings);
      if (q.from) and.push({ createdAt: { gte: statementBound(q.from, 'from', options).at } });
      if (q.to) {
        const bound = statementBound(q.to, 'to', options);
        and.push({ createdAt: bound.exclusive ? { lt: bound.at } : { lte: bound.at } });
      }
    }
    const cursor = decodeCursor(q.cursor, 2);
    if (cursor) {
      const [at, id] = cursor;
      const atDate = new Date(String(at));
      if (Number.isNaN(atDate.getTime()) || !isUuid(id)) throw invalidCursor();
      and.push({ OR: [{ createdAt: { lt: atDate } }, { createdAt: atDate, id: { lt: id } }] });
    }

    const rows = await this.prisma.ledgerEntry.findMany({
      where: { distributorId, ...(and.length > 0 ? { AND: and } : {}) },
      include: STATEMENT_ROW_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const items = await this.toStatementItems(rows, distributor.code, view);
    return toPage(items, limit, (item) => [item.at, item.id]);
  }

  /** One ledger row as a statement item (for example a correction just written). */
  async statementItem(entryId: string, view: WalletStatementView): Promise<StatementItem> {
    const row = isUuid(entryId)
      ? await this.prisma.ledgerEntry.findUnique({
          where: { id: entryId },
          include: { ...STATEMENT_ROW_INCLUDE, distributor: { select: { code: true } } },
        })
      : null;
    if (!row) throw new AppError('NOT_FOUND');
    const [item] = await this.toStatementItems([row], row.distributor.code, view);
    return item;
  }

  /**
   * The integrity check for one distributor, or all (the nightly job): the ledger sum must equal the
   * cached balance, and the balance must be at least 0.
   */
  async verify(distributorId?: string): Promise<WalletCheck[]> {
    if (distributorId !== undefined && !isUuid(distributorId)) return [];
    const only = distributorId === undefined ? Prisma.empty : Prisma.sql`WHERE d.id = ${distributorId}::uuid`;
    const rows = await this.prisma.$queryRaw<Array<{ distributorId: string; balancePaisa: bigint; ledgerSumPaisa: bigint }>>`
      SELECT d.id AS "distributorId", d.advance_balance_paisa AS "balancePaisa",
             COALESCE(sum(l.amount_paisa), 0)::bigint AS "ledgerSumPaisa"
      FROM distributors d
      LEFT JOIN ledger_entries l ON l.distributor_id = d.id
      ${only}
      GROUP BY d.id, d.advance_balance_paisa
      ORDER BY d.id`;
    return rows.map((row) => ({
      distributorId: row.distributorId,
      balancePaisa: row.balancePaisa,
      ledgerSumPaisa: row.ledgerSumPaisa,
      ok: row.balancePaisa === row.ledgerSumPaisa && row.balancePaisa >= 0n,
    }));
  }

  /** Delivery costs taken today, net of costs returned, for the business-day bounds given. */
  deliveryCostTaken(range: { start: Date; end: Date }): Promise<bigint> {
    return deliveryCostTakenInRange(this.prisma, range);
  }

  // ---------------------------------------------------------------------------------------------
  // Writes (each inside the caller's transaction)

  /**
   * Deducts a delivery cost. Amount 0 → null, no row. Guarded `balance >= amount AND status ACTIVE`,
   * else DISTRIBUTOR_NOT_ACTIVE (checked first: a shop that isn't active is refused for that, whatever
   * its balance) or WALLET_INSUFFICIENT_BALANCE `{requiredPaisa, balancePaisa, shortByPaisa}`.
   * ORDER → DEBIT_ORDER with key `order:<id>:debit`; a second call for the same order returns that row.
   */
  async debit(tx: WalletTx, p: WalletDebitParams): Promise<LedgerEntry | null> {
    const orderId = this.orderOf(p.subject);
    if (p.amountPaisa < 0n) throw new AppError('INTERNAL_ERROR', { reason: 'NEGATIVE_AMOUNT' });
    if (p.amountPaisa === 0n) return null;
    if (!isUuid(p.distributorId)) throw new AppError('NOT_FOUND');

    const key = walletKeys.orderDebit(orderId);
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (existing) return this.sameEntry(existing, p.distributorId, -p.amountPaisa);

    for (let attempt = 1; ; attempt++) {
      const balance = await this.moveBalance(tx, p.distributorId, -p.amountPaisa, 'DEBIT');
      if (balance !== null) {
        return this.insertEntry(tx, {
          distributorId: p.distributorId,
          entryType: 'DEBIT_ORDER',
          amountPaisa: -p.amountPaisa,
          balanceAfterPaisa: balance,
          idempotencyKey: key,
          orderId,
          createdByUserId: actorUserId(p.actor),
        });
      }
      const now = await tx.distributor.findUnique({
        where: { id: p.distributorId },
        select: { status: true, advanceBalancePaisa: true },
      });
      if (!now) throw new AppError('NOT_FOUND');
      if (now.status !== 'ACTIVE') throw new AppError('DISTRIBUTOR_NOT_ACTIVE');
      if (now.advanceBalancePaisa < p.amountPaisa || attempt >= DEBIT_ATTEMPTS) {
        // The real, signed balance, as the quote uses it: a legacy balance below zero (only possible
        // before inc1b) is short by the cost plus what it is below zero, never by the cost alone.
        const shortBy = p.amountPaisa - now.advanceBalancePaisa;
        throw new AppError('WALLET_INSUFFICIENT_BALANCE', {
          requiredPaisa: p.amountPaisa.toString(),
          balancePaisa: now.advanceBalancePaisa.toString(),
          shortByPaisa: (shortBy > 0n ? shortBy : 0n).toString(),
        });
      }
      // A top-up or a returned cost landed between the refused update and this read: try once more.
    }
  }

  /**
   * Returns the debit (the ledger row keyed `order:<id>:debit`) in full, once (key `order:<id>:reversal`,
   * CREDIT_ORDER_REVERSAL). Null when there was no such debit, as for every order the old code charged.
   * A second call returns the first reversal. Called only by OrdersFeePolicy.cancel.
   */
  async reverse(tx: WalletTx, p: WalletReverseParams): Promise<LedgerEntry | null> {
    const orderId = this.orderOf(p.subject);
    const debit = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: walletKeys.orderDebit(orderId) } });
    if (!debit || debit.entryType !== 'DEBIT_ORDER') return null;
    const key = walletKeys.orderReversal(orderId);
    const done = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (done) return done;

    const amount = -debit.amountPaisa;
    if (amount <= 0n) return null;
    const balance = await this.moveBalance(tx, debit.distributorId, amount, 'NONE');
    if (balance === null) throw new AppError('NOT_FOUND');
    return this.insertEntry(tx, {
      distributorId: debit.distributorId,
      entryType: 'CREDIT_ORDER_REVERSAL',
      amountPaisa: amount,
      balanceAfterPaisa: balance,
      idempotencyKey: key,
      orderId,
      note: p.reason?.trim() ? p.reason.trim().slice(0, 300) : null,
      createdByUserId: actorUserId(p.actor),
    });
  }

  /**
   * Credits an approved top-up once (key `topup:<paymentId>`, CREDIT_TOPUP), whatever the distributor's
   * status. A second call for the same payment returns the first credit.
   */
  async creditTopup(tx: WalletTx, p: WalletCreditTopupParams): Promise<LedgerEntry> {
    if (p.amountPaisa <= 0n) throw new AppError('INTERNAL_ERROR', { reason: 'NON_POSITIVE_AMOUNT' });
    if (!isUuid(p.distributorId)) throw new AppError('NOT_FOUND');
    const key = walletKeys.topup(p.paymentId);
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (existing) return this.sameEntry(existing, p.distributorId, p.amountPaisa);

    const balance = await this.moveBalance(tx, p.distributorId, p.amountPaisa, 'NONE');
    if (balance === null) throw new AppError('NOT_FOUND');
    return this.insertEntry(tx, {
      distributorId: p.distributorId,
      entryType: 'CREDIT_TOPUP',
      amountPaisa: p.amountPaisa,
      balanceAfterPaisa: balance,
      idempotencyKey: key,
      paymentId: p.paymentId,
      createdByUserId: actorUserId(p.actor),
    });
  }

  /**
   * A super-admin correction (ADJUSTMENT with a reason code; key `adjust:<requestKey>`), audited as
   * `wallet.correction` in the same transaction. TAKE needs balance >= amount, else
   * WALLET_ADJUST_EXCEEDS_BALANCE. No cap and no distributor status check. Sent again with its key,
   * it returns the first entry (or IDEMPOTENCY_CONFLICT when any detail differs).
   */
  async correct(tx: WalletTx, p: WalletCorrectionParams): Promise<LedgerEntry> {
    return (await this.applyCorrection(tx, p)).entry;
  }

  /**
   * {@link correct}, also saying whether the entry was already there (a replay). Rules in order
   * (API_CONTRACT §7.8): the key (replay or IDEMPOTENCY_CONFLICT); the distributor exists; the related
   * top-up and order are this distributor's (404 NOT_FOUND `{field}`); TAKE covered by the balance.
   * A duplicate racing it fails on `ledger_entries_idempotency_key_key` and rolls back whole; the caller
   * then runs this again, which finds the first entry and replays it.
   */
  async applyCorrection(tx: WalletTx, p: WalletCorrectionParams): Promise<CorrectionOutcome> {
    if (p.amountPaisa <= 0n) throw new AppError('INTERNAL_ERROR', { reason: 'NON_POSITIVE_AMOUNT' });
    const relatedPaymentId = p.relatedPaymentId?.toLowerCase() ?? null;
    const relatedOrderId = p.relatedOrderId?.toLowerCase() ?? null;
    const key = walletKeys.correction(p.requestKey);

    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.entryType !== 'ADJUSTMENT') throw new AppError('IDEMPOTENCY_CONFLICT');
      assertSameRequest(
        {
          distributorId: existing.distributorId,
          direction: existing.amountPaisa > 0n ? 'ADD' : 'TAKE',
          amountPaisa: existing.amountPaisa > 0n ? existing.amountPaisa : -existing.amountPaisa,
          reasonCode: existing.reasonCode,
          note: existing.note,
          relatedPaymentId: existing.paymentId,
          relatedOrderId: existing.orderId,
        },
        {
          distributorId: p.distributorId.toLowerCase(),
          direction: p.direction,
          amountPaisa: p.amountPaisa,
          reasonCode: p.reasonCode,
          note: p.note.trim(),
          relatedPaymentId,
          relatedOrderId,
        },
        ['distributorId', 'direction', 'amountPaisa', 'reasonCode', 'note', 'relatedPaymentId', 'relatedOrderId'],
      );
      return { entry: existing, replayed: true };
    }

    if (!isUuid(p.distributorId)) throw new AppError('NOT_FOUND');
    const distributor = await tx.distributor.findUnique({ where: { id: p.distributorId }, select: { id: true, businessName: true } });
    if (!distributor) throw new AppError('NOT_FOUND');
    if (relatedPaymentId) {
      const payment = isUuid(relatedPaymentId)
        ? await tx.payment.findFirst({ where: { id: relatedPaymentId, distributorId: p.distributorId }, select: { id: true } })
        : null;
      if (!payment) throw new AppError('NOT_FOUND', { field: 'relatedPaymentId' });
    }
    if (relatedOrderId) {
      const order = isUuid(relatedOrderId)
        ? await tx.order.findFirst({ where: { id: relatedOrderId, distributorId: p.distributorId }, select: { id: true } })
        : null;
      if (!order) throw new AppError('NOT_FOUND', { field: 'relatedOrderId' });
    }

    const delta = p.direction === 'ADD' ? p.amountPaisa : -p.amountPaisa;
    const balance = await this.moveBalance(tx, p.distributorId, delta, p.direction === 'TAKE' ? 'COVER' : 'NONE');
    if (balance === null) {
      const now = await tx.distributor.findUnique({ where: { id: p.distributorId }, select: { advanceBalancePaisa: true } });
      if (!now) throw new AppError('NOT_FOUND');
      const shown = now.advanceBalancePaisa < 0n ? 0n : now.advanceBalancePaisa;
      throw new AppError('WALLET_ADJUST_EXCEEDS_BALANCE', { balancePaisa: shown.toString() });
    }

    const note = p.note.trim();
    const entry = await this.insertEntry(tx, {
      distributorId: p.distributorId,
      entryType: 'ADJUSTMENT',
      amountPaisa: delta,
      balanceAfterPaisa: balance,
      idempotencyKey: key,
      paymentId: relatedPaymentId,
      orderId: relatedOrderId,
      reasonCode: p.reasonCode,
      note,
      createdByUserId: actorUserId(p.actor),
    });
    await this.audit.record(
      {
        action: 'wallet.correction',
        actor: p.actor,
        resourceType: 'Distributor',
        resourceId: p.distributorId,
        distributorId: p.distributorId,
        reason: note,
        before: { balancePaisa: balance - delta },
        after: { balancePaisa: balance },
        diff: {
          ledgerEntryId: entry.id,
          distributor: distributor.businessName,
          direction: p.direction,
          amountPaisa: p.amountPaisa,
          reasonCode: p.reasonCode,
          ...(relatedPaymentId ? { relatedPaymentId } : {}),
          ...(relatedOrderId ? { relatedOrderId } : {}),
        },
      },
      tx,
    );
    return { entry, replayed: false };
  }

  // ---------------------------------------------------------------------------------------------
  // Internals

  private orderOf(subject: WalletDebitParams['subject']): string {
    // REFILL is reserved for `refill.deliveryCost`, which is off and not built (ADR-16).
    if (subject.type !== 'ORDER') throw new AppError('INTERNAL_ERROR', { reason: 'REFILL_DELIVERY_COST_OFF' });
    if (!isUuid(subject.orderId)) throw new AppError('NOT_FOUND');
    return subject.orderId.toLowerCase();
  }

  /** A row already written under a deterministic key must be the same money; anything else is a bug. */
  private sameEntry(entry: LedgerEntry, distributorId: string, amountPaisa: bigint): LedgerEntry {
    if (entry.distributorId !== distributorId.toLowerCase() || entry.amountPaisa !== amountPaisa) {
      throw new AppError('INTERNAL_ERROR', { reason: 'LEDGER_KEY_REUSED' });
    }
    return entry;
  }

  /** One guarded balance update; the new balance, or null when the guard (or the id) refused it. */
  private async moveBalance(tx: WalletTx, distributorId: string, delta: bigint, guard: BalanceGuard): Promise<bigint | null> {
    let rows: Array<{ balance: bigint }>;
    switch (guard) {
      case 'DEBIT':
        rows = await tx.$queryRaw`
          UPDATE distributors SET advance_balance_paisa = advance_balance_paisa + ${delta}, updated_at = now()
          WHERE id = ${distributorId}::uuid AND status = 'ACTIVE' AND advance_balance_paisa + ${delta} >= 0
          RETURNING advance_balance_paisa AS balance`;
        break;
      case 'COVER':
        rows = await tx.$queryRaw`
          UPDATE distributors SET advance_balance_paisa = advance_balance_paisa + ${delta}, updated_at = now()
          WHERE id = ${distributorId}::uuid AND advance_balance_paisa + ${delta} >= 0
          RETURNING advance_balance_paisa AS balance`;
        break;
      case 'NONE':
        rows = await tx.$queryRaw`
          UPDATE distributors SET advance_balance_paisa = advance_balance_paisa + ${delta}, updated_at = now()
          WHERE id = ${distributorId}::uuid
          RETURNING advance_balance_paisa AS balance`;
        break;
    }
    return rows.length === 1 ? rows[0].balance : null;
  }

  /**
   * Inserts one signed ledger row. `created_at` is the clock time, but always after the distributor's
   * previous row: this runs while the balance update holds the distributor's row lock, so per
   * distributor the creation order is the order the balance moved.
   */
  private async insertEntry(tx: WalletTx, row: NewLedgerRow): Promise<LedgerEntry> {
    const rows = await tx.$queryRaw<LedgerEntry[]>`
      INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key,
                                  payment_id, order_id, reason_code, note, created_by_user_id, created_at)
      VALUES (gen_random_uuid(), ${row.distributorId}::uuid, ${row.entryType}::"LedgerEntryType", ${row.amountPaisa},
              ${row.balanceAfterPaisa}, ${row.idempotencyKey}, ${row.paymentId ?? null}::uuid, ${row.orderId ?? null}::uuid,
              ${row.reasonCode ?? null}, ${row.note ?? null}, ${row.createdByUserId}::uuid,
              GREATEST(clock_timestamp() AT TIME ZONE 'UTC',
                       (SELECT max(created_at) + interval '1 millisecond' FROM ledger_entries
                        WHERE distributor_id = ${row.distributorId}::uuid)))
      RETURNING id, distributor_id AS "distributorId", entry_type AS "entryType", amount_paisa AS "amountPaisa",
                balance_after_paisa AS "balanceAfterPaisa", idempotency_key AS "idempotencyKey",
                payment_id AS "paymentId", order_id AS "orderId", filling_order_id AS "fillingOrderId",
                reason_code AS "reasonCode", note, created_by_user_id AS "createdByUserId", created_at AS "createdAt"`;
    return rows[0];
  }

  private async toStatementItems(rows: StatementRow[], code: string | null, view: WalletStatementView): Promise<StatementItem[]> {
    const userNames = new Map<string, string>();
    if (view === 'OFFICE') {
      const ids = [...new Set(rows.map((row) => row.createdByUserId).filter((id): id is string => !!id))];
      if (ids.length > 0) {
        const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
        for (const user of users) userNames.set(user.id, user.name);
      }
    }
    return rows.map((row) => toStatementItem(row, { distributorCode: code, userNames }, view));
  }
}
