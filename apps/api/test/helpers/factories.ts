/**
 * Test data factories. Rows with geometry columns (zones, stores, client addresses) are written
 * with raw SQL, as the services write them (DATA_MODEL §6); the rest use Prisma.
 *
 * Every factory takes optional overrides, creates what it depends on when not given, and returns
 * the ids a test needs. Factories for people return an `actor` for the token helpers:
 *
 *   const shop = await createDistributor({ balancePaisa: 500_000n });
 *   const driver = await createDriver({ zone: shop.zone });
 *   const customer = await createClient({ distributor: shop });
 *   await request(app.getHttpServer()).post('/api/v1/orders').set(authHeader(shop.actor)) ...
 *
 * Wallets stay consistent: a distributor created with a balance also gets the matching opening
 * ledger row (ADJUSTMENT, OPENING_BALANCE), so the nightly check's invariant holds.
 */
import * as crypto from 'crypto';
import {
  CustodyType,
  CylinderState,
  DistributorStatus,
  LedgerEntryType,
  Prisma,
  PrismaClient,
  UserRole,
  UserStatus,
  VehicleStatus,
} from '@prisma/client';
import { TestActor } from './auth';
import { getTestPrisma } from './db';

type Db = PrismaClient | Prisma.TransactionClient;
export interface LatLng {
  lat: number;
  lng: number;
}

// Unique values within a run: a random base per test file plus a counter.
const BASE = crypto.randomInt(0, 1_000_000);
let counter = 0;
function next(): number {
  counter += 1;
  return BASE + counter;
}

/** A Pakistani mobile number in E.164 (+923XXXXXXXXX), unique within the run. */
export function uniquePhone(): string {
  return `+923${String(next() % 1_000_000_000).padStart(9, '0')}`;
}

/** A distributor code matching ^[A-Z][A-Z0-9]{1,5}$, unique within the run. */
export function uniqueDistributorCode(): string {
  return `T${next().toString(36).toUpperCase().padStart(5, '0').slice(-5)}`;
}

// ---------- people ----------

export interface TestUser {
  id: string;
  phone: string;
  role: UserRole;
  actor: TestActor;
}

export async function createUser(
  opts: { role?: UserRole; status?: UserStatus; phone?: string; name?: string; passwordHash?: string | null } = {},
  db: Db = getTestPrisma(),
): Promise<TestUser> {
  const role = opts.role ?? UserRole.SUPER_ADMIN;
  const user = await db.user.create({
    data: {
      phone: opts.phone ?? uniquePhone(),
      name: opts.name ?? `Test ${role.toLowerCase()}`,
      role,
      status: opts.status ?? UserStatus.ACTIVE,
      passwordHash: opts.passwordHash ?? null,
    },
  });
  return { id: user.id, phone: user.phone, role, actor: { userId: user.id, role, tokenVersion: user.tokenVersion } };
}

/** A super admin ("the office"). */
export function createSuperAdmin(opts: { phone?: string; name?: string } = {}, db: Db = getTestPrisma()) {
  return createUser({ ...opts, role: UserRole.SUPER_ADMIN }, db);
}

// ---------- geography ----------

export interface TestCity {
  id: string;
  name: string;
}

export async function createCity(opts: { name?: string } = {}, db: Db = getTestPrisma()): Promise<TestCity> {
  const city = await db.city.create({ data: { name: opts.name ?? `Test City ${next()}` } });
  return { id: city.id, name: city.name };
}

export interface TestZone {
  id: string;
  cityId: string;
  name: string;
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  /** A point inside the zone (its centre). */
  center: LatLng;
}

/**
 * A rectangular zone. Without `bbox`, each call gets its own 0.05° square on a grid inside
 * Pakistan, so zones from one test never overlap unless asked to.
 */
export async function createZone(
  opts: { city?: { id: string }; name?: string; bbox?: [number, number, number, number]; isActive?: boolean } = {},
  db: Db = getTestPrisma(),
): Promise<TestZone> {
  const city = opts.city ?? (await createCity({}, db));
  const n = next();
  const bbox: [number, number, number, number] = opts.bbox ?? (() => {
    const lng = 61 + (n % 250) * 0.06;
    const lat = 24 + (Math.floor(n / 250) % 200) * 0.06;
    return [round6(lng), round6(lat), round6(lng + 0.05), round6(lat + 0.05)];
  })();
  const [x1, y1, x2, y2] = bbox;
  const geojson = JSON.stringify({ type: 'MultiPolygon', coordinates: [[[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]]] });
  const name = opts.name ?? `Test Zone ${n}`;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), ${city.id}::uuid, ${name},
            ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
            ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)),
            ${opts.isActive ?? true}, now(), now())
    RETURNING id`;
  return { id: rows[0].id, cityId: city.id, name, bbox, center: { lat: round6((y1 + y2) / 2), lng: round6((x1 + x2) / 2) } };
}

export interface TestStore {
  id: string;
  zoneId: string;
  name: string;
  location: LatLng;
}

/** A store; by default at the centre of a new zone. */
export async function createStore(
  opts: { zone?: TestZone; name?: string; address?: string; location?: LatLng; isActive?: boolean } = {},
  db: Db = getTestPrisma(),
): Promise<TestStore> {
  const zone = opts.zone ?? (await createZone({}, db));
  const location = opts.location ?? zone.center;
  const name = opts.name ?? `Test Store ${next()}`;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), ${name}, ${zone.id}::uuid, ${opts.address ?? 'Test address'},
            ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326), ${opts.isActive ?? true}, now(), now())
    RETURNING id`;
  return { id: rows[0].id, zoneId: zone.id, name, location };
}

