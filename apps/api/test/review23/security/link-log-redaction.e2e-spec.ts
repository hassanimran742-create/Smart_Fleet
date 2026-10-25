/**
 * Review 23 (security): the customer link's token must never reach a log (CUSTOMER_PAGE §5 "Redaction",
 * §12). The page accepts a token in any letter case and with any separators (§2: "lower-case it ... strip
 * other characters"), but the Caddy access-log filter only rewrites a lower-case run of `[0-9a-z]`
 * (infrastructure/aws/Caddyfile `request>uri regexp "^/c/[0-9a-z]+" "/c/[token]"`). So a link opened as
 * `/c/3H7K…` or `/c/3h7k-9m2q-…` works, and Caddy writes the live token to its access log.
 *
 * The filter is applied here with the same regular expression (RE2 and JavaScript read this pattern the
 * same way: an anchored, case-sensitive character class).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { createConfirmation } from '../../helpers/customer-links';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createOrder } from '../../helpers/runs';
import { createStandardData } from '../../helpers/standard-data';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { systemActor } from '../../../src/common/auth/actor';
import { redactPath } from '../../../src/common/http/redact';

jest.setTimeout(120_000);

const CADDYFILE = path.resolve(__dirname, '../../../../../infrastructure/aws/Caddyfile');

/** Every `request>uri regexp "<re>" "<replacement>"` of the Caddyfile, as Caddy's log filter applies them. */
function caddyUriFilters(): Array<{ re: RegExp; replacement: string }> {
  const text = fs.readFileSync(CADDYFILE, 'utf8');
  const out: Array<{ re: RegExp; replacement: string }> = [];
  for (const match of text.matchAll(/request>uri regexp "([^"]+)" "([^"]*)"/g)) out.push({ re: new RegExp(match[1], 'g'), replacement: match[2] });
  return out;
}

function caddyLoggedUri(uri: string): string {
  return caddyUriFilters().reduce((value, filter) => value.replace(filter.re, filter.replacement), uri);
}

describeDb('review23 security: link tokens in the Caddy access log', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('REV23-SEC-LINK-LOG a link opened in upper case or with separators works, and the Caddy filter leaves its token in the log', async () => {
    await resetDb();
    app.get(SettingsService).invalidate();
    const std = await createStandardData();
    await app.get(SettingsService).set('confirmation.enabled', true, systemActor('cli:settings'), 'Review 23 link log check');
    const order = await createOrder({ distributor: std.DA, client: std.C1, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1 }], status: OrderStatus.DELIVERED });
    const link = await createConfirmation({ order });
    expect(caddyUriFilters().length).toBeGreaterThan(0);

    const variants = [
      `/c/${link.token}`,
      `/c/${link.token.toUpperCase()}`,
      `/c/${link.token.match(/.{1,4}/g)?.join('-')}`,
      `/c/${link.token}?done=1`,
      // Express routes are case-insensitive, so the whole link in capitals opens the page too.
      `/C/${link.token.toUpperCase()}`,
    ];
    const seen: Array<{ uri: string; status: number; logged: string; leaks: boolean }> = [];
    for (const uri of variants) {
      const res = await http(app).get(uri);
      const logged = caddyLoggedUri(uri);
      const leaks = logged.toLowerCase().replace(/[^0-9a-z]/g, '').includes(link.token.slice(4));
      seen.push({ uri: uri.replace(link.token, '<token>'), status: res.status, logged, leaks });
    }
    // eslint-disable-next-line no-console
    console.log(`[review23] ${JSON.stringify(seen.map(({ uri, status, leaks }) => ({ uri, status, leaks })))}`);
    // Every variant opens the customer's live page...
    expect(seen.map((row) => row.status)).toEqual([200, 200, 200, 200, 200]);
    // ...so none may leave the token in the access log, and the API's own redaction (error envelopes,
    // Sentry URLs: redactPath) must hide a "/C/" link as well.
    const apiRedacted = redactPath(`/C/${link.token.toUpperCase()}`);
    // eslint-disable-next-line no-console
    console.log(`[review23] redactPath('/C/<TOKEN>') keeps the token: ${apiRedacted.includes(link.token.toUpperCase())}`);
    expect({
      caddyLeaks: seen.filter((row) => row.leaks).map((row) => row.uri),
      apiRedactionKeepsToken: apiRedacted.includes(link.token.toUpperCase()),
    }).toEqual({ caddyLeaks: [], apiRedactionKeepsToken: false });
  });
});
