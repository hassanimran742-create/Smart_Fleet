/**
 * Review 23 (robustness, jobs and operations): Inc 2/3 bodies holding a lone UTF-16 surrogate (half of an
 * emoji, as a text cut at a code-unit limit or a damaged label leaves it) answer 500 INTERNAL_ERROR. The
 * shared `textSchema` and `cylinderCodeSchema` refuse a NUL (the Inc 1 fix) but not a lone surrogate;
 * JSON.parse keeps it, and Prisma's query engine then refuses the whole query ("lone leading surrogate in
 * hex escape"), which the filter maps to 500. API_CONTRACT §2.2: bad input is VALIDATION_FAILED; only
 * "anything else" is INTERNAL_ERROR. A driver's phone treats the 500 as "Not saved" and resends the same
 * scan id, which fails the same way every time.
 *
 * Each case expects a 4xx; the failing ones show the 500.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { createConfirmation, customerLinks, dayEndCalls, describeDb, getTestPrisma } from '../../helpers';
import { http } from '../../helpers/http';
import { DayEndCore } from '../../../src/modules/day-end/day-end-core';
import { buildWorld, Y1, type World } from '../../inc2/scan/support/world';
import { stubStorage } from '../../inc3/dayend/support';

/** "…forgot 😀 the label" with the emoji's second half cut off. */
const LONE = 'Driver forgot \ud83d the label at the gate';

function statusAndCode(res: { status: number; body: { code?: string } }): { status: number; code: string | undefined } {
  return { status: res.status, code: res.body?.code };
}

describeDb('review23 robustness: a lone surrogate in an Inc 2/3 body answers 500', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
    // Object storage answers every command, as the day-end suites stub it (no MinIO here).
    stubStorage(app);
    w = await buildWorld(app);
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it('POST /trips/:tripId/scans with such a QR value is a 4xx (driver LOAD)', async () => {
    const order = await w.placeOrder(Y1);
    const trip = await w.assign(order, w.std.DR1);
    const res = await w.scans.tripScan(w.std.DR1, trip.id, { stopId: trip.pickupStopId, action: 'LOAD', code: 'STD_11_8KG-\ud800' });
    expect(statusAndCode(res).status).toBeLessThan(500);
  });

  it('POST /store/scans with such a QR value is a 4xx (the shop receive)', async () => {
    const res = await w.scans.storeScan(w.std.DA, { code: 'STD_11_8KG-\udc00' });
    expect(statusAndCode(res).status).toBeLessThan(500);
  });

  it('POST /orders/:id/manual-delivery with such a reason is a 400 (office)', async () => {
    const order = await w.placeOrder(Y1, 'C2');
    await w.assign(order, w.std.DR2);
    const res = await w.scans.manualDelivery(w.std.SA1, order.id, { reason: LONE, cylinders: [{ code: w.ag(5).shortCode }] });
    expect(statusAndCode(res)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('PATCH /clients/:id with such a name or note is a 400 (the shop edits a customer)', async () => {
    const name = await w.as(w.std.DA).patch(`/clients/${w.std.C1.id}`).send({ name: 'Sana \ud83d' });
    const notes = await w.as(w.std.DA).patch(`/clients/${w.std.C1.id}`).send({ notes: LONE });
    expect([statusAndCode(name), statusAndCode(notes)]).toEqual([
      { status: 400, code: 'VALIDATION_FAILED' },
      { status: 400, code: 'VALIDATION_FAILED' },
    ]);
  });

  it('POST /alerts/:id/resolve with such a note is a 400 (the office closes a case)', async () => {
    await w.setting('confirmation.enabled', true);
    const order = await w.placeOrder(Y1);
    await getTestPrisma().order.update({ where: { id: order.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    const link = await createConfirmation({ order: { ...order, distributorId: w.std.DA.id } });
    const links = customerLinks(app);
    expect((await links.answer(link.token, 'NO')).status).toBe(303);
    const alert = await getTestPrisma().alert.findFirstOrThrow({ where: { alertType: 'CUSTOMER_PROBLEM', resourceId: order.id } });
    const res = await links.resolveCase(w.std.SA1, alert.id, LONE);
    expect(statusAndCode(res)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('POST /day-end/:date/submit with such a note is a 400, and so is a send-back reason (Inc 3)', async () => {
    const days = dayEndCalls(app);
    const date = await app.get(DayEndCore).today();
    const sheet = await days.sheet(w.std.DA, date);
    expect(sheet.status).toBe(200);
    const upload = await days.upload(w.std.DA, date, sheet.body as Buffer);
    expect(upload.status).toBe(200);
    const submit = await days.submit(w.std.DA, date, { version: upload.body.version, note: LONE });
    const fine = await days.submit(w.std.DA, date, { version: upload.body.version, note: 'All counted' });
    expect(fine.status).toBe(200);
    const day = await getTestPrisma().dayClose.findFirstOrThrow({ where: { distributorId: w.std.DA.id } });
    const sendBack = await days.sendBack(w.std.SA1, day.id, { reason: LONE });
    expect([statusAndCode(submit), statusAndCode(sendBack)]).toEqual([
      { status: 400, code: 'VALIDATION_FAILED' },
      { status: 400, code: 'VALIDATION_FAILED' },
    ]);
  });

  it('POST /c/:token with such a comment (posted as JSON) is not the 500 page', async () => {
    const order = await w.placeOrder(Y1, 'C2');
    await getTestPrisma().order.update({ where: { id: order.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    const link = await createConfirmation({ order: { ...order, distributorId: w.std.DA.id } });
    const res = await http(app)
      .post(link.path)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ answer: 'NO', comment: LONE }));
    expect(res.status).toBeLessThan(500);
  });
});
