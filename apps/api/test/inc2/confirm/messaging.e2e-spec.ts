/**
 * Messaging (CUSTOMER_PAGE §8-§10, API_CONTRACT §9.7): the QUEUED SMS row written with the delivery, the
 * after-commit send through test mode and the provider (a spy standing in for an SMS company), failures,
 * the new link's SMS, a customer whose number is wrong, and no webhook.
 */
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ERROR_MESSAGE_EN } from '@smartfleet/shared-types';
import { ConfirmationService } from '../../../src/modules/confirmation/confirmation.interface';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authHeader } from '../../helpers/auth';
import { confirmationToken, customerLinks } from '../../helpers/customer-links';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import type { StandardData } from '../../helpers/standard-data';
import { scanCalls } from '../../helpers/scan-calls';
import {
  auditRows,
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  confirmationOf,
  createConfirmApp,
  currentToken,
  deliverX1,
  freshStandard,
  itAfterGate,
  itWithScanLane,
  messagesOf,
  messagingOf,
  setSetting,
  SpyProvider,
  waitForSends,
  withSpyProvider,
  type X1Delivery,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

const TOKEN_26 = /[0-9a-z]{26}/;

describeDb('messaging: the SMS of a confirmation link', () => {
  let app: INestApplication;
  let std: StandardData;
  const spy = new SpyProvider();
  const db = () => getTestPrisma();
  const links = () => customerLinks(app);

  beforeAll(async () => {
    app = await createConfirmApp(withSpyProvider(spy));
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await waitForSends().catch(() => undefined);
    await app?.close();
  });

  beforeEach(async () => {
    spy.reset();
    messagingOf(app).sendTimeoutMs = 15_000;
    std = await freshStandard(app);
  });

  /** The visit finish's transaction, without the after-commit send (the test sends, or watches it). */
  async function deliverWithoutSending(d: X1Delivery) {
    const prisma = app.get(PrismaService);
    const deliveredAt = new Date();
    return prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: d.order.id }, data: { status: 'DELIVERED', deliveredAt, deliveryMethod: 'SCANNED', deliveredByUserId: std.DR1.userId } });
      await tx.tripStop.update({ where: { id: d.stopId }, data: { status: 'DONE', completedAt: deliveredAt } });
      return app.get(ConfirmationService).issueForDeliveredOrder(tx, { orderId: d.order.id, stopId: d.stopId, deliveredAt });
    });
  }

  it('MSG-001 the mock provider records the outgoing SMS in the message log', async () => {
    await setSetting(app, 'messaging.allowlist', ['+923001234567']);
    const d1 = await deliverX1(app, std, { deliver: false });
    const issued = await deliverWithoutSending(d1);
    // Written QUEUED inside the delivery's transaction...
    const queued = await messagesOf(d1.order.id);
    expect(queued.map((row) => row.status)).toEqual(['QUEUED']);
    expect(issued?.messageId).toBe(queued[0].id);
    // ...and updated after commit.
    await app.get(ConfirmationService).sendIssued(issued);
    const [row] = await messagesOf(d1.order.id);
    const confirmation = (await confirmationOf(d1.order.id))!;
    expect(row).toMatchObject({
      channel: 'SMS',
      provider: 'mock',
      toPhoneE164: '+923001234567',
      templateKey: 'sms.deliveryConfirm.v1',
      locale: 'en',
      status: 'SKIPPED',
      errorCode: 'MOCK_PROVIDER',
      providerMessageId: null,
      idempotencyKey: `confirm:${d1.order.id}:v1:sms`,
      confirmationId: confirmation.id,
      orderId: d1.order.id,
      distributorId: std.DA.id,
      tokenVersion: 1,
    });
    expect(row.bodyRedacted.startsWith('Ahmed Gas: Order AG-0001 delivered. Did you get it? Tap ')).toBe(true);
    expect(row.bodyRedacted).toContain('[link]');
    expect(row.bodyRedacted).not.toMatch(TOKEN_26);
    expect(row.bodyRedacted).not.toContain(confirmationToken(confirmation.id, 1));
    expect(await db().outboundMessage.count({ where: { status: 'QUEUED' } })).toBe(0);
  });

  it('MSG-003 test mode sends real messages only to allowlisted phones', async () => {
    spy.next = { kind: 'SENT', providerMessageId: 'spy-1' };
    // Step 1: test mode on, nobody allowed.
    const d1 = await deliverX1(app, std);
    expect(spy.calls).toHaveLength(0);
    expect((await messagesOf(d1.order.id))[0]).toMatchObject({ status: 'SKIPPED', errorCode: 'NOT_A_TEST_PHONE' });

    // Step 2: Sana allowed; the view reads "sending" while the provider is still at it.
    await setSetting(app, 'messaging.allowlist', ['+923001234567']);
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    spy.next = async () => {
      await answered;
      return { kind: 'SENT', providerMessageId: 'spy-1' };
    };
    const d2 = await deliverX1(app, std, { deliver: false });
    const issued = await deliverWithoutSending(d2);
    const sending = app.get(ConfirmationService).sendIssued(issued);
    for (let i = 0; i < 50 && spy.calls.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await links().view(std.DA, d2.order.id).expect(200)).body.reach).toBe('SMS_SENDING');
    release();
    await sending;
    const [row2] = await messagesOf(d2.order.id);
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toMatchObject({ toE164: '+923001234567', templateKey: 'sms.deliveryConfirm.v1', messageId: row2.id, channel: 'SMS', locale: 'en' });
    const token = await currentToken(d2.order.id);
    expect(spy.calls[0].text).toBe(`Ahmed Gas: Order ${d2.order.shortCode} delivered. Did you get it? Tap https://smartfleetpk.com/c/${token} Help: 03211234567`);
    expect(row2).toMatchObject({ status: 'SENT', providerMessageId: 'spy-1' });
    expect(row2.sentAt).toBeInstanceOf(Date);

    // Step 3: test mode off.
    spy.reset();
    spy.next = { kind: 'SENT', providerMessageId: 'spy-1' };
    await setSetting(app, 'messaging.allowlist', []);
    await setSetting(app, 'messaging.testMode', false);
    const d3 = await deliverX1(app, std);
    expect(spy.calls).toHaveLength(1);
    expect((await messagesOf(d3.order.id))[0]).toMatchObject({ status: 'SENT', providerMessageId: 'spy-1' });
  });

  it('MSG-004 a failed send is recorded and logged, the delivery still finishes, and nothing retries', async () => {
    await setSetting(app, 'messaging.testMode', false);
    messagingOf(app).sendTimeoutMs = 300;
    const errors = jest.spyOn(Logger.prototype, 'error');
    try {
      spy.next = { kind: 'FAILED', code: 'INVALID_NUMBER' };
      const d1 = await deliverX1(app, std);
      spy.next = async () => {
        throw new Error('socket hang up while calling https://sms.example/send?to=+923001234567');
      };
      const d2 = await deliverX1(app, std);
      spy.next = () => new Promise(() => undefined);
      const d3 = await deliverX1(app, std);

      for (const d of [d1, d2, d3]) {
        expect((await db().order.findUniqueOrThrow({ where: { id: d.order.id } })).status).toBe('DELIVERED');
        expect((await confirmationOf(d.order.id))?.status).toBe('PENDING');
      }
      const rows = await Promise.all([d1, d2, d3].map(async (d) => (await messagesOf(d.order.id))[0]));
      expect(rows.map((row) => [row.status, row.errorCode])).toEqual([
        ['FAILED', 'INVALID_NUMBER'],
        ['FAILED', 'UNKNOWN'],
        ['FAILED', 'TIMEOUT'],
      ]);
      const lines = errors.mock.calls.map((call) => call.map(String).join(' '));
      for (const [row, code] of [
        [rows[0], 'INVALID_NUMBER'],
        [rows[1], 'UNKNOWN'],
        [rows[2], 'TIMEOUT'],
      ] as const) {
        const line = lines.find((text) => text.includes(row.id));
        expect(line).toBeDefined();
        expect(line).toContain(code);
        expect(line).not.toMatch(/https?:\/\//);
        expect(line).not.toContain('+923001234567');
        expect(line).not.toMatch(/\/c\/[0-9a-z]{26}/);
      }

      // Step 5: the view, then the expiry job: nothing is sent again.
      const view = await links().view(std.DA, d1.order.id).expect(200);
      expect(view.body).toMatchObject({
        reach: 'SMS_FAILED',
        lastMessage: { channel: 'SMS', status: 'FAILED', errorCode: 'INVALID_NUMBER' },
        allowedActions: ['SHARE', 'NEW_LINK'],
        customer: { name: 'Sana', phoneDisplay: '0300 1234567' },
      });
      const callsBefore = spy.calls.filter((call) => call.messageId === rows[0].id).length;
      await app.get(ConfirmationService).expireDue();
      expect((await messagesOf(d1.order.id))[0].status).toBe('FAILED');
      expect(spy.calls.filter((call) => call.messageId === rows[0].id).length).toBe(callsBefore);
      expect(callsBefore).toBe(1);
    } finally {
      errors.mockRestore();
    }
  });

  itWithScanLane('MSG-004 step 4: a visit that cannot finish writes no confirmation, no message and calls no provider', async () => {
    await setSetting(app, 'messaging.testMode', false);
    spy.next = { kind: 'FAILED', code: 'INVALID_NUMBER' };
    const d4 = await deliverX1(app, std, { deliver: false });
    // One cylinder not handed over: put the last one back on the van.
    await db().stopCylinder.deleteMany({ where: { tripStopId: d4.stopId, cylinderId: d4.given[2].id } });
    await db().cylinder.update({ where: { id: d4.given[2].id }, data: { custodyType: 'VEHICLE', custodyId: d4.trip.vehicleId } });
    const res = await scanCalls(app).finishStop(std.DR1, d4.trip.id, d4.stopId, {}).expect(409);
    expect(res.body.code).toBe('DELIVERY_SCANS_INCOMPLETE');
    expect(await confirmationOf(d4.order.id)).toBeNull();
    expect(await messagesOf(d4.order.id)).toEqual([]);
    expect(spy.calls).toHaveLength(0);
  });

  it('MSG-010 a new link can be sent by SMS and the SMS carries the new link', async () => {
    await setSetting(app, 'messaging.allowlist', ['+923001234567']);
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    const v1 = d1.token as string;
    spy.reset();
    const view = await links().newLink(std.DA, d1.order.id, { send: 'SMS' }).expect(200);
    expect(view.body.orderId).toBe(d1.order.id);
    expect((await confirmationOf(d1.order.id))?.tokenVersion).toBe(2);
    await waitForSends();
    const row = (await messagesOf(d1.order.id)).find((m) => m.idempotencyKey === `confirm:${d1.order.id}:v2:sms`);
    expect(row).toMatchObject({ toPhoneE164: '+923001234567', status: 'SKIPPED', errorCode: 'MOCK_PROVIDER', tokenVersion: 2 });
    const v2 = await currentToken(d1.order.id);
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].text).toContain(`/c/${v2}`);
    expect(spy.calls[0].text).not.toContain(v1);
    const audits = await auditRows('confirmation.new_link', d1.order.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorKind: 'USER', actorUserId: std.DA.userId });
  });

  it('MSG-011 (the link part) after the customer\'s number is fixed, a new link and a share use the new number', async () => {
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    // The fix itself is PATCH /clients/:id (below); here the number changes as that route stores it.
    await db().client.update({ where: { id: std.C1.id }, data: { phone: '+923017654321' } });
    await links().newLink(std.DA, d1.order.id, { send: 'SMS' }).expect(200);
    await waitForSends();
    const row = (await messagesOf(d1.order.id)).find((m) => m.idempotencyKey === `confirm:${d1.order.id}:v2:sms`);
    expect(row?.toPhoneE164).toBe('+923017654321');
    expect((await confirmationOf(d1.order.id))?.phoneE164).toBe('+923017654321');
    const shared = await links().share(std.DA, d1.order.id, 'WHATSAPP').expect(200);
    expect(shared.body.whatsappUrl.startsWith('https://wa.me/923017654321?text=')).toBe(true);
    expect(await app.get(ConfirmationService).hasPendingForClient(std.C1.id)).toBe(true);
  });

  itAfterGate('MSG-011 fixing the customer\'s number while a link is pending (PATCH /clients/:id)', async () => {
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    const patched = await http(app).patch(`/api/v1/clients/${std.C1.id}`).set(authHeader(std.DA.actor)).send({ phone: '0301 7654321' }).expect(200);
    expect(patched.body).toMatchObject({ confirmationNeedsNewLink: true });
    expect((await db().client.findUniqueOrThrow({ where: { id: std.C1.id } })).phone).toBe('+923017654321');
    expect(await auditRows('client.update', std.C1.id)).toHaveLength(1);
    await links().newLink(std.DA, d1.order.id, { send: 'SMS' }).expect(200);
    await waitForSends();
    expect((await messagesOf(d1.order.id)).find((m) => m.idempotencyKey === `confirm:${d1.order.id}:v2:sms`)?.toPhoneE164).toBe('+923017654321');
    const shared = await links().share(std.DA, d1.order.id, 'WHATSAPP').expect(200);
    expect(shared.body.whatsappUrl.startsWith('https://wa.me/923017654321?text=')).toBe(true);
    await http(app).post(`/c/${await currentToken(d1.order.id)}`).set('Content-Type', 'application/x-www-form-urlencoded').send('v=1&answer=YES').expect(303);
    const back = await http(app).patch(`/api/v1/clients/${std.C1.id}`).set(authHeader(std.DA.actor)).send({ phone: '0300 1234567' }).expect(200);
    expect(back.body.confirmationNeedsNewLink).toBeUndefined();
  });

  it('MSG-012 a customer with a wrong number gets no SMS and copy-only links', async () => {
    await db().client.update({ where: { id: std.C1.id }, data: { phone: '042 35551234' } });
    const d1 = await deliverX1(app, std);
    const row = (await confirmationOf(d1.order.id))!;
    expect(row).toMatchObject({ status: 'PENDING', phoneE164: null });
    expect(await messagesOf(d1.order.id)).toEqual([]);
    expect(spy.calls).toHaveLength(0);

    const view = await links().view(std.DA, d1.order.id).expect(200);
    expect(view.body).toMatchObject({ customer: { name: 'Sana', phoneDisplay: '042 35551234', phoneValid: false }, reach: 'NOT_SENT', lastMessage: null });
    for (const via of ['COPY', 'WHATSAPP'] as const) {
      const shared = await links().share(std.DA, d1.order.id, via).expect(200);
      expect(shared.body).toMatchObject({ whatsappUrl: null, smsUrl: null });
      expect(shared.body.url).toMatch(/^https:\/\/smartfleetpk\.com\/c\/[0-9a-z]{26}$/);
      expect(shared.body.message).toContain(shared.body.url);
    }
    const refused = await links().newLink(std.DA, d1.order.id, { send: 'SMS' }).expect(400);
    expect(refused.body).toMatchObject({ code: 'CLIENT_PHONE_INVALID', message: ERROR_MESSAGE_EN.CLIENT_PHONE_INVALID });
    expect((await confirmationOf(d1.order.id))?.tokenVersion).toBe(1);
    expect((await messagesOf(d1.order.id)).filter((m) => m.channel === 'SMS')).toEqual([]);
  });

  it('MSG-014 there is no messaging webhook in the pilot', async () => {
    const d1 = await deliverX1(app, std, { takeBack118: 2 });
    const [row] = await messagesOf(d1.order.id);
    expect(row.status).toBe('SKIPPED');
    for (const provider of ['eocean', 'mock']) {
      const res = await http(app).post(`/api/v1/webhooks/messaging/${provider}`).send({ messageId: row.id, status: 'DELIVERED' }).expect(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    }
    expect((await messagesOf(d1.order.id))[0].status).toBe('SKIPPED');
  });
});
