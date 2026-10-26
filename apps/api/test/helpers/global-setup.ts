/**
 * Jest globalSetup for `npm run test:e2e`: runs once, before any suite.
 *
 * Without DATABASE_URL it does nothing and the DB suites skip (describeDb). With it, the test
 * database is brought to the current migrations with `prisma migrate deploy`, or rebuilt from
 * scratch with E2E_DB_RESET=1 (`prisma migrate reset`). Either refuses a database whose name
 * doesn't contain "test" (see assertSafeTestDatabase).
 */
import { assertSafeTestDatabase, hasTestDb, migrateTestDb } from './db';

export default async function globalSetup(): Promise<void> {
  if (!hasTestDb) {
    console.log('\n[e2e] DATABASE_URL is not set: DB suites are skipped.');
    return;
  }
  const name = assertSafeTestDatabase();
  const reset = process.env.E2E_DB_RESET === '1';
  try {
    migrateTestDb({ reset });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message: string };
    const out = `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`.trim();
    throw new Error(`[e2e] could not ${reset ? 'reset' : 'migrate'} test database "${name}":\n${out || err.message}`);
  }
  console.log(`\n[e2e] test database "${name}" ${reset ? 'reset and migrated' : 'migrated'}.`);
}
