import { PrismaClient, UserRole, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminPhone = '+923000000000';

  const admin = await prisma.user.upsert({
    where: { phone: adminPhone },
    update: {},
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

  await prisma.city.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: { id: '00000000-0000-0000-0000-000000000001', name: 'Lahore', countryCode: 'PK' },
  });

  console.log('Seeded admin user:', admin.phone);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
