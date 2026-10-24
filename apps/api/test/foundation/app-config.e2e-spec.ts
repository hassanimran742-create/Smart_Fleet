/**
 * FND-001 (GET /app/config) and FND-010 (the 426 update gate): API_CONTRACT §1.2, §5.2, §6.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app';
import { http as client } from '../helpers/http';
import { authHeader } from '../helpers/auth';
import { describeDb } from '../helpers/describe-db';
import { createStandardData, type StandardData } from '../helpers/standard-data';

describeDb('foundation: public app config and the update gate', () => {
  let app: INestApplication;
  let std: StandardData;
  const previousEnv = process.env.APP_ENV;

  beforeAll(async () => {
    process.env.APP_ENV = 'test';
    app = await createTestApp();
    std = await createStandardData();
  });

  afterAll(async () => {
    await app?.close();
    if (previousEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousEnv;
  });

  const http = () => client(app);

  async function setMinVersion(variant: 'distributor' | 'driver', value: string): Promise<void> {
    await http()
      .patch(`/api/v1/settings/app.minVersion.${variant}`)
      .set(authHeader(std.SA1.actor))
      .send({ value, reason: 'Update gate test' })
      .expect(200);
  }

  it('FND-001 GET /app/config works without a token and returns the default public settings', async () => {
    const anonymous = await http().get('/api/v1/app/config').expect(200);
    const badToken = await http().get('/api/v1/app/config').set('Authorization', 'Bearer garbage').expect(200);
    for (const res of [anonymous, badToken]) {
      expect(res.headers['x-request-id']).toEqual(expect.any(String));
      const body = res.body;
      expect(body.features).toEqual({
        autoAssign: false,
        transfers: false,
        fuelRefills: false,
        accessories: false,
        support: false,
        clientApp: false,
        refills: true,
        // Increment 2 (API_CONTRACT §9.1): runs are on scans and typed numbers are on by default;
        // confirmations follow `confirmation.enabled`, false by default (ADR-15). Increment 3 (§6): day-end
        // is on by default once Inc 3 ships (`dayEnd.enabled` "false (true when Inc 3 ships)").
        scanFlow: true,
        confirmations: false,
        dayEnd: true,
        typedCylinderNumber: true,
        languageSwitch: false,
      });
      expect(body.minVersion).toEqual({ driver: '0.0.0', distributor: '0.0.0' });
      expect(body.orders).toEqual({ maxCylindersPerOrder: 30, deliveryStartedAt: 'FIRST_LOAD_SCAN' });
      expect(body.refill).toEqual({ maxCylinders: 30 });
      expect(body.day).toEqual({ timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' });
      expect(body.topup).toEqual({
        minPaisa: '50000',
        maxPaisa: '5000000',
        quickAmountsPaisa: ['200000', '500000', '1000000'],
        checkingHours: { from: '09:00', to: '21:00' },
      });
      expect(body.wallet).toEqual({ lowBalancePaisa: '100000', capPaisa: null });
      expect(body.support).toEqual({ phone: null, whatsApp: null, hours: '9am–9pm' });
      expect(body.environment).toBe('test');
      expect(body.training).toBe(false);
      expect(body.links).toEqual({ updateUrl: null });
      // Nothing that isn't public: no locked roles, OTP switch, mismatch policy, pending limit, reserved
      // settings or company account.
      expect(Object.keys(body).sort()).toEqual(
        ['day', 'environment', 'features', 'links', 'minVersion', 'orders', 'refill', 'support', 'topup', 'training', 'wallet'].sort(),
      );
      const text = JSON.stringify(body);
      for (const secret of ['lockedRoles', 'otpLogin', 'onAmountMismatch', 'maxPendingPerDistributor', 'secondApproval', 'deliveryCost', 'deliveryStrategy', 'iban', 'accountTitle']) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it('FND-010 the app-version gate answers 426 below the minimum and compares versions as numbers', async () => {
    const asShop = (version?: string) => {
      const req = http().get('/api/v1/users/me').set(authHeader(std.DA.actor));
      return version === undefined ? req : req.set('X-App-Variant', 'distributor').set('X-App-Version', version);
    };
    // Step 1.
    await asShop('0.1.0').expect(200);
    // Steps 2–3.
    await setMinVersion('distributor', '0.2.0');
    const refused = await asShop('0.1.0').expect(426);
    expect(refused.body).toMatchObject({ code: 'APP_UPDATE_REQUIRED', message: 'Please update the app to continue.' });
    await asShop('0.2.0').expect(200);
    await asShop('0.10.0').expect(200);
    // Step 4: the installed 0.1.0 app sends no headers; its token's role decides, and no version is 0.1.0.
    await asShop().expect(426);
    // Step 5: the driver minimum is still 0.0.0.
    await http()
      .get('/api/v1/trips/mine')
      .set(authHeader(std.DR1.actor))
      .set('X-App-Variant', 'driver')
      .set('X-App-Version', '0.1.0')
      .expect(200);
    // Step 6: an old app can still read the gate and the support details.
    await http().get('/api/v1/app/config').set('X-App-Variant', 'distributor').set('X-App-Version', '0.1.0').expect(200);
    // Step 7.
    await setMinVersion('distributor', '0.1.0');
    await asShop().expect(200);
    await setMinVersion('distributor', '0.1.1');
    await asShop().expect(426);
    // Step 8.
    await setMinVersion('distributor', '0.0.0');
    await asShop('0.1.0').expect(200);
    await asShop().expect(200);
  });

  it('FND-010 the health routes are never gated, for an old app either', async () => {
    await setMinVersion('distributor', '0.2.0');
    try {
      await http().get('/api/v1/health').set('X-App-Variant', 'distributor').set('X-App-Version', '0.1.0').expect(200);
      await http().get('/api/v1/health/live').set('X-App-Variant', 'distributor').set('X-App-Version', '0.1.0').expect(200);
    } finally {
      await setMinVersion('distributor', '0.0.0');
    }
  });
});
