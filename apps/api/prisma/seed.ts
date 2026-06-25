import { PrismaClient, UserRole, UserStatus, DistributorStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// Default password used on first seed for the admin-side accounts.
// Override at seed time with SEED_ADMIN_PASSWORD env var.
// Operators MUST change this from the admin UI after first login.
const DEFAULT_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!Now123';

// Default password for the seeded test driver + distributor. Admin can reset
// these from the Drivers / Distributors screens any time.
const DEFAULT_MOBILE_PASSWORD = process.env.SEED_MOBILE_PASSWORD ?? 'Driver!Now123';

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
  await prisma.distributor.upsert({
    where: { userId: distrUser.id },
    update: { status: DistributorStatus.ACTIVE },
    create: { userId: distrUser.id, businessName: 'Test LPG Shop', status: DistributorStatus.ACTIVE },
  });

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

  const cities = [
    { id: '00000000-0000-0000-0000-000000000001', name: 'Islamabad', countryCode: 'PK' },
    { id: '00000000-0000-0000-0000-000000000002', name: 'Rawalpindi', countryCode: 'PK' },
    { id: '00000000-0000-0000-0000-000000000003', name: 'Lahore',    countryCode: 'PK' },
    { id: '00000000-0000-0000-0000-000000000004', name: 'Karachi',   countryCode: 'PK' },
  ];
  for (const c of cities) {
    await prisma.city.upsert({ where: { id: c.id }, update: {}, create: c });
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
  console.log('Seeded cities:', cities.map((c) => c.name).join(', '));
  console.log('Seeded accessories:', accessories.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
