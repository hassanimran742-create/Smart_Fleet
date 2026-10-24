/**
 * The pilot setup and reset CLIs' pure parts (API_CONTRACT §10.3): flags, the file checks and how a
 * refusal names its entry, the passwords and the labels CSV, the reset's map, and the transaction
 * scope that lets the services write into one run's transaction. The database cases are SET-003 …
 * SET-012 in the e2e suites next to this file.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { pilotSetupFileSchema } from '@smartfleet/shared-validation';
import { cylinderRanges, parsePilotSetupArgs } from '../../../src/modules/pilot-setup/cli/pilot-setup';
import { isProductionForReset, parsePilotResetArgs } from '../../../src/modules/pilot-setup/cli/pilot-reset';
import { PilotRefusal, formatPath } from '../../../src/modules/pilot-setup/refusal';
import { ABOUT_DELETED, DELETE_ORDER, NEVER_DELETED, OWNED_BY, POINTS_AT } from '../../../src/modules/pilot-setup/reset/reset-graph';
import { checkSetupFile, parseSetupFile } from '../../../src/modules/pilot-setup/setup/setup-file';
import { SETUP_PASSWORD_LENGTH, defaultLabelsFileName, generateSetupPassword, labelsCsv, loginLines } from '../../../src/modules/pilot-setup/setup/setup-output';
import { inRunTransaction, runInTransaction, transactionAware } from '../../../src/modules/pilot-setup/tx-scope';

const SAMPLE = path.resolve(__dirname, '..', '..', '..', '..', '..', 'docs', 'pilot', 'pilot-setup.sample.json');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sample = (): Record<string, any> => JSON.parse(readFileSync(SAMPLE, 'utf8'));

function refusalOf(json: unknown, test = true): PilotRefusal {
  const parsed = parseSetupFile(json);
  if (!parsed.ok) return parsed.refusal;
  const checked = checkSetupFile(parsed.file, json, { test });
  if (checked instanceof PilotRefusal) return checked;
  throw new Error('expected a refusal');
}

describe('SET-003 the setup file', () => {
  it('SET-003 the sample file (the standard test data) passes the shared schema and the whole-file rules', () => {
    const json = sample();
    const parsed = parseSetupFile(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.zones.map((zone) => zone.name)).toEqual(['North', 'South', 'East']);
    expect(parsed.file.distributors.map((shop) => shop.code)).toEqual(['AG', 'BG']);
    expect(parsed.file.stock.reduce((sum, row) => sum + row.count, 0)).toBe(35);
    const checked = checkSetupFile(parsed.file, json, { test: true });
    expect(checked).not.toBeInstanceOf(PilotRefusal);
    if (checked instanceof PilotRefusal) return;
    expect(checked.phones).toEqual({
      officeUsers: ['+923331000001', '+923331000002'],
      distributors: ['+923211234567', '+923227654321'],
      drivers: ['+923451000001', '+923451000002'],
      customers: ['+923001234567', '+923217654321', '+923009876543'],
    });
  });

  it('SET-003 every pilot/*.json data file in the repository passes the schema too', () => {
    const dir = path.resolve(__dirname, '..', '..', '..', '..', '..', 'pilot');
    const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
    for (const name of files) {
      const parsed = pilotSetupFileSchema.safeParse(JSON.parse(readFileSync(path.join(dir, name), 'utf8')));
      expect({ name, ok: parsed.success }).toEqual({ name, ok: true });
    }
  });

  it('SET-004 a broken zone shape anywhere in its structure is ZONE_INVALID_SHAPE, naming the zone', () => {
    for (const shape of [{ type: 'MultiPolygon', coordinates: [] }, { type: 'Point', coordinates: [74.3, 31.5] }, { type: 'MultiPolygon', coordinates: [[[[74.3, 31.5], [74.35, 31.5], [74.3, 31.55]]]] }]) {
      const json = sample();
      json.zones[2].shape = shape;
      const refusal = refusalOf(json);
      expect(refusal.lines()[0]).toBe("Refused at zones[2].shape (East): ZONE_INVALID_SHAPE: This zone shape isn't valid.");
    }
    // A Polygon is read as a one-part MultiPolygon.
    const json = sample();
    json.zones[2].shape = { type: 'Polygon', coordinates: json.zones[2].shape.coordinates[0] };
    const parsed = parseSetupFile(json);
    expect(parsed.ok && parsed.file.zones[2].shape).toEqual(sample().zones[2].shape);
  });

  it('SET-005 the first bad entry is named with its catalogue code, in section order', () => {
    const both = sample();
    both.prices[0].basePaisa = '250.50';
    both.distributors[0].code = 'ag';
    // distributors come before prices.
    expect(refusalOf(both).lines()[0]).toBe(
      'Refused at distributors[0].code (Ahmed Gas): DISTRIBUTOR_CODE_INVALID: Use 2 to 6 capital letters or digits, starting with a letter.',
    );
    const price = sample();
    price.prices[2].basePaisa = 12345;
    expect(refusalOf(price).lines()[0]).toBe('Refused at prices[2].basePaisa (BG in South): PRICE_INVALID: Enter whole rupees, from Rs 0 to Rs 100,000.');
    const name = sample();
    name.zones[1].name = 'S';
    expect(refusalOf(name).lines()).toEqual([
      'Refused at zones[1].name (S): VALIDATION_FAILED: Some details need fixing.',
      '  TOO_SHORT: Use at least 2 characters.',
    ]);
    const reference = sample();
    reference.stock[0].distributor = 'XX';
    expect(refusalOf(reference).lines()).toEqual([
      'Refused at stock[0].distributor (XX STD_11_8KG): VALIDATION_FAILED: Some details need fixing.',
      '  INVALID_CHOICE: Pick one of the options.',
    ]);
  });

  it('SET-005 opening balances need --test, and logins and customers need good, unique phones', () => {
    expect(refusalOf(sample(), false).lines()).toEqual([
      'Refused at openingBalances[0] (AG): VALIDATION_FAILED: Some details need fixing.',
      "  NOT_ALLOWED: This can't be sent here.",
      '  Opening balances are for a test server: run with --test. On live, balances come only from top-ups and office corrections.',
    ]);
    const bad = sample();
    bad.drivers[1].phone = '042 1234567';
    expect(refusalOf(bad).lines()[1]).toBe('  INVALID_PHONE: Enter a mobile number like 0300 1234567.');
    expect(refusalOf(bad).path).toEqual(['drivers', 1, 'phone']);
    const twice = sample();
    twice.drivers[0].phone = '+92 333 1000001'; // Owner's phone, written another way.
    const dup = refusalOf(twice);
    expect(dup.path).toEqual(['drivers', 0, 'phone']);
    expect(dup.lines().join('\n')).toContain('DUPLICATE_ITEM: This is listed twice.');
    expect(dup.lines().join('\n')).toContain('officeUsers[0].phone');
    const customer = sample();
    customer.customers[2].phone = '0300 12';
    expect(refusalOf(customer).lines()[0]).toBe('Refused at customers[2].phone (Hina): CLIENT_PHONE_INVALID: Enter a number like 300 1234567.');
    const size = sample();
    size.cylinderTypes.push({ code: 'OTHER_11_8', name: '11.8 kg (B)', weightKg: 11.8 });
    expect(refusalOf(size).path).toEqual(['cylinderTypes', 4, 'weightKg']);
  });

  it('SET-005 an unknown key anywhere is refused with its name', () => {
    const json = sample();
    json.distributors[1].store.zone = 'South';
    const refusal = refusalOf(json);
    expect(refusal.lines()[0]).toBe('Refused at distributors[1].store (Bilal Gas): VALIDATION_FAILED: Some details need fixing.');
    expect(refusal.lines().join('\n')).toContain('Unknown key "zone"');
    expect(refusalOf({ ...sample(), extra: 1 }).lines()[0]).toBe('Refused at (the file): VALIDATION_FAILED: Some details need fixing.');
  });

  it('SET-005 JSON paths print as the file reads them', () => {
    expect(formatPath(['zones', 2, 'shape'])).toBe('zones[2].shape');
    expect(formatPath(['settings', 'topup.account'])).toBe('settings["topup.account"]');
    expect(formatPath([])).toBe('(the file)');
  });
});

describe('SET-007 passwords and labels', () => {
  it('SET-007 each password is 12 random characters that read unambiguously', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const password = generateSetupPassword();
      expect(password).toHaveLength(SETUP_PASSWORD_LENGTH);
      expect(password).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{12}$/);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
    expect(loginLines([])).toEqual(['No new logins: no passwords were made (a re-run never resets one).']);
    const lines = loginLines([{ name: 'Owner', role: 'SUPER_ADMIN', phone: '+923331000001', password: 'abcdEFGH2345' }]);
    expect(lines[1]).toBe('  Owner  SUPER_ADMIN  +92 333 1000001  abcdEFGH2345');
  });

  it('SET-007 the labels CSV lists each cylinder once, in number order, safe to open in a spreadsheet', () => {
    const csv = labelsCsv([
      { shortNo: 2, shortCode: 'AG-C0002', qrValue: 'STD-2', sizeLabel: '11.8 kg', state: 'FULL', distributorCode: 'AG', distributorName: 'Ahmed Gas' },
      { shortNo: 1, shortCode: 'AG-C0001', qrValue: 'STD-1', sizeLabel: '11.8 kg', state: 'EMPTY', distributorCode: 'AG', distributorName: '=HYPERLINK("x")' },
      { shortNo: 1, shortCode: 'BG-C0001', qrValue: 'STD-3', sizeLabel: '15 kg', state: 'FULL', distributorCode: 'BG', distributorName: 'Bilal, "Gas"' },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'Cylinder number,QR value,Size,State,Shop code,Shop',
      `AG-C0001,STD-1,11.8 kg,Empty,AG,"'=HYPERLINK(""x"")"`,
      'AG-C0002,STD-2,11.8 kg,Full,AG,Ahmed Gas',
      'BG-C0001,STD-3,15 kg,Full,BG,"Bilal, ""Gas"""',
      '',
    ]);
    expect(defaultLabelsFileName(new Date('2026-10-24T15:30:12.345Z'))).toBe('pilot-labels-20261024-153012.csv');
    expect(cylinderRanges(['AG-C0001', 'AG-C0002', 'AG-C0003', 'AG-C0007', 'BG-C0001'])).toBe('AG-C0001–AG-C0003, AG-C0007, BG-C0001');
  });
});

describe('SET-008 and SET-011 flags', () => {
  it('SET-008 the setup flags', () => {
    expect(parsePilotSetupArgs(['--file', 'pilot/test.json', '--test', '--dry-run'])).toEqual({ file: 'pilot/test.json', test: true, dryRun: true, labels: undefined });
    expect(parsePilotSetupArgs(['--file=pilot/x.json', '--labels', 'out.csv'])).toEqual({ file: 'pilot/x.json', test: false, dryRun: false, labels: 'out.csv' });
    expect(() => parsePilotSetupArgs([])).toThrow('--file is required');
    expect(() => parsePilotSetupArgs(['--file'])).toThrow('--file needs a value');
    expect(() => parsePilotSetupArgs(['--file', '--test'])).toThrow('--file needs a value');
    expect(() => parsePilotSetupArgs(['--file', 'a.json', '--yes'])).toThrow('Unknown argument: --yes');
  });

  it('SET-011 the reset flags, and production by APP_ENV or NODE_ENV', () => {
    expect(parsePilotResetArgs([])).toEqual({ yes: false, dryRun: false, allowProduction: false });
    expect(parsePilotResetArgs(['--yes', '--allow-production', '--confirm-db', 'smartfleet_prod_copy'])).toEqual({
      yes: true,
      dryRun: false,
      allowProduction: true,
      confirmDb: 'smartfleet_prod_copy',
    });
    expect(parsePilotResetArgs(['--dry-run', '--confirm-db=x'])).toMatchObject({ dryRun: true, confirmDb: 'x' });
    expect(() => parsePilotResetArgs(['--force'])).toThrow('Unknown argument: --force');
    expect(() => parsePilotResetArgs(['--confirm-db'])).toThrow('--confirm-db needs a value');
    expect(isProductionForReset({ NODE_ENV: 'production' })).toBe(true);
    expect(isProductionForReset({ NODE_ENV: 'production', APP_ENV: 'staging' })).toBe(true);
    expect(isProductionForReset({ NODE_ENV: 'test', APP_ENV: 'production' })).toBe(true);
    expect(isProductionForReset({ NODE_ENV: 'test', APP_ENV: 'staging' })).toBe(false);
    expect(isProductionForReset({})).toBe(false);
  });
});

describe('SET-009 the reset map', () => {
  it('SET-009 every table it names is deleted in order or kept on purpose, with plain identifiers', () => {
    const order = new Set<string>(DELETE_ORDER);
    const kept = new Set<string>(NEVER_DELETED);
    for (const edge of [...OWNED_BY, ...ABOUT_DELETED]) {
      expect({ edge: `${edge.table}.${edge.column}`, deleted: order.has(edge.table) }).toEqual({ edge: `${edge.table}.${edge.column}`, deleted: true });
      for (const parent of edge.parents) if (parent !== '*') expect(order.has(parent)).toBe(true);
    }
    for (const edge of POINTS_AT) {
      expect(order.has(edge.table) || kept.has(edge.table)).toBe(true);
      for (const target of edge.targets) expect(order.has(target)).toBe(true);
    }
    for (const name of [...order, ...kept]) expect(name).toMatch(/^[a-z_]+$/);
    expect(new Set(DELETE_ORDER).size).toBe(DELETE_ORDER.length);
    expect([...order].filter((table) => kept.has(table))).toEqual([]);
    // Office logins and the shared set-up are never in the plan.
    expect(DELETE_ORDER[DELETE_ORDER.length - 1]).toBe('users');
    for (const table of ['zones', 'cities', 'cylinder_types', 'filling_stations', 'app_settings']) expect(kept.has(table)).toBe(true);
  });
});

describe('SET-005 one transaction through the services', () => {
  /** A stand-in Prisma client: records which object served each call. */
  function fakeClient(name: string) {
    const calls: string[] = [];
    const client = {
      calls,
      user: { findMany: () => calls.push(`${name}.user.findMany`) },
      $queryRaw(this: unknown) {
        calls.push(`${name}.$queryRaw:${this === client ? 'bound' : 'unbound'}`);
        return Promise.resolve([]);
      },
      $transaction: (work: (tx: unknown) => unknown) => {
        calls.push(`${name}.$transaction`);
        return Promise.resolve(work(client));
      },
      onModuleInit: () => calls.push(`${name}.onModuleInit`),
    };
    return client;
  }

  it('SET-005 a service call inside a run goes to the run’s transaction; outside, to the client itself', async () => {
    const base = fakeClient('base');
    const tx = fakeClient('tx');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = transactionAware(base as any) as any;
    prisma.user.findMany();
    await prisma.$queryRaw();
    expect(inRunTransaction()).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runInTransaction(tx as any, async () => {
      expect(inRunTransaction()).toBe(true);
      prisma.user.findMany();
      await prisma.$queryRaw();
      // A service's own $transaction joins the run's: its callback gets the run's transaction.
      const inner = await prisma.$transaction(async (client: unknown) => {
        expect(client).toBe(tx);
        await Promise.resolve();
        prisma.user.findMany();
        return 'done';
      });
      expect(inner).toBe('done');
      // The array form runs its queries in order on the run's transaction.
      expect(await prisma.$transaction([Promise.resolve(1), Promise.resolve(2)])).toEqual([1, 2]);
      // Lifecycle hooks stay the client's own.
      prisma.onModuleInit();
    });
    expect(base.calls).toEqual(['base.user.findMany', 'base.$queryRaw:bound', 'base.onModuleInit']);
    expect(tx.calls).toEqual(['tx.user.findMany', 'tx.$queryRaw:bound', 'tx.user.findMany']);
    expect(prisma.constructor).toBe(base.constructor);
  });
});
