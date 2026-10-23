/**
 * REVIEW (contract-compat): `features.transfers` is off (API_CONTRACT §3.4), yet `GET /trips/next-suggestions`
 * used to list a legacy open transfer to the installed driver app, and the single-transfer GET it then
 * opens answered `[]` instead of an object. The installed TransferDetailScreen.tsx (git HEAD) reads
 * `t.lines.length` from that answer, so it threw while rendering and closed the app.
 *
 * Fixed (contract-compat-01):
 * - the suggestions skip transfers while the module is off, which removes the only way into that screen
 *   (HomeScreen "Nearby orders"); with the module on they are listed as before;
 * - a single-transfer GET while off answers 403 FEATURE_DISABLED with `X-Feature-Disabled: transfers`
 *   instead of `[]`: only lists answer `[]` (§3.4), and the old screen then stays on "Loading…". (That
 *   part is the FeatureListInterceptor's, common/features/feature.ts.)
 */
import type { INestApplication } from '@nestjs/common';
import { systemActor } from '../../../src/common/auth/actor';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createStandardData, type StandardData } from '../../helpers/standard-data';

const API = '/api/v1';

describeDb('REVIEW contract-compat: switched-off transfers reach the installed driver app', () => {
  let app: INestApplication;
  let std: StandardData;
  let transferId: string;
  const db = () => getTestPrisma();
  const h = () => ({ ...authHeader(std.DR1.actor), 'Content-Type': 'application/json' });
  const transfersSwitch = (on: boolean) =>
    app.get(SettingsService).set('features.transfers', on, systemActor('cli:settings'), 'review: transfers switch', { allowNotEditable: true });

  beforeAll(async () => {
    app = await createTestApp();
    app.get(SettingsService).invalidate();
    std = await createStandardData({ cylinders: true });
    // A transfer left open from before the switch-over (the checklist closes orders and refills, not transfers).
    const transfer = await db().transfer.create({
      data: {
        fromStoreId: std.DA.homeStoreId,
        toStoreId: std.DB.homeStoreId,
        driverId: std.DR1.id,
        vehicleId: std.DR1.vehicleId,
        status: 'REQUESTED',
        requestedBy: std.SA1.id,
      },
    });
    transferId = transfer.id;
    // The installed app reports the driver's position every 15 s (useLiveLocation.ts).
    await db().$executeRaw`UPDATE drivers SET current_location = ST_SetSRID(ST_MakePoint(74.221, 31.521), 4326) WHERE id = ${std.DR1.id}::uuid`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('REV contract-compat-01 a legacy REQUESTED transfer is not suggested while transfers are off', async () => {
    // The module is switched off: the list is empty and says so.
    const mine = await http(app).get(`${API}/transfers/mine`).set(h()).expect(200);
    expect(mine.body).toEqual([]);
    expect(mine.headers['x-feature-disabled']).toBe('transfers');

    // HomeScreen.tsx:26,107-113 — "Nearby orders" must not offer it: a tap would open TransferDetail.
    const suggestions = await http(app).get(`${API}/trips/next-suggestions`).set(h()).expect(200);
    expect(suggestions.body.filter((s: { kind: string }) => s.kind === 'TRANSFER')).toEqual([]);
  });

  it('REV contract-compat-01 with transfers switched on, the same transfer is suggested as before', async () => {
    await transfersSwitch(true);
    try {
      const suggestions = await http(app).get(`${API}/trips/next-suggestions`).set(h()).expect(200);
      expect(suggestions.body.filter((s: { kind: string; id: string }) => s.kind === 'TRANSFER').map((s: { id: string }) => s.id)).toEqual([transferId]);
    } finally {
      await transfersSwitch(false);
    }
  });

  it('REV contract-compat-01 a single-transfer GET while off is refused (403 FEATURE_DISABLED), never answered with [] the old screen crashes on', async () => {
    // TransferDetailScreen.tsx:56,61 — the two reads it makes.
    const detail = await http(app).get(`${API}/transfers/${transferId}`).set(h());
    const progress = await http(app).get(`${API}/transfers/${transferId}/progress`).set(h());
    const seen = (res: { status: number; body: { code?: string }; headers: Record<string, string> }) => ({
      status: res.status,
      code: res.body.code,
      header: res.headers['x-feature-disabled'],
    });
    expect({ detail: seen(detail), progress: seen(progress) }).toEqual({
      detail: { status: 403, code: 'FEATURE_DISABLED', header: 'transfers' },
      progress: { status: 403, code: 'FEATURE_DISABLED', header: 'transfers' },
    });
  });
});
