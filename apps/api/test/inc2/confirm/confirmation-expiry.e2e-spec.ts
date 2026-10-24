/**
 * The confirmation-expiry job and the link lifetime (API_CONTRACT §9.9, CUSTOMER_PAGE §2, §11): every 15
 * minutes on Pakistan time, PENDING links past their expiry become EXPIRED, whatever the switch says; the
 * lifetime setting (24–168 hours) applies only to links issued after a change. No money.
 */
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CONFIRMATION_EXPIRY_JOB, ConfirmationExpiryJob } from '../../../src/modules/confirmation/confirmation.interface';
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
  casesOf,
  confirmationOf,
  createConfirmApp,
  deliverX1,
  freshStandard,
  moneyOf,
  pageCalls,
  setSetting,
  textOf,
  waitForSends,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

const HOUR = 3_600_000;

describeDb('confirmation expiry and the link lifetime', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();
  const links = () => customerLinks(app);
  const page = () => pageCalls(app);
  const job = () => app.get(ConfirmationExpiryJob);

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

  async function deliveredAtOf(orderId: string): Promise<Date> {
    return (await db().order.findUniqueOrThrow({ where: { id: orderId } })).deliveredAt as Date;
  }

  it('CNF-020 the expiry job closes unanswered links and moves no money', async () => {
    const p1 = await deliverX1(app, std);
    const p2 = await deliverX1(app, std);
    const a1 = await deliverX1(app, std);
    await page().answer(a1.token as string, 'NO').expect(303);
    await ageLink(p1.order.id, new Date(Date.now() - 60_000));
    await ageLink(p2.order.id, new Date(Date.now() + HOUR));
    await ageLink(a1.order.id, new Date(Date.now() - 60_000));
    const money = await moneyOf(std.DA.id);
    const casesBefore = (await casesOf()).length;

    // The job is registered every 15 minutes, Pakistan time.
    const cron = app.get(SchedulerRegistry).getCronJob(CONFIRMATION_EXPIRY_JOB);
    expect(cron.cronTime.source).toBe('*/15 * * * *');
    expect(cron.cronTime.timeZone).toBe('Asia/Karachi');

    expect(await job().run()).toBe(1);
    expect(await job().run()).toBe(0);
    expect((await confirmationOf(p1.order.id))?.status).toBe('EXPIRED');
    expect((await confirmationOf(p2.order.id))?.status).toBe('PENDING');
    expect(await confirmationOf(a1.order.id)).toMatchObject({ status: 'ANSWERED', response: 'NO' });

    const view = await links().view(std.DA, p1.order.id).expect(200);
    expect(view.body).toMatchObject({ status: 'EXPIRED', allowedActions: [] });
    expect(await moneyOf(std.DA.id)).toEqual(money);
    expect(await casesOf(p1.order.id)).toEqual([]);
    expect((await casesOf()).length).toBe(casesBefore);

    // Step 4: the job runs whatever the switch says.
    await setSetting(app, 'confirmation.enabled', false, 'Owner switched confirmation off');
    await ageLink(p2.order.id, new Date(Date.now() - 60_000));
    expect(await job().run()).toBe(1);
    expect((await confirmationOf(p2.order.id))?.status).toBe('EXPIRED');
    await setSetting(app, 'confirmation.enabled', true, 'Owner switched confirmation back on');
    expect(await moneyOf(std.DA.id)).toEqual(money);
  });

  it('CNF-021 the link lifetime setting accepts 24 to 168 hours and applies to new links', async () => {
    const d1 = await deliverX1(app, std);
    const e1 = (await confirmationOf(d1.order.id))!.expiresAt;
    const patch = (value: unknown, reason: string, status: number) =>
      http(app).patch('/api/v1/settings/confirmation.linkTtlHours').set(authHeader(std.SA1.actor)).send({ value, reason }).expect(status);

    for (const value of [23, 169]) {
      const res = await patch(value, 'Testing the limit', 400);
      expect(res.body).toMatchObject({ code: 'SETTING_INVALID_VALUE', message: "This value isn't allowed here." });
    }
    expect(await db().appSetting.findFirst({ where: { key: 'confirmation.linkTtlHours' } })).toBeNull();

    await patch(24, 'Shorter links for the pilot', 200);
    const updates = (await auditRows('setting.update')).filter((row) => (row.diff as { key?: string } | null)?.key === 'confirmation.linkTtlHours');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ reason: 'Shorter links for the pilot', diff: { key: 'confirmation.linkTtlHours', from: 72, to: 24 } });
    const d2 = await deliverX1(app, std);
    expect((await confirmationOf(d2.order.id))!.expiresAt.getTime()).toBe((await deliveredAtOf(d2.order.id)).getTime() + 24 * HOUR);

    await patch(168, 'The longest links', 200);
    const d3 = await deliverX1(app, std);
    expect((await confirmationOf(d3.order.id))!.expiresAt.getTime()).toBe((await deliveredAtOf(d3.order.id)).getTime() + 168 * HOUR);

    await patch(36, 'A day and a half', 200);
    const d4 = await deliverX1(app, std);
    expect((await confirmationOf(d4.order.id))!.expiresAt.getTime()).toBe((await deliveredAtOf(d4.order.id)).getTime() + 36 * HOUR);

    expect((await confirmationOf(d1.order.id))!.expiresAt).toEqual(e1);
    await patch(72, 'Back to the default', 200);

    // Step 6: eight days later each expired page states its own link's lifetime.
    for (const d of [d2, d3, d4]) {
      const row = (await confirmationOf(d.order.id))!;
      await ageLink(d.order.id, new Date(row.expiresAt.getTime() - 8 * 24 * HOUR));
    }
    const words = async (token: string) => textOf((await page().get(token).expect(410)).text);
    expect(await words(d2.token as string)).toContain('Answers close 1 day after delivery.');
    expect(await words(d4.token as string)).toContain('Answers close 36 hours after delivery.');
    expect(await words(d3.token as string)).toContain('Answers close 7 days after delivery.');
  });
});
