/**
 * REVIEW (contract-compat): error paths the installed 0.1.0 apps can reach with their own bodies (no
 * X-App-* headers, no Idempotency-Key). Each answer must be the §2.1 envelope with a catalogue code and a
 * plain message (the old screens show `message`); none may be a 500. Writes the answers to the review
 * scratchpad for reading; the assertions are the contract's.
 */
import type { INestApplication } from '@nestjs/common';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createStandardData, type StandardData } from '../../helpers/standard-data';
import { setCompanyAccount } from '../../money/money-fixtures';

jest.setTimeout(120_000);
const API = '/api/v1';
const OUT =
  'C:/Users/Experts/AppData/Local/Temp/claude/d--smart-fleet/57654f05-d43e-46ff-b258-2d1d56cada85/scratchpad/review/contract-compat/error-paths.json';

describeDb('REVIEW contract-compat: installed-app error paths', () => {
  let app: INestApplication;
  let std: StandardData;
  const seen: Record<string, { status: number; code?: string; message?: string; details?: unknown }> = {};

  beforeAll(async () => {
    app = await createTestApp();
    app.get(SettingsService).invalidate();
    std = await createStandardData({ cylinders: true });
    await setCompanyAccount(app);
  });

  afterAll(async () => {
    fs.writeFileSync(OUT, JSON.stringify(seen, null, 1));
    await app?.close();
  });

  const shop = () => ({ ...authHeader(std.DA.actor), 'Content-Type': 'application/json' });
  const driver = () => ({ ...authHeader(std.DR1.actor), 'Content-Type': 'application/json' });

  async function record(name: string, req: PromiseLike<{ status: number; body: { code?: string; message?: string; details?: unknown } }>) {
    const res = await req;
    seen[name] = { status: res.status, code: res.body?.code, message: res.body?.message, details: res.body?.details };
    return res;
  }

  it('none of the reachable error paths answers 500, and each carries a catalogue code and a plain message', async () => {
    const unknown = randomUUID();
    const placed = await http(app)
      .post(`${API}/orders`)
      .set(shop())
      .send({ clientId: std.C1.id, deliveryLabel: 'x', deliveryLocation: { lat: 31.53, lng: 74.23 }, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }] })
      .expect(201);

    // PlaceOrderScreen.tsx:131 variants.
    await record('order-unknown-size', http(app).post(`${API}/orders`).set(shop()).send({ clientId: std.C1.id, deliveryLabel: 'x', deliveryLocation: { lat: 31.53, lng: 74.23 }, lines: [{ cylinderTypeId: unknown, fullCount: 1, expectedReturnCount: 1 }] }));
    await record('order-other-shops-client', http(app).post(`${API}/orders`).set(shop()).send({ clientId: std.C3.id, deliveryLabel: 'x', deliveryLocation: { lat: 31.53, lng: 74.23 }, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }] }));
    await record('order-outside', http(app).post(`${API}/orders`).set(shop()).send({ clientId: std.C1.id, deliveryLabel: 'x', deliveryLocation: std.outside, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }] }));
    await record('order-31-cylinders', http(app).post(`${API}/orders`).set(shop()).send({ clientId: std.C1.id, deliveryLabel: 'x', deliveryLocation: { lat: 31.53, lng: 74.23 }, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 31, expectedReturnCount: 0 }] }));
    await record('order-long-label', http(app).post(`${API}/orders`).set(shop()).send({ clientId: std.C1.id, deliveryLabel: 'x'.repeat(300), deliveryLocation: { lat: 31.53, lng: 74.23 }, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }] }));
    // AddClientScreen.tsx:93,104 variants.
    await record('client-bad-phone', http(app).post(`${API}/clients`).set(shop()).send({ name: 'A', phone: '+92300123', address: '', area: '', city: 'Islamabad', creditLimitRs: 0, priority: 3, notes: '' }));
    await record('client-dup-phone', http(app).post(`${API}/clients`).set(shop()).send({ name: 'A', phone: '+923001234567', address: '', area: '', city: 'Islamabad', creditLimitRs: 0, priority: 3, notes: '' }));
    await record('client-long-area', http(app).post(`${API}/clients`).set(shop()).send({ name: 'A', phone: '+923001234500', address: '', area: 'y'.repeat(90), city: 'Islamabad', creditLimitRs: 0, priority: 3, notes: '' }));
    await record('address-unpriced', http(app).post(`${API}/clients/${std.C1.id}/addresses`).set(shop()).send({ label: 'East house', lat: std.zones.East.center.lat, lng: std.zones.East.center.lng }));
    await record('address-other-shop', http(app).post(`${API}/clients/${std.C3.id}/addresses`).set(shop()).send({ label: 'x', lat: 31.53, lng: 74.23 }));
    await record('address-undefined-id', http(app).post(`${API}/clients/undefined/addresses`).set(shop()).send({ label: 'x', lat: 31.53, lng: 74.23 }));
    // TrackOrderScreen / TopupScreen / RequestFillingScreen variants.
    await record('tracking-unknown', http(app).get(`${API}/orders/${unknown}/tracking`).set(shop()));
    await record('topup-small', http(app).post(`${API}/payments/topup`).set(shop()).send({ amountPaisa: 10000, provider: 'BANK_MANUAL' }));
    await record('topup-paisa', http(app).post(`${API}/payments/topup`).set(shop()).send({ amountPaisa: 100050, provider: 'BANK_MANUAL' }));
    await record('bank-proof-unknown', http(app).post(`${API}/payments/${unknown}/bank-proof`).set(shop()).send({ proofUrl: 'http://x/uploads/a.jpg' }));
    await record('bank-proof-null-url', http(app).post(`${API}/payments/${unknown}/bank-proof`).set(shop()).send({ proofUrl: null }));
    await record('refill-diy', http(app).post(`${API}/filling-orders`).set(shop()).send({ cylinderTypeId: std.sizes.kg11_8, requestedCount: 2, serviceType: 'DIY', ownStationName: 'Mine', ownStationAddress: '', ownStationNotes: '' }));
    await record('refill-unknown-station', http(app).post(`${API}/filling-orders`).set(shop()).send({ fillingStationId: unknown, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2, serviceType: 'OUR_SERVICE' }));
    await record('refill-too-many', http(app).post(`${API}/filling-orders`).set(shop()).send({ fillingStationId: unknown, cylinderTypeId: std.sizes.kg11_8, requestedCount: 31, serviceType: 'OUR_SERVICE' }));
    // Driver: ScanScreen.tsx:58 / DeliveryStepsScreen.tsx / FillingOrdersScreen.tsx variants.
    await record('scan-from-home-no-trip', http(app).post(`${API}/custody/scan`).set(driver()).send({ qrCode: 'AG-C0001-QR', eventType: 'SCAN_OUT' }));
    await record('scan-unknown-trip', http(app).post(`${API}/custody/scan`).set(driver()).send({ qrCode: 'AG-C0001-QR', eventType: 'SCAN_OUT', tripId: unknown, orderId: null }));
    await record('scan-returned-to-distributor', http(app).post(`${API}/custody/scan`).set(driver()).send({ qrCode: 'AG-C0001-QR', eventType: 'RETURNED_TO_DISTRIBUTOR', tripId: unknown }));
    await record('delivered-unknown-order', http(app).patch(`${API}/orders/${unknown}/status`).set(driver()).send({ status: 'DELIVERED' }));
    await record('delivered-undefined-order', http(app).patch(`${API}/orders/undefined/status`).set(driver()).send({ status: 'DELIVERED' }));
    await record('delivered-not-on-trip', http(app).patch(`${API}/orders/${placed.body.id}/status`).set(driver()).send({ status: 'DELIVERED' }));
    await record('arrive-unknown-stop', http(app).patch(`${API}/trips/stops/${unknown}/arrive`).set(driver()));
    await record('trip-unknown', http(app).get(`${API}/trips/${unknown}`).set(driver()));
    await record('trip-status-unknown', http(app).patch(`${API}/trips/${unknown}/status`).set(driver()).send({ status: 'IN_PROGRESS' }));
    await record('refill-step-unknown', http(app).patch(`${API}/filling-orders/${unknown}/picked-empties`).set(driver()).send({ emptyCount: 2 }));
    await record('refill-step-fraction', http(app).patch(`${API}/filling-orders/${unknown}/picked-empties`).set(driver()).send({ emptyCount: 2.5 }));
    await record('fuel-refill-off', http(app).post(`${API}/fuel-refills`).set(driver()).send({ vehicleId: std.DR1.vehicleId, litres: 10, costPaisa: 300000, odometerKm: 100 }));
    await record('reconciliation-old', http(app).post(`${API}/reconciliations`).set(driver()).send({ forDate: '2026-10-22', submittedCashPaisa: 0, cylindersDelivered: 0, cylindersReturned: 0 }));
    await record('driver-profile-save', http(app).patch(`${API}/users/me`).set(driver()).send({ name: 'Kashif', email: '', phone: '+923451000001', cnic: '' }));

    const fiveHundreds = Object.entries(seen).filter(([, v]) => v.status >= 500);
    expect(fiveHundreds).toEqual([]);
    for (const [name, v] of Object.entries(seen)) {
      if (v.status < 400) continue;
      expect([name, typeof v.code, typeof v.message]).toEqual([name, 'string', 'string']);
      expect([name, /\{\{|undefined|null/.test(v.message as string)]).toEqual([name, false]);
    }
  });
});
