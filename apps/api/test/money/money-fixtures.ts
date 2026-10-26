/**
 * Fixtures for the money suites (api-money lane): company account and settings through the real
 * SettingsService (as the logged CLI does), orders and top-up requests seeded with raw SQL so wallet
 * cases don't need the orders lane, and small ledger readers.
 */
import type { INestApplication } from '@nestjs/common';
import { OrderStatus, PaymentStatus, type PrismaClient } from '@prisma/client';
import type { SettingKey, SettingValue, TopupAccount } from '@smartfleet/shared-types';
import { formatNo } from '@smartfleet/shared-utils';
import { systemActor } from '../../src/common/auth/actor';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { getTestPrisma } from '../helpers/db';
import type { TestClient, TestDistributor } from '../helpers/factories';
import { DUMMY_COMPANY_ACCOUNT } from '../helpers/standard-data';

/** A deterministic Idempotency-Key for a test step: `key('a', 3)` → 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003'. */
export function key(letter: string, n: number): string {
  const c = letter.slice(0, 1).toLowerCase();
  const hex = /[0-9a-f]/.test(c) ? c : 'a';
  return `${hex.repeat(8)}-${hex.repeat(4)}-4${hex.repeat(3)}-8${hex.repeat(3)}-${String(n).padStart(12, '0')}`;
}

/** Sets a setting the way the logged settings CLI does (also keys the API refuses to edit). */
export async function setSetting<K extends SettingKey>(app: INestApplication, k: K, value: SettingValue<K>): Promise<void> {
  await app.get(SettingsService).set(k, value, systemActor('cli:settings'), 'Money test setup', { allowNotEditable: true });
}

/** The dummy company account of the standard data, or null to close top-ups. */
export function setCompanyAccount(app: INestApplication, account: TopupAccount | null = DUMMY_COMPANY_ACCOUNT): Promise<void> {
  return setSetting(app, 'topup.account', account ? { ...account } : null);
}

/**
 * An order row written directly (no wallet movement), for wallet and report cases that need an order to
 * point at. Numbered from the distributor's counter like a real order.
 */
export async function insertOrder(opts: {
  distributor: Pick<TestDistributor, 'id' | 'homeStoreId'>;
  client: Pick<TestClient, 'id' | 'location'>;
  zoneId: string;
  feePaisa?: bigint;
  status?: OrderStatus;
  createdAt?: Date;
  deliveredAt?: Date | null;
  db?: PrismaClient;
}): Promise<{ id: string; orderNo: number }> {
  const db = opts.db ?? getTestPrisma();
  const fee = opts.feePaisa ?? 0n;
  const at = opts.createdAt ?? new Date();
  const point = opts.client.location ?? { lat: 31.53, lng: 74.23 };
  const rows = await db.$queryRaw<Array<{ id: string; order_no: number }>>`
    WITH n AS (
      UPDATE distributors SET next_order_no = next_order_no + 1 WHERE id = ${opts.distributor.id}::uuid
      RETURNING next_order_no - 1 AS no
    )
    INSERT INTO orders (id, distributor_id, client_id, delivery_address, delivery_address_label, dest_zone_id,
                        origin_store_id, order_no, status, payment_status, delivery_fee_paisa, fee_status, fee_strategy,
                        fee_base_paisa, delivered_at, created_at, updated_at)
    SELECT gen_random_uuid(), ${opts.distributor.id}::uuid, ${opts.client.id}::uuid,
           ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326), 'Test address', ${opts.zoneId}::uuid,
           ${opts.distributor.homeStoreId}::uuid, n.no, ${opts.status ?? OrderStatus.PENDING}::"OrderStatus",
           ${fee > 0n ? 'PAID_VIA_LEDGER' : 'UNPAID'}::"OrderPaymentStatus", ${fee},
           ${fee > 0n ? 'DEDUCTED' : 'NONE'}::"OrderFeeStatus", 'DISTRIBUTOR_ZONE'::"FeeStrategy", ${fee},
           (${opts.deliveredAt ?? null}::timestamptz AT TIME ZONE 'UTC'),
           (${at}::timestamptz AT TIME ZONE 'UTC'), (${at}::timestamptz AT TIME ZONE 'UTC')
    FROM n
    RETURNING id, order_no`;
  return { id: rows[0].id, orderNo: Number(rows[0].order_no) };
}

/**
 * A top-up request seeded directly (cases that need more pending requests than the limit allows, or
 * a fixed time), numbered from the distributor's counter.
 */
export async function seedTopup(opts: {
  distributor: Pick<TestDistributor, 'id' | 'code'>;
  amountPaisa: bigint;
  payerName?: string | null;
  transactionId?: string | null;
  status?: PaymentStatus;
  createdAt?: Date;
  completedAt?: Date | null;
  bankReference?: string | null;
  bankAmountPaisa?: bigint | null;
  verifiedByUserId?: string | null;
  db?: PrismaClient;
}): Promise<{ id: string; requestNo: number; shortCode: string }> {
  const db = opts.db ?? getTestPrisma();
  const [{ no }] = await db.$queryRaw<Array<{ no: number }>>`
    UPDATE distributors SET next_topup_no = next_topup_no + 1 WHERE id = ${opts.distributor.id}::uuid
    RETURNING next_topup_no - 1 AS no`;
  const bankReference = opts.bankReference ?? null;
  const payment = await db.payment.create({
    data: {
      distributorId: opts.distributor.id,
      requestNo: Number(no),
      amountPaisa: opts.amountPaisa,
      provider: 'BANK_MANUAL',
      providerTxnId: null,
      status: opts.status ?? PaymentStatus.PENDING,
      payerName: opts.payerName === undefined ? 'Ahmed Raza' : opts.payerName,
      payerChannel: 'BANK_APP',
      transactionId: opts.transactionId ?? null,
      bankReference,
      bankReferenceKey: bankReference ? bankReference.toUpperCase().replace(/[^A-Z0-9]/g, '') : null,
      bankAmountPaisa: opts.bankAmountPaisa ?? null,
      verifiedByUserId: opts.verifiedByUserId ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      completedAt: opts.completedAt ?? null,
    },
  });
  return { id: payment.id, requestNo: Number(no), shortCode: formatNo(opts.distributor.code, 'TOPUP', Number(no)) };
}

/** The distributor's cached balance. */
export async function balanceOf(distributorId: string, db: PrismaClient = getTestPrisma()): Promise<bigint> {
  return (await db.distributor.findUniqueOrThrow({ where: { id: distributorId } })).advanceBalancePaisa;
}

/** The distributor's ledger rows in the order the balance moved (creation order). */
export function ledgerOf(distributorId: string, db: PrismaClient = getTestPrisma()) {
  return db.ledgerEntry.findMany({ where: { distributorId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/**
 * Every row's balance_after is the previous row's plus its own amount, none is negative, and the last
 * equals the cached balance (the ledger's running-balance invariant).
 */
export async function expectRunningBalances(distributorId: string, db: PrismaClient = getTestPrisma()): Promise<void> {
  const rows = await ledgerOf(distributorId, db);
  let running = 0n;
  for (const row of rows) {
    running += row.amountPaisa;
    expect({ id: row.id, balanceAfter: row.balanceAfterPaisa }).toEqual({ id: row.id, balanceAfter: running });
    expect(row.balanceAfterPaisa >= 0n).toBe(true);
  }
  expect(await balanceOf(distributorId, db)).toBe(running);
}

/** Audit rows of one action, oldest first. */
export function auditRows(action: string, db: PrismaClient = getTestPrisma()) {
  return db.auditLog.findMany({ where: { action }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** A recent past ISO time, for bank times. */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
