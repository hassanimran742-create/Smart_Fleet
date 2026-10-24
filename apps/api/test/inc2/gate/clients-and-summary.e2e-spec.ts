/**
 * Increment 2 gate: the pieces the gate wired outside the lanes' files.
 * - `PATCH /clients/:id` (API_CONTRACT §9.4; Appendix B `client.update` [Inc 2]): the shop fixes a
 *   customer's name, mobile or notes. The phone is normalised and unique within the distributor, another
 *   shop's customer is a 404, and every change is audited in its own transaction. The pending-link flag
 *   (`confirmationNeedsNewLink`) is MSG-011's, in test/inc2/confirm/messaging.e2e-spec.ts.
 * - `GET /admin/summary` adds `problems: { open, oldestOpenAt }` from Inc 2 (§7.13, G07-22).
 */
import type { INestApplication } from '@nestjs/common';
import { AlertStatus, AlertType } from '@prisma/client';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createStandardData, STANDARD_PHONES } from '../../helpers/standard-data';
import { OrdersFixture, together } from '../../orders/support/fixture';
import { createOrdersTestApp, freshSettings } from '../../orders/support/orders-app';

jest.setTimeout(300_000);

describeDb('Inc 2 gate: editing a customer, and the office summary', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData());
  });

  afterAll(async () => {
    await app?.close();
  });

  it("CUS-013 Edit a customer's name, mobile or notes, with normalising, uniqueness, ownership and audit (Inc 2)", async () => {
    const { std, db } = f;
    const sana = std.C1.id;
    const edit = (who: Parameters<OrdersFixture['as']>[0], body: Record<string, unknown>) => f.as(who).patch(`/clients/${sana}`).send(body);

    // Step 1: name and notes; the address is untouched and still listed.
    const one = await edit(std.DA, { name: 'Sana Bibi', notes: 'Gate code 12' }).expect(200);
    expect(one.body).toMatchObject({ id: sana, name: 'Sana Bibi', notes: 'Gate code 12', phone: STANDARD_PHONES.C1 });
    expect(one.body.addresses).toEqual([expect.objectContaining({ id: std.C1.addressId, label: "Sana's house", zone: expect.objectContaining({ name: 'North' }) })]);
    expect(one.body).not.toHaveProperty('confirmationNeedsNewLink');

    // Step 2: the mobile, normalised; no confirmation is pending, so no new-link flag.
    const two = await edit(std.DA, { phone: '0301 7654321' }).expect(200);
    expect(two.body.phone).toBe('+923017654321');
    expect(two.body.confirmationNeedsNewLink).toBeUndefined();

    // Step 3: a number that isn't a Pakistani mobile.
    const bad = await edit(std.DA, { phone: '0300 12' }).expect(400);
    expect(bad.body.code).toBe('CLIENT_PHONE_INVALID');
    expect((await db.client.findUniqueOrThrow({ where: { id: sana } })).phone).toBe('+923017654321');

    // Step 4: Usman's number is taken within Ahmed Gas.
    const taken = await edit(std.DA, { phone: STANDARD_PHONES.C2 }).expect(409);
    expect(taken.body).toMatchObject({ code: 'CLIENT_PHONE_EXISTS', details: { name: 'Usman' } });

    // Step 5: another shop's customer, an unknown id and a malformed one are all CLIENT_NOT_FOUND; the
    // office and drivers may not edit at all.
    expect((await edit(std.DB, { name: 'X' }).expect(404)).body.code).toBe('CLIENT_NOT_FOUND');
    expect((await f.as(std.DA).patch('/clients/9b2f1c1e-0000-4000-8000-000000000000').send({ name: 'X' }).expect(404)).body.code).toBe('CLIENT_NOT_FOUND');
    expect((await f.as(std.DA).patch('/clients/not-an-id').send({ name: 'X' }).expect(404)).body.code).toBe('CLIENT_NOT_FOUND');
    for (const who of [std.SA1, std.DR1]) expect((await edit(who, { name: 'X' }).expect(403)).body.code).toBe('PERMISSION_DENIED');
    expect(await db.client.findUniqueOrThrow({ where: { id: sana } })).toMatchObject({ name: 'Sana Bibi', phone: '+923017654321' });

    // A body that changes nothing writes nothing; addresses can't be sent here (dropped).
    await edit(std.DA, { name: 'Sana Bibi', address: { label: 'Elsewhere', lat: 31.5, lng: 74.3 } }).expect(200);
    expect(await db.clientAddress.count({ where: { clientId: sana } })).toBe(1);

    // Step 6: back as she was; blank notes clear them.
    const back = await edit(std.DA, { name: 'Sana', phone: '0300 1234567', notes: '' }).expect(200);
    expect(back.body).toMatchObject({ name: 'Sana', phone: STANDARD_PHONES.C1, notes: null });

    // Step 7: one client.update row per successful change, with before and after, DA's user and DA.
    const res = await f.as(std.SA1).get(`/audit-logs?action=client.update&resourceId=${sana}`).expect(200);
    const rows = (Array.isArray(res.body) ? res.body : res.body.items) as Array<{
      actor: { userId?: string };
      distributorId: string | null;
      resourceType: string;
      diff: { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] };
    }>;
    expect(rows).toHaveLength(3);
    // Newest first.
    expect(rows.map((row) => row.diff.changed)).toEqual([['name', 'phone', 'notes'], ['phone'], ['name', 'notes']]);
    expect(rows[2].diff).toMatchObject({ before: { name: 'Sana', notes: null }, after: { name: 'Sana Bibi', notes: 'Gate code 12' } });
    expect(rows[1].diff).toMatchObject({ before: { phone: STANDARD_PHONES.C1 }, after: { phone: '+923017654321' } });
    expect(rows[0].diff).toMatchObject({
      before: { name: 'Sana Bibi', phone: '+923017654321', notes: 'Gate code 12' },
      after: { name: 'Sana', phone: STANDARD_PHONES.C1, notes: null },
    });
    for (const row of rows) expect(row).toMatchObject({ actor: { userId: std.DA.userId }, distributorId: std.DA.id, resourceType: 'client' });
  });

  it('CUS-013 two edits to one number at once: one wins, the other gets CLIENT_PHONE_EXISTS (the distributor-row lock)', async () => {
    const { std, db } = f;
    const target = '0301 7654321';
    for (let round = 0; round < 5; round++) {
      const [a, b] = await together(
        f.as(std.DA).patch(`/clients/${std.C1.id}`).send({ phone: target }),
        f.as(std.DA).patch(`/clients/${std.C2.id}`).send({ phone: target }),
      );
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect([a, b].find((res) => res.status === 409)?.body.code).toBe('CLIENT_PHONE_EXISTS');
      expect(await db.client.count({ where: { distributorId: std.DA.id, phone: '+923017654321' } })).toBe(1);
      // Reset both for the next round.
      await db.client.update({ where: { id: std.C1.id }, data: { phone: STANDARD_PHONES.C1 } });
      await db.client.update({ where: { id: std.C2.id }, data: { phone: STANDARD_PHONES.C2 } });
    }
  });

  it('OFF-002 (Inc 2) GET /admin/summary adds the open customer problems and the oldest one', async () => {
    const { std, db } = f;
    expect((await f.as(std.SA1).get('/admin/summary').expect(200)).body.problems).toEqual({ open: 0, oldestOpenAt: null });

    const problem = (createdAt: string, status: AlertStatus) =>
      db.alert.create({
        data: {
          alertType: AlertType.CUSTOMER_PROBLEM,
          status,
          title: 'Customer problem',
          body: 'The customer said not received.',
          resourceType: 'Order',
          resourceId: '9b2f1c1e-0000-4000-8000-0000000000aa',
          distributorId: std.DA.id,
          createdAt: new Date(createdAt),
          ...(status === AlertStatus.RESOLVED ? { resolvedAt: new Date(), resolutionNote: 'Called the customer' } : {}),
        },
      });
    await problem('2026-10-20T05:00:00.000Z', AlertStatus.RESOLVED);
    await problem('2026-10-21T06:00:00.000Z', AlertStatus.OPEN);
    await problem('2026-10-22T07:00:00.000Z', AlertStatus.OPEN);
    // Another alert type never counts.
    await db.alert.create({ data: { alertType: AlertType.VAN_NOT_EMPTY, title: 'Van not empty', body: 'LEA-101', createdAt: new Date('2026-10-19T00:00:00Z') } });

    const summary = await f.as(std.SA1).get('/admin/summary').expect(200);
    expect(summary.body.problems).toEqual({ open: 2, oldestOpenAt: '2026-10-21T06:00:00.000Z' });
    expect((await f.as(std.DA).get('/admin/summary').expect(403)).body.code).toBe('PERMISSION_DENIED');
  });
});
