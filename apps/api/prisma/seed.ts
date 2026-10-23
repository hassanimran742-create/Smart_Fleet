import { PrismaClient, UserRole, UserStatus, DistributorStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { deploymentName } from '../src/common/bootstrap/boot-guards';

/** The one line printed when the seed refuses to run on production (DATA_MODEL §2.5, G11-13). */
export const SEED_REFUSED_MESSAGE = 'seed.ts is for development and test servers';

// Refuse production before anything connects or writes: its upserts would re-activate the seeded
// logins suspended at the switch-over. The deployment's name follows the boot-guards rule: APP_ENV
// when set, else NODE_ENV (staging and training servers set APP_ENV).
if (deploymentName(process.env) === 'production') {
  console.error(SEED_REFUSED_MESSAGE);
  process.exit(1);
}

const prisma = new PrismaClient();

// Default password used on first seed for the admin-side accounts.
// Override at seed time with SEED_ADMIN_PASSWORD env var.
// Operators MUST change this from the admin UI after first login.
const DEFAULT_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!Now123';

// Default password for the seeded test driver + distributor. Admin can reset
// these from the Drivers / Distributors screens any time.
const DEFAULT_MOBILE_PASSWORD = process.env.SEED_MOBILE_PASSWORD ?? 'Driver!Now123';

// Fixed ids keep the seed idempotent. ISLAMABAD_CITY_ID is the first entry of `cities` below.
const ISLAMABAD_CITY_ID = '00000000-0000-0000-0000-000000000001';
const SEED_ZONE_ID = '00000000-0000-0000-0000-00000000a001';
const SEED_STORE_ID = '00000000-0000-0000-0000-00000000b001';
// The test distributor's human-number code (orders TST-0001, top-ups TST-T001).
const TEST_DISTRIBUTOR_CODE = 'TST';

async function main() {
  const adminPhone = '+923000000000';
  const passwordHash = await argon2.hash(DEFAULT_ADMIN_PASSWORD);

  const admin = await prisma.user.upsert({
    where: { phone: adminPhone },
    // On re-seed, refresh role/status/name but DO NOT overwrite the password
    // if one already exists — protect any operator-changed password.
    update: {
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      name: 'LPG Super Admin',
    },
    create: {
      phone: adminPhone,
      name: 'LPG Super Admin',
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      passwordHash,
    },
  });
  // Backfill: if a previous seed created the admin without a password, set one.
  if (!admin.passwordHash) {
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash } });
  }

  const branchAdmin = await prisma.user.upsert({
    where: { phone: '+923000000001' },
    update: { role: UserRole.ADMIN, status: UserStatus.ACTIVE, name: 'LPG Branch Admin' },
    create: {
      phone: '+923000000001',
      name: 'LPG Branch Admin',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      passwordHash,
    },
  });
  if (!branchAdmin.passwordHash) {
    await prisma.user.update({ where: { id: branchAdmin.id }, data: { passwordHash } });
  }

  // Cities first: the test distributor's store needs a zone, and a zone needs a city.
  const cities = [
    { id: ISLAMABAD_CITY_ID,                      name: 'Islamabad', countryCode: 'PK' },
    { id: '00000000-0000-0000-0000-000000000002', name: 'Rawalpindi', countryCode: 'PK' },
    { id: '00000000-0000-0000-0000-000000000003', name: 'Lahore',    countryCode: 'PK' },
    { id: '00000000-0000-0000-0000-000000000004', name: 'Karachi',   countryCode: 'PK' },
  ];
  for (const c of cities) {
    await prisma.city.upsert({ where: { id: c.id }, update: {}, create: c });
  }

  // ───── Test mobile users (distributor + driver) for end-to-end testing ─────
  //
  // We seed these so that a fresh deployment can verify mobile login + the
  // assignment flow without manual DB tinkering. Default password matches
  // DEFAULT_MOBILE_PASSWORD; admin can reset either user from the UI.
  // Existing passwords are NEVER overwritten — operator-changed passwords win.
  const mobileHash = await argon2.hash(DEFAULT_MOBILE_PASSWORD);

  const distrUser = await prisma.user.upsert({
    where: { phone: '+923001111111' },
    update: { role: UserRole.DISTRIBUTOR, status: UserStatus.ACTIVE, name: 'Test Distributor' },
    create: {
      phone: '+923001111111',
      name: 'Test Distributor',
      role: UserRole.DISTRIBUTOR,
      status: UserStatus.ACTIVE,
      passwordHash: mobileHash,
    },
  });
  if (!distrUser.passwordHash) {
    await prisma.user.update({ where: { id: distrUser.id }, data: { passwordHash: mobileHash } });
  }
  const testDistributor = await seedTestDistributor(distrUser.id);

  const drvUser = await prisma.user.upsert({
    where: { phone: '+923002222222' },
    update: { role: UserRole.DRIVER, status: UserStatus.ACTIVE, name: 'Test Driver' },
    create: {
      phone: '+923002222222',
      name: 'Test Driver',
      role: UserRole.DRIVER,
      status: UserStatus.ACTIVE,
      passwordHash: mobileHash,
    },
  });
  if (!drvUser.passwordHash) {
    await prisma.user.update({ where: { id: drvUser.id }, data: { passwordHash: mobileHash } });
  }
  await prisma.driver.upsert({
    where: { userId: drvUser.id },
    update: {},
    create: { userId: drvUser.id, licenceNo: 'DL-TEST-001' },
  });

  // Migrate any old underscore-based cylinder codes to the new dotted form.
  // E.g. LPG_11_8KG → LPG_11.8KG. Safe to run multiple times.
  await prisma.cylinderType.updateMany({
    where: { code: 'LPG_11_8KG' },
    data: { code: 'LPG_11.8KG' },
  }).catch(() => undefined);
  await prisma.cylinderType.updateMany({
    where: { code: 'LPG_45_4KG' },
    data: { code: 'LPG_45.4KG' },
  }).catch(() => undefined);

  const types = [
    { code: 'LPG_6KG',     name: 'LPG 6 kg',    weightKg: 6,    capacityUnits: 1 },
    { code: 'LPG_11.8KG',  name: 'LPG 11.8 kg', weightKg: 11.8, capacityUnits: 1 },
    { code: 'LPG_15KG',    name: 'LPG 15 kg',   weightKg: 15,   capacityUnits: 2 },
    { code: 'LPG_45.4KG',  name: 'LPG 45.4 kg', weightKg: 45.4, capacityUnits: 4 },
  ];
  for (const t of types) {
    await prisma.cylinderType.upsert({
      where: { code: t.code },
      update: { name: t.name, weightKg: t.weightKg, capacityUnits: t.capacityUnits },
      create: t,
    });
  }

  const accessories = [
    { code: 'PIPE_HALF_INCH', name: '1/2 inch LPG pipe', category: 'PIPE' as const, unit: 'meter', defaultPricePaisa: 50_000n },
    { code: 'PIPE_QUARTER_INCH', name: '1/4 inch LPG pipe', category: 'PIPE' as const, unit: 'meter', defaultPricePaisa: 35_000n },
    { code: 'CONNECTOR_BRASS_HALF', name: 'Brass 1/2 inch connector', category: 'CONNECTOR' as const, unit: 'piece', defaultPricePaisa: 25_000n },
    { code: 'REGULATOR_LOW', name: 'Low-pressure regulator', category: 'REGULATOR' as const, unit: 'piece', defaultPricePaisa: 95_000n },
    { code: 'REGULATOR_HIGH', name: 'High-pressure regulator', category: 'REGULATOR' as const, unit: 'piece', defaultPricePaisa: 180_000n },
    { code: 'VALVE_SHUTOFF', name: 'Manual shut-off valve', category: 'VALVE' as const, unit: 'piece', defaultPricePaisa: 45_000n },
    { code: 'HOSE_RUBBER_2M', name: 'Rubber gas hose (2m)', category: 'HOSE' as const, unit: 'piece', defaultPricePaisa: 60_000n },
    { code: 'VAPORISER_15KG_AUTO',  name: 'Auto LPG vaporiser (15 kg/hr)',  category: 'VAPORISER' as const, unit: 'piece', defaultPricePaisa: 6_500_000n },
    { code: 'VAPORISER_30KG_AUTO',  name: 'Auto LPG vaporiser (30 kg/hr)',  category: 'VAPORISER' as const, unit: 'piece', defaultPricePaisa: 9_800_000n },
    { code: 'VAPORISER_60KG_DIRECT',name: 'Direct-fired vaporiser (60 kg/hr)', category: 'VAPORISER' as const, unit: 'piece', defaultPricePaisa: 14_500_000n },
  ];
  for (const a of accessories) {
    await prisma.accessory.upsert({
      where: { code: a.code },
      update: {},
      create: a,
    });
  }

  console.log('Seeded admin user:', admin.phone);
  console.log(
    'Seeded test distributor:',
    testDistributor.businessName,
    `(code ${testDistributor.code ?? 'not set'}, store ${testDistributor.homeStoreId ?? 'not set'})`,
  );
  console.log('Seeded cities:', cities.map((c) => c.name).join(', '));
  console.log('Seeded accessories:', accessories.length);
}

