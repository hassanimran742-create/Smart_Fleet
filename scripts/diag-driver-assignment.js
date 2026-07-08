/**
 * Smart_Fleet — driver assignment diagnostic.
 *
 * Tells you in one shot why the driver app doesn't show an order after admin
 * "Assign driver…" was clicked. Run INSIDE the api container so Prisma client
 * resolves and the env vars are wired:
 *
 *   sudo docker cp scripts/diag-driver-assignment.js \
 *       smartfleet-api-prod:/tmp/diag.js
 *   sudo docker exec smartfleet-api-prod node /tmp/diag.js +923335118111
 *
 * Pass the driver's phone number (E.164 with +). Defaults to +923002222222
 * (the seeded test driver).
 */

/* eslint-disable */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const phone = process.argv[2] || '+923002222222';

(async () => {
  console.log(`\n== Looking up driver with phone: ${phone} ==`);

  // 1. Driver record + linked user
  const driver = await p.driver.findFirst({
    where: { user: { phone } },
    include: { user: true, currentVehicle: true },
  });

  console.log('\n=== DRIVER RECORD ===');
  console.log(JSON.stringify({
    found: !!driver,
    driverId: driver?.id,
    userId: driver?.userId,
    phone: driver?.user?.phone,
    role: driver?.user?.role,
    status: driver?.user?.status,
    availability: driver?.availability,
    isOnline: driver?.isOnline,
    hasVehicle: !!driver?.currentVehicleId,
    vehiclePlate: driver?.currentVehicle?.plateNo,
  }, null, 2));

  if (!driver) {
    console.log('\nNO DRIVER — that phone has no driver record. Admin → Drivers, or User has wrong role.');
    process.exit(0);
  }

  // 2. Trips for this driver
  const trips = await p.trip.findMany({
    where: { driverId: driver.id },
    select: { id: true, status: true, plannedAt: true, createdAt: true, _count: { select: { orders: true, stops: true } } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('\n=== TRIPS FOR THIS DRIVER (top 5 newest) ===');
  console.log(JSON.stringify(trips, null, 2));

  // 3. Most recent orders (any distributor) — does any of them have a tripId?
  const orders = await p.order.findMany({
    select: {
      id: true,
      status: true,
      tripId: true,
      createdAt: true,
      trip: { select: { driverId: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('\n=== 5 NEWEST ORDERS (any distributor) ===');
  console.log(JSON.stringify(orders, null, 2));

  // 4. Concise verdict
  const hasTrip = trips.length > 0;
  const ordersForThisDriver = orders.filter((o) => o.trip?.driverId === driver.id);
  console.log('\n=== VERDICT ===');
  if (!driver.userId) {
    console.log('Driver has no linked user — assignment can never reach the app.');
  } else if (driver.user.role !== 'DRIVER') {
    console.log(`Linked user has role "${driver.user.role}" (not DRIVER). Driver app will not load this user's trips.`);
  } else if (driver.user.status !== 'ACTIVE') {
    console.log(`User status is "${driver.user.status}" — login is blocked. Activate in Drivers.`);
  } else if (!driver.currentVehicleId) {
    console.log('Driver has NO vehicle assigned. Assignment via the manual endpoint will be rejected. Assign one in Vehicles → Assign drivers tab.');
  } else if (!hasTrip) {
    console.log('Driver record is fine, but no Trip rows exist with this driverId.');
    console.log('Either the admin Assign click never actually created a trip (API endpoint missing or 5xx), or it created a trip for a different driverId.');
    if (orders.some((o) => o.tripId)) {
      console.log('Some recent orders have tripIds — those trips belong to a DIFFERENT driver. Likely wrong driver picked in the modal.');
    } else {
      console.log('No recent orders have tripIds at all — the assignment endpoint never succeeded.');
    }
  } else {
    console.log('Driver + trips look correct. If the driver app still shows nothing:');
    console.log('  1. The phone is logged in as a DIFFERENT user — sign out + OTP login again as ' + phone);
    console.log('  2. JWT was minted BEFORE the driverProfile was created — sign out + OTP login again');
    console.log('  3. App has cached the empty /trips/mine response — force-stop the app and reopen');
  }

  process.exit(0);
})().catch((e) => {
  console.error('Diagnostic failed:', e.message);
  process.exit(1);
});
