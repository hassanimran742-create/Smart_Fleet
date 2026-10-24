/**
 * Helpers for the pilot setup and reset suites (API_CONTRACT §10.3; SET-003 … SET-012). The CLIs run in
 * this process through their exported entry points (no HTTP, as the cases say), against the suite's own
 * test database; the results are then read back through the API and the database.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { UserRole } from '@prisma/client';
import { runPilotResetCli } from '../../../src/modules/pilot-setup/cli/pilot-reset';
import { runPilotSetupCli } from '../../../src/modules/pilot-setup/cli/pilot-setup';
import type { TestActor } from '../../helpers/auth';
import { API_DIR, getTestPrisma } from '../../helpers/db';

/** The sample setup file: the standard test data of TEST_CASES.md (pilot/test.json is the same data). */
export const SAMPLE_FILE = path.resolve(API_DIR, '..', '..', 'docs', 'pilot', 'pilot-setup.sample.json');

/** The standard phones (TEST_CASES.md "People" and "Customers", settled point G10-04). */
export const PHONES = {
  SA1: '+923331000001',
  SA2: '+923331000002',
  DA: '+923211234567',
  DB: '+923227654321',
  DR1: '+923451000001',
  DR2: '+923451000002',
  C1: '+923001234567',
  C2: '+923217654321',
  C3: '+923009876543',
} as const;

/** Points inside each standard zone, and "Outside" (in no zone). */
export const POINTS = {
  north: { lat: 31.525, lng: 74.225 },
  south: { lat: 31.525, lng: 74.275 },
  east: { lat: 31.525, lng: 74.325 },
  outside: { lat: 31.525, lng: 74.6 },
} as const;

// The setup file is plain JSON; tests edit copies of it freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SetupJson = Record<string, any>;

/** A fresh copy of the sample file's JSON. */
export function sampleJson(): SetupJson {
  return JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')) as SetupJson;
}

/** A box zone shape `[minLng, minLat, maxLng, maxLat]` as a GeoJSON MultiPolygon. */
export function box(minLng: number, minLat: number, maxLng: number, maxLat: number) {
  return { type: 'MultiPolygon', coordinates: [[[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]]] };
}

/** A folder of the suite's own for setup files and labels CSVs. */
export function scratchDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), `sf-${prefix}-`));
}

/** Removes a scratch folder (Windows may still hold a file a moment; the OS cleans its temp folder anyway). */
export function removeScratchDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // Left for the OS.
  }
}

/** Writes `json` as a setup file in `dir` and returns its path. */
export function writeSetupFile(dir: string, name: string, json: SetupJson): string {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(json, null, 2));
  return file;
}

export interface CliRun {
  code: number;
  lines: string[];
  text: string;
}

