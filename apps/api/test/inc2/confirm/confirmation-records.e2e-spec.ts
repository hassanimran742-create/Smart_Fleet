/**
 * What an answer leaves behind (CUSTOMER_PAGE §7, §12; API_CONTRACT §5.3, §9.11, Appendix B): one
 * `confirmation.answer` audit row by the CUSTOMER actor with no IP or user agent, written in the
 * answer's own transaction; and no money anywhere: no answer, share, new link or expiry writes a ledger
 * row or changes a balance.
 */
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { WalletService } from '../../../src/modules/wallet/wallet.service';
import { ConfirmationExpiryJob } from '../../../src/modules/confirmation/confirmation.interface';
import { authHeader } from '../../helpers/auth';
import { customerLinks } from '../../helpers/customer-links';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import type { StandardData } from '../../helpers/standard-data';
import {
  ageLink,
  auditRows,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  confirmationOf,
  createConfirmApp,
  deliverX1,
  freshStandard,
  moneyOf,
  pageCalls,
  setSetting,
  waitForSends,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

describeDb('confirmation records: the audit row and no money', () => {
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

  it('CNF-039 the audit entry for an answer has actor kind CUSTOMER and no IP', async () => {
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    await page().answer(d1.token as string, 'NO', 'No cylinder came', { ip: '203.0.113.20', userAgent: 'TestPhone/1.0' }).expect(303);

    const listed = await http(app)
      .get('/api/v1/audit-logs')
      .query({ action: 'confirmation.answer', distributorId: std.DA.id })
      .set(authHeader(std.SA1.actor))
      .expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({
      action: 'confirmation.answer',
      actor: { kind: 'CUSTOMER', label: 'link:AG-0001' },
      resourceType: 'Order',
      resourceId: d1.order.id,
      distributorId: std.DA.id,
      diff: { response: 'NO' },
    });
    expect(listed.body.items[0].actor.userId).toBeUndefined();
    const [row] = await auditRows('confirmation.answer', d1.order.id);
    expect(row).toMatchObject({ actorKind: 'CUSTOMER', actorUserId: null, actorLabel: 'link:AG-0001', ip: null, userAgent: null });
    // The answer and the order's number (for the Activity line), never the customer's note or phone.
    expect(row.diff).toEqual({ response: 'NO', no: 'AG-0001' });
    expect(row.requestId).toEqual(expect.any(String));

    // Step 4: the answer's UPDATE fails, so no audit row is left either (one transaction).
    const d2 = await deliverX1(app, std);
    const fn = `sf_test_fail_answer_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const confirmationId = (await confirmationOf(d2.order.id))!.id;
    await db().$executeRawUnsafe(`
      CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = '${confirmationId}'::uuid AND NEW.status::text = 'ANSWERED' THEN RAISE EXCEPTION 'forced answer failure'; END IF;
        RETURN NEW;
      END $$`);
    await db().$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE UPDATE ON delivery_confirmations FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    try {
      await page().answer(d2.token as string, 'YES').expect(500);
    } finally {
      await db().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON delivery_confirmations`);
      await db().$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    expect(await confirmationOf(d2.order.id)).toMatchObject({ status: 'PENDING', response: null });
    expect(await auditRows('confirmation.answer', d2.order.id)).toHaveLength(0);
  });

  it('CNF-037 no answer, share, new link or expiry moves any money', async () => {
    await setSetting(app, 'confirmation.caseOnAnswers', ['NO', 'OTHER', 'PARTLY']);
    const orders = [];
    for (let i = 0; i < 5; i++) orders.push(await deliverX1(app, std));
    const [d1, d2, d3, d4, d5] = orders;
    const start = await moneyOf(std.DA.id);
    expect(start.balancePaisa).toBe(260_000n);
    const statementBefore = (await http(app).get('/api/v1/wallet/statement').set(authHeader(std.DA.actor)).expect(200)).body;
    const expectUnchanged = async () => {
      expect(await moneyOf(std.DA.id)).toEqual(start);
    };

    await page().answer(d1.token as string, 'YES').expect(303);
    await page().answer(d2.token as string, 'PARTLY', 'One missing').expect(303);
    await page().answer(d3.token as string, 'NO').expect(303);
    await page().answer(d4.token as string, 'OTHER', 'Leak at valve').expect(303);
    await expectUnchanged();

    for (const via of ['WHATSAPP', 'SMS', 'SHARE_SHEET', 'COPY'] as const) await links().share(std.DA, d5.order.id, via).expect(200);
    await links().newLink(std.DA, d5.order.id, { send: 'SMS' }).expect(200);
    await links().newLink(std.DA, d5.order.id, { send: 'SMS' }).expect(200);
    await waitForSends();
    await expectUnchanged();

    const row = (await confirmationOf(d5.order.id))!;
    await ageLink(d5.order.id, new Date(Date.now() - 60_000));
    expect(row.status).toBe('PENDING');
    await app.get(ConfirmationExpiryJob).run();
    expect((await confirmationOf(d5.order.id))?.status).toBe('EXPIRED');
    await expectUnchanged();

    const checks = await app.get(WalletService).verify(std.DA.id);
    expect(checks).toEqual([expect.objectContaining({ distributorId: std.DA.id, ok: true })]);
    for (const d of orders) {
      const order = await http(app).get(`/api/v1/orders/${d.order.id}`).set(authHeader(std.DA.actor)).expect(200);
      expect(order.body.fee).toMatchObject({ status: 'DEDUCTED', totalPaisa: '25000' });
    }
    const statementAfter = (await http(app).get('/api/v1/wallet/statement').set(authHeader(std.DA.actor)).expect(200)).body;
    expect(statementAfter).toEqual(statementBefore);
    expect(start.ledger.filter((entry) => entry.entryType === 'DEBIT_ORDER')).toHaveLength(5);
  });
});
