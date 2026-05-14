/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CustodyType,
  CylinderState,
  DistributorStatus,
  DriverAvailability,
  OrderStatus,
  PrismaClient,
  UserRole,
  UserStatus,
  VehicleStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';

/**
 * End-to-end happy-path scenario for the Smart_Fleet platform.
 *
 * Hits these test-matrix scenarios in one continuous flow:
 *   A-01  Stock at client zone store · vehicle at same store
 *   B-01  Vehicle capacity exactly fits the order
 *   C-01  Driver idle, in zone, fully available
 *   D-01  Store has exact stock available
 *   E-01  Client and distributor stock in same zone (base tariff)
 *   F-01  Empties will be picked up at delivery (data setup)
 *   G-01  Order placed within normal delivery window
 *
 * Run with: npm run seed:demo
 * Idempotent — safe to re-run.
 */

const prisma = new PrismaClient();

// Fixed UUIDs so re-runs hit the same rows (no sprawling duplicates).
const IDS = {
  city:           '11111111-0000-0000-0000-000000000001',
  fSectorZone:    '22222222-0000-0000-0000-000000000001',
  gSectorZone:    '22222222-0000-0000-0000-000000000002',
  fHubStore:      '33333333-0000-0000-0000-000000000001',
  gHubStore:      '33333333-0000-0000-0000-000000000002',
  distributor:    '44444444-0000-0000-0000-000000000001',
  distributorUser:'44444444-0000-0000-0000-000000000aaa',
  driver:         '55555555-0000-0000-0000-000000000001',
  driverUser:     '55555555-0000-0000-0000-000000000aaa',
  vehicle:        '66666666-0000-0000-0000-000000000001',
  client:         '77777777-0000-0000-0000-000000000001',
};

// Demo phones
const PHONES = {
  distributor: '+923111111111',
  driver:      '+923222222222',
  client:      '+923333333333',
};