// ---------- distributors (shop-keepers) ----------

export interface TestDistributor {
  id: string;
  userId: string;
  code: string;
  businessName: string;
  homeStoreId: string;
  store: TestStore;
  /** The zone the store is in. */
  zone: TestZone;
  actor: TestActor & { distributorId: string };
}

/**
 * A distributor with its user (DISTRIBUTOR, ACTIVE), its one store and its code. With
 * `balancePaisa`, the wallet starts with that balance and the matching opening ledger row.
 */
export async function createDistributor(
  opts: {
    code?: string;
    businessName?: string;
    status?: DistributorStatus;
    balancePaisa?: bigint;
    phone?: string;
    zone?: TestZone;
    store?: TestStore;
  } = {},
  db: Db = getTestPrisma(),
): Promise<TestDistributor> {
  const zone = opts.zone ?? (opts.store ? await zoneOf(opts.store, db) : await createZone({}, db));
  const store = opts.store ?? (await createStore({ zone }, db));
  const user = await createUser({ role: UserRole.DISTRIBUTOR, phone: opts.phone, name: 'Test shop-keeper' }, db);
  const balance = opts.balancePaisa ?? 0n;
  const distributor = await db.distributor.create({
    data: {
      userId: user.id,
      businessName: opts.businessName ?? `Test Shop ${next()}`,
      code: opts.code ?? uniqueDistributorCode(),
      homeStoreId: store.id,
      status: opts.status ?? DistributorStatus.ACTIVE,
      advanceBalancePaisa: balance,
    },
  });
  if (balance !== 0n) {
    await db.ledgerEntry.create({
      data: {
        distributorId: distributor.id,
        entryType: LedgerEntryType.ADJUSTMENT,
        amountPaisa: balance,
        balanceAfterPaisa: balance,
        idempotencyKey: `opening:${distributor.id}`,
        reasonCode: 'OPENING_BALANCE',
        note: 'Test opening balance',
      },
    });
  }
  return {
    id: distributor.id,
    userId: user.id,
    code: distributor.code as string,
    businessName: distributor.businessName,
    homeStoreId: store.id,
    store,
    zone,
    actor: { ...user.actor, distributorId: distributor.id },
  };
}

// ---------- drivers and vans ----------

export interface TestDriver {
  id: string;
  userId: string;
  vehicleId: string | null;
  actor: TestActor & { driverId: string };
}

/** A driver with its user (DRIVER, ACTIVE) and, unless `withVehicle: false`, its van. */
export async function createDriver(
  opts: { zone?: TestZone; withVehicle?: boolean; phone?: string; vehicleStatus?: VehicleStatus; userStatus?: UserStatus } = {},
  db: Db = getTestPrisma(),
): Promise<TestDriver> {
  const n = next();
  const user = await createUser({ role: UserRole.DRIVER, phone: opts.phone, status: opts.userStatus, name: 'Test driver' }, db);
  let vehicleId: string | null = null;
  if (opts.withVehicle ?? true) {
    const zone = opts.zone ?? (await createZone({}, db));
    const vehicle = await db.vehicle.create({
      data: { plateNo: `TST-${n}`, capacityUnits: 40, homeZoneId: zone.id, status: opts.vehicleStatus ?? VehicleStatus.ACTIVE },
    });
    vehicleId = vehicle.id;
  }
  const driver = await db.driver.create({
    data: { userId: user.id, licenceNo: `DL-TEST-${n}`, currentVehicleId: vehicleId },
  });
  return { id: driver.id, userId: user.id, vehicleId, actor: { ...user.actor, driverId: driver.id } };
}

// ---------- customers ----------

export interface TestClient {
  id: string;
  distributorId: string;
  phone: string;
  addressId: string | null;
  /** The zone stored on the address (the one zone rule: active, ST_Covers, smallest, oldest). */
  zoneId: string | null;
  location: LatLng | null;
}

/**
 * A customer of `distributor` with one address. The pin defaults to the distributor's store, so it
 * lies in the store's zone; `address: false` creates no address.
 */
