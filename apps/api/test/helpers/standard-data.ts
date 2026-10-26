/**
 * The standard test data of docs/pilot/TEST_CASES.md ("Standard test data"), built with the factories
 * so every DB suite can name SA1, DA, C1… exactly as the cases do. Same names, phones, codes, zones,
 * prices and balances; the zones are three adjacent boxes in Lahore, and the cylinders are optional.
 *
 *   const std = await createStandardData();
 *   await request(app.getHttpServer()).post('/api/v1/orders').set(authHeader(std.DA.actor)).send(x1Body(std));
 */
import { CustodyType, CylinderState, Prisma, UserRole } from '@prisma/client';
import { TestActor } from './auth';
import { getTestPrisma } from './db';
import {
  createCity,
  createClient,
  createDistributor,
  createDriver,
  createStore,
  createUser,
  createZone,
  createZonePrice,
  type LatLng,
  type TestClient,
  type TestDistributor,
  type TestDriver,
  type TestUser,
  type TestZone,
} from './factories';

/** The dummy company account of the standard data (set by the settings CLI in the cases). */
export const DUMMY_COMPANY_ACCOUNT = {
  accountTitle: 'Smart Fleet (Pvt) Ltd',
  bankName: 'Test Bank',
  iban: 'PK00TEST0000000000000000',
  accountNumber: '0000000000',
} as const;

