/**
 * WAL-020: the nightly wallet check, run once after every DB suite (API_CONTRACT §8.6 "the nightly check
 * is clean after all of the above"). It is the `globalTeardown` of test/jest-e2e.json.
 *
 * It runs the DATA_MODEL §3.6 query on the suite database: any distributor whose ledger sum differs
 * from its balance, or whose balance is below zero, fails the run. A suite that breaks a wallet on
 * purpose (WAL-016) puts it right before it finishes. Without DATABASE_URL it does nothing.
 */
import { PrismaClient } from '@prisma/client';

export default async function walletCheckTeardown(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const broken = await db.$queryRaw<Array<{ id: string; balance: bigint; ledger: bigint }>>`
      SELECT d.id, d.advance_balance_paisa AS balance, COALESCE(sum(l.amount_paisa), 0)::bigint AS ledger
      FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id
      GROUP BY d.id
      HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa), 0) OR d.advance_balance_paisa < 0`;
    if (broken.length > 0) {
      const list = broken.map((row) => `${row.id} (balance ${row.balance}, ledger ${row.ledger})`).join(', ');
      throw new Error(`[e2e] WAL-020: the nightly wallet check found ${broken.length} broken wallet(s): ${list}`);
    }
    console.log('\n[e2e] WAL-020: the nightly wallet check is clean.');
  } finally {
    await db.$disconnect();
  }
}
