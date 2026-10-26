/**
 * [Inc 2/3 UI gate] What the order answers add for the screens (API_CONTRACT §9.12):
 * - `OrderDto.load` while the order is LOADING: its trip's load so far, the office board's "Loading · 1 of 3
 *   loaded" (the trip's STORE_PICKUP doneCount of neededCount); null in any other stage; absent for a driver.
 * - `OrderDto.visit` on `GET /orders/:id` for the owning shop and the office: each cylinder given and taken
 *   back by number, and the unlabelled returns (the shop's "Empty · AG-C0011", the drawer's "Delivered"
 *   rows); null before anything was given; absent on the lists and for a driver. Read only, no money.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { buildWorld, type Line, type World } from '../scan/support/world';

jest.setTimeout(180_000);

/** X1 with its expected returns: 2 × 11.8 kg and 1 × 45.4 kg back (still Rs 250). */
const X1_BACK: Line[] = [
  { size: '11.8', full: 2, back: 2 },
  { size: '45.4', full: 1, back: 1 },
];

describeDb('Inc 2/3 UI gate: the order answers carry the load and the visit', () => {
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

  it('API §9.12 a LOADING order carries its trip\'s load; any other stage and the driver get none', async () => {
    const { std } = w;
    const x1 = await w.placeOrder(X1_BACK);
    const t1 = await w.assign(x1, std.DR1);

    const assigned = await w.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(assigned.body).toMatchObject({ stage: 'DRIVER_ASSIGNED', load: null, visit: null });

    await w.load(std.DR1, t1, [1]);
    const shop = await w.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(shop.body).toMatchObject({ stage: 'LOADING', load: { done: 1, total: 3 } });
    const board = await w.as(std.SA1).get('/orders/board?tab=in-progress').expect(200);
    const row = board.body.items.find((item: { id: string }) => item.id === x1.id);
    expect(row).toMatchObject({ stage: 'LOADING', load: { done: 1, total: 3 } });
    expect(row).not.toHaveProperty('visit');
    const list = await w.as(std.DA).get('/orders?tab=active').expect(200);
    expect(list.body.items.find((item: { id: string }) => item.id === x1.id)).toMatchObject({ load: { done: 1, total: 3 } });

    const driver = await w.as(std.DR1).get(`/orders/${x1.id}`).expect(200);
    expect(driver.body).not.toHaveProperty('load');
    expect(driver.body).not.toHaveProperty('visit');

    await w.load(std.DR1, t1, [2, 31]);
    await w.doneLoading(std.DR1, t1);
    const onTheWay = await w.as(std.SA1).get(`/orders/${x1.id}`).expect(200);
    expect(onTheWay.body).toMatchObject({ stage: 'ON_THE_WAY', load: null });
  });

  it('API §9.12 a delivered order lists its visit by cylinder number for the shop and the office', async () => {
    const { std, scans } = w;
    for (const n of [11, 12]) await w.withCustomer(n, 'C1');
    const x1 = await w.placeOrder(X1_BACK);
    const t1 = await w.assign(x1, std.DR1);
    await w.load(std.DR1, t1, [1, 2, 31]);
    await w.doneLoading(std.DR1, t1);
    const sana = await t1.stopFor(x1.id);

    await w.hand(std.DR1, t1, x1, [1, 2]);
    const midway = await w.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(midway.body.visit).toEqual({
      given: [
        { shortCode: 'AG-C0001', cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg' },
        { shortCode: 'AG-C0002', cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg' },
      ],
      takenBack: [],
      unlabelled: [],
    });

    await w.hand(std.DR1, t1, x1, [31]);
    await w.takeBack(std.DR1, t1, x1, 11, 'EMPTY');
    await w.takeBack(std.DR1, t1, x1, 12, 'PART_FILLED');
    await scans.unlabelledReturns(std.DR1, t1.id, sana, [{ cylinderTypeId: std.sizes.kg45_4, state: 'EMPTY', count: 1 }]).expect(200);
    expect((await w.finishVisit(std.DR1, t1, x1)).status).toBe(200);

    const expected = {
      given: [
        { shortCode: 'AG-C0001', cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg' },
        { shortCode: 'AG-C0002', cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg' },
        { shortCode: 'AG-C0031', cylinderTypeId: std.sizes.kg45_4, sizeLabel: '45.4 kg' },
      ],
      takenBack: [
        { shortCode: 'AG-C0011', cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg', state: 'EMPTY' },
        { shortCode: 'AG-C0012', cylinderTypeId: std.sizes.kg11_8, sizeLabel: '11.8 kg', state: 'PART_FILLED' },
      ],
      unlabelled: [{ cylinderTypeId: std.sizes.kg45_4, sizeLabel: '45.4 kg', state: 'EMPTY', count: 1 }],
    };
    const shop = await w.as(std.DA).get(`/orders/${x1.id}`).expect(200);
    expect(shop.body).toMatchObject({ status: 'DELIVERED', stage: 'DELIVERED', load: null });
    expect(shop.body.visit).toEqual(expected);
    const office = await w.as(std.SA1).get(`/orders/${x1.id}`).expect(200);
    expect(office.body.visit).toEqual(expected);

    // Lists leave it out; another shop and the driver never see it.
    const done = await w.as(std.DA).get('/orders?tab=done').expect(200);
    expect(done.body.items.find((item: { id: string }) => item.id === x1.id)).not.toHaveProperty('visit');
    expect((await w.as(std.DB).get(`/orders/${x1.id}`)).status).toBe(404);
    expect((await w.as(std.DR1).get(`/orders/${x1.id}`).expect(200)).body).not.toHaveProperty('visit');
    await w.walletClean();
  });
});