/** The standard sign-in phones (TEST_CASES.md "People"). Reserved: a case that needs a free number uses another. */
export const STANDARD_PHONES = {
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

export interface StandardSizes {
  kg6: string;
  kg11_8: string;
  kg15: string;
  kg45_4: string;
}

export interface StandardData {
  SA1: TestUser;
  SA2: TestUser;
  DA: TestDistributor;
  DB: TestDistributor;
  DR1: TestDriver;
  DR2: TestDriver;
  zones: { North: TestZone; South: TestZone; East: TestZone };
  /** A point in no zone. */
  outside: LatLng;
  sizes: StandardSizes;
  C1: TestClient;
  C2: TestClient;
  C3: TestClient;
}

/** 6 kg, 11.8 kg, 15 kg and 45.4 kg, created once per database. */
async function standardSizes(db = getTestPrisma()): Promise<StandardSizes> {
  const want = [
    ['kg6', 'STD_6KG', '6 kg', 6],
    ['kg11_8', 'STD_11_8KG', '11.8 kg', 11.8],
    ['kg15', 'STD_15KG', '15 kg', 15],
    ['kg45_4', 'STD_45_4KG', '45.4 kg', 45.4],
  ] as const;
  const out = {} as StandardSizes;
  for (const [key, code, name, weightKg] of want) {
    const row = await db.cylinderType.upsert({
      where: { code },
      update: {},
      create: { code, name, weightKg: new Prisma.Decimal(weightKg), capacityUnits: 1 },
    });
    out[key] = row.id;
  }
  return out;
}

export async function createStandardData(opts: { cylinders?: boolean } = {}): Promise<StandardData> {
  const db = getTestPrisma();
  const lahore = await createCity({ name: 'Lahore' });
  // Three adjacent 0.05° boxes, west to east: North, South, East. "Outside" is east of East.
  const North = await createZone({ city: lahore, name: 'North', bbox: [74.2, 31.5, 74.25, 31.55] });
  const South = await createZone({ city: lahore, name: 'South', bbox: [74.25, 31.5, 74.3, 31.55] });
  const East = await createZone({ city: lahore, name: 'East', bbox: [74.3, 31.5, 74.35, 31.55] });
  const outside = { lat: 31.525, lng: 74.6 };

  const SA1 = await createUser({ role: UserRole.SUPER_ADMIN, phone: STANDARD_PHONES.SA1, name: 'Owner' });
  const SA2 = await createUser({ role: UserRole.SUPER_ADMIN, phone: STANDARD_PHONES.SA2, name: 'Ops' });

  const daStore = await createStore({ zone: North, name: 'Ahmed Gas Store', location: { lat: 31.52, lng: 74.22 } });
  const DA = await createDistributor({
    code: 'AG',
    businessName: 'Ahmed Gas',
    phone: STANDARD_PHONES.DA,
    store: daStore,
    zone: North,
    balancePaisa: 500_000n,
  });
  const dbStore = await createStore({ zone: South, name: "Bilal Gas's store", location: { lat: 31.52, lng: 74.28 } });
  const DB = await createDistributor({ code: 'BG', businessName: 'Bilal Gas', phone: STANDARD_PHONES.DB, store: dbStore, zone: South });
  await db.user.update({ where: { id: DA.userId }, data: { name: 'Ahmed Gas' } });
  await db.user.update({ where: { id: DB.userId }, data: { name: 'Bilal Gas' } });

  const DR1 = await createDriver({ zone: North, phone: STANDARD_PHONES.DR1 });
  const DR2 = await createDriver({ zone: South, phone: STANDARD_PHONES.DR2 });
  await db.user.update({ where: { id: DR1.userId }, data: { name: 'Kashif' } });
  await db.user.update({ where: { id: DR2.userId }, data: { name: 'Imran' } });
  if (DR1.vehicleId) await db.vehicle.update({ where: { id: DR1.vehicleId }, data: { plateNo: 'LEA-101' } });
  if (DR2.vehicleId) await db.vehicle.update({ where: { id: DR2.vehicleId }, data: { plateNo: 'LEB-202' } });

  const sizes = await standardSizes(db);
  const rs = (rupees: number) => BigInt(rupees * 100);
  // One delivery cost per order, whatever cylinders it holds (ADR-08): Ahmed Gas North Rs 250, South Rs 400,
  // East none; Bilal Gas South Rs 300.
  await createZonePrice({ distributorId: DA.id, zoneId: North.id, basePaisa: rs(250) });
  await createZonePrice({ distributorId: DA.id, zoneId: South.id, basePaisa: rs(400) });
  await createZonePrice({ distributorId: DB.id, zoneId: South.id, basePaisa: rs(300) });

  const C1 = await createClient({ distributor: DA, name: 'Sana', phone: STANDARD_PHONES.C1, address: { location: { lat: 31.53, lng: 74.23 }, label: "Sana's house" } });
  const C2 = await createClient({ distributor: DA, name: 'Usman', phone: STANDARD_PHONES.C2, address: { location: { lat: 31.53, lng: 74.27 }, label: "Usman's house" } });
  const C3 = await createClient({ distributor: DB, name: 'Hina', phone: STANDARD_PHONES.C3, address: { location: { lat: 31.51, lng: 74.28 }, label: "Hina's house" } });

  if (opts.cylinders) {
    const plan: [number, number, string][] = [
      [1, 20, sizes.kg11_8],
      [21, 30, sizes.kg15],
      [31, 35, sizes.kg45_4],
    ];
    for (const [from, to, cylinderTypeId] of plan) {
      for (let n = from; n <= to; n++) {
        const code = `AG-C${String(n).padStart(4, '0')}`;
        await db.cylinder.create({
          data: {
            serial: code,
            qrCode: `${code}-QR`,
            distributorId: DA.id,
            cylinderTypeId,
            state: CylinderState.FULL,
            custodyType: CustodyType.STORE,
            custodyId: DA.homeStoreId,
          },
        });
      }
    }
  }

  return { SA1, SA2, DA, DB, DR1, DR2, zones: { North, South, East }, outside, sizes, C1, C2, C3 };
}

/** X1: Ahmed Gas orders 2 × 11.8 kg + 1 × 45.4 kg for Sana in North, Rs 250 (TEST_CASES.md "Worked money examples"). */
export function x1OrderBody(std: StandardData): Record<string, unknown> {
  return {
    clientId: std.C1.id,
    addressId: std.C1.addressId,
    deliveryLabel: "Sana's house",
    lines: [
      { cylinderTypeId: std.sizes.kg11_8, fullCount: 2, expectedReturnCount: 2 },
      { cylinderTypeId: std.sizes.kg45_4, fullCount: 1, expectedReturnCount: 1 },
    ],
  };
}

/** X2: Ahmed Gas orders 3 × 15 kg for Usman in South, flat Rs 400. */
export function x2OrderBody(std: StandardData): Record<string, unknown> {
  return {
    clientId: std.C2.id,
    addressId: std.C2.addressId,
    deliveryLabel: "Usman's house",
    lines: [{ cylinderTypeId: std.sizes.kg15, fullCount: 3, expectedReturnCount: 3 }],
  };
}

/** The `actor` of a standard person, for authHeader(). */
export function actorOf(person: { actor: TestActor }): TestActor {
  return person.actor;
}