export async function createClient(
  opts: {
    distributor: { id: string; store?: TestStore };
    name?: string;
    phone?: string;
    address?: { location?: LatLng; label?: string } | false;
  },
  db: Db = getTestPrisma(),
): Promise<TestClient> {
  const phone = opts.phone ?? uniquePhone();
  const client = await db.client.create({
    data: { distributorId: opts.distributor.id, name: opts.name ?? `Test Customer ${next()}`, phone },
  });
  if (opts.address === false) {
    return { id: client.id, distributorId: opts.distributor.id, phone, addressId: null, zoneId: null, location: null };
  }
  const location = opts.address?.location ?? opts.distributor.store?.location ?? (await storeLocationOf(opts.distributor.id, db));
  const rows = await db.$queryRaw<Array<{ id: string; zone_id: string | null }>>`
    INSERT INTO client_addresses (id, client_id, label, location, zone_id)
    VALUES (gen_random_uuid(), ${client.id}::uuid, ${opts.address?.label ?? 'Home'},
            ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326),
            (SELECT z.id FROM zones z
              WHERE z.is_active AND ST_Covers(z.polygon, ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326))
              ORDER BY ST_Area(z.polygon), z.created_at, z.id LIMIT 1))
    RETURNING id, zone_id`;
  return { id: client.id, distributorId: opts.distributor.id, phone, addressId: rows[0].id, zoneId: rows[0].zone_id, location };
}

// ---------- cylinders ----------

export async function createCylinderType(
  opts: { code?: string; name?: string; weightKg?: number; capacityUnits?: number } = {},
  db: Db = getTestPrisma(),
) {
  const n = next();
  return db.cylinderType.create({
    data: {
      code: opts.code ?? `TEST_${n}`,
      name: opts.name ?? `Test ${n} kg`,
      weightKg: opts.weightKg ?? 11.8,
      capacityUnits: opts.capacityUnits ?? 1,
    },
  });
}

/** A cylinder owned by `distributor`; by default FULL and held by the distributor's store. */
export async function createCylinder(
  opts: {
    distributor: { id: string; homeStoreId: string };
    cylinderTypeId?: string;
    state?: CylinderState;
    custody?: { type: CustodyType; id: string };
  },
  db: Db = getTestPrisma(),
) {
  const n = next();
  const cylinderTypeId = opts.cylinderTypeId ?? (await createCylinderType({}, db)).id;
  return db.cylinder.create({
    data: {
      serial: `SN-TEST-${n}`,
      qrCode: `QR-TEST-${n}`,
      distributorId: opts.distributor.id,
      cylinderTypeId,
      state: opts.state ?? CylinderState.FULL,
      custodyType: opts.custody?.type ?? CustodyType.STORE,
      custodyId: opts.custody?.id ?? opts.distributor.homeStoreId,
    },
  });
}

// ---------- delivery prices ----------

/** The distributor's delivery price in a zone: a base per order plus optional per-size amounts. */
export async function createZonePrice(
  opts: {
    distributorId: string;
    zoneId: string;
    basePaisa: bigint;
    sizes?: Array<{ cylinderTypeId: string; perCylinderPaisa: bigint }>;
  },
  db: Db = getTestPrisma(),
) {
  return db.distributorZonePrice.create({
    data: {
      distributorId: opts.distributorId,
      zoneId: opts.zoneId,
      basePaisa: opts.basePaisa,
      sizes: opts.sizes?.length ? { create: opts.sizes } : undefined,
    },
    include: { sizes: true },
  });
}

// ---------- internals ----------

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

async function zoneOf(store: TestStore, db: Db): Promise<TestZone> {
  const rows = await db.$queryRaw<Array<{ id: string; city_id: string; name: string; x1: number; y1: number; x2: number; y2: number }>>`
    SELECT id, city_id, name, ST_XMin(polygon) AS x1, ST_YMin(polygon) AS y1, ST_XMax(polygon) AS x2, ST_YMax(polygon) AS y2
    FROM zones WHERE id = ${store.zoneId}::uuid`;
  const z = rows[0];
  return {
    id: z.id,
    cityId: z.city_id,
    name: z.name,
    bbox: [z.x1, z.y1, z.x2, z.y2],
    center: { lat: round6((z.y1 + z.y2) / 2), lng: round6((z.x1 + z.x2) / 2) },
  };
}

async function storeLocationOf(distributorId: string, db: Db): Promise<LatLng> {
  const rows = await db.$queryRaw<Array<{ lat: number; lng: number }>>`
    SELECT ST_Y(s.location) AS lat, ST_X(s.location) AS lng
    FROM distributors d JOIN stores s ON s.id = d.home_store_id
    WHERE d.id = ${distributorId}::uuid`;
  if (!rows.length) throw new Error(`distributor ${distributorId} has no store; pass address.location`);
  return rows[0];
}
