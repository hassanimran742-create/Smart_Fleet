/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AlertSeverity,
  AlertStatus,
  AlertType,
  CustodyType,
  CylinderEventType,
  CylinderState,
  DistributorStatus,
  DriverAvailability,
  LedgerEntryType,
  OrderPaymentStatus,
  OrderStatus,
  PrismaClient,
  TripStatus,
  TripStopType,
  UserRole,
  UserStatus,
  VehicleStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';

/**
 * Smart_Fleet demo seed — 8 end-to-end scenarios at different lifecycle
 * stages. Run with: npm run seed:demo
 *
 * Scenarios after seeding:
 *   1. DELIVERED yesterday  — F-zone → F-zone, full custody chain
 *   2. DELIVERED today      — F-zone → G-zone (cross-zone, higher fee)
 *   3. DELIVERED today      — XYZ distributor, 15kg cylinders
 *   4. IN_TRANSIT now       — active trip, driver en route
 *   5. ASSIGNED              — dispatched but driver hasn't started
 *   6. PENDING               — queued, waiting for dispatch worker
 *   7. FAILED                — client address inaccessible
 *   8. CANCELLED             — distributor cancelled after dispatch
 *
 * Plus: 3 drivers (online, on break, on leave), 2 distributors,
 * 2 vehicles, 2 stores, ledger debits, alerts, driver shifts.
 *
 * Idempotent — safe to re-run.
 */

const prisma = new PrismaClient();

const ID = {
  city: '11111111-0000-0000-0000-000000000001',
  fZone: '22222222-0000-0000-0000-000000000001',
  gZone: '22222222-0000-0000-0000-000000000002',
  fStore: '33333333-0000-0000-0000-000000000001',
  gStore: '33333333-0000-0000-0000-000000000002',
  distABC: '44444444-0000-0000-0000-000000000001',
  distXYZ: '44444444-0000-0000-0000-000000000002',
  distABCUser: '44444444-0000-0000-0000-000000000aa1',
  distXYZUser: '44444444-0000-0000-0000-000000000aa2',
  driverAhmad: '55555555-0000-0000-0000-000000000001',
  driverBilal: '55555555-0000-0000-0000-000000000002',
  driverImran: '55555555-0000-0000-0000-000000000003',
  driverFarhan:'55555555-0000-0000-0000-000000000004',
  driverSalman:'55555555-0000-0000-0000-000000000005',
  driverAhmadUser: '55555555-0000-0000-0000-000000000aa1',
  driverBilalUser: '55555555-0000-0000-0000-000000000aa2',
  driverImranUser: '55555555-0000-0000-0000-000000000aa3',
  driverFarhanUser:'55555555-0000-0000-0000-000000000aa4',
  driverSalmanUser:'55555555-0000-0000-0000-000000000aa5',
  vehicleA: '66666666-0000-0000-0000-000000000001',
  vehicleB: '66666666-0000-0000-0000-000000000002',
  vehicleC: '66666666-0000-0000-0000-000000000003',
  vehicleD: '66666666-0000-0000-0000-000000000004',
  vehicleE: '66666666-0000-0000-0000-000000000005',
  clientFatima: '77777777-0000-0000-0000-000000000001',
  clientAyesha: '77777777-0000-0000-0000-000000000002',
  clientUsman: '77777777-0000-0000-0000-000000000003',
  clientNoor: '77777777-0000-0000-0000-000000000004',
  clientHassan: '77777777-0000-0000-0000-000000000005',
  clientSara:  '77777777-0000-0000-0000-000000000006',
  clientAhmed: '77777777-0000-0000-0000-000000000007',
};

