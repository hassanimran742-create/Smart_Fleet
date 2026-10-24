/**
 * The pilot setup CLI (API_CONTRACT §10.3, settled points G10-01 and G10-04): SET-003 … SET-008.
 *
 * No HTTP: each case runs the CLI's entry point (`runPilotSetupCli`, what `npm run pilot:setup` calls)
 * against this suite's test database, then checks the result through the API and the database. The sample
 * file docs/pilot/pilot-setup.sample.json is the standard test data (pilot/test.json is the same data).
 */
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { ConsoleLogger, type INestApplication, type LoggerService } from '@nestjs/common';
import { CustodyType, CylinderEventType, CylinderState, DistributorStatus, UserRole, UserStatus } from '@prisma/client';
import { createTestApp, forgetSettings } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { API_DIR, getTestPrisma, resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createDistributor, createZone } from '../../helpers/factories';
import { http } from '../../helpers/http';
import { login, secretsIn, useMemoryRateLimits } from '../../security/security-helpers';
import {
  PHONES,
  POINTS,
  SAMPLE_FILE,
  box,
  printedPasswords,
  removeScratchDir,
  runSetup,
  sampleJson,
  scratchDir,
  setupPeople,
  tableCounts,
  writeSetupFile,
  x1Body,
  type CliRun,
} from './support';

// Each case boots the CLI's own Nest context and hashes six passwords with argon2.
jest.setTimeout(240_000);

const API = '/api/v1';

