/**
 * Customer problems (cases, API_CONTRACT §9.6, CUSTOMER_PAGE §7): the answers that `confirmation.
 * caseOnAnswers` names open one CUSTOMER_PROBLEM case in the answer's own transaction; the office lists
 * and resolves them with a note (audited, once); the shop sees its own. No money action exists.
 */
import type { INestApplication } from '@nestjs/common';
import { AlertSeverity, AlertType } from '@prisma/client';
import { ERROR_MESSAGE_EN } from '@smartfleet/shared-types';
import { AlertsService } from '../../../src/modules/alerts/alerts.service';
import { authHeader } from '../../helpers/auth';
import { customerLinks } from '../../helpers/customer-links';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import type { StandardData } from '../../helpers/standard-data';
import {
  auditRows,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  casesOf,
  confirmationOf,
  createConfirmApp,
  deliverX1,
  freshStandard,
  moneyOf,
  pageCalls,
  textOf,
  waitForSends,
  type X1Delivery,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('customer problems (cases)', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();
  const links = () => customerLinks(app);
  const page = () => pageCalls(app);

  beforeAll(async () => {
    app = await createConfirmApp();
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await waitForSends().catch(() => undefined);
    await app?.close();
  });

  beforeEach(async () => {
    std = await freshStandard(app);
  });

  async function delivered(count: number): Promise<X1Delivery[]> {
    const out: X1Delivery[] = [];
    for (let i = 0; i < count; i++) out.push(await deliverX1(app, std));
    return out;
  }

  async function answer(d: X1Delivery, value: string, comment?: string): Promise<void> {
    await page().answer(d.token as string, value, comment).expect(303);
  }

  /** One open case per order: d answered NO "Nothing came". */
  async function openCase(d: X1Delivery): Promise<string> {
    await answer(d, 'NO', 'Nothing came');
    const [row] = await casesOf(d.order.id);
    return row.id;
  }

  async function patchSetting(key: string, value: unknown, reason: string, status = 200) {
    return http(app).patch(`/api/v1/settings/${key}`).set(authHeader(std.SA1.actor)).send({ value, reason }).expect(status);
  }

  it('CAS-001 by default "Not received" and "Other problem" each open one case; "All received" and "Partly" open none', async () => {
    const [d1, d2, d3, d4] = await delivered(4);
    await answer(d1, 'NO', 'Nothing came');
    await answer(d2, 'OTHER', 'Leak at valve');
    await answer(d3, 'YES');
    await answer(d4, 'PARTLY', 'One missing');

    const office = await links().cases(std.SA1, { status: 'OPEN' }).expect(200);
    expect(office.body).toEqual({ items: expect.any(Array), nextCursor: null });
    expect(office.body.items.map((c: { order: { id: string } }) => c.order.id)).toEqual([d1.order.id, d2.order.id]);
    expect(office.body.items[0]).toMatchObject({
      status: 'OPEN',
      order: { id: d1.order.id, shortCode: 'AG-0001' },
      answer: 'NO',
      comment: 'Nothing came',
      customerName: 'Sana',
      distributor: { id: std.DA.id, businessName: 'Ahmed Gas' },
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
      allowedActions: ['RESOLVE'],
    });
    const [c1] = await casesOf(d1.order.id);
    expect(c1).toMatchObject({
      alertType: 'CUSTOMER_PROBLEM',
      severity: 'WARNING',
      status: 'OPEN',
      distributorId: std.DA.id,
      resourceType: 'Order',
      resourceId: d1.order.id,
      context: { orderId: d1.order.id, orderShortCode: 'AG-0001', distributorId: std.DA.id, answer: 'NO', comment: 'Nothing came' },
    });
    const [c2] = await casesOf(d2.order.id);
    expect(c2).toMatchObject({ severity: 'WARNING', context: { answer: 'OTHER', comment: 'Leak at valve' } });
    expect(await casesOf(d3.order.id)).toEqual([]);
    expect(await casesOf(d4.order.id)).toEqual([]);

    const mine = await links().myCases(std.DA).expect(200);
    expect(mine.body.nextCursor).toBeNull();
    expect(mine.body.items.map((c: { id: string; allowedActions: string[] }) => [c.id, c.allowedActions])).toEqual([
      [c1.id, []],
      [c2.id, []],
    ]);
    expect((await links().view(std.DA, d1.order.id).expect(200)).body.caseOpen).toBe(true);
    expect((await links().view(std.DA, d3.order.id).expect(200)).body.caseOpen).toBe(false);
  });

  it('CAS-002 the "answers that open a case" setting decides, on and off', async () => {
    const [d0, a1, b1, b2, c1, c2] = await delivered(6);
    await answer(d0, 'PARTLY', 'One missing');
    expect(await casesOf(d0.order.id)).toEqual([]);

    await patchSetting('confirmation.caseOnAnswers', ['NO', 'OTHER', 'PARTLY'], 'Track partly answers too');
    await answer(a1, 'PARTLY', 'One missing');
    const [partly] = await casesOf(a1.order.id);
    expect(partly).toMatchObject({ severity: AlertSeverity.INFO, context: { answer: 'PARTLY', comment: 'One missing' } });

    await patchSetting('confirmation.caseOnAnswers', ['OTHER'], 'Only other problems open cases');
    await answer(b1, 'NO');
    await answer(b2, 'OTHER', 'Leak');
    expect(await casesOf(b1.order.id)).toEqual([]);
    const [other] = await casesOf(b2.order.id);
    expect(other.severity).toBe(AlertSeverity.WARNING);

    await patchSetting('confirmation.caseOnAnswers', [], 'No cases for a while');
    await answer(c1, 'NO');
    await answer(c2, 'OTHER', 'Leak');
    expect(await casesOf(c1.order.id)).toEqual([]);
    expect(await casesOf(c2.order.id)).toEqual([]);

    const refused = await patchSetting('confirmation.caseOnAnswers', ['MAYBE'], 'Not an answer', 400);
    expect(refused.body).toMatchObject({ code: 'SETTING_INVALID_VALUE', message: "This value isn't allowed here." });
    const stored = await db().appSetting.findFirst({ where: { key: 'confirmation.caseOnAnswers' } });
    expect(stored?.value).toEqual([]);

    const updates = (await auditRows('setting.update')).filter((row) => (row.diff as { key?: string })?.key === 'confirmation.caseOnAnswers');
    expect(updates.map((row) => row.reason)).toEqual(['Track partly answers too', 'Only other problems open cases', 'No cases for a while']);
    expect(await casesOf(d0.order.id)).toEqual([]);
    await patchSetting('confirmation.caseOnAnswers', ['NO', 'OTHER'], 'Back to the default');
  });

  it('CAS-003 one case per order, even with repeated or parallel answers', async () => {
    const [d1, d2] = await delivered(2);
    await answer(d1, 'NO');
    const second = await page().answer(d1.token as string, 'NO').expect(303);
    expect(textOf((await page().path('get', second.headers.location).expect(200)).text)).toContain('Thank you!');
    expect(await casesOf(d1.order.id)).toHaveLength(1);

    const parallel = await Promise.all(Array.from({ length: 5 }, () => page().answer(d2.token as string, 'NO')));
    for (const res of parallel) expect(res.status).toBe(303);
    expect(await casesOf(d2.order.id)).toHaveLength(1);

    // The same raise again (same dedupe key): still one open case.
    const [existing] = await casesOf(d1.order.id);
    await app.get(AlertsService).raise({
      alertType: AlertType.CUSTOMER_PROBLEM,
      severity: AlertSeverity.WARNING,
      title: 'Customer problem: AG-0001',
      body: 'Again',
      resourceType: 'Order',
      resourceId: d1.order.id,
      distributorId: std.DA.id,
      context: existing.context as never,
      dedupeKey: { resourceType: 'Order', resourceId: d1.order.id, alertType: AlertType.CUSTOMER_PROBLEM },
    });
    const after = await casesOf(d1.order.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: existing.id, status: 'OPEN' });
  });

  it('CAS-004 if opening the case fails, the answer is not saved and can be sent again', async () => {
    const [d1] = await delivered(1);
    const raise = jest.spyOn(app.get(AlertsService), 'raise').mockRejectedValueOnce(new Error('alerts are down'));
    const failed = await page().answer(d1.token as string, 'NO', 'Nothing came').expect(500);
    raise.mockRestore();
    expect(textOf(failed.text)).toContain('Something went wrong');
    expect(textOf(failed.text)).toContain('Your answer was not saved.');
    expect(await confirmationOf(d1.order.id)).toMatchObject({ status: 'PENDING', response: null });
    expect(await auditRows('confirmation.answer')).toHaveLength(0);
    expect(await casesOf()).toHaveLength(0);

    const retried = await page().answer(d1.token as string, 'NO', 'Nothing came').expect(303);
    expect(textOf((await page().path('get', retried.headers.location).expect(200)).text)).toContain('Thank you!');
    expect(await confirmationOf(d1.order.id)).toMatchObject({ status: 'ANSWERED', response: 'NO' });
    expect(await auditRows('confirmation.answer', d1.order.id)).toHaveLength(1);
    expect(await casesOf(d1.order.id)).toHaveLength(1);
  });

  it('CAS-005 the office resolves a case with a note, and it is audited', async () => {
    const [d1] = await delivered(1);
    const caseId = await openCase(d1);
    const note = 'Called Sana; the cylinder was with her neighbour';
    const res = await links().resolveCase(std.SA1, caseId, note).expect(200);
    expect(res.body).toMatchObject({
      id: caseId,
      status: 'RESOLVED',
      resolvedBy: { id: std.SA1.id, name: 'Owner' },
      resolutionNote: note,
      allowedActions: [],
      answer: 'NO',
    });
    expect(res.body.resolvedAt).toEqual(expect.any(String));

    expect((await links().cases(std.SA1, { status: 'OPEN' }).expect(200)).body.items).toEqual([]);
    expect((await links().myCases(std.DA).expect(200)).body.items).toEqual([]);
    const view = await links().view(std.DA, d1.order.id).expect(200);
    expect(view.body).toMatchObject({ caseOpen: false, response: 'NO' });

    const audit = await http(app).get('/api/v1/audit-logs').query({ action: 'case.resolve' }).set(authHeader(std.SA1.actor)).expect(200);
    expect(audit.body.items).toHaveLength(1);
    expect(audit.body.items[0]).toMatchObject({
      action: 'case.resolve',
      actor: { kind: 'USER', userId: std.SA1.id },
      resourceType: 'Alert',
      resourceId: caseId,
      reason: note,
    });
  });

  it('CAS-006 the resolve note must be 5 to 300 characters', async () => {
    const [a, b, c] = await delivered(3);
    const [ca, cb, cc] = [await openCase(a), await openCase(b), await openCase(c)];
    for (const body of [{}, { note: '     ' }, { note: 'Done' }, { note: 'x'.repeat(301) }]) {
      const res = await http(app).post(`/api/v1/alerts/${ca}/resolve`).set(authHeader(std.SA1.actor)).send(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.fields[0].path).toBe('note');
    }
    expect((await db().alert.findUniqueOrThrow({ where: { id: ca } })).status).toBe('OPEN');
    expect(await auditRows('case.resolve')).toHaveLength(0);
    expect((await links().resolveCase(std.SA1, cb, 'Fixed').expect(200)).body.status).toBe('RESOLVED');
    expect((await links().resolveCase(std.SA1, cc, 'y'.repeat(300)).expect(200)).body.status).toBe('RESOLVED');
  });

  it('CAS-007 a case closes only once, even when two office users click together', async () => {
    const [a, b] = await delivered(2);
    const [ca, cb] = [await openCase(a), await openCase(b)];
    const key = '88888888-bbbb-4bbb-8bbb-000000000001';
    const resolveAs = (who: { actor: Parameters<typeof authHeader>[0] }, id: string, note: string, idempotencyKey?: string) => {
      let req = http(app).post(`/api/v1/alerts/${id}/resolve`).set(authHeader(who.actor));
      if (idempotencyKey) req = req.set('Idempotency-Key', idempotencyKey);
      return req.send({ note });
    };
    const first = await resolveAs(std.SA1, ca, 'Called the customer', key).expect(200);
    const repeat = await resolveAs(std.SA1, ca, 'Called the customer', key).expect(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    expect(repeat.body).toEqual(first.body);
    const other = await resolveAs(std.SA2, ca, 'Second try').expect(409);
    expect(other.body).toMatchObject({
      code: 'CASE_ALREADY_RESOLVED',
      details: { by: 'Owner', currentStatus: 'RESOLVED' },
      message: ERROR_MESSAGE_EN.CASE_ALREADY_RESOLVED.replace('{{by}}', 'Owner'),
    });

    const race = await Promise.all([resolveAs(std.SA1, cb, 'Owner sorted it'), resolveAs(std.SA2, cb, 'Ops sorted it')]);
    expect(race.map((res) => res.status).sort()).toEqual([200, 409]);
    const winner = race.find((res) => res.status === 200)!;
    const loser = race.find((res) => res.status === 409)!;
    expect(loser.body.code).toBe('CASE_ALREADY_RESOLVED');
    expect(loser.body.details.by).toBe(winner.body.resolvedBy.name);

    for (const [id, note] of [
      [ca, 'Called the customer'],
      [cb, winner.body.resolutionNote],
    ]) {
      expect(await auditRows('case.resolve', id)).toHaveLength(1);
      expect((await db().alert.findUniqueOrThrow({ where: { id } })).resolutionNote).toBe(note);
    }
  });

  it('CAS-008 resolving a case never moves money', async () => {
    const [d1] = await delivered(1);
    const caseId = await openCase(d1);
    const before = await moneyOf(std.DA.id);
    const res = await http(app)
      .post(`/api/v1/alerts/${caseId}/resolve`)
      .set(authHeader(std.SA1.actor))
      .send({ note: 'Refund the customer', refundPaisa: '48000', amountPaisa: '48000' })
      .expect(200);
    expect(res.body.status).toBe('RESOLVED');
    expect(JSON.stringify(res.body)).not.toMatch(/Paisa/);
    for (const path of ['refund', 'charge']) {
      await http(app).post(`/api/v1/alerts/${caseId}/${path}`).set(authHeader(std.SA1.actor)).send({ amountPaisa: '48000' }).expect(404);
    }
    expect(await moneyOf(std.DA.id)).toEqual(before);
    expect(before.balancePaisa).toBe(452_000n);
    expect(await auditRows('wallet.correction')).toHaveLength(0);
    expect((await db().order.findUniqueOrThrow({ where: { id: d1.order.id } })).feeStatus).toBe('DEDUCTED');
  });

  it('CAS-009 only the office closes cases; each shop sees only its own', async () => {
    const [d1] = await delivered(1);
    const caseId = await openCase(d1);
    await app.get(AlertsService).raise({
      alertType: AlertType.WALLET_CHECK_MISMATCH,
      severity: AlertSeverity.CRITICAL,
      title: 'Wallet check',
      body: 'The ledger and the balance differ.',
      resourceType: 'Distributor',
      resourceId: std.DA.id,
      distributorId: std.DA.id,
    });
    const mine = await links().myCases(std.DA).expect(200);
    expect(mine.body.items.map((c: { id: string }) => c.id)).toEqual([caseId]);
    expect((await links().myCases(std.DB).expect(200)).body).toEqual({ items: [], nextCursor: null });
    const denied = await links().cases(std.DA, { status: 'OPEN' }).expect(403);
    expect(denied.body).toMatchObject({ code: 'PERMISSION_DENIED', message: "Your account can't do this." });
    for (const who of [std.DA, std.DB, std.DR1]) {
      expect((await links().resolveCase(who, caseId, 'Sorted it myself').expect(403)).body.code).toBe('PERMISSION_DENIED');
    }
    expect((await db().alert.findUniqueOrThrow({ where: { id: caseId } })).status).toBe('OPEN');
    expect(await auditRows('case.resolve')).toHaveLength(0);
  });

  it('CAS-013 the old alert routes can\'t close a customer problem, and the old alert list leaves cases out', async () => {
    const [a, b] = await delivered(2);
    const ca = await openCase(a);
    const cb = await openCase(b);
    const wallet = await app.get(AlertsService).raise({
      alertType: AlertType.WALLET_CHECK_MISMATCH,
      severity: AlertSeverity.CRITICAL,
      title: 'Wallet check',
      body: 'The ledger and the balance differ.',
      resourceType: 'Distributor',
      resourceId: std.DA.id,
    });
    const office = authHeader(std.SA1.actor);
    for (const path of ['acknowledge', 'resolve']) {
      expect((await http(app).patch(`/api/v1/alerts/${ca}/${path}`).set(office).expect(404)).body.code).toBe('NOT_FOUND');
    }
    const legacy = await http(app).get('/api/v1/alerts').set(office).expect(200);
    expect(Array.isArray(legacy.body)).toBe(true);
    expect(legacy.body.map((alert: { id: string }) => alert.id)).toContain(wallet.id);
    expect(legacy.body.some((alert: { alertType: string }) => alert.alertType === 'CUSTOMER_PROBLEM')).toBe(false);

    expect((await links().resolveCase(std.SA1, cb, 'Called the customer').expect(200)).body.status).toBe('RESOLVED');
    const resolved = await links().cases(std.SA1, { status: 'RESOLVED' }).expect(200);
    expect(resolved.body.items.map((c: { id: string }) => c.id)).toEqual([cb]);
    const open = await http(app).get('/api/v1/alerts').query({ type: 'CUSTOMER_PROBLEM' }).set(office).expect(200);
    expect(open.body.items.map((c: { id: string }) => c.id)).toEqual([ca]);

    expect(await db().alert.findUniqueOrThrow({ where: { id: ca } })).toMatchObject({ status: 'OPEN', resolvedAt: null, resolutionNote: null });
    expect(await db().alert.findUniqueOrThrow({ where: { id: cb } })).toMatchObject({ status: 'RESOLVED', resolutionNote: 'Called the customer' });
    expect(await auditRows('case.resolve')).toHaveLength(1);
  });
});
