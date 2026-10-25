/**
 * [Inc 2/3 UI gate] `GET /store/incoming` lists what is coming back (API_CONTRACT §9.4; UX_MOBILE §7.3
 * S13: Home's "3 coming back", "0 of 2 received"). Cylinders out for delivery, loaded for an order still
 * to be delivered (loading or on the way), aren't coming back: the list leaves them out. Taken-back,
 * not-delivered (could not deliver) and spare cylinders always show, and the store can still receive any
 * cylinder (STR-009). Read only: nothing moves, no money.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, X2, Y1, type Line, type World } from '../scan/support/world';

jest.setTimeout(180_000);

/** X1 with its returns expected: 2 × 11.8 kg and 1 × 45.4 kg, 1 back. */
const X1_BACK: Line[] = [
  { size: '11.8', full: 2, back: 1 },
  { size: '45.4', full: 1 },
];

interface IncomingVan {
  vehicle: { plateNo: string };
  cylinders: Array<{ shortCode: string; came: string }>;
  counts: { total: number; received: number };
}

describeDb('Inc 2/3 UI gate: the store\'s incoming list is what is coming back', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    w = await buildWorld(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const vans = async (): Promise<IncomingVan[]> => (await w.scans.storeIncoming(w.std.DA).expect(200)).body.vans;
  const codes = (van: IncomingVan | undefined) => (van?.cylinders ?? []).map((c) => `${c.shortCode} ${c.came}`).sort();

  it('API §9.4 a van loading or out for delivery lists only what is coming back', async () => {
    const { std, scans } = w;
    await w.withCustomer(11, 'C1');
    const x1 = await w.placeOrder(X1_BACK);
    const x2 = await w.placeOrder(X2, 'C2');
    const t1 = await w.assign(x1, std.DR1);
    await w.assign(x2, std.DR1);

    // Loading at the store: nothing is coming back yet.
    await w.load(std.DR1, t1, [1, 2]);
    expect(await vans()).toEqual([]);

    // On the way: nothing is coming back yet, so the van isn't listed.
    await w.load(std.DR1, t1, [31, 21, 22, 23]);
    await w.doneLoading(std.DR1, t1);
    expect(await vans()).toEqual([]);

    // Sana's visit: the cylinder taken back is coming back; Usman's three are still out for delivery.
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    await w.takeBack(std.DR1, t1, x1, 11, 'EMPTY');
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);
    let [van] = await vans();
    expect(van).toMatchObject({ vehicle: { plateNo: 'LEA-101' }, counts: { total: 1, received: 0 } });
    expect(codes(van)).toEqual(['AG-C0011 TAKEN_BACK']);

    // Usman isn't home: his three come back too.
    await scans.failOrder(std.DR1, x2.id, { reasonCode: 'CUSTOMER_NOT_HOME' }).expect(200);
    [van] = await vans();
    expect(van.counts).toMatchObject({ total: 4, received: 0 });
    expect(codes(van)).toEqual(['AG-C0011 TAKEN_BACK', 'AG-C0021 NOT_DELIVERED', 'AG-C0022 NOT_DELIVERED', 'AG-C0023 NOT_DELIVERED']);

    expect((await w.receive(11)).status).toBe(201);
    [van] = await vans();
    expect(van.counts).toMatchObject({ total: 4, received: 1 });
    await w.walletClean();
  });

  it('API §9.4 "received" counts this return only, never an earlier run of the same van today', async () => {
    const { std, scans } = w;
    await w.withCustomer(11, 'C1');
    // Run 1: Sana's delivery with one cylinder taken back, received, and the trip finished.
    const x1 = await w.placeOrder(X1_BACK);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    await w.hand(std.DR1, t1, x1, [1, 2, 31]);
    await w.takeBack(std.DR1, t1, x1, 11, 'EMPTY');
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);
    expect((await w.receive(11)).status).toBe(201);
    await scans.finishTrip(std.DR1, t1.id, {}).expect(200);
    expect(await vans()).toEqual([]);

    // Run 2 on the same van: Usman isn't home, so his cylinder comes back: "0 of 1", not "1 of 2".
    const y1 = await w.placeOrder(Y1, 'C2');
    const t2 = await w.assign(y1, std.DR1);
    await w.load(std.DR1, t2, [3]);
    await w.doneLoading(std.DR1, t2);
    await scans.failOrder(std.DR1, y1.id, { reasonCode: 'CUSTOMER_NOT_HOME' }).expect(200);
    const [van] = await vans();
    expect(codes(van)).toEqual(['AG-C0003 NOT_DELIVERED']);
    expect(van.counts).toMatchObject({ total: 1, received: 0 });
    expect((await w.receive(3)).status).toBe(201);
    expect(await vans()).toEqual([]);
    await w.walletClean();
  });

  it('API §9.4 a spare cylinder on a van out for delivery is coming back', async () => {
    const { std } = w;
    const x1 = await w.placeOrder(X1_BACK);
    const y1 = await w.placeOrder(Y1, 'C2');
    const t1 = await w.assign(x1, std.DR1);
    await w.assign(y1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31, 3]);
    await w.doneLoading(std.DR1, t1);
    expect(await vans()).toEqual([]);

    // Usman's order is cancelled after loading: AG-C0003 is a spare, coming back; the rest is still out.
    await w.as(std.DA).post(`/orders/${y1.id}/cancel`).send({ reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    const [van] = await vans();
    expect(codes(van)).toEqual(['AG-C0003 SPARE']);
    expect(van.counts).toMatchObject({ total: 1, received: 0 });
    await w.walletClean();
  });
});