/** `npm run pilot:setup -- <argv>`, in this process. */
export async function runSetup(argv: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<CliRun> {
  const lines: string[] = [];
  const code = await runPilotSetupCli(argv, { out: (line) => lines.push(...line.split('\n')), env: opts.env, cwd: opts.cwd });
  return { code, lines, text: lines.join('\n') };
}

/** `npm run pilot:reset -- <argv>`, in this process. */
export async function runReset(argv: string[], opts: { env?: NodeJS.ProcessEnv } = {}): Promise<CliRun> {
  const lines: string[] = [];
  const code = await runPilotResetCli(argv, { out: (line) => lines.push(...line.split('\n')), env: opts.env });
  return { code, lines, text: lines.join('\n') };
}

/** The passwords a run printed, by login name (the lines after "New logins"). */
export function printedPasswords(run: CliRun): Map<string, { role: string; phone: string; password: string }> {
  const out = new Map<string, { role: string; phone: string; password: string }>();
  const start = run.lines.findIndex((line) => line.startsWith('New logins ('));
  if (start === -1) return out;
  for (const line of run.lines.slice(start + 1)) {
    const match = /^ {2}(.+?)\s{2,}(SUPER_ADMIN|DISTRIBUTOR|DRIVER)\s{2,}(\+92 \d{3} \d{7})\s{2,}(\S+)$/.exec(line);
    if (!match) break;
    out.set(match[1].trim(), { role: match[2], phone: match[3], password: match[4] });
  }
  return out;
}

/** Every application table's row count (not the migrations' or PostGIS's own). */
export async function tableCounts(): Promise<Record<string, number>> {
  const db = getTestPrisma();
  const tables = await db.$queryRaw<Array<{ name: string }>>`
    SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('_prisma_migrations', 'spatial_ref_sys')
    ORDER BY c.relname`;
  const out: Record<string, number> = {};
  for (const { name } of tables) {
    const [row] = await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${name}"`);
    out[name] = Number(row.n);
  }
  return out;
}

/** The rows the setup made for the standard data, by the short names of TEST_CASES.md, ready for tokens. */
export interface SetupPeople {
  SA1: TestActor & { id: string };
  SA2: TestActor & { id: string };
  DA: TestActor & { distributorId: string; homeStoreId: string; id: string };
  DB: TestActor & { distributorId: string; homeStoreId: string; id: string };
  DR1: TestActor & { driverId: string; vehicleId: string | null; id: string };
  DR2: TestActor & { driverId: string; vehicleId: string | null; id: string };
  cityId: string;
  zones: { North: string; South: string; East: string };
  sizes: { kg6: string; kg11_8: string; kg15: string; kg45_4: string };
  C1: { id: string; addressId: string };
  C2: { id: string; addressId: string };
  C3: { id: string; addressId: string };
}

/** Reads the standard rows back after a setup run of the sample file. */
export async function setupPeople(): Promise<SetupPeople> {
  const db = getTestPrisma();
  const user = async (phone: string) => db.user.findUniqueOrThrow({ where: { phone }, select: { id: true, role: true, tokenVersion: true } });
  const office = async (phone: string) => {
    const row = await user(phone);
    return { id: row.id, userId: row.id, role: row.role, tokenVersion: row.tokenVersion };
  };
  const shop = async (code: string) => {
    const row = await db.distributor.findUniqueOrThrow({ where: { code }, select: { id: true, homeStoreId: true, user: { select: { id: true, tokenVersion: true } } } });
    return { id: row.id, userId: row.user.id, role: UserRole.DISTRIBUTOR, tokenVersion: row.user.tokenVersion, distributorId: row.id, homeStoreId: row.homeStoreId };
  };
  const driver = async (phone: string) => {
    const row = await db.driver.findFirstOrThrow({ where: { user: { phone } }, select: { id: true, currentVehicleId: true, user: { select: { id: true, tokenVersion: true } } } });
    return { id: row.id, userId: row.user.id, role: UserRole.DRIVER, tokenVersion: row.user.tokenVersion, driverId: row.id, vehicleId: row.currentVehicleId };
  };
  const city = await db.city.findFirstOrThrow({ where: { name: 'Lahore' }, select: { id: true } });
  const zone = async (name: string) => (await db.zone.findFirstOrThrow({ where: { cityId: city.id, name }, select: { id: true } })).id;
  const size = async (code: string) => (await db.cylinderType.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
  const DA = await shop('AG');
  const DB = await shop('BG');
  const customer = async (distributorId: string, phone: string) => {
    const row = await db.client.findUniqueOrThrow({
      where: { distributorId_phone: { distributorId, phone } },
      select: { id: true, addresses: { select: { id: true }, take: 1 } },
    });
    return { id: row.id, addressId: row.addresses[0].id };
  };
  return {
    SA1: await office(PHONES.SA1),
    SA2: await office(PHONES.SA2),
    DA,
    DB,
    DR1: await driver(PHONES.DR1),
    DR2: await driver(PHONES.DR2),
    cityId: city.id,
    zones: { North: await zone('North'), South: await zone('South'), East: await zone('East') },
    sizes: { kg6: await size('STD_6KG'), kg11_8: await size('STD_11_8KG'), kg15: await size('STD_15KG'), kg45_4: await size('STD_45_4KG') },
    C1: await customer(DA.id, PHONES.C1),
    C2: await customer(DA.id, PHONES.C2),
    C3: await customer(DB.id, PHONES.C3),
  };
}

/** X1: Ahmed Gas orders 2 × 11.8 kg + 1 × 45.4 kg for Sana in North (Rs 480). */
export function x1Body(people: SetupPeople): Record<string, unknown> {
  return {
    clientId: people.C1.id,
    addressId: people.C1.addressId,
    deliveryLabel: "Sana's house",
    lines: [
      { cylinderTypeId: people.sizes.kg11_8, fullCount: 2, expectedReturnCount: 2 },
      { cylinderTypeId: people.sizes.kg45_4, fullCount: 1, expectedReturnCount: 1 },
    ],
  };
}
