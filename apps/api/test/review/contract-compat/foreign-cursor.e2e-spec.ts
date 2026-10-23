/**
 * REVIEW (contract-compat): API_CONTRACT §1.3 (G15-07) — "A cursor this list didn't make gives 400
 * VALIDATION_FAILED on `cursor`." Cursors used to be bare base64url `[sortKey, id]` with no list tag, so
 * any list with the same key shape accepted another list's cursor and silently paged from that position.
 *
 * Fixed (contract-compat-03, common/pagination/cursor.ts): a cursor carries the tag of the list (path and
 * tab) that made it, so another list or tab refuses it with 400 on `cursor`.
 */
import type { INestApplication } from '@nestjs/common';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createStandardData, x1OrderBody, x2OrderBody, type StandardData } from '../../helpers/standard-data';

const API = '/api/v1';

describeDb('REVIEW contract-compat: a cursor from another list', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
    app.get(SettingsService).invalidate();
    std = await createStandardData();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the order list cursor is refused by the wallet statement and by the "done" tab (400 on cursor), as a garbage one is', async () => {
    const shop = authHeader(std.DA.actor);
    await http(app).post(`${API}/orders`).set(shop).send(x1OrderBody(std)).expect(201);
    await http(app).post(`${API}/orders`).set(shop).send(x2OrderBody(std)).expect(201);

    const page1 = await http(app).get(`${API}/orders?tab=active&limit=1`).set(shop).expect(200);
    const orderCursor: string = page1.body.nextCursor;
    expect(typeof orderCursor).toBe('string');

    // A garbage cursor is refused, as §1.3 says…
    const garbage = await http(app).get(`${API}/wallet/statement?cursor=bm90LWEtY3Vyc29y`).set(shop);
    expect(garbage.status).toBe(400);
    expect(garbage.body.details.fields[0]).toMatchObject({ path: 'cursor' });

    // …and so is the orders list's cursor, by the statement and by the "done" tab: no rows silently skipped.
    const statement = await http(app).get(`${API}/wallet/statement?cursor=${orderCursor}`).set(shop);
    const done = await http(app).get(`${API}/orders?tab=done&cursor=${orderCursor}`).set(shop);
    const seen = (res: { status: number; body: { code?: string; details?: { fields?: Array<{ path: string }> } } }) => ({
      status: res.status,
      code: res.body.code,
      field: res.body.details?.fields?.[0]?.path,
    });
    const refused = { status: 400, code: 'VALIDATION_FAILED', field: 'cursor' };
    expect({ statement: seen(statement), done: seen(done) }).toEqual({ statement: refused, done: refused });

    // Its own list still pages with it.
    await http(app).get(`${API}/orders?tab=active&limit=1&cursor=${orderCursor}`).set(shop).expect(200);
  });
});
