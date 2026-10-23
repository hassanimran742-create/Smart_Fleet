/**
 * Regression test for review finding contract-compat-04 (README rule 2: DTO types live in shared-types
 * and apps never redefine them): the shared `SafeUserDto` (`GET /users/me`) and `TripViewDto` /
 * `TripStopDto` (`GET /trips/:id`, API_CONTRACT §7.7) name what the server really sends. The key lists
 * below are checked against the types at compile time (`satisfies Record<keyof …>`), so a field added
 * to a DTO must also come from the server, and a secret or stray field in `GET /users/me` fails here.
 */
import type { INestApplication } from '@nestjs/common';
import type { SafeUserDistributorProfile, SafeUserDriverProfile, SafeUserDto, TripStopDto, TripViewDto } from '@smartfleet/shared-types';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, x1OrderBody, type StandardData } from '../helpers/standard-data';

const SAFE_USER_KEYS = {
  id: true,
  phone: true,
  email: true,
  name: true,
  role: true,
  status: true,
  profilePictureUrl: true,
  createdAt: true,
  updatedAt: true,
  hasPassword: true,
  distributorProfile: true,
  driverProfile: true,
} satisfies Record<keyof SafeUserDto, true>;
const DISTRIBUTOR_PROFILE_KEYS = { id: true, businessName: true, code: true, status: true, homeStoreId: true } satisfies Record<keyof SafeUserDistributorProfile, true>;
const DRIVER_PROFILE_KEYS = {
  id: true,
  licenceNo: true,
  availability: true,
  isOnline: true,
  currentVehicleId: true,
  currentVehicle: true,
} satisfies Record<keyof SafeUserDriverProfile, true>;
const TRIP_KEYS = {
  id: true,
  driverId: true,
  vehicleId: true,
  originStoreId: true,
  status: true,
  plannedAt: true,
  startedAt: true,
  completedAt: true,
  stops: true,
  orders: true,
  originStore: true,
  vehicle: true,
  driver: true,
  allowedActions: true,
} satisfies Record<keyof TripViewDto, true>;
const STOP_KEYS = {
  id: true,
  tripId: true,
  orderId: true,
  storeId: true,
  seq: true,
  stopType: true,
  status: true,
  location: true,
  etaAt: true,
  arrivedAt: true,
  departedAt: true,
  completedAt: true,
  cancelledAt: true,
  notes: true,
  allowedActions: true,
} satisfies Record<keyof TripStopDto, true>;

const sorted = (keys: object) => Object.keys(keys).sort();

describeDb('shared DTOs match the server', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('REV contract-compat-04 GET /users/me sends exactly the shared SafeUserDto, for a shop and for a driver', async () => {
    const shop = (await http(app).get('/api/v1/users/me').set(authHeader(std.DA.actor)).expect(200)).body as SafeUserDto;
    expect(sorted(shop)).toEqual(sorted(SAFE_USER_KEYS));
    expect(sorted(shop.distributorProfile as object)).toEqual(sorted(DISTRIBUTOR_PROFILE_KEYS));
    expect({ driverProfile: shop.driverProfile, createdAt: typeof shop.createdAt, hasPassword: typeof shop.hasPassword }).toEqual({
      driverProfile: null,
      createdAt: 'string',
      hasPassword: 'boolean',
    });
    const driver = (await http(app).get('/api/v1/users/me').set(authHeader(std.DR1.actor)).expect(200)).body as SafeUserDto;
    expect(sorted(driver)).toEqual(sorted(SAFE_USER_KEYS));
    expect(sorted(driver.driverProfile as object)).toEqual(sorted(DRIVER_PROFILE_KEYS));
    expect(driver.distributorProfile).toBeNull();
  });

  it('REV contract-compat-04 GET /trips/:id sends every field of the shared TripViewDto and TripStopDto', async () => {
    const order = await http(app).post('/api/v1/orders').set(authHeader(std.DA.actor)).send(x1OrderBody(std)).expect(201);
    await http(app).post(`/api/v1/orders/${order.body.id}/assign-driver`).set(authHeader(std.SA1.actor)).send({ driverId: std.DR1.id }).expect(200);
    const tripId = (await http(app).get(`/api/v1/orders/${order.body.id}`).set(authHeader(std.DR1.actor)).expect(200)).body.trip.id as string;
    const trip = (await http(app).get(`/api/v1/trips/${tripId}`).set(authHeader(std.DR1.actor)).expect(200)).body as TripViewDto;
    expect(Object.keys(trip)).toEqual(expect.arrayContaining(sorted(TRIP_KEYS)));
    expect(trip.stops.length).toBeGreaterThan(0);
    for (const stop of trip.stops) {
      expect(Object.keys(stop)).toEqual(expect.arrayContaining(sorted(STOP_KEYS)));
      expect({ lat: typeof stop.location?.lat, lng: typeof stop.location?.lng, actions: Array.isArray(stop.allowedActions) }).toEqual({
        lat: 'number',
        lng: 'number',
        actions: true,
      });
    }
    expect(Array.isArray(trip.allowedActions)).toBe(true);
    expect(trip.orders.map((o) => o.id)).toEqual([order.body.id]);
  });
});
