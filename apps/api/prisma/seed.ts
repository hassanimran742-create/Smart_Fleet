import { PrismaClient, UserRole, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminPhone = '+923000000000';

  const admin = await prisma.user.upsert({
    where: { phone: adminPhone },
    // Make sure an existing user (e.g. auto-created at first OTP login)
    // is promoted to ADMIN so the dev account always has admin perms.
    update: {
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      name: 'Smart_Fleet Admin',
    },
    create: {
      phone: adminPhone,
      name: 'Smart_Fleet Admin',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  const types = [
    { code: 'LPG_11KG', name: 'LPG 11kg', weightKg: 11, capacityUnits: 1 },
    { code: 'LPG_45KG', name: 'LPG 45kg', weightKg: 45, capacityUnits: 4 },
  ];
  for (const t of types) {
    await prisma.cylinderType.upsert({
      where: { code: t.code },
      update: {},
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
