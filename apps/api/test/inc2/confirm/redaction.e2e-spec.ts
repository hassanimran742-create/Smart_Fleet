/**
 * CNF-028: link tokens never reach the logs, the API's error bodies, Sentry or the message log
 * (CUSTOMER_PAGE §5 redaction, §8, §12; API_CONTRACT §2.1). Everything the API writes while a delivery's
 * link is issued, shared, rotated, opened, answered, refused and failed is captured and searched.
 */
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfirmationServiceImpl } from '../../../src/modules/confirmation/confirmation.interface';
import { customerLinks, tokenFromUrl } from '../../helpers/customer-links';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import type { StandardData } from '../../helpers/standard-data';
import {
  BOOT_TIMEOUT_MS,
  CASE_TIMEOUT_MS,
  confirmationOf,
  createConfirmApp,
  currentToken,
  deliverX1,
  freshStandard,
  pageCalls,
  setSetting,
  waitForSends,
} from './support';

jest.setTimeout(CASE_TIMEOUT_MS);

const LINK_PATTERN = /\/c\/[0-9a-z]{26}/;

/** Sentry's options as initSentry passes them, with a stand-in for the SDK. */
function sentryOptions(): { beforeSend: (event: unknown) => unknown; beforeBreadcrumb: (crumb: unknown) => unknown } {
  let options: unknown;
  jest.isolateModules(() => {
    jest.doMock('@sentry/node', () => ({ init: (opts: unknown) => (options = opts), captureException: () => 'event-id' }), { virtual: true });
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://public@sentry.example/1';
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require('../../../src/common/sentry/sentry') as { initSentry: () => unknown }).initSentry();
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = previous;
    }
  });
  return options as ReturnType<typeof sentryOptions>;
}

describeDb('CNF-028 link tokens are redacted everywhere', () => {
  let app: INestApplication;
  let std: StandardData;

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

  it('CNF-028 link tokens never reach logs, error bodies, Sentry or the message log', async () => {
    await setSetting(app, 'messaging.allowlist', ['+923001234567']);
    const captured: string[] = [];
    const methods = ['log', 'error', 'warn', 'debug', 'verbose'] as const;
    const spies = methods.map((method) =>
      jest.spyOn(Logger.prototype, method).mockImplementation(function (this: Logger, ...args: unknown[]) {
        captured.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(' '));
      }),
    );
    const staticSpies = methods.map((method) =>
      jest.spyOn(Logger, method).mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      }),
    );
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    }) as never);
    const tokens: string[] = [];
    const bodies: string[] = [];
    try {
      // Step 1: the visit finishes (the SMS goes through the mock), then every share and a new link by SMS.
      const d1 = await deliverX1(app, std);
      tokens.push(d1.token as string);
      for (const via of ['WHATSAPP', 'SMS', 'SHARE_SHEET', 'COPY'] as const) {
        const shared = await customerLinks(app).share(std.DA, d1.order.id, via).expect(200);
        expect(tokenFromUrl(shared.body.url)).toBe(d1.token);
      }
      await customerLinks(app).newLink(std.DA, d1.order.id, { send: 'SMS' }).expect(200);
      await waitForSends();
      const token = await currentToken(d1.order.id);
      tokens.push(token);

      // Step 2: the page, a broken token, the API path, and one forced 500.
      await pageCalls(app).get(token).expect(200);
      await pageCalls(app).get(token, '/other').expect(200);
      await pageCalls(app).get(tokens[0]).expect(404);
      await pageCalls(app).get(`${token.slice(0, 20)}zzz`).expect(404);
      const apiError = await pageCalls(app).path('get', `/api/v1/c/${token}`).expect(404);
      bodies.push(JSON.stringify(apiError.body));
      expect(apiError.body.path).toBe('/api/v1/c/[token]');
      const record = jest.spyOn(app.get(ConfirmationServiceImpl), 'record').mockRejectedValueOnce(new Error(`database error at /c/${token}`));
      const failed = await pageCalls(app).answer(token, 'YES').expect(500);
      record.mockRestore();
      bodies.push(failed.text.split(token).join(''));
      expect((await confirmationOf(d1.order.id))?.status).toBe('PENDING');
    } finally {
      for (const spy of [...spies, ...staticSpies]) spy.mockRestore();
      stdout.mockRestore();
    }

    // Step 3: search everything captured, the error bodies and the message log.
    const messages = await getTestPrisma().outboundMessage.findMany({});
    expect(messages.length).toBeGreaterThanOrEqual(6);
    const haystack = [...captured, ...bodies, ...messages.map((row) => row.bodyRedacted)];
    for (const text of haystack) {
      expect(text).not.toMatch(LINK_PATTERN);
      for (const token of tokens) expect(text.includes(token)).toBe(false);
    }
    for (const row of messages) expect(row.bodyRedacted).toContain('[link]');
    const mockLines = captured.filter((line) => line.includes('sms.deliveryConfirm.v1') && line.includes('"chars"'));
    expect(mockLines.length).toBeGreaterThanOrEqual(2);
    for (const line of mockLines) expect(line).not.toContain('http');
    expect(captured.some((line) => line.includes('/c/[token]'))).toBe(true);

    // Sentry: the request URL and breadcrumbs are redacted before an event leaves.
    const sentry = sentryOptions();
    const event = sentry.beforeSend({ request: { url: `https://smartfleetpk.com/c/${tokens[1]}?done=1`, headers: {} } }) as { request: { url: string } };
    expect(event.request.url).toBe('https://smartfleetpk.com/c/[token]?done=1');
    const crumb = sentry.beforeBreadcrumb({ data: { url: `/c/${tokens[1]}/other`, to: `/c/${tokens[0]}`, from: '/c/x' } }) as { data: Record<string, string> };
    expect(crumb.data).toEqual({ url: '/c/[token]/other', to: '/c/[token]', from: '/c/[token]' });
  });
});