/**
 * The test distributor with its one store (ADR-01) and its code (ADR-22).
 *
 * Re-seeding only fills gaps: a code or store already set (by the office, or the D01... codes the
 * inc1a migration gave old rows) is never overwritten, and a code or store owned by another
 * distributor is left alone.
 */
async function seedTestDistributor(userId: string) {
  // Zones and stores have geometry columns, so they are written with raw SQL. The zone is INACTIVE:
  // it exists only because stores.zone_id is required, and zone lookups use active zones only, so it
  // can never change which zone a real customer's pin falls in.
  await prisma.$executeRaw`
    INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at)
    VALUES (
      ${SEED_ZONE_ID}::uuid, ${ISLAMABAD_CITY_ID}::uuid, 'Seed test zone (inactive)',
      ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((73.050 33.715, 73.057 33.715, 73.057 33.720, 73.050 33.720, 73.050 33.715)))'), 4326),
      ST_SetSRID(ST_MakePoint(73.0535, 33.7175), 4326),
      FALSE, NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `;
  await prisma.$executeRaw`
    INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
    VALUES (
      ${SEED_STORE_ID}::uuid, 'Test LPG Shop', ${SEED_ZONE_ID}::uuid, 'F-7 Markaz, Islamabad',
      ST_SetSRID(ST_MakePoint(73.0535, 33.7177), 4326),
      TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  const existing = await prisma.distributor.findUnique({ where: { userId } });
  const [codeOwner, storeOwner] = await Promise.all([
    prisma.distributor.findUnique({ where: { code: TEST_DISTRIBUTOR_CODE }, select: { id: true } }),
    prisma.distributor.findUnique({ where: { homeStoreId: SEED_STORE_ID }, select: { id: true } }),
  ]);
  const code = codeOwner && codeOwner.id !== existing?.id ? null : TEST_DISTRIBUTOR_CODE;
  const homeStoreId = storeOwner && storeOwner.id !== existing?.id ? null : SEED_STORE_ID;

  const distributor = existing
    ? await prisma.distributor.update({
        where: { id: existing.id },
        data: {
          status: DistributorStatus.ACTIVE,
          ...(existing.code === null && code !== null ? { code } : {}),
          ...(existing.homeStoreId === null && homeStoreId !== null ? { homeStoreId } : {}),
        },
      })
    : await prisma.distributor.create({
        data: { userId, businessName: 'Test LPG Shop', status: DistributorStatus.ACTIVE, code, homeStoreId },
      });

  const missing = [
    !distributor.code && `its code (${TEST_DISTRIBUTOR_CODE} belongs to another distributor)`,
    !distributor.homeStoreId && "its store (the seed store is another distributor's home store)",
  ].filter(Boolean);
  if (missing.length) {
    console.warn(`Test distributor is missing ${missing.join(' and ')}. Set it in the office website.`);
  }
  return distributor;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