async function main() {
  console.log('🌱 Smart_Fleet demo seed — building happy-path scenario');

  // 1) City -----------------------------------------------------------------
  const city = await prisma.city.upsert({
    where: { id: IDS.city },
    update: { name: 'Islamabad' },
    create: { id: IDS.city, name: 'Islamabad', countryCode: 'PK' },
  });
  console.log(`  ✓ City: ${city.name}`);

  // 2) Zones (F-sectors and G-sectors) -- requires raw SQL for PostGIS ------
  // Square polygons around F-7 and G-9 centroids.
  await prisma.$executeRaw`
    INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at)
    VALUES (
      ${IDS.fSectorZone}::uuid,
      ${IDS.city}::uuid,
      'F-Sectors Core',
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({
        type: 'MultiPolygon',
        coordinates: [[[
          [73.030, 33.700],
          [73.090, 33.700],
          [73.090, 33.740],
          [73.030, 33.740],
          [73.030, 33.700],
        ]]],
      })}), 4326),
      ST_SetSRID(ST_MakePoint(73.060, 33.720), 4326),
      TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, polygon = EXCLUDED.polygon, centroid = EXCLUDED.centroid, is_active = TRUE
  `;
  await prisma.$executeRaw`
    INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at)
    VALUES (
      ${IDS.gSectorZone}::uuid,
      ${IDS.city}::uuid,
      'G-Sectors Core',
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({
        type: 'MultiPolygon',
        coordinates: [[[
          [73.030, 33.660],
          [73.090, 33.660],
          [73.090, 33.700],
          [73.030, 33.700],
          [73.030, 33.660],
        ]]],
      })}), 4326),
      ST_SetSRID(ST_MakePoint(73.060, 33.680), 4326),
      TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, polygon = EXCLUDED.polygon, centroid = EXCLUDED.centroid, is_active = TRUE
  `;
  console.log('  ✓ Zones: F-Sectors Core, G-Sectors Core');

  // 3) Stores (one per zone) ------------------------------------------------
  await prisma.$executeRaw`
    INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
    VALUES (
      ${IDS.fHubStore}::uuid,
      'F-Hub Store',
      ${IDS.fSectorZone}::uuid,
      'F-7 Markaz, Islamabad',
      ST_SetSRID(ST_MakePoint(73.0535, 33.7177), 4326),
      TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, zone_id = EXCLUDED.zone_id, address = EXCLUDED.address, location = EXCLUDED.location, is_active = TRUE
  `;
  await prisma.$executeRaw`
    INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
    VALUES (
      ${IDS.gHubStore}::uuid,
      'G-Hub Store',
      ${IDS.gSectorZone}::uuid,
      'G-9 Markaz, Islamabad',
      ST_SetSRID(ST_MakePoint(73.0322, 33.6883), 4326),
      TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, zone_id = EXCLUDED.zone_id, address = EXCLUDED.address, location = EXCLUDED.location, is_active = TRUE
  `;
  console.log('  ✓ Stores: F-Hub Store, G-Hub Store');

  // 4) Distributor ----------------------------------------------------------
  await prisma.user.upsert({
    where: { id: IDS.distributorUser },
    update: {
      phone: PHONES.distributor,
      name: 'Bilal Ahmad',
      email: 'bilal@abclpg.pk',
      role: UserRole.DISTRIBUTOR,
      status: UserStatus.ACTIVE,
    },
    create: {
      id: IDS.distributorUser,
      phone: PHONES.distributor,
      name: 'Bilal Ahmad',
      email: 'bilal@abclpg.pk',
      role: UserRole.DISTRIBUTOR,
      status: UserStatus.ACTIVE,
    },
  });
  await prisma.distributor.upsert({
    where: { id: IDS.distributor },
    update: {
      businessName: 'ABC LPG (Pvt) Ltd',
      homeStoreId: IDS.fHubStore,
      status: DistributorStatus.ACTIVE,
      advanceBalancePaisa: BigInt(50_00000), // 50,000 PKR
    },
    create: {
      id: IDS.distributor,
      userId: IDS.distributorUser,
      businessName: 'ABC LPG (Pvt) Ltd',
      homeStoreId: IDS.fHubStore,
      status: DistributorStatus.ACTIVE,
      advanceBalancePaisa: BigInt(50_00000),
    },
  });
  console.log(`  ✓ Distributor: ABC LPG (Pvt) Ltd — balance Rs. 50,000`);

  // 5) Driver + Vehicle -----------------------------------------------------
  await prisma.user.upsert({
    where: { id: IDS.driverUser },
    update: {
      phone: PHONES.driver,
      name: 'Ahmad Ali',
      email: 'ahmad@smartfleet.pk',
      cnic: '12345-1234567-1',
      role: UserRole.DRIVER,
      status: UserStatus.ACTIVE,
    },
    create: {
      id: IDS.driverUser,
      phone: PHONES.driver,
      name: 'Ahmad Ali',
      email: 'ahmad@smartfleet.pk',
      cnic: '12345-1234567-1',
      role: UserRole.DRIVER,
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.vehicle.upsert({
    where: { id: IDS.vehicle },
    update: {
      plateNo: 'ICT-1234',
      capacityUnits: 20,
      homeZoneId: IDS.fSectorZone,
      status: VehicleStatus.ACTIVE,
    },
    create: {
      id: IDS.vehicle,
      plateNo: 'ICT-1234',
      capacityUnits: 20,
      homeZoneId: IDS.fSectorZone,
      status: VehicleStatus.ACTIVE,
    },
  });

  await prisma.driver.upsert({
    where: { id: IDS.driver },
    update: {
      userId: IDS.driverUser,
      licenceNo: 'DL-ICT-7788',
      currentVehicleId: IDS.vehicle,
      isOnline: true,
      availability: DriverAvailability.AVAILABLE,
    },
    create: {
      id: IDS.driver,
      userId: IDS.driverUser,
      licenceNo: 'DL-ICT-7788',
      currentVehicleId: IDS.vehicle,
      isOnline: true,
      availability: DriverAvailability.AVAILABLE,
    },
  });
  // Position the driver at F-Hub store (so the dispatch algorithm finds a candidate)
  await prisma.$executeRaw`
    UPDATE drivers
    SET current_location = ST_SetSRID(ST_MakePoint(73.0535, 33.7177), 4326),
        current_location_updated_at = NOW(),
        current_zone_id = ${IDS.fSectorZone}::uuid
    WHERE id = ${IDS.driver}::uuid
  `;
  console.log(`  ✓ Driver: Ahmad Ali · vehicle ICT-1234 · ONLINE at F-Hub`);

  // 6) Cylinders — 50 LPG 11.8kg cylinders owned by ABC LPG at F-Hub --------
  const cylinderType = await prisma.cylinderType.findUnique({ where: { code: 'LPG_11_8KG' } });
  if (!cylinderType) {
    throw new Error('Cylinder type LPG_11_8KG not found. Run `npm run seed` first.');
  }

  // Wipe existing demo cylinders to keep counts predictable (only ones with our marker prefix)
  await prisma.cylinderEvent.deleteMany({
    where: { cylinder: { serial: { startsWith: 'DEMO-LPG_11_8KG-' } } },
  });
  await prisma.cylinder.deleteMany({
    where: { serial: { startsWith: 'DEMO-LPG_11_8KG-' } },
  });

  const cylinderRows = Array.from({ length: 50 }, () => {
    const suffix = randomBytes(3).toString('hex').toUpperCase();
    return {
      serial: `DEMO-LPG_11_8KG-${suffix}`,
      qrCode: `DEMO-LPG_11_8KG-${suffix}`,
      distributorId: IDS.distributor,
      cylinderTypeId: cylinderType.id,
      state: CylinderState.FULL,
      custodyType: CustodyType.STORE,
      custodyId: IDS.fHubStore,
    };
  });
  await prisma.cylinder.createMany({ data: cylinderRows });

  // Update inventory_lots so the dispatch query sees the stock immediately.
  await prisma.inventoryLot.upsert({
    where: {
      inventory_unique: {
        holderType: CustodyType.STORE,
        holderId: IDS.fHubStore,
        distributorId: IDS.distributor,
        cylinderTypeId: cylinderType.id,
        state: CylinderState.FULL,
      },
    },
    update: { count: 50 },
    create: {
      holderType: CustodyType.STORE,
      holderId: IDS.fHubStore,
      distributorId: IDS.distributor,
      cylinderTypeId: cylinderType.id,
      state: CylinderState.FULL,
      count: 50,
    },
  });
  console.log('  ✓ Cylinders: 50 × LPG 11.8kg FULL at F-Hub for ABC LPG');

  // 7) Pricing matrix --------------------------------------------------------
  const types = await prisma.cylinderType.findMany();
  const zonePairs = [
    [IDS.fSectorZone, IDS.fSectorZone, 250],   // same zone — base tier
    [IDS.fSectorZone, IDS.gSectorZone, 400],   // adjacent
    [IDS.gSectorZone, IDS.fSectorZone, 400],
    [IDS.gSectorZone, IDS.gSectorZone, 250],
  ];
  for (const [origin, dest, baseRupees] of zonePairs) {
    for (const t of types) {
      // Bigger cylinders charge a premium per unit on top of base
      const perUnitRupees =
        t.code.includes('45') ? 150 : t.code.includes('15') ? 80 : 40;
      // Clear any existing active rule for this combo then insert fresh
      await prisma.pricingRule.updateMany({
        where: {
          cityId: IDS.city,
          originZoneId: origin as string,
          destZoneId: dest as string,
          cylinderTypeId: t.id,
          effectiveUntil: null,
        },
        data: { effectiveUntil: new Date() },
      });
      await prisma.pricingRule.create({
        data: {
          cityId: IDS.city,
          originZoneId: origin as string,
          destZoneId: dest as string,
          cylinderTypeId: t.id,
          basePaisa: BigInt(Number(baseRupees) * 100),
          perUnitPaisa: BigInt(perUnitRupees * 100),
          effectiveFrom: new Date(),
        },
      });
    }
  }
  console.log('  ✓ Pricing matrix: 4 zone-pairs × all cylinder types (base 250–400 PKR)');

  // 8) Client + address ------------------------------------------------------
  await prisma.client.upsert({
    where: { id: IDS.client },
    update: {
      distributorId: IDS.distributor,
      name: 'Fatima Khan',
      phone: PHONES.client,
    },
    create: {
      id: IDS.client,
      distributorId: IDS.distributor,
      name: 'Fatima Khan',
      phone: PHONES.client,
    },
  });
  // Wipe and re-insert the address (location column needs raw SQL).
  await prisma.clientAddress.deleteMany({ where: { clientId: IDS.client } });
  await prisma.$executeRaw`
    INSERT INTO client_addresses (id, client_id, label, location)
    VALUES (
      gen_random_uuid(),
      ${IDS.client}::uuid,
      'F-7/2 House 24, Street 14',
      ST_SetSRID(ST_MakePoint(73.0535, 33.7177), 4326)
    )
  `;
  console.log('  ✓ Client: Fatima Khan in F-7/2');

  // 9) Pre-create a PENDING order (so admin sees it immediately) -----------
  // Remove any prior demo order(s) to keep things tidy
  await prisma.orderLine.deleteMany({
    where: { order: { client: { id: IDS.client } } },
  });
  await prisma.order.deleteMany({
    where: { clientId: IDS.client },
  });

  const orderRows: { id: string }[] = await prisma.$queryRaw`
    INSERT INTO orders (
      id, distributor_id, client_id, delivery_address_label, dest_zone_id,
      status, payment_status, delivery_fee_paisa, delivery_address, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(),
      ${IDS.distributor}::uuid,
      ${IDS.client}::uuid,
      'F-7/2 House 24, Street 14',
      ${IDS.fSectorZone}::uuid,
      'PENDING',
      'UNPAID',
      0,
      ST_SetSRID(ST_MakePoint(73.0535, 33.7177), 4326),
      NOW(), NOW()
    )
    RETURNING id
  `;
  const orderId = orderRows[0].id;

  await prisma.orderLine.create({
    data: {
      orderId,
      cylinderTypeId: cylinderType.id,
      fullCount: 2,
      expectedReturnCount: 2,
    },
  });

  console.log(`  ✓ Order: 2 × LPG 11.8kg, PENDING (id ${orderId.slice(0, 8)}…)`);

  console.log('\n📋 Summary');
  console.log('   Admin login: +923000000000');
  console.log(`   Distributor login: ${PHONES.distributor} (Bilal Ahmad · ABC LPG)`);
  console.log(`   Driver login: ${PHONES.driver} (Ahmad Ali · ICT-1234)`);
  console.log(`   Client: Fatima Khan (${PHONES.client}) at F-7/2`);
  console.log('   1 PENDING order with 2 × LPG 11.8kg in F-Sectors zone\n');
  console.log('To dispatch it manually from the admin web:');
  console.log(`   POST /api/v1/dispatch/manual  { "orderId": "${orderId}" }`);
  console.log('Or wait — the queue worker will pick it up automatically on next reload.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
