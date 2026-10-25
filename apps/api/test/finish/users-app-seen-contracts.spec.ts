/**
 * MIG-020: the users_app_seen migration file (DATA_MODEL §2.4, §5.6), without a database: made with the repo's
 * new-migration flow (UTF-8 without a BOM, LF line endings, the newest folder), its generated DDL unchanged
 * (the diff from the Increment 3 schema, test/helpers/fixtures/schema.inc3.prisma, to prisma/schema.prisma), no
 * pre-check and no backfill, and the two CHECKs AppSeenService's writes need. The database side is
 * users-app-seen-migration.e2e-spec.ts.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { APP_SEEN_MIGRATION, INC3_MIGRATION, INC3_SCHEMA, MIGRATIONS_DIR, PRISMA_DIR } from '../helpers/migrations';

const API_DIR = path.resolve(__dirname, '..', '..');
const FILE = path.join(MIGRATIONS_DIR, APP_SEEN_MIGRATION, 'migration.sql');
const sql = () => fs.readFileSync(FILE, 'utf8');
const section = (text: string, from: string, to: string) => text.slice(text.indexOf(from) + from.length, text.indexOf(to)).trim();

function diff(from: string, to: string): string {
  const run = spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-schema-datamodel', from, '--to-schema-datamodel', to, '--script'],
    { cwd: API_DIR, encoding: 'utf8', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' }, maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(`prisma migrate diff failed: ${run.stderr}`);
  return run.stdout.replace(/\r\n/g, '\n').trim();
}

describe('MIG-020 the users_app_seen migration file', () => {
  it('MIG-020 is the newest migration, right after inc3_refills_dayend, UTF-8 without a BOM, with LF line endings', () => {
    const names = fs.readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{14}_/.test(name)).sort();
    expect(names.slice(-2)).toEqual([INC3_MIGRATION, APP_SEEN_MIGRATION]);
    const bytes = fs.readFileSync(FILE);
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(bytes.includes(Buffer.from('\r\n'))).toBe(false);
    expect(Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)).toBe(true);
  });

  it('MIG-020 keeps the generated DDL unchanged: the diff from the Inc 3 schema to prisma/schema.prisma', () => {
    const generated = diff(INC3_SCHEMA, path.join(PRISMA_DIR, 'schema.prisma'));
    expect(section(sql(), '-- (2) GENERATED DDL (unchanged)', '-- (3) BACKFILLS')).toBe(generated);
    // Three nullable columns on users, nothing else: the previous release keeps starting and writing (DATA_MODEL §1 rule 6).
    expect(generated).toBe(
      ['-- AlterTable', 'ALTER TABLE "users" ADD COLUMN     "app_seen_at" TIMESTAMP(3),', 'ADD COLUMN     "app_variant" TEXT,', 'ADD COLUMN     "app_version" TEXT;'].join('\n'),
    );
  }, 120_000);

  it('MIG-020 has the four sections in order, no pre-check or backfill statement, and the two CHECKs', () => {
    const text = sql();
    const at = ['-- (1) PRE-CHECK', '-- (2) GENERATED DDL (unchanged)', '-- (3) BACKFILLS', '-- (4) CHECK CONSTRAINTS'].map((marker) => text.indexOf(marker));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The lines after a section's marker line, up to the next marker, that aren't comments.
    const statements = (from: string, to: string) =>
      section(text, from, to)
        .split('\n')
        .slice(1)
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('--'));
    expect(statements('-- (1) PRE-CHECK', '-- (2) GENERATED DDL (unchanged)')).toEqual([]);
    expect(statements('-- (3) BACKFILLS', '-- (4) CHECK CONSTRAINTS')).toEqual([]);
    const checks = text.slice(text.indexOf('-- (4) CHECK CONSTRAINTS'));
    expect([...checks.matchAll(/ADD CONSTRAINT (\w+) CHECK/g)].map((m) => m[1])).toEqual(['users_app_seen_chk', 'users_app_version_chk']);
    // Both validated at once: every existing row has the three columns NULL.
    const statementsOnly = checks
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statementsOnly).toMatch(/ADD CONSTRAINT users_app_seen_chk CHECK/);
    expect(statementsOnly).not.toMatch(/NOT VALID/);
    // No money: the file never names the balance or the ledger.
    expect(text).not.toMatch(/UPDATE\s+distributors|ledger_entries\s*\(|INSERT INTO ledger_entries/i);
  });
});
