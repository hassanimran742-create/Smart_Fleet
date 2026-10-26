/**
 * Regression test for review finding contract-compat-03 (API_CONTRACT §1.3, CHANGELOG G15-07): "A
 * cursor this list didn't make gives 400 VALIDATION_FAILED on `cursor`." Before the fix, cursors were
 * bare base64url `[sortKey, id]`, so another list with the same key shape took them and silently paged
 * from that position (rows went missing with no error).
 */
import type { INestApplication } from '@nestjs/common';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { describeDb } from '../helpers/describe-db';
import { http, type TestResponse } from '../helpers/http';
import { createStandardData, x1OrderBody, x2OrderBody, type StandardData } from '../helpers/standard-data';

const API = '/api/v1';

describeDb('cursors from another list', () => {
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

  const onCursor = (res: TestResponse) => ({ status: res.status, code: res.body.code, field: res.body.details?.fields?.[0]?.path });

  it('REV contract-compat-03 a cursor is refused by every other list and tab, and still pages its own list', async () => {
    const shop = authHeader(std.DA.actor);
    const office = authHeader(std.SA1.actor);
    const first = await http(app).post(`${API}/orders`).set(shop).send(x1OrderBody(std)).expect(201);
    const second = await http(app).post(`${API}/orders`).set(shop).send(x2OrderBody(std)).expect(201);

    const page1 = await http(app).get(`${API}/orders?tab=active&limit=1`).set(shop).expect(200);
    const cursor: string = page1.body.nextCursor;
    expect(typeof cursor).toBe('string');

    const refused = { status: 400, code: 'VALIDATION_FAILED', field: 'cursor' };
    expect({
      statement: onCursor(await http(app).get(`${API}/wallet/statement?cursor=${cursor}`).set(shop)),
      doneTab: onCursor(await http(app).get(`${API}/orders?tab=done&cursor=${cursor}`).set(shop)),
      board: onCursor(await http(app).get(`${API}/orders/board?tab=all&cursor=${cursor}`).set(office)),
      topups: onCursor(await http(app).get(`${API}/admin/topups?tab=all&cursor=${cursor}`).set(office)),
      activity: onCursor(await http(app).get(`${API}/audit-logs?cursor=${cursor}`).set(office)),
    }).toEqual({ statement: refused, doneTab: refused, board: refused, topups: refused, activity: refused });

    // Its own list takes it: the second page holds the other order and ends the list.
    const page2 = await http(app).get(`${API}/orders?tab=active&limit=1&cursor=${cursor}`).set(shop).expect(200);
    const seen = [...page1.body.items, ...page2.body.items].map((order: { id: string }) => order.id).sort();
    expect(seen).toEqual([first.body.id, second.body.id].sort());
    expect(page2.body.nextCursor).toBeNull();
  });
});
