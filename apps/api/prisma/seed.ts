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

  console.log('Seeded admin user:', admin.phone);
  console.log('Seeded cities:', cities.map((c) => c.name).join(', '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
