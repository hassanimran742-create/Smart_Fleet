/**
 * MIG-021: the flat_delivery_cost migration file (DATA_MODEL §2.4, §5.7; ADR-08, 2026-10-26), without a
 * database: made with the repo's new-migration flow (UTF-8 without a BOM, LF line endings, the newest folder,
 * right after users_app_seen), its generated DDL unchanged (the diff from the users_app_seen schema,
 * test/helpers/fixtures/schema.appseen.prisma, to prisma/schema.prisma), a pre-check that is a comment only,
 * no backfill and no CHECK. The database side is flat-delivery-cost.e2e-spec.ts.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { APP_SEEN_MIGRATION, APP_SEEN_SCHEMA, FLAT_COST_MIGRATION, MIGRATIONS_DIR, PRISMA_DIR } from '../helpers/migrations';

const API_DIR = path.resolve(__dirname, '..', '..');
const FILE = path.join(MIGRATIONS_DIR, FLAT_COST_MIGRATION, 'migration.sql');
const sql = () => fs.readFileSync(FILE, 'utf8');
const section = (text: string, from: string, to: string) => text.slice(text.indexOf(from) + from.length, text.indexOf(to)).trim();
const MARKERS = ['-- (1) PRE-CHECK', '-- (2) GENERATED DDL (unchanged)', '-- (3) BACKFILLS', '-- (4) CHECK CONSTRAINTS'];

function diff(from: string, to: string): string {
  const run = spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-schema-datamodel', from, '--to-schema-datamodel', to, '--script'],
    { cwd: API_DIR, encoding: 'utf8', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' }, maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(`prisma migrate diff failed: ${run.stderr}`);
  return run.stdout.replace(/\r\n/g, '\n').trim();
}

/** The lines of a section that aren't comments or blank. */
function statements(text: string, from: string, to?: string): string[] {
  const body = to ? section(text, from, to) : text.slice(text.indexOf(from) + from.length);
  return body
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('--'));
}

describe('MIG-021 the flat_delivery_cost migration file', () => {
  it('MIG-021 is the newest migration, right after users_app_seen, UTF-8 without a BOM, with LF line endings', () => {
    const names = fs.readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{14}_/.test(name)).sort();
    expect(names.slice(-2)).toEqual([APP_SEEN_MIGRATION, FLAT_COST_MIGRATION]);
    const bytes = fs.readFileSync(FILE);
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(bytes.includes(Buffer.from('\r\n'))).toBe(false);
    expect(Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)).toBe(true);
  });

  it('MIG-021 keeps the generated DDL unchanged: it drops the per-size price rows and the order lines\' size amounts, nothing else', () => {
    const generated = diff(APP_SEEN_SCHEMA, path.join(PRISMA_DIR, 'schema.prisma'));
    expect(section(sql(), MARKERS[1], MARKERS[2])).toBe(generated);
    expect(generated).toBe(
      [
        '-- DropForeignKey',
        'ALTER TABLE "distributor_zone_price_sizes" DROP CONSTRAINT "distributor_zone_price_sizes_price_id_fkey";',
        '',
        '-- DropForeignKey',
        'ALTER TABLE "distributor_zone_price_sizes" DROP CONSTRAINT "distributor_zone_price_sizes_cylinder_type_id_fkey";',
        '',
        '-- AlterTable',
        'ALTER TABLE "order_lines" DROP COLUMN "fee_paisa",',
        'DROP COLUMN "fee_per_cylinder_paisa";',
        '',
        '-- DropTable',
        'DROP TABLE "distributor_zone_price_sizes";',
      ].join('\n'),
    );
  }, 120_000);

  it('MIG-021 has the four sections in order; the pre-check is a comment that says why dropping is safe; no backfill, no CHECK, no money', () => {
    const text = sql();
    const at = MARKERS.map((marker) => text.indexOf(marker));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(statements(text, MARKERS[0], MARKERS[1])).toEqual([]);
    expect(statements(text, MARKERS[2], MARKERS[3])).toEqual([]);
    expect(statements(text, MARKERS[3])).toEqual([]);
    const preCheck = section(text, MARKERS[0], MARKERS[1]);
    expect(preCheck).toMatch(/test data only/);
    expect(preCheck).toMatch(/nothing is deployed/);
    // Placed orders keep their cost: the file never touches the order's amounts, the balance or the ledger.
    expect(text).not.toMatch(/UPDATE\s+(orders|distributors)|ledger_entries\s*\(|INSERT INTO|delivery_fee_paisa\s*=/i);
  });
});