describeDb('pilot setup CLI (SET-003 to SET-008)', () => {
  let app: INestApplication;
  const db = () => getTestPrisma();
  const api = () => http(app);
  const dir = scratchDir('pilot-setup');
  let labelsCount = 0;
  /** A labels path no earlier run used (a run never overwrites one). */
  const labels = () => path.join(dir, `labels-${++labelsCount}.csv`);

  /** `npm run pilot:setup -- --file <file> [flags]`, with a fresh labels path; then the API's settings cache is dropped. */
  async function setup(file: string, ...flags: string[]): Promise<CliRun> {
    const run = await runSetup(['--file', file, ...flags, '--labels', labels()]);
    forgetSettings(app);
    return run;
  }

  async function counts(): Promise<{ zones: number; distributors: number; cylinders: number; users: number; auditRows: number }> {
    return {
      zones: await db().zone.count(),
      distributors: await db().distributor.count(),
      cylinders: await db().cylinder.count(),
      users: await db().user.count(),
      auditRows: await db().auditLog.count(),
    };
  }

  const nothing = { zones: 0, distributors: 0, cylinders: 0, users: 0, auditRows: 0 };

  beforeAll(async () => {
    app = await createTestApp();
    useMemoryRateLimits(app);
  }, 300_000);

  beforeEach(async () => {
    await resetDb();
    forgetSettings(app);
  });

  afterAll(async () => {
    await app?.close();
    removeScratchDir(dir);
  });

  it('SET-003 setup loads the zones from the file, and the Outside point is in no zone', async () => {
    // Step 1.
    const run = await setup(SAMPLE_FILE, '--test');
    expect({ code: run.code, text: run.text }).toEqual({ code: 0, text: expect.stringContaining('done, in one transaction') });
    const people = await setupPeople();
    const file = sampleJson();

    // Step 2: three active zones with the file's shapes, valid and with an area.
    const zones = await api().get(`${API}/zones/city/${people.cityId}`).set(authHeader(people.SA1)).expect(200);
    expect(zones.body.map((zone: { name: string }) => zone.name).sort()).toEqual(['East', 'North', 'South']);
    for (const zone of zones.body as Array<{ name: string; is_active: boolean; polygon: { type: string; coordinates: unknown } }>) {
      expect(zone.is_active).toBe(true);
      const wanted = file.zones.find((entry: { name: string }) => entry.name === zone.name);
      expect(zone.polygon).toEqual({ type: 'MultiPolygon', coordinates: wanted.shape.coordinates });
    }
    const shapes = await db().$queryRaw<Array<{ name: string; valid: boolean; area: number }>>`
      SELECT name, ST_IsValid(polygon) AS valid, ST_Area(polygon::geography) AS area FROM zones ORDER BY name`;
    for (const shape of shapes) expect({ name: shape.name, valid: shape.valid, positive: Number(shape.area) > 0 }).toEqual({ name: shape.name, valid: true, positive: true });

    // Step 3: each point in its zone, Outside in none.
    for (const [name, point] of [
      ['North', POINTS.north],
      ['South', POINTS.south],
      ['East', POINTS.east],
    ] as const) {
      const located = await api().get(`${API}/zones/locate`).query(point).set(authHeader(people.SA1)).expect(200);
      expect(located.body).toEqual({ id: people.zones[name], name });
    }
    const outside = await api().get(`${API}/zones/locate`).query(POINTS.outside).set(authHeader(people.SA1)).expect(200);
    expect(outside.body?.id).toBeUndefined();

    // Step 4: quotes for Ahmed Gas.
    const notCovered = await api().get(`${API}/pricing/quote`).query(POINTS.outside).set(authHeader(people.DA)).expect(200);
    expect(notCovered.body).toMatchObject({ serviceable: false, blockCode: 'PRICING_ZONE_NOT_COVERED' });
    const noPrice = await api().get(`${API}/pricing/quote`).query(POINTS.east).set(authHeader(people.DA)).expect(200);
    expect(noPrice.body).toMatchObject({ serviceable: false, blockCode: 'PRICING_PRICE_NOT_SET', zone: { id: people.zones.East, name: 'East' } });
  });

  it('SET-004 setup refuses broken or overlapping zone shapes', async () => {
    const east = (shape: unknown) => {
      const json = sampleJson();
      json.zones[2].shape = shape;
      return json;
    };
    const broken: Array<[string, unknown]> = [
      // Step 1: a self-crossing (bow-tie) polygon.
      ['bow-tie', { type: 'MultiPolygon', coordinates: [[[[74.3, 31.5], [74.35, 31.55], [74.35, 31.5], [74.3, 31.55], [74.3, 31.5]]]] }],
      // Step 2: every point on one line (area 0).
      ['one-line', { type: 'MultiPolygon', coordinates: [[[[74.3, 31.5], [74.32, 31.5], [74.35, 31.5], [74.3, 31.5]]]] }],
      // Step 3: an empty MultiPolygon.
      ['empty', { type: 'MultiPolygon', coordinates: [] }],
    ];
    for (const [name, shape] of broken) {
      const run = await setup(writeSetupFile(dir, `east-${name}.json`, east(shape)), '--test');
      expect({ name, code: run.code }).toEqual({ name, code: 1 });
      expect(run.lines[0]).toBe("Refused at zones[2].shape (East): ZONE_INVALID_SHAPE: This zone shape isn't valid.");
      expect(run.text).toContain('Nothing was written.');
      // Step 6.
      expect(await counts()).toEqual(nothing);
    }

    // Step 4: North widened so it overlaps South by a strip (0.01° wide).
    const wide = sampleJson();
    wide.zones[0].shape = box(74.2, 31.5, 74.26, 31.55);
    const overlap = await setup(writeSetupFile(dir, 'north-wide.json', wide), '--test');
    expect(overlap.code).toBe(1);
    expect(overlap.lines[0]).toBe("Refused at zones[0].shape (North): ZONE_INVALID_SHAPE: This zone shape isn't valid.");
    expect(overlap.text).toMatch(/North overlaps South \(zones\[1\]\) by [\d,]+ m²/);
    expect(await counts()).toEqual(nothing);

    // An overlap with an active zone already stored counts too (the stored zone isn't in the file).
    const city = await db().city.create({ data: { name: 'Lahore' } });
    await createZone({ city, name: 'Gulberg', bbox: [74.34, 31.52, 74.4, 31.6] });
    const stored = await setup(SAMPLE_FILE, '--test');
    expect(stored.code).toBe(1);
    expect(stored.lines[0]).toBe("Refused at zones[2].shape (East): ZONE_INVALID_SHAPE: This zone shape isn't valid.");
    expect(stored.text).toContain('East overlaps the stored active zone "Gulberg" (Lahore)');
    expect(await db().zone.count()).toBe(1);
    expect(await db().distributor.count()).toBe(0);

    // Step 5: North and South share only a border line (as in the standard file): touching isn't overlapping.
    await resetDb();
    const touching = await setup(SAMPLE_FILE, '--test');
    expect(touching.code).toBe(0);
    expect(await db().zone.count({ where: { isActive: true } })).toBe(3);
    // … and so do zones that meet at one corner only.
    await resetDb();
    const corner = sampleJson();
    corner.zones[2].shape = box(74.3, 31.55, 74.35, 31.6);
    const cornerRun = await setup(writeSetupFile(dir, 'east-corner.json', corner), '--test');
    expect(cornerRun.code).toBe(0);
  });

  it('SET-005 setup creates both shops, their stores, prices and the company account through the normal rules', async () => {
    // Step 1.
    const run = await setup(SAMPLE_FILE, '--test');
    expect(run.code).toBe(0);
    const people = await setupPeople();

    // Step 2: the shops and their one store each.
    const shops = await api().get(`${API}/distributors`).set(authHeader(people.SA1)).expect(200);
    const byCode = new Map((shops.body as Array<{ code: string }>).map((shop) => [shop.code, shop]));
    expect(byCode.get('AG')).toMatchObject({
      code: 'AG',
      businessName: 'Ahmed Gas',
      status: DistributorStatus.ACTIVE,
      contact: { name: 'Ahmed Gas', phone: PHONES.DA },
      store: { name: 'Ahmed Gas Store', zone: { name: 'North' } },
      appPasswordSet: true,
      wallet: { balancePaisa: '500000' },
    });
    expect(byCode.get('BG')).toMatchObject({
      code: 'BG',
      businessName: 'Bilal Gas',
      status: DistributorStatus.ACTIVE,
      store: { name: "Bilal Gas's store", zone: { name: 'South' } },
      wallet: { balancePaisa: '0' },
    });

    // Step 2: the prices (in paisa: 25000 with 3000, 4000, 8000, 15000; 40000 flat; 30000 flat).
    const sizes = (row: { price: { sizes: Array<{ cylinderTypeId: string; perCylinderPaisa: string }> } | null }) =>
      Object.fromEntries((row.price?.sizes ?? []).map((size) => [size.cylinderTypeId, size.perCylinderPaisa]));
    const grid = async (distributorId: string) => (await api().get(`${API}/pricing/prices/${distributorId}`).set(authHeader(people.SA1)).expect(200)).body;
    const ag = await grid(people.DA.distributorId);
    const agZone = (name: string) => ag.zones.find((row: { zone: { name: string } }) => row.zone.name === name);
    expect(agZone('North').price.basePaisa).toBe('25000');
    expect(sizes(agZone('North'))).toEqual({
      [people.sizes.kg6]: '3000',
      [people.sizes.kg11_8]: '4000',
      [people.sizes.kg15]: '8000',
      [people.sizes.kg45_4]: '15000',
    });
    expect(agZone('South').price.basePaisa).toBe('40000');
    expect(Object.values(sizes(agZone('South')))).toEqual(['0', '0', '0', '0']);
    expect(agZone('East').price).toBeNull();
    expect(ag.coverage).toEqual({ priced: 2, total: 3 });
    const bg = await grid(people.DB.distributorId);
    const bgSouth = bg.zones.find((row: { zone: { name: string } }) => row.zone.name === 'South');
    expect(bgSouth.price.basePaisa).toBe('30000');
    expect(Object.values(sizes(bgSouth))).toEqual(['0', '0', '0', '0']);
    expect(bg.coverage).toEqual({ priced: 1, total: 3 });

    // Step 3: the company account.
    const info = await api().get(`${API}/payments/topup-info`).set(authHeader(people.DA)).expect(200);
    expect(info.body.account).toMatchObject({ accountTitle: 'Smart Fleet (Pvt) Ltd', iban: 'PK00TEST0000000000000000' });

    // Step 5: one distributor.create per shop, one price.set per price.
    const audit = async (action: string) =>
      (await api().get(`${API}/audit-logs`).query({ action, limit: 50 }).set(authHeader(people.SA1)).expect(200)).body.items as Array<{ actor: unknown }>;
    const created = await audit('distributor.create');
    expect(created).toHaveLength(2);
    const priced = await audit('price.set');
    expect(priced).toHaveLength(3);
    for (const row of [...created, ...priced]) expect(row.actor).toEqual({ kind: 'SYSTEM', label: 'cli:pilot-setup' });

    // Step 4: three bad copies, each on a fresh database: the row is named, nothing is written.
    const bad: Array<[string, (json: ReturnType<typeof sampleJson>) => void, string]> = [
      [
        'store-outside',
        (json) => Object.assign(json.distributors[0].store, POINTS.outside),
        'Refused at distributors[0] (Ahmed Gas): STORE_OUTSIDE_ZONES: This spot is outside every active zone. Move the pin.',
      ],
      [
        'price-250.50',
        (json) => {
          json.prices[0].basePaisa = '250.50';
        },
        'Refused at prices[0].basePaisa (AG in North): PRICE_INVALID: Enter whole rupees, from Rs 0 to Rs 100,000.',
      ],
      [
        'code-ag',
        (json) => {
          json.distributors[0].code = 'ag';
        },
        'Refused at distributors[0].code (Ahmed Gas): DISTRIBUTOR_CODE_INVALID: Use 2 to 6 capital letters or digits, starting with a letter.',
      ],
    ];
    for (const [name, edit, line] of bad) {
      await resetDb();
      const json = sampleJson();
      edit(json);
      const refused = await setup(writeSetupFile(dir, `${name}.json`, json), '--test');
      expect({ name, code: refused.code, first: refused.lines[0] }).toEqual({ name, code: 1, first: line });
      expect(await counts()).toEqual(nothing);
    }

    // Step 6: opening balances without --test are refused.
    await resetDb();
    const live = await setup(SAMPLE_FILE);
    expect(live.code).toBe(1);
    expect(live.lines[0]).toBe("Refused at openingBalances[0] (AG): VALIDATION_FAILED: Some details need fixing.");
    expect(live.text).toContain("NOT_ALLOWED: This can't be sent here.");
    expect(live.text).toContain('Opening balances are for a test server: run with --test.');
    expect(await counts()).toEqual(nothing);
  });

  it('SET-006 setup creates drivers with vans and the test customers', async () => {
    const run = await setup(SAMPLE_FILE, '--test');
    expect(run.code).toBe(0);
    const passwords = printedPasswords(run);
    const people = await setupPeople();

    // Step 1: the drivers with their vans; no secret in either list.
    const drivers = await api().get(`${API}/drivers`).set(authHeader(people.SA1)).expect(200);
    const driverNamed = (name: string) => (drivers.body as Array<{ user: { name: string } }>).find((driver) => driver.user.name === name);
    expect(driverNamed('Kashif')).toMatchObject({ user: { status: UserStatus.ACTIVE, phone: PHONES.DR1 }, currentVehicle: { plateNo: 'LEA-101' } });
    expect(driverNamed('Imran')).toMatchObject({ user: { status: UserStatus.ACTIVE, phone: PHONES.DR2 }, currentVehicle: { plateNo: 'LEB-202' } });
    expect(secretsIn(drivers.body)).toEqual([]);
    const vans = await api().get(`${API}/vehicles`).set(authHeader(people.SA1)).expect(200);
    const plates = Object.fromEntries((vans.body as Array<{ plateNo: string; currentDriver: { user: { name: string } } | null; homeZone: { name: string } }>).map((van) => [van.plateNo, van]));
    expect(plates['LEA-101']).toMatchObject({ currentDriver: { user: { name: 'Kashif' } }, homeZone: { name: 'North' }, capacityUnits: 40 });
    expect(plates['LEB-202']).toMatchObject({ currentDriver: { user: { name: 'Imran' } }, homeZone: { name: 'South' } });
    expect(secretsIn(vans.body)).toEqual([]);

    // Step 2: Kashif signs in to the driver app.
    const kashif = passwords.get('Kashif');
    expect(kashif).toBeDefined();
    const signedIn = await login(app, PHONES.DR1, kashif?.password as string, 'driver').expect(200);
    expect(signedIn.body.role).toBe(UserRole.DRIVER);

    // Step 3: X1 for Sana, assigned to Kashif: the trip starts at Ahmed Gas Store.
    const x1 = await api().post(`${API}/orders`).set(authHeader(people.DA)).set('Idempotency-Key', randomUUID()).send(x1Body(people)).expect(201);
    const assigned = await api().post(`${API}/orders/${x1.body.id}/assign-driver`).set(authHeader(people.SA1)).send({ driverId: people.DR1.driverId }).expect(200);
    expect(assigned.body).toMatchObject({ driverId: people.DR1.driverId, originStoreId: people.DA.homeStoreId });

    // Step 4: each shop sees its own customers, with the zone and price status of their pins.
    const clientsOf = async (caller: typeof people.DA) => (await api().get(`${API}/clients`).set(authHeader(caller)).expect(200)).body as Array<{
      name: string;
      phone: string;
      addresses: Array<{ zone: { name: string } | null; priceStatus: string }>;
    }>;
    const agClients = await clientsOf(people.DA);
    expect(agClients.map((client) => client.name).sort()).toEqual(['Sana', 'Usman']);
    const sana = agClients.find((client) => client.name === 'Sana');
    expect(sana).toMatchObject({ phone: PHONES.C1, addresses: [{ zone: { name: 'North' }, priceStatus: 'SET' }] });
    expect(agClients.find((client) => client.name === 'Usman')).toMatchObject({ phone: PHONES.C2, addresses: [{ zone: { name: 'South' }, priceStatus: 'SET' }] });
    const bgClients = await clientsOf(people.DB);
    expect(bgClients).toHaveLength(1);
    expect(bgClients[0]).toMatchObject({ name: 'Hina', phone: PHONES.C3, addresses: [{ zone: { name: 'South' }, priceStatus: 'SET' }] });
  });

  it('SET-007 setup registers the labelled stock, writes the labels file and prints passwords once', async () => {
    // Everything the process writes or logs while the case runs: the CLI, the API and its request log.
    const written: string[] = [];
    const text = (parts: unknown[]) => parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ');
    const logs: LoggerService = {
      log: (...parts: unknown[]) => written.push(text(parts)),
      error: (...parts: unknown[]) => written.push(text(parts)),
      warn: (...parts: unknown[]) => written.push(text(parts)),
      debug: (...parts: unknown[]) => written.push(text(parts)),
      verbose: (...parts: unknown[]) => written.push(text(parts)),
      fatal: (...parts: unknown[]) => written.push(text(parts)),
      // Nest sets the levels on the logger in use when a context starts with a level list (the CLI's own).
      setLogLevels: () => undefined,
    };
    const capture = (chunk: unknown) => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      return true;
    };
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(capture);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(capture);
    const labelsFile = path.join(dir, 'set-007-labels.csv');
    let run: CliRun;
    try {
      app.useLogger(logs);
      run = await runSetup(['--file', SAMPLE_FILE, '--test', '--labels', labelsFile]);
      forgetSettings(app);
      // The API logs every request (method, route, status): sign in with each password while it logs.
      app.useLogger(logs);
      for (const [, entry] of printedPasswords(run)) {
        const variant = entry.role === 'SUPER_ADMIN' ? 'admin-web' : entry.role === 'DRIVER' ? 'driver' : 'distributor';
        await login(app, entry.phone.replace(/ /g, ''), entry.password, variant).expect(200);
      }
    } finally {
      app.useLogger(new ConsoleLogger('', { logLevels: ['error', 'warn'] }));
      stdout.mockRestore();
      stderr.mockRestore();
    }
    expect({ code: run.code, text: run.text }).toEqual({ code: 0, text: expect.stringContaining('done, in one transaction') });

    // Step 1: one password per new login, each printed once, 12 characters.
    const passwords = printedPasswords(run);
    expect([...passwords.keys()]).toEqual(['Owner', 'Ops', 'Ahmed Gas', 'Bilal Gas', 'Kashif', 'Imran']);
    expect([...passwords.values()].map((entry) => entry.role)).toEqual(['SUPER_ADMIN', 'SUPER_ADMIN', 'DISTRIBUTOR', 'DISTRIBUTOR', 'DRIVER', 'DRIVER']);
    for (const { password } of passwords.values()) {
      expect(password).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{12}$/);
      expect(run.lines.filter((line) => line.includes(password))).toHaveLength(1);
    }
    expect(new Set([...passwords.values()].map((entry) => entry.password)).size).toBe(6);
    // The labels CSV: 35 rows with their QR values.
    const csv = readFileSync(labelsFile, 'utf8').trimEnd().split('\r\n');
    expect(csv[0]).toBe('Cylinder number,QR value,Size,State,Shop code,Shop');
    const rows = csv.slice(1).map((line) => line.split(','));
    expect(rows).toHaveLength(35);
    const expectedSize = (n: number) => (n <= 20 ? '11.8 kg' : n <= 30 ? '15 kg' : '45.4 kg');
    rows.forEach((row, index) => {
      const n = index + 1;
      expect(row).toEqual([`AG-C${String(n).padStart(4, '0')}`, expect.any(String), expectedSize(n), 'Full', 'AG', 'Ahmed Gas']);
    });
    const people = await setupPeople();
    const stored = await db().cylinder.findMany({ select: { shortNo: true, qrCode: true }, orderBy: { shortNo: 'asc' } });
    expect(rows.map((row) => row[1])).toEqual(stored.map((cylinder) => cylinder.qrCode));
    expect(run.text).toContain(`Labels: 35 cylinders written to ${labelsFile}.`);

    // Step 2: 35 full cylinders in Ahmed Gas Store, each with one REGISTERED move.
    const stock = await api().get(`${API}/store/stock`).set(authHeader(people.DA)).expect(200);
    expect(stock.body.total).toBe(35);
    const bySize = Object.fromEntries((stock.body.sizes as Array<{ sizeLabel: string; total: number; byState: Record<string, number> }>).map((size) => [size.sizeLabel, size]));
    expect(bySize['11.8 kg']).toMatchObject({ total: 20, byState: { FULL: 20 } });
    expect(bySize['15 kg']).toMatchObject({ total: 10, byState: { FULL: 10 } });
    expect(bySize['45.4 kg']).toMatchObject({ total: 5, byState: { FULL: 5 } });
    const list = await api().get(`${API}/cylinders`).set(authHeader(people.SA1)).expect(200);
    expect(list.body).toHaveLength(35);
    const history = await api().get(`${API}/cylinders/AG-C0001/history`).set(authHeader(people.SA1)).expect(200);
    expect(history.body.cylinder).toMatchObject({ shortCode: 'AG-C0001', state: CylinderState.FULL, size: { label: '11.8 kg' } });
    expect(history.body.holder).toMatchObject({ type: CustodyType.STORE, label: 'Ahmed Gas Store' });
    expect(history.body.events).toHaveLength(1);
    expect(history.body.events[0]).toMatchObject({ action: CylinderEventType.REGISTERED, source: 'REGISTRATION' });
    const everyCylinder = await db().cylinder.findMany({ select: { custodyType: true, custodyId: true, state: true, lastEventId: true, events: { select: { id: true, eventType: true } } } });
    for (const cylinder of everyCylinder) {
      expect(cylinder).toMatchObject({ custodyType: CustodyType.STORE, custodyId: people.DA.homeStoreId, state: CylinderState.FULL });
      expect(cylinder.events.map((event) => event.eventType)).toEqual([CylinderEventType.REGISTERED]);
      expect(cylinder.lastEventId).toBe(cylinder.events[0].id);
    }

    // Step 3: the next label number is 36, and one pilot.setup row says SYSTEM.
    const shop = await db().distributor.findUniqueOrThrow({ where: { code: 'AG' }, select: { nextCylinderNo: true } });
    expect(shop.nextCylinderNo).toBe(36);
    const audit = await api().get(`${API}/audit-logs`).query({ action: 'pilot.setup' }).set(authHeader(people.SA1)).expect(200);
    expect(audit.body.items).toHaveLength(1);
    expect(audit.body.items[0].actor).toEqual({ kind: 'SYSTEM', label: 'cli:pilot-setup' });

    // Step 4: no password anywhere else: not in the logs, the labels file, the audit log or the users table.
    const everythingWritten = written.join('');
    expect(everythingWritten).toContain('POST /api/v1/auth/login 200');
    const auditText = JSON.stringify(await db().auditLog.findMany());
    const usersText = JSON.stringify(await db().user.findMany());
    for (const { password } of passwords.values()) {
      expect(everythingWritten).not.toContain(password);
      expect(csv.join('\n')).not.toContain(password);
      expect(auditText).not.toContain(password);
      expect(usersText).not.toContain(password);
    }
  });

  it('SET-008 a dry run writes nothing, and a second run makes no duplicates', async () => {
    const empty = await tableCounts();

    // Step 1: the plan, exit 0.
    const dry = await setup(SAMPLE_FILE, '--dry-run', '--test');
    expect(dry.code).toBe(0);
    expect(dry.lines[0]).toBe(`Dry run of ${relativeSampleDir()}pilot-setup.sample.json (--test): every check passed and nothing was written. A run would:`);
    expect(dry.text).toContain('shops            2 to create (AG, BG)');
    expect(dry.text).toContain('cylinders        35 to register (AG-C0001–AG-C0035)');
    expect(dry.text).not.toContain('New logins');
    // Step 2: no rows at all, no pilot.setup row, and no labels file.
    expect(await tableCounts()).toEqual(empty);
    expect(await db().auditLog.count({ where: { action: 'pilot.setup' } })).toBe(0);

    // Step 3.
    const first = await setup(SAMPLE_FILE, '--test');
    expect(first.code).toBe(0);
    const passwords = printedPasswords(first);
    expect(passwords.size).toBe(6);
    const afterFirst = await tableCounts();
    expect({
      distributors: afterFirst.distributors,
      stores: afterFirst.stores,
      prices: afterFirst.distributor_zone_prices,
      drivers: afterFirst.drivers,
      vans: afterFirst.vehicles,
      cylinders: afterFirst.cylinders,
      customers: afterFirst.clients,
    }).toEqual({ distributors: 2, stores: 2, prices: 3, drivers: 2, vans: 2, cylinders: 35, customers: 3 });

    // Step 4: the same file again: the same counts (only one more pilot.setup row), no new password.
    const second = await setup(SAMPLE_FILE, '--test');
    expect(second.code).toBe(0);
    expect(printedPasswords(second).size).toBe(0);
    expect(second.text).toContain('No new logins: no passwords were made (a re-run never resets one).');
    expect(second.text).toContain('Labels: no new cylinders, so no labels file.');
    expect(second.text).not.toMatch(/created|changed \(/);
    expect(await tableCounts()).toEqual({ ...afterFirst, audit_logs: afterFirst.audit_logs + 1 });
    expect(await db().auditLog.count({ where: { action: 'pilot.setup' } })).toBe(2);
    expect((await db().ledgerEntry.findMany({ where: { reasonCode: 'OPENING_BALANCE' } })).map((row) => row.amountPaisa)).toEqual([500000n]);

    // Step 5: the first run's password still signs Ahmed Gas in.
    const da = passwords.get('Ahmed Gas');
    await login(app, PHONES.DA, da?.password as string, 'distributor').expect(200);
  });

  it('SET-008 a re-run follows an edited file through the services and keeps what it may not change', async () => {
    expect((await setup(SAMPLE_FILE, '--test')).code).toBe(0);
    const json = sampleJson();
    json.zones[0].shape = box(74.2, 31.49, 74.25, 31.55); // North reaches further south.
    json.prices[0].basePaisa = 26000; // AG in North: Rs 260.
    json.stock[0].count = 22; // two more 11.8 kg: AG-C0036 and AG-C0037.
    json.stock.push({ distributor: 'BG', cylinderType: 'STD_11_8KG', count: 3, state: 'EMPTY' });
    json.customers.push({ distributor: 'BG', name: 'Asad', phone: '0300 5550001', address: { label: 'Shop', lat: 31.53, lng: 74.28 } });
    json.customers[0].name = 'Sana Bibi'; // the shop owns its customers: not changed.
    json.openingBalances[0].amountPaisa = 900000; // a re-run never changes a balance.
    json.settings['support.phone'] = '0300 1112223';
    const run = await setup(writeSetupFile(dir, 'edited.json', json), '--test');
    expect(run.code).toBe(0);
    expect(run.text).toContain('zones            1 changed (North); 2 already as in the file');
    expect(run.text).toContain('prices           1 changed (AG in North); 2 already as in the file');
    expect(run.text).toContain('cylinders        5 registered (AG-C0036–AG-C0037, BG-C0001–BG-C0003)');
    expect(run.text).toContain('customers        1 created (Asad (BG)); 3 already as in the file');
    expect(run.text).toContain('settings         1 changed (support.phone); 1 already as in the file');
    expect(run.text).toContain('a re-run never changes a balance');
    expect(printedPasswords(run).size).toBe(0);

    const zoneUpdates = await db().auditLog.count({ where: { action: 'zone.update' } });
    expect(zoneUpdates).toBe(1);
    expect(await db().auditLog.count({ where: { action: 'price.set' } })).toBe(4);
    const north = await db().distributorZonePrice.findFirstOrThrow({ where: { distributor: { code: 'AG' }, zone: { name: 'North' } } });
    expect(north.basePaisa).toBe(26000n);
    expect(await db().client.findFirst({ where: { phone: PHONES.C1 }, select: { name: true } })).toEqual({ name: 'Sana' });
    expect((await db().distributor.findUniqueOrThrow({ where: { code: 'AG' } })).advanceBalancePaisa).toBe(500000n);
    const bgCylinders = await db().cylinder.findMany({ where: { distributor: { code: 'BG' } }, select: { shortNo: true, state: true } });
    expect(bgCylinders.map((cylinder) => cylinder.state)).toEqual([CylinderState.EMPTY, CylinderState.EMPTY, CylinderState.EMPTY]);
    const labelsCsv = run.lines.find((line) => line.startsWith('Labels: 5 cylinders written to '));
    expect(labelsCsv).toBeDefined();

    // Stock is never removed: a smaller count leaves the cylinders.
    const fewer = sampleJson();
    fewer.stock[0].count = 5;
    const smaller = await setup(writeSetupFile(dir, 'fewer.json', fewer), '--test');
    expect(smaller.code).toBe(0);
    expect(smaller.text).toContain('stock is never removed');
    expect(await db().cylinder.count({ where: { distributor: { code: 'AG' } } })).toBe(37);
  });

  it('SET-008 a run with --test touches only test rows, and a run without it only live rows', async () => {
    // A live shop AG already exists: the --test run refuses to touch it, and writes nothing.
    const lahore = await db().city.create({ data: { name: 'Lahore' } });
    const north = await createZone({ city: lahore, name: 'North', bbox: [74.2, 31.5, 74.25, 31.55] });
    await createDistributor({ code: 'AG', businessName: 'Ahmed Gas', phone: PHONES.DA, zone: north });
    const before = await tableCounts();
    const refused = await setup(SAMPLE_FILE, '--test');
    expect(refused.code).toBe(1);
    expect(refused.lines[0]).toBe('Refused at distributors[0] (Ahmed Gas): VALIDATION_FAILED: Some details need fixing.');
    expect(refused.text).toContain('is a live row: a --test run may only change test rows.');
    expect(await tableCounts()).toEqual(before);

    // Test rows: a plain run of the same data (without opening balances) refuses them.
    await resetDb();
    expect((await setup(SAMPLE_FILE, '--test')).code).toBe(0);
    const live = sampleJson();
    live.openingBalances = [];
    const afterTest = await tableCounts();
    const plain = await setup(writeSetupFile(dir, 'live.json', live));
    expect(plain.code).toBe(1);
    expect(plain.lines[0]).toBe('Refused at distributors[0] (Ahmed Gas): VALIDATION_FAILED: Some details need fixing.');
    expect(plain.text).toContain('is a test row (made with --test)');
    expect(await tableCounts()).toEqual(afterTest);

    // The rows --test marks: shops, their logins, the drivers' logins and the vans; never office logins.
    expect(await db().distributor.count({ where: { isTest: false } })).toBe(0);
    expect(await db().vehicle.count({ where: { isTest: false } })).toBe(0);
    const users = await db().user.findMany({ select: { role: true, isTest: true } });
    for (const user of users) expect({ role: user.role, isTest: user.isTest }).toEqual({ role: user.role, isTest: user.role !== UserRole.SUPER_ADMIN });
  });

  it('SET-008 --test is refused on the live server, and the file and flags are checked first', async () => {
    const production = { ...process.env, NODE_ENV: 'production', APP_ENV: '' };
    const onLive = await runSetup(['--file', SAMPLE_FILE, '--test', '--dry-run'], { env: production });
    expect(onLive.code).toBe(1);
    expect(onLive.text).toContain("--test can't run on the live server");
    // Staging runs with NODE_ENV=production and APP_ENV=staging: a test server.
    const staging = await runSetup(['--file', SAMPLE_FILE, '--test', '--dry-run'], { env: { ...process.env, NODE_ENV: 'production', APP_ENV: 'staging' } });
    expect(staging.code).toBe(0);
    // Bad arguments: exit 2 with the usage; a missing or broken file: exit 1.
    expect((await runSetup([])).code).toBe(2);
    expect((await runSetup(['--file', SAMPLE_FILE, '--force'])).code).toBe(2);
    const missing = await runSetup(['--file', 'pilot/nope.json', '--dry-run']);
    expect(missing.code).toBe(1);
    expect(missing.text).toContain("can't find pilot/nope.json");
    const brokenJson = path.join(dir, 'broken.json');
    writeFileSync(brokenJson, '{ "city": ');
    const broken = await runSetup(['--file', brokenJson, '--dry-run']);
    expect(broken.code).toBe(1);
    expect(broken.text).toContain("isn't valid JSON");
    // An unknown key is refused (a typo is never dropped).
    const typo = sampleJson();
    typo.zones[1].actve = true;
    const strict = await runSetup(['--file', writeSetupFile(dir, 'typo.json', typo), '--test', '--dry-run']);
    expect(strict.code).toBe(1);
    expect(strict.lines[0]).toBe('Refused at zones[1] (South): VALIDATION_FAILED: Some details need fixing.');
    expect(strict.text).toContain('Unknown key "actve"');
    expect(await counts()).toEqual(nothing);
  });

  it('SET-008 the npm entry points (scripts/pilot-setup.ts and scripts/pilot-reset.ts) run the same CLIs and set the exit code', () => {
    // `npm run pilot:setup` / `pilot:reset` run these with ts-node, in a process of their own.
    const tsNode = require.resolve('ts-node/dist/bin.js');
    const run = (script: string, args: string[]) =>
      spawnSync(process.execPath, [tsNode, script, ...args], { cwd: API_DIR, env: process.env, encoding: 'utf8', timeout: 200_000 });
    // One run each (every other exit code is covered in this process above): ts-node compiles the API each time.
    const dry = run('scripts/pilot-setup.ts', ['--file', SAMPLE_FILE, '--test', '--dry-run']);
    expect({ status: dry.status, out: dry.stdout }).toEqual({ status: 0, out: expect.stringContaining('every check passed and nothing was written') });
    const unconfirmed = run('scripts/pilot-reset.ts', []);
    expect({ status: unconfirmed.status, out: unconfirmed.stdout }).toEqual({ status: 1, out: expect.stringContaining('Nothing deleted. Run again with --yes to delete.') });
  }, 600_000);
});

/** The sample's folder as the dry run prints it: relative to the current directory, with forward slashes. */
function relativeSampleDir(): string {
  const relative = path.relative(process.cwd(), path.dirname(SAMPLE_FILE)).split(path.sep).join('/');
  return relative ? `${relative}/` : '';
}