const PHONES = {
  distABC: '+923111111111',
  distXYZ: '+923111111112',
  driverAhmad: '+923222222221',
  driverBilal: '+923222222222',
  driverImran: '+923222222223',
  driverFarhan:'+923222222224',
  driverSalman:'+923222222225',
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function suffix() {
  return randomBytes(3).toString('hex').toUpperCase();
}

async function main() {
  console.log('🌱 Building multi-scenario demo data\n');

  // ---------------- Cleanup pass ----------------
  // Wipe anything from a previous demo run that matches our natural keys
  // (phones, plates, licences). Must walk FK relations in order.
  const demoPhones = [
    PHONES.distABC, PHONES.distXYZ,
    PHONES.driverAhmad, PHONES.driverBilal, PHONES.driverImran,
    PHONES.driverFarhan, PHONES.driverSalman,
  ];
  const demoLicences = ['DL-ICT-7788', 'DL-ICT-7789', 'DL-ICT-7790', 'DL-ICT-7791', 'DL-ICT-7792'];
  const demoPlates = ['ICT-1234', 'ICT-5678', 'ICT-9012', 'ICT-3456', 'ICT-7890'];

  const matchingUsers = await prisma.user.findMany({
    where: { phone: { in: demoPhones } },
    select: { id: true },
  });
  const oldUserIds = matchingUsers.map((u) => u.id);

  const matchingDrivers = await prisma.driver.findMany({
    where: { OR: [{ userId: { in: oldUserIds } }, { licenceNo: { in: demoLicences } }] },
    select: { id: true },
  });
  const oldDriverIds = matchingDrivers.map((d) => d.id);

  const matchingDistributors = await prisma.distributor.findMany({
    where: { userId: { in: oldUserIds } },
    select: { id: true },
  });
  const oldDistributorIds = matchingDistributors.map((d) => d.id);

  const matchingVehicles = await prisma.vehicle.findMany({
    where: { plateNo: { in: demoPlates } },
    select: { id: true },
  });
  const oldVehicleIds = matchingVehicles.map((v) => v.id);

  // Trips related to those drivers/vehicles, plus orders.tripId nullify
  const oldTrips = await prisma.trip.findMany({
    where: { OR: [{ driverId: { in: oldDriverIds } }, { vehicleId: { in: oldVehicleIds } }] },
    select: { id: true },
  });
  const oldTripIds = oldTrips.map((t) => t.id);

  // Orders by demo distributors
  const oldOrders = await prisma.order.findMany({
    where: { distributorId: { in: oldDistributorIds } },
    select: { id: true },
  });
  const oldOrderIds = oldOrders.map((o) => o.id);

  // Clients by demo distributors
  const oldClients = await prisma.client.findMany({
    where: { distributorId: { in: oldDistributorIds } },
    select: { id: true },
  });
  const oldClientIds = oldClients.map((c) => c.id);

  // Cylinders by demo distributors
  const oldCylinders = await prisma.cylinder.findMany({
    where: { distributorId: { in: oldDistributorIds } },
    select: { id: true },
  });
  const oldCylinderIds = oldCylinders.map((c) => c.id);

  // Delete in FK-safe order
  await prisma.cylinderEvent.deleteMany({
    where: {
      OR: [
        { cylinderId: { in: oldCylinderIds } },
        { actorUserId: { in: oldUserIds } },
        { tripId: { in: oldTripIds } },
        { orderId: { in: oldOrderIds } },
      ],
    },
  });
  await prisma.cylinder.deleteMany({ where: { id: { in: oldCylinderIds } } });
  await prisma.inventoryLot.deleteMany({ where: { distributorId: { in: oldDistributorIds } } });
  await prisma.tripStop.deleteMany({ where: { tripId: { in: oldTripIds } } });
  await prisma.ledgerEntry.deleteMany({
    where: { OR: [{ distributorId: { in: oldDistributorIds } }, { orderId: { in: oldOrderIds } }] },
  });
  await prisma.payment.deleteMany({ where: { distributorId: { in: oldDistributorIds } } });
  // Orders reference trips. Null-out then delete orders.
  await prisma.order.updateMany({ where: { tripId: { in: oldTripIds } }, data: { tripId: null } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: oldOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: oldOrderIds } } });
  // Now safe to delete trips
  await prisma.trip.deleteMany({ where: { id: { in: oldTripIds } } });
  await prisma.driverShift.deleteMany({ where: { driverId: { in: oldDriverIds } } });
  await prisma.reconciliation.deleteMany({ where: { driverId: { in: oldDriverIds } } });
  // Fuel refills (newly added schema) reference both driver and vehicle.
  await prisma.fuelRefill.deleteMany({
    where: {
      OR: [
        { driverId: { in: oldDriverIds } },
        { vehicleId: { in: oldVehicleIds } },
      ],
    },
  });
  // Filling orders reference assigned driver / vehicle / distributor / pickup store.
  await prisma.fillingOrder.deleteMany({
    where: {
      OR: [
        { assignedDriverId: { in: oldDriverIds } },
        { assignedVehicleId: { in: oldVehicleIds } },
        { distributorId: { in: oldDistributorIds } },
      ],
    },
  });
  // Clear driver→vehicle FK before deleting vehicles to avoid the unique constraint
  await prisma.driver.updateMany({
    where: { id: { in: oldDriverIds } },
    data: { currentVehicleId: null },
  });
  await prisma.driver.deleteMany({ where: { id: { in: oldDriverIds } } });
  await prisma.clientAddress.deleteMany({ where: { clientId: { in: oldClientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: oldClientIds } } });
  await prisma.distributor.deleteMany({ where: { id: { in: oldDistributorIds } } });
  await prisma.vehicle.deleteMany({ where: { id: { in: oldVehicleIds } } });
  // Auth + audit tables reference users — must clear before deleting users.
  await prisma.refreshToken.deleteMany({ where: { userId: { in: oldUserIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: oldUserIds } } });
  await prisma.expoPushToken.deleteMany({ where: { userId: { in: oldUserIds } } });
  // Reconciliations also reference verifiedByUserId (separate from driverId
  // — already deleted via driverId path) plus support tickets potentially.
  await prisma.reconciliation.updateMany({
    where: { verifiedByUserId: { in: oldUserIds } },
    data: { verifiedByUserId: null },
  });
  await prisma.user.deleteMany({ where: { id: { in: oldUserIds } } });
  console.log(`  ✓ Cleanup: removed ${oldUserIds.length} users, ${oldDriverIds.length} drivers, ${oldDistributorIds.length} distributors, ${oldVehicleIds.length} vehicles, ${oldOrderIds.length} orders`);

  // ---------------- City + Zones + Stores ----------------
  await prisma.city.upsert({
    where: { id: ID.city },
    update: { name: 'Islamabad' },
    create: { id: ID.city, name: 'Islamabad', countryCode: 'PK' },
  });

  await prisma.$executeRaw`
    INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at)
    VALUES (
      ${ID.fZone}::uuid, ${ID.city}::uuid, 'F-Sectors Core',
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({
        type: 'MultiPolygon',
        coordinates: [[[
          [73.030, 33.700], [73.090, 33.700], [73.090, 33.740],
          [73.030, 33.740], [73.030, 33.700],
        ]]],
      })}), 4326),
      ST_SetSRID(ST_MakePoint(73.060, 33.720), 4326),
      TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET polygon = EXCLUDED.polygon, centroid = EXCLUDED.centroid, is_active = TRUE
  `;
  await prisma.$executeRaw`
    INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at)
    VALUES (
      ${ID.gZone}::uuid, ${ID.city}::uuid, 'G-Sectors Core',
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({
        type: 'MultiPolygon',
        coordinates: [[[
          [73.030, 33.660], [73.090, 33.660], [73.090, 33.700],
          [73.030, 33.700], [73.030, 33.660],
        ]]],
      })}), 4326),
      ST_SetSRID(ST_MakePoint(73.060, 33.680), 4326),
      TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET polygon = EXCLUDED.polygon, centroid = EXCLUDED.centroid, is_active = TRUE
  `;

  await prisma.$executeRaw`
    INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
    VALUES (
      ${ID.fStore}::uuid, 'F-Hub Store', ${ID.fZone}::uuid,
      'F-7 Markaz, Islamabad',
      ST_SetSRID(ST_MakePoint(73.0535, 33.7177), 4326),
      TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, location = EXCLUDED.location, is_active = TRUE
  `;
  await prisma.$executeRaw`
    INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at)
    VALUES (
      ${ID.gStore}::uuid, 'G-Hub Store', ${ID.gZone}::uuid,
      'G-9 Markaz, Islamabad',
      ST_SetSRID(ST_MakePoint(73.0322, 33.6883), 4326),
      TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET zone_id = EXCLUDED.zone_id, location = EXCLUDED.location, is_active = TRUE
  `;
  console.log('  ✓ 1 city, 2 zones, 2 stores');

  // ---------------- Helper: upsert user by PHONE (the natural unique) ----
  // Returns the actual user id (existing or new). Robust to whatever was
  // already in the table from a previous seed run.
  async function upsertUser(payload: {
    phone: string;
    name: string;
    email?: string;
    cnic?: string;
    role: UserRole;
    fallbackId: string;
  }): Promise<string> {
    const user = await prisma.user.upsert({
      where: { phone: payload.phone },
      update: {
        name: payload.name,
        email: payload.email,
        cnic: payload.cnic,
        role: payload.role,
        status: UserStatus.ACTIVE,
      },
      create: {
        id: payload.fallbackId,
        phone: payload.phone,
        name: payload.name,
        email: payload.email,
        cnic: payload.cnic,
        role: payload.role,
        status: UserStatus.ACTIVE,
      },
    });
    return user.id;
  }

  // ---------------- Distributors ----------------
  const distABCUserId = await upsertUser({
    phone: PHONES.distABC,
    name: 'Bilal Ahmad',
    email: 'bilal@abclpg.pk',
    role: UserRole.DISTRIBUTOR,
    fallbackId: ID.distABCUser,
  });
  const distXYZUserId = await upsertUser({
    phone: PHONES.distXYZ,
    name: 'Saima Iqbal',
    email: 'saima@xyzgas.pk',
    role: UserRole.DISTRIBUTOR,
    fallbackId: ID.distXYZUser,
  });

  await prisma.distributor.upsert({
    where: { userId: distABCUserId },
    update: {
      businessName: 'ABC LPG (Pvt) Ltd',
      homeStoreId: ID.fStore,
      status: DistributorStatus.ACTIVE,
      advanceBalancePaisa: BigInt(50_00000),
    },
    create: {
      id: ID.distABC,
      userId: distABCUserId,
      businessName: 'ABC LPG (Pvt) Ltd',
      homeStoreId: ID.fStore,
      status: DistributorStatus.ACTIVE,
      advanceBalancePaisa: BigInt(50_00000),
    },
  });
  await prisma.distributor.upsert({
    where: { userId: distXYZUserId },
    update: {
      businessName: 'XYZ Gas Distributors',
      homeStoreId: ID.gStore,
      status: DistributorStatus.ACTIVE,
      advanceBalancePaisa: BigInt(30_00000),
    },
    create: {
      id: ID.distXYZ,
      userId: distXYZUserId,
      businessName: 'XYZ Gas Distributors',
      homeStoreId: ID.gStore,
      status: DistributorStatus.ACTIVE,
      advanceBalancePaisa: BigInt(30_00000),
    },
  });
  // After upsert, capture the actual distributor IDs (might be different on re-runs)
  const distABC = await prisma.distributor.findUnique({ where: { userId: distABCUserId } });
  const distXYZ = await prisma.distributor.findUnique({ where: { userId: distXYZUserId } });
  ID.distABC = distABC!.id;
  ID.distXYZ = distXYZ!.id;
  console.log('  ✓ 2 distributors: ABC LPG (Rs 50,000), XYZ Gas (Rs 30,000)');

  // ---------------- Drivers + Vehicles ----------------
  const driverPlan = [
    {
      userId: ID.driverAhmadUser, driverId: ID.driverAhmad, vehicleId: ID.vehicleA,
      phone: PHONES.driverAhmad, name: 'Ahmad Ali', cnic: '12345-1234567-1',
      licence: 'DL-ICT-7788', plate: 'ICT-1234', capacity: 20, zoneId: ID.fZone,
      isOnline: true, availability: DriverAvailability.AVAILABLE,
      lat: 33.7177, lng: 73.0535, // at F-Hub
    },
    {
      userId: ID.driverBilalUser, driverId: ID.driverBilal, vehicleId: ID.vehicleB,
      phone: PHONES.driverBilal, name: 'Bilal Hassan', cnic: '12345-7654321-3',
      licence: 'DL-ICT-7789', plate: 'ICT-5678', capacity: 16, zoneId: ID.gZone,
      isOnline: true, availability: DriverAvailability.AVAILABLE,
      lat: 33.6883, lng: 73.0322, // at G-Hub
    },
    {
      userId: ID.driverImranUser, driverId: ID.driverImran, vehicleId: ID.vehicleC,
      phone: PHONES.driverImran, name: 'Imran Shah', cnic: '12345-9876543-5',
      licence: 'DL-ICT-7790', plate: 'ICT-9012', capacity: 24, zoneId: ID.fZone,
      isOnline: false, availability: DriverAvailability.ON_LEAVE,
      lat: 33.7050, lng: 73.0500,
    },
    // Driver 4: Farhan — actively in transit somewhere in F-Sectors
    {
      userId: ID.driverFarhanUser, driverId: ID.driverFarhan, vehicleId: ID.vehicleD,
      phone: PHONES.driverFarhan, name: 'Farhan Aziz', cnic: '12345-2233445-7',
      licence: 'DL-ICT-7791', plate: 'ICT-3456', capacity: 18, zoneId: ID.fZone,
      isOnline: true, availability: DriverAvailability.AVAILABLE,
      lat: 33.7095, lng: 73.0405, // en route in F-8
    },
    // Driver 5: Salman — online at G-Hub, just received an assigned trip
    {
      userId: ID.driverSalmanUser, driverId: ID.driverSalman, vehicleId: ID.vehicleE,
      phone: PHONES.driverSalman, name: 'Salman Tariq', cnic: '12345-6677889-2',
      licence: 'DL-ICT-7792', plate: 'ICT-7890', capacity: 22, zoneId: ID.gZone,
      isOnline: true, availability: DriverAvailability.AVAILABLE,
      lat: 33.6911, lng: 73.0184, // around F-10
    },
  ];

  const driverIdMap: Record<string, string> = {};
  const driverUserIdMap: Record<string, string> = {};

  for (const d of driverPlan) {
    const userId = await upsertUser({
      phone: d.phone, name: d.name, cnic: d.cnic,
      role: UserRole.DRIVER, fallbackId: d.userId,
    });
    driverUserIdMap[d.driverId] = userId;

    // Upsert vehicle by plate (the natural unique). Don't pin the id —
    // a previous run may already have used it.
    await prisma.vehicle.upsert({
      where: { plateNo: d.plate },
      update: { capacityUnits: d.capacity, homeZoneId: d.zoneId, status: VehicleStatus.ACTIVE },
      create: { plateNo: d.plate, capacityUnits: d.capacity, homeZoneId: d.zoneId, status: VehicleStatus.ACTIVE },
    });
    const veh = await prisma.vehicle.findUnique({ where: { plateNo: d.plate } });
    const vehicleId = veh!.id;

    // Upsert driver by userId. Same: don't pin the id.
    await prisma.driver.upsert({
      where: { userId },
      update: {
        licenceNo: d.licence, currentVehicleId: vehicleId,
        isOnline: d.isOnline, availability: d.availability,
        leaveStart: d.availability === DriverAvailability.ON_LEAVE ? new Date() : null,
        leaveEnd: d.availability === DriverAvailability.ON_LEAVE ? new Date(Date.now() + 5 * DAY) : null,
        leaveReason: d.availability === DriverAvailability.ON_LEAVE ? 'annual leave' : null,
      },
      create: {
        userId, licenceNo: d.licence,
        currentVehicleId: vehicleId,
        isOnline: d.isOnline, availability: d.availability,
        leaveStart: d.availability === DriverAvailability.ON_LEAVE ? new Date() : null,
        leaveEnd: d.availability === DriverAvailability.ON_LEAVE ? new Date(Date.now() + 5 * DAY) : null,
        leaveReason: d.availability === DriverAvailability.ON_LEAVE ? 'annual leave' : null,
      },
    });
    const drv = await prisma.driver.findUnique({ where: { userId } });
    const driverActualId = drv!.id;
    driverIdMap[d.driverId] = driverActualId;

    await prisma.$executeRaw`
      UPDATE drivers
      SET current_location = ST_SetSRID(ST_MakePoint(${d.lng}, ${d.lat}), 4326),
          current_location_updated_at = NOW(),
          current_zone_id = ${d.zoneId}::uuid
      WHERE id = ${driverActualId}::uuid
    `;
  }

  // Map our planning IDs to the actual driver/vehicle/user IDs that ended up in the DB.
  const planToActual = { ...driverIdMap };  // snapshot before we mutate ID.*
  ID.driverAhmad  = planToActual[ID.driverAhmad];
  ID.driverBilal  = planToActual[ID.driverBilal];
  ID.driverImran  = planToActual[ID.driverImran];
  ID.driverFarhan = planToActual[ID.driverFarhan];
  ID.driverSalman = planToActual[ID.driverSalman];
  const userByActualId = Object.fromEntries(
    Object.entries(planToActual).map(([planId, actualId]) => [actualId, driverUserIdMap[planId]]),
  );
  ID.driverAhmadUser  = userByActualId[ID.driverAhmad];
  ID.driverBilalUser  = userByActualId[ID.driverBilal];
  ID.driverImranUser  = userByActualId[ID.driverImran];
  ID.driverFarhanUser = userByActualId[ID.driverFarhan];
  ID.driverSalmanUser = userByActualId[ID.driverSalman];
  // Vehicle IDs: capture by plate
  const vA = await prisma.vehicle.findUnique({ where: { plateNo: 'ICT-1234' } });
  const vB = await prisma.vehicle.findUnique({ where: { plateNo: 'ICT-5678' } });
  const vC = await prisma.vehicle.findUnique({ where: { plateNo: 'ICT-9012' } });
  const vD = await prisma.vehicle.findUnique({ where: { plateNo: 'ICT-3456' } });
  const vE = await prisma.vehicle.findUnique({ where: { plateNo: 'ICT-7890' } });
  ID.vehicleA = vA!.id;
  ID.vehicleB = vB!.id;
  ID.vehicleC = vC!.id;
  ID.vehicleD = vD!.id;
  ID.vehicleE = vE!.id;
  console.log('  ✓ 5 drivers: Ahmad, Bilal, Farhan, Salman (online), Imran (on leave)');

  // ---------------- Driver shifts (for attendance) ----------------
  // Wipe + reseed shifts for these drivers so the report shows clean numbers.
  await prisma.driverShift.deleteMany({
    where: { driverId: { in: [ID.driverAhmad, ID.driverBilal, ID.driverImran] } },
  });
  const now = new Date();
  // Ahmad: shifts on 3 of the last 7 days, ~8 hours each, plus an open shift right now
  for (const daysAgo of [6, 4, 2]) {
    const start = new Date(now.getTime() - daysAgo * DAY - 9 * HOUR);
    const end = new Date(start.getTime() + 8 * HOUR);
    await prisma.driverShift.create({ data: { driverId: ID.driverAhmad, startedAt: start, endedAt: end } });
  }
  await prisma.driverShift.create({ data: { driverId: ID.driverAhmad, startedAt: new Date(now.getTime() - 2 * HOUR), endedAt: null } });

  // Bilal: shifts on 2 of the last 7 days, started just now
  for (const daysAgo of [5, 1]) {
    const start = new Date(now.getTime() - daysAgo * DAY - 7 * HOUR);
    const end = new Date(start.getTime() + 6 * HOUR);
    await prisma.driverShift.create({ data: { driverId: ID.driverBilal, startedAt: start, endedAt: end } });
  }
  await prisma.driverShift.create({ data: { driverId: ID.driverBilal, startedAt: new Date(now.getTime() - 1 * HOUR), endedAt: null } });
  console.log('  ✓ Driver shifts seeded for attendance report (Ahmad: 32h, Bilal: 13h)');

  // ---------------- Cylinder types ----------------
  const cylTypes = await prisma.cylinderType.findMany();
  const tLPG118 = cylTypes.find((t) => t.code === 'LPG_11_8KG');
  const tLPG15  = cylTypes.find((t) => t.code === 'LPG_15KG');
  const tLPG454 = cylTypes.find((t) => t.code === 'LPG_45_4KG');
  if (!tLPG118 || !tLPG15 || !tLPG454) {
    throw new Error('Cylinder types missing. Run `npm run seed` first.');
  }

  // ---------------- Pricing matrix ----------------
  const zonePairs: [string, string, number][] = [
    [ID.fZone, ID.fZone, 250],
    [ID.fZone, ID.gZone, 400],
    [ID.gZone, ID.fZone, 400],
    [ID.gZone, ID.gZone, 250],
  ];
  for (const [origin, dest, baseRupees] of zonePairs) {
    for (const t of cylTypes) {
      const perUnit = t.code.includes('45') ? 150 : t.code.includes('15') ? 80 : 40;
      await prisma.pricingRule.updateMany({
        where: { cityId: ID.city, originZoneId: origin, destZoneId: dest, cylinderTypeId: t.id, effectiveUntil: null },
        data: { effectiveUntil: new Date() },
      });
      await prisma.pricingRule.create({
        data: {
          cityId: ID.city, originZoneId: origin, destZoneId: dest, cylinderTypeId: t.id,
          basePaisa: BigInt(baseRupees * 100), perUnitPaisa: BigInt(perUnit * 100),
          effectiveFrom: new Date(),
        },
      });
    }
  }
  console.log('  ✓ Pricing matrix: 4 zone-pairs × all cylinder types');

  // ---------------- Cylinders + Inventory ----------------
  // Wipe demo cylinders first
  await prisma.cylinderEvent.deleteMany({
    where: { cylinder: { serial: { startsWith: 'DEMO-' } } },
  });
  await prisma.cylinder.deleteMany({ where: { serial: { startsWith: 'DEMO-' } } });
  await prisma.inventoryLot.deleteMany({
    where: {
      OR: [
        { holderId: ID.fStore, holderType: CustodyType.STORE },
        { holderId: ID.gStore, holderType: CustodyType.STORE },
        { holderId: ID.vehicleA, holderType: CustodyType.VEHICLE },
        { holderId: ID.vehicleB, holderType: CustodyType.VEHICLE },
      ],
    },
  });

  // Seed cylinders: ABC LPG has 40 × 11.8kg + 10 × 15kg at F-Store
  //                  XYZ Gas has 30 × 11.8kg + 12 × 45.4kg at G-Store
  type CylSpec = { distributorId: string; typeId: string; storeId: string; count: number };
  const stockPlan: CylSpec[] = [
    { distributorId: ID.distABC, typeId: tLPG118.id, storeId: ID.fStore, count: 40 },
    { distributorId: ID.distABC, typeId: tLPG15.id,  storeId: ID.fStore, count: 10 },
    { distributorId: ID.distXYZ, typeId: tLPG118.id, storeId: ID.gStore, count: 30 },
    { distributorId: ID.distXYZ, typeId: tLPG454.id, storeId: ID.gStore, count: 12 },
  ];
  for (const lot of stockPlan) {
    const type = cylTypes.find((t) => t.id === lot.typeId)!;
    const data = Array.from({ length: lot.count }, () => ({
      serial: `DEMO-${type.code}-${suffix()}`,
      qrCode: `DEMO-${type.code}-${suffix()}`,
      distributorId: lot.distributorId,
      cylinderTypeId: lot.typeId,
      state: CylinderState.FULL,
      custodyType: CustodyType.STORE,
      custodyId: lot.storeId,
    }));
    await prisma.cylinder.createMany({ data });
    await prisma.inventoryLot.upsert({
      where: {
        inventory_unique: {
          holderType: CustodyType.STORE,
          holderId: lot.storeId,
          distributorId: lot.distributorId,
          cylinderTypeId: lot.typeId,
          state: CylinderState.FULL,
        },
      },
      update: { count: lot.count },
      create: {
        holderType: CustodyType.STORE,
        holderId: lot.storeId,
        distributorId: lot.distributorId,
        cylinderTypeId: lot.typeId,
        state: CylinderState.FULL,
        count: lot.count,
      },
    });
  }
  console.log('  ✓ 92 cylinders across 2 distributors / 2 stores');

  // ---------------- Clients ----------------
  const clientPlan = [
    { id: ID.clientFatima, distId: ID.distABC, name: 'Fatima Khan',  phone: '+923333333331', label: 'F-7/2 House 24, Street 14',           lat: 33.7177, lng: 73.0535 },
    { id: ID.clientAyesha, distId: ID.distABC, name: 'Ayesha Malik', phone: '+923333333332', label: 'G-9/3 House 87, Street 6',            lat: 33.6883, lng: 73.0322 },
    { id: ID.clientUsman,  distId: ID.distXYZ, name: 'Usman Tariq',  phone: '+923333333333', label: 'F-8/4 Plot 102, Civic Centre Road',   lat: 33.7095, lng: 73.0405 },
    { id: ID.clientNoor,   distId: ID.distXYZ, name: 'Noor Fatima',  phone: '+923333333334', label: 'G-10/2 House 14',                     lat: 33.6783, lng: 73.0163 },
    { id: ID.clientHassan, distId: ID.distABC, name: 'Hassan Raza',  phone: '+923333333335', label: 'F-11/1 Street 22 (gated, no entry)', lat: 33.6857, lng: 73.0058 },
    { id: ID.clientSara,   distId: ID.distABC, name: 'Sara Iqbal',   phone: '+923333333336', label: 'F-10/3 House 5',                      lat: 33.6911, lng: 73.0184 },
    { id: ID.clientAhmed,  distId: ID.distXYZ, name: 'Ahmed Khan',   phone: '+923333333337', label: 'G-11/1 House 99',                     lat: 33.6649, lng: 73.0017 },
  ];
  for (const c of clientPlan) {
    await prisma.client.upsert({
      where: { id: c.id },
      update: { distributorId: c.distId, name: c.name, phone: c.phone },
      create: { id: c.id, distributorId: c.distId, name: c.name, phone: c.phone },
    });
    await prisma.clientAddress.deleteMany({ where: { clientId: c.id } });
    await prisma.$executeRaw`
      INSERT INTO client_addresses (id, client_id, label, location)
      VALUES (gen_random_uuid(), ${c.id}::uuid, ${c.label},
              ST_SetSRID(ST_MakePoint(${c.lng}, ${c.lat}), 4326))
    `;
  }
  console.log('  ✓ 5 clients across both distributors');

  // ---------------- Clean prior demo orders ----------------
  await prisma.ledgerEntry.deleteMany({
    where: { order: { client: { id: { in: Object.values(ID).filter((v) => v.startsWith('77777777')) } } } },
  });
  await prisma.tripStop.deleteMany({
    where: { trip: { driverId: { in: [ID.driverAhmad, ID.driverBilal, ID.driverImran] } } },
  });
  await prisma.cylinderEvent.deleteMany({
    where: { actorUserId: { in: [ID.driverAhmadUser, ID.driverBilalUser] } },
  });
  await prisma.orderLine.deleteMany({
    where: { order: { distributorId: { in: [ID.distABC, ID.distXYZ] } } },
  });
  await prisma.order.deleteMany({
    where: { distributorId: { in: [ID.distABC, ID.distXYZ] } },
  });
  await prisma.trip.deleteMany({
    where: { driverId: { in: [ID.driverAhmad, ID.driverBilal, ID.driverImran] } },
  });

  // ---------------- Scenario builder helper ----------------
  type Scenario = {
    label: string;
    distributorId: string;
    clientId: string;
    typeId: string;
    fullCount: number;
    destZoneId: string;
    destLat: number;
    destLng: number;
    deliveryLabel: string;
    status: OrderStatus;
    driverId?: string;
    vehicleId?: string;
    originStoreId?: string;
    storeLat?: number; storeLng?: number;
    deliveredAt?: Date;
    cancellationReason?: string;
  };

  const scenarios: Scenario[] = [
    // 1. Delivered yesterday (Ahmad F→F)
    {
      label: 'S1 DELIVERED yesterday',
      distributorId: ID.distABC, clientId: ID.clientFatima, typeId: tLPG118.id, fullCount: 2,
      destZoneId: ID.fZone, destLat: 33.7177, destLng: 73.0535, deliveryLabel: 'F-7/2 House 24, Street 14',
      status: OrderStatus.DELIVERED, driverId: ID.driverAhmad, vehicleId: ID.vehicleA,
      originStoreId: ID.fStore, storeLat: 33.7177, storeLng: 73.0535,
      deliveredAt: new Date(now.getTime() - 1 * DAY - 4 * HOUR),
    },
    // 2. Delivered today (Bilal F→G cross-zone)
    {
      label: 'S2 DELIVERED today (cross-zone)',
      distributorId: ID.distABC, clientId: ID.clientAyesha, typeId: tLPG118.id, fullCount: 3,
      destZoneId: ID.gZone, destLat: 33.6883, destLng: 73.0322, deliveryLabel: 'G-9/3 House 87, Street 6',
      status: OrderStatus.DELIVERED, driverId: ID.driverBilal, vehicleId: ID.vehicleB,
      originStoreId: ID.fStore, storeLat: 33.7177, storeLng: 73.0535,
      deliveredAt: new Date(now.getTime() - 3 * HOUR),
    },
    // 3. Delivered today (Ahmad XYZ 15kg)
    {
      label: 'S3 DELIVERED today (XYZ 15kg)',
      distributorId: ID.distXYZ, clientId: ID.clientUsman, typeId: tLPG118.id, fullCount: 4,
      destZoneId: ID.fZone, destLat: 33.7095, destLng: 73.0405, deliveryLabel: 'F-8/4 Plot 102',
      status: OrderStatus.DELIVERED, driverId: ID.driverAhmad, vehicleId: ID.vehicleA,
      originStoreId: ID.gStore, storeLat: 33.6883, storeLng: 73.0322,
      deliveredAt: new Date(now.getTime() - 1 * HOUR),
    },
    // 4. IN_TRANSIT now (Ahmad, active on map)
    {
      label: 'S4 IN_TRANSIT now',
      distributorId: ID.distABC, clientId: ID.clientHassan, typeId: tLPG118.id, fullCount: 2,
      destZoneId: ID.fZone, destLat: 33.6857, destLng: 73.0058, deliveryLabel: 'F-11/1 Street 22',
      status: OrderStatus.IN_TRANSIT, driverId: ID.driverAhmad, vehicleId: ID.vehicleA,
      originStoreId: ID.fStore, storeLat: 33.7177, storeLng: 73.0535,
    },
    // 5. ASSIGNED (Bilal, dispatched but not started)
    {
      label: 'S5 ASSIGNED',
      distributorId: ID.distXYZ, clientId: ID.clientNoor, typeId: tLPG454.id, fullCount: 1,
      destZoneId: ID.gZone, destLat: 33.6783, destLng: 73.0163, deliveryLabel: 'G-10/2 House 14',
      status: OrderStatus.ASSIGNED, driverId: ID.driverBilal, vehicleId: ID.vehicleB,
      originStoreId: ID.gStore, storeLat: 33.6883, storeLng: 73.0322,
    },
    // 6. PENDING (queued, dispatch worker will pick up)
    {
      label: 'S6 PENDING (awaiting dispatch)',
      distributorId: ID.distABC, clientId: ID.clientFatima, typeId: tLPG15.id, fullCount: 1,
      destZoneId: ID.fZone, destLat: 33.7177, destLng: 73.0535, deliveryLabel: 'F-7/2 House 24',
      status: OrderStatus.PENDING,
    },
    // 7. FAILED (client address inaccessible)
    {
      label: 'S7 FAILED (access blocked)',
      distributorId: ID.distABC, clientId: ID.clientHassan, typeId: tLPG118.id, fullCount: 2,
      destZoneId: ID.fZone, destLat: 33.6857, destLng: 73.0058, deliveryLabel: 'F-11/1 (gated)',
      status: OrderStatus.FAILED, driverId: ID.driverAhmad, vehicleId: ID.vehicleA,
      originStoreId: ID.fStore, storeLat: 33.7177, storeLng: 73.0535,
      cancellationReason: 'gated community, no access',
    },
    // 8. CANCELLED (distributor pulled the order)
    {
      label: 'S8 CANCELLED',
      distributorId: ID.distXYZ, clientId: ID.clientUsman, typeId: tLPG118.id, fullCount: 2,
      destZoneId: ID.fZone, destLat: 33.7095, destLng: 73.0405, deliveryLabel: 'F-8/4 Plot 102',
      status: OrderStatus.CANCELLED,
      cancellationReason: 'distributor cancelled before dispatch',
    },
    // 9. IN_TRANSIT (Farhan, second live trip)
    {
      label: 'S9 IN_TRANSIT (Farhan)',
      distributorId: ID.distABC, clientId: ID.clientSara, typeId: tLPG118.id, fullCount: 1,
      destZoneId: ID.fZone, destLat: 33.6911, destLng: 73.0184, deliveryLabel: 'F-10/3 House 5',
      status: OrderStatus.IN_TRANSIT, driverId: ID.driverFarhan, vehicleId: ID.vehicleD,
      originStoreId: ID.fStore, storeLat: 33.7177, storeLng: 73.0535,
    },
    // 10. ASSIGNED (Salman, second assigned trip)
    {
      label: 'S10 ASSIGNED (Salman)',
      distributorId: ID.distXYZ, clientId: ID.clientAhmed, typeId: tLPG118.id, fullCount: 2,
      destZoneId: ID.gZone, destLat: 33.6649, destLng: 73.0017, deliveryLabel: 'G-11/1 House 99',
      status: OrderStatus.ASSIGNED, driverId: ID.driverSalman, vehicleId: ID.vehicleE,
      originStoreId: ID.gStore, storeLat: 33.6883, storeLng: 73.0322,
    },
  ];

  let runningBalanceABC = 50_00000n;
  let runningBalanceXYZ = 30_00000n;

  for (const s of scenarios) {
    // Insert order. Cast every uuid parameter explicitly — Prisma sends
    // parameters as text by default and Postgres rejects them otherwise.
    const createdAtTs = new Date(
      Date.now() - (s.status === OrderStatus.DELIVERED ? 5 : 2) * HOUR,
    );
    const orderRows: { id: string }[] = await prisma.$queryRaw`
      INSERT INTO orders (
        id, distributor_id, client_id, delivery_address_label, dest_zone_id,
        origin_store_id, status, payment_status, delivery_fee_paisa,
        delivery_address, trip_id, cancellation_reason, created_at, updated_at
      )
      VALUES (
        gen_random_uuid(),
        ${s.distributorId}::uuid,
        ${s.clientId}::uuid,
        ${s.deliveryLabel},
        ${s.destZoneId}::uuid,
        ${s.originStoreId ?? null}::uuid,
        ${s.status}::"OrderStatus",
        'UNPAID'::"OrderPaymentStatus",
        0,
        ST_SetSRID(ST_MakePoint(${s.destLng}, ${s.destLat}), 4326),
        NULL,
        ${s.cancellationReason ?? null},
        ${createdAtTs},
        NOW()
      )
      RETURNING id
    `;
    const orderId = orderRows[0].id;
    await prisma.orderLine.create({
      data: {
        orderId,
        cylinderTypeId: s.typeId,
        fullCount: s.fullCount,
        expectedReturnCount: s.fullCount,
      },
    });

    // If there's a driver, set up trip
    if (s.driverId && s.vehicleId && s.originStoreId) {
      const tripStatus: TripStatus =
        s.status === OrderStatus.DELIVERED ? TripStatus.COMPLETED
        : s.status === OrderStatus.IN_TRANSIT ? TripStatus.IN_PROGRESS
        : s.status === OrderStatus.FAILED    ? TripStatus.COMPLETED
        : TripStatus.PLANNED;
      const trip = await prisma.trip.create({
        data: {
          driverId: s.driverId,
          vehicleId: s.vehicleId,
          originStoreId: s.originStoreId,
          status: tripStatus,
          plannedAt: new Date(s.deliveredAt ? s.deliveredAt.getTime() - 2 * HOUR : Date.now()),
          startedAt: s.status !== OrderStatus.ASSIGNED ? new Date(s.deliveredAt ? s.deliveredAt.getTime() - HOUR : Date.now() - HOUR) : null,
          completedAt: s.status === OrderStatus.DELIVERED ? s.deliveredAt : (s.status === OrderStatus.FAILED ? new Date() : null),
        },
      });

      // Update order with trip + originStore (raw SQL for location-touching tables fine)
      await prisma.order.update({ where: { id: orderId }, data: { tripId: trip.id } });

      // Trip stops via raw SQL (location column needs PostGIS)
      await prisma.$executeRaw`
        INSERT INTO trip_stops (id, trip_id, seq, stop_type, location, arrived_at, departed_at)
        VALUES (
          gen_random_uuid(), ${trip.id}::uuid, 0, 'STORE_PICKUP',
          ST_SetSRID(ST_MakePoint(${s.storeLng!}, ${s.storeLat!}), 4326),
          ${s.status === OrderStatus.DELIVERED ? new Date(s.deliveredAt!.getTime() - 90 * 60 * 1000) : null},
          ${s.status === OrderStatus.DELIVERED ? new Date(s.deliveredAt!.getTime() - 60 * 60 * 1000) : null}
        )
      `;
      await prisma.$executeRaw`
        INSERT INTO trip_stops (id, trip_id, order_id, seq, stop_type, location, arrived_at, departed_at)
        VALUES (
          gen_random_uuid(), ${trip.id}::uuid, ${orderId}::uuid, 1, 'DELIVERY',
          ST_SetSRID(ST_MakePoint(${s.destLng}, ${s.destLat}), 4326),
          ${s.status === OrderStatus.DELIVERED ? s.deliveredAt : null},
          ${s.status === OrderStatus.DELIVERED ? s.deliveredAt : null}
        )
      `;
    }

    // For delivered orders: compute fee, debit ledger
    if (s.status === OrderStatus.DELIVERED && s.originStoreId) {
      const originStore = await prisma.store.findUnique({ where: { id: s.originStoreId } });
      const rule = await prisma.pricingRule.findFirst({
        where: {
          cityId: ID.city,
          originZoneId: originStore!.zoneId,
          destZoneId: s.destZoneId,
          cylinderTypeId: s.typeId,
          effectiveUntil: null,
        },
      });
      if (rule) {
        const feePaisa = rule.basePaisa + rule.perUnitPaisa * BigInt(s.fullCount);
        const balanceField = s.distributorId === ID.distABC ? 'ABC' : 'XYZ';
        if (balanceField === 'ABC') runningBalanceABC -= feePaisa;
        else runningBalanceXYZ -= feePaisa;
        const newBalance = balanceField === 'ABC' ? runningBalanceABC : runningBalanceXYZ;

        await prisma.order.update({
          where: { id: orderId },
          data: { deliveryFeePaisa: feePaisa, paymentStatus: OrderPaymentStatus.PAID_VIA_LEDGER },
        });
        await prisma.ledgerEntry.create({
          data: {
            distributorId: s.distributorId,
            entryType: LedgerEntryType.DEBIT_ORDER,
            amountPaisa: -feePaisa,
            balanceAfterPaisa: newBalance,
            orderId,
            createdAt: s.deliveredAt!,
          },
        });

        // Custody events: SCAN_IN at store (already there), SCAN_OUT to vehicle, DELIVERED to client
        const cyls = await prisma.cylinder.findMany({
          where: {
            distributorId: s.distributorId,
            cylinderTypeId: s.typeId,
            custodyType: CustodyType.STORE,
            custodyId: s.originStoreId,
          },
          take: s.fullCount,
        });
        for (const cyl of cyls) {
          await prisma.cylinderEvent.create({
            data: {
              cylinderId: cyl.id,
              eventType: CylinderEventType.SCAN_OUT,
              fromCustodyType: CustodyType.STORE, fromCustodyId: s.originStoreId,
              toCustodyType: CustodyType.VEHICLE, toCustodyId: s.vehicleId!,
              actorUserId: s.driverId === ID.driverAhmad ? ID.driverAhmadUser : ID.driverBilalUser,
              tripId: (await prisma.order.findUnique({ where: { id: orderId } }))!.tripId!,
              orderId,
              createdAt: new Date(s.deliveredAt!.getTime() - 60 * 60 * 1000),
            },
          });
          await prisma.cylinderEvent.create({
            data: {
              cylinderId: cyl.id,
              eventType: CylinderEventType.DELIVERED,
              fromCustodyType: CustodyType.VEHICLE, fromCustodyId: s.vehicleId!,
              toCustodyType: CustodyType.CLIENT, toCustodyId: s.clientId,
              actorUserId: s.driverId === ID.driverAhmad ? ID.driverAhmadUser : ID.driverBilalUser,
              tripId: (await prisma.order.findUnique({ where: { id: orderId } }))!.tripId!,
              orderId,
              createdAt: s.deliveredAt!,
            },
          });
          await prisma.cylinder.update({
            where: { id: cyl.id },
            data: { custodyType: CustodyType.CLIENT, custodyId: s.clientId, state: CylinderState.EMPTY },
          });
        }
        // Adjust inventory lot counts
        await prisma.inventoryLot.upsert({
          where: {
            inventory_unique: {
              holderType: CustodyType.STORE, holderId: s.originStoreId,
              distributorId: s.distributorId, cylinderTypeId: s.typeId,
              state: CylinderState.FULL,
            },
          },
          update: { count: { decrement: s.fullCount } },
          create: {
            holderType: CustodyType.STORE, holderId: s.originStoreId,
            distributorId: s.distributorId, cylinderTypeId: s.typeId,
            state: CylinderState.FULL, count: 0,
          },
        });
      }
    }

    console.log(`  ✓ ${s.label}`);
  }

  // Persist new distributor balances
  await prisma.distributor.update({
    where: { id: ID.distABC },
    data: { advanceBalancePaisa: runningBalanceABC },
  });
  await prisma.distributor.update({
    where: { id: ID.distXYZ },
    data: { advanceBalancePaisa: runningBalanceXYZ },
  });

  // ---------------- Filling stations ----------------
  await prisma.fillingOrder.deleteMany({});
  await prisma.fillingStation.deleteMany({});
  const fillingStations: { id: string; name: string }[] = [];
  const stationSpecs = [
    { name: 'SNGPL Sihala Bottling Plant', address: 'Sihala Industrial Area',  lat: 33.5294, lng: 73.2106, price: 30000 }, // Rs 300
    { name: 'PSO Tarnol Filling Plant',    address: 'Tarnol Industrial Zone',  lat: 33.6736, lng: 72.8689, price: 28000 }, // Rs 280
    { name: 'OGRA Rawalpindi Plant',       address: 'Westridge II',            lat: 33.5870, lng: 72.9930, price: 32000 }, // Rs 320
  ];
  for (const s of stationSpecs) {
    const rows: { id: string }[] = await prisma.$queryRaw`
      INSERT INTO filling_stations (id, name, address, location, price_per_cylinder_paisa, is_active, created_at, updated_at)
      VALUES (
        gen_random_uuid(), ${s.name}, ${s.address},
        ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326),
        ${s.price}, TRUE, NOW(), NOW()
      ) RETURNING id
    `;
    fillingStations.push({ id: rows[0].id, name: s.name });
  }
  console.log(`  ✓ ${fillingStations.length} filling stations`);

  // 1 pending filling order for ABC LPG
  const fillingOrderABC = await prisma.fillingOrder.create({
    data: {
      distributorId: ID.distABC,
      fillingStationId: fillingStations[0].id,
      cylinderTypeId: tLPG118.id,
      requestedCount: 20,
      pricePerCylinderPaisa: BigInt(stationSpecs[0].price),
      totalCostPaisa: BigInt(stationSpecs[0].price * 20),
      pickupStoreId: ID.fStore,
    },
  });
  // 1 ASSIGNED filling order with Salman
  const fillingOrderXYZ = await prisma.fillingOrder.create({
    data: {
      distributorId: ID.distXYZ,
      fillingStationId: fillingStations[2].id,
      cylinderTypeId: tLPG118.id,
      requestedCount: 15,
      pricePerCylinderPaisa: BigInt(stationSpecs[2].price),
      totalCostPaisa: BigInt(stationSpecs[2].price * 15),
      pickupStoreId: ID.gStore,
      assignedDriverId: ID.driverSalman,
      assignedVehicleId: ID.vehicleE,
      status: 'ASSIGNED',
    },
  });
  console.log('  ✓ 2 filling orders (1 PENDING, 1 ASSIGNED to Salman)');

  // ---------------- Fuel refills ----------------
  await prisma.fuelRefill.deleteMany({
    where: { vehicleId: { in: [ID.vehicleA, ID.vehicleB, ID.vehicleD, ID.vehicleE] } },
  });
  // Set vehicle odometers
  await prisma.vehicle.update({ where: { id: ID.vehicleA }, data: { currentOdometerKm: 18450 } });
  await prisma.vehicle.update({ where: { id: ID.vehicleB }, data: { currentOdometerKm: 22130 } });
  await prisma.vehicle.update({ where: { id: ID.vehicleD }, data: { currentOdometerKm: 9870 } });
  await prisma.vehicle.update({ where: { id: ID.vehicleE }, data: { currentOdometerKm: 31200 } });

  // Recent fuel refill history (last 14 days)
  const refillSpecs = [
    { vehicleId: ID.vehicleA, driverId: ID.driverAhmad,  litres: 35, costPaisa: 1015000, odo: 18100, station: 'PSO F-10',      daysAgo: 12 }, // Rs 10,150
    { vehicleId: ID.vehicleA, driverId: ID.driverAhmad,  litres: 32, costPaisa:  928000, odo: 18300, station: 'PSO F-10',      daysAgo: 7  }, // Rs 9,280
    { vehicleId: ID.vehicleA, driverId: ID.driverAhmad,  litres: 28, costPaisa:  812000, odo: 18450, station: 'Shell Margalla', daysAgo: 2  }, // Rs 8,120
    { vehicleId: ID.vehicleB, driverId: ID.driverBilal,  litres: 40, costPaisa: 1160000, odo: 21950, station: 'PSO G-8',       daysAgo: 9  },
    { vehicleId: ID.vehicleB, driverId: ID.driverBilal,  litres: 38, costPaisa: 1102000, odo: 22130, station: 'PSO G-8',       daysAgo: 1  },
    { vehicleId: ID.vehicleD, driverId: ID.driverFarhan, litres: 30, costPaisa:  870000, odo: 9700,  station: 'Total F-7',     daysAgo: 5  },
    { vehicleId: ID.vehicleD, driverId: ID.driverFarhan, litres: 27, costPaisa:  783000, odo: 9870,  station: 'Total F-7',     daysAgo: 0  },
    { vehicleId: ID.vehicleE, driverId: ID.driverSalman, litres: 45, costPaisa: 1305000, odo: 31000, station: 'Attock G-11',   daysAgo: 6  },
    { vehicleId: ID.vehicleE, driverId: ID.driverSalman, litres: 32, costPaisa:  928000, odo: 31200, station: 'Attock G-11',   daysAgo: 0  },
  ];
  for (const r of refillSpecs) {
    await prisma.fuelRefill.create({
      data: {
        vehicleId: r.vehicleId,
        driverId: r.driverId,
        litres: r.litres,
        costPaisa: BigInt(r.costPaisa),
        odometerKm: r.odo,
        fuelStation: r.station,
        refillAt: new Date(now.getTime() - r.daysAgo * DAY),
      },
    });
  }
  console.log(`  ✓ ${refillSpecs.length} fuel refill records across 4 vehicles`);

  // ---------------- Alerts ----------------
  await prisma.alert.deleteMany({ where: { resourceType: 'Demo' } });
  await prisma.alert.create({
    data: {
      alertType: AlertType.LOW_STOCK,
      severity: AlertSeverity.WARNING,
      status: AlertStatus.OPEN,
      title: 'Low stock at G-Hub for XYZ Gas',
      body: 'Only 12 × 45.4 kg cylinders remain at G-Hub. Reorder soon to avoid stock-out.',
      resourceType: 'Demo',
      context: { storeId: ID.gStore, distributorId: ID.distXYZ, threshold: 20 },
    },
  });
  await prisma.alert.create({
    data: {
      alertType: AlertType.RECONCILIATION_MISMATCH,
      severity: AlertSeverity.INFO,
      status: AlertStatus.OPEN,
      title: 'Awaiting today\'s reconciliation from Bilal',
      body: 'Driver Bilal Hassan has not submitted today\'s end-of-day reconciliation.',
      resourceType: 'Demo',
    },
  });
  await prisma.alert.create({
    data: {
      alertType: AlertType.PAYMENT_FAILED,
      severity: AlertSeverity.CRITICAL,
      status: AlertStatus.OPEN,
      title: 'XYZ Gas balance approaching credit limit',
      body: 'XYZ Gas Distributors advance balance is below Rs 5,000. Recommend topping up before next dispatch to avoid orders being blocked.',
      resourceType: 'Demo',
      context: { distributorId: ID.distXYZ, currentBalancePaisa: Number(runningBalanceXYZ) },
    },
  });
  await prisma.alert.create({
    data: {
      alertType: AlertType.CYLINDER_LOST,
      severity: AlertSeverity.WARNING,
      status: AlertStatus.OPEN,
      title: 'Cylinder marked lost on yesterday\'s delivery',
      body: '1 × 11.8 kg cylinder from ABC LPG\'s yesterday delivery has not been returned. Investigate with client Fatima Khan.',
      resourceType: 'Demo',
      context: { distributorId: ID.distABC, clientId: ID.clientFatima },
    },
  });
  console.log('  ✓ 4 sample alerts (low stock, missing reconciliation, low balance, lost cylinder)');

  console.log('\n📋 Demo data summary');
  console.log(`   ABC LPG balance now: Rs. ${Number(runningBalanceABC) / 100}`);
  console.log(`   XYZ Gas balance now: Rs. ${Number(runningBalanceXYZ) / 100}`);
  console.log('   Orders by status:');
  console.log('     DELIVERED:  3  (1 yesterday + 2 today, ledger debited)');
  console.log('     IN_TRANSIT: 2  (active right now — visible on live map)');
  console.log('     ASSIGNED:   2  (dispatched, awaiting driver start)');
  console.log('     PENDING:    1  (queued — dispatch worker will pick up)');
  console.log('     FAILED:     1  (gated community)');
  console.log('     CANCELLED:  1  (distributor pulled)');
  console.log('\n👤 Login credentials');
  console.log(`   Admin:        +923000000000`);
  console.log(`   Distributor 1: ${PHONES.distABC}  (Bilal Ahmad / ABC LPG)`);
  console.log(`   Distributor 2: ${PHONES.distXYZ}  (Saima Iqbal / XYZ Gas)`);
  console.log(`   Driver 1:     ${PHONES.driverAhmad}   (Ahmad — online at F-Hub)`);
  console.log(`   Driver 2:     ${PHONES.driverBilal}   (Bilal — online at G-Hub)`);
  console.log(`   Driver 3:     ${PHONES.driverImran}   (Imran — on leave)`);
  console.log(`   Driver 4:     ${PHONES.driverFarhan}   (Farhan — IN_TRANSIT in F-8)`);
  console.log(`   Driver 5:     ${PHONES.driverSalman}   (Salman — ASSIGNED at G-Hub)\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
