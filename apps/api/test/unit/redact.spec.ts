import * as fs from 'fs';
import * as path from 'path';
import { envelopePath, redactPath } from '../../src/common/http/redact';

const TOKEN = '33k658mq1brkfzw4gm1jypyjjs';

/** The Caddyfile's access-log filters, applied as Caddy (RE2) applies them: every pattern is RE2- and JS-safe. */
function caddyLogged(uri: string): string {
  const text = fs.readFileSync(path.resolve(__dirname, '../../../../infrastructure/aws/Caddyfile'), 'utf8');
  const filters = [...text.matchAll(/request>uri regexp "([^"]+)" "([^"]*)"/g)];
  expect(filters.length).toBe(3); // both API hosts and the short-link template
  return filters.reduce((value, [, re, replacement]) => value.replace(new RegExp(re, 'g'), replacement), uri);
}

describe('REV23 security-04 a link token never reaches a log, in any form the page accepts', () => {
  const forms = [
    `/c/${TOKEN}`,
    `/c/${TOKEN.toUpperCase()}`,
    `/c/${TOKEN.match(/.{1,4}/g)?.join('-')}`,
    `/C/${TOKEN.toUpperCase()}`,
    `/C/${TOKEN}`,
    `/c//${TOKEN}`,
  ];

  it('REV23 security-04 redactPath hides it in the error envelope, request logs and Sentry URLs', () => {
    for (const form of forms) {
      expect(redactPath(form)).toBe('/c/[token]');
      expect(redactPath(`/api/v1${form}`)).toBe('/api/v1/c/[token]');
      expect(redactPath(`https://api.smartfleetpk.com${form}?done=1`)).toBe('https://api.smartfleetpk.com/c/[token]?done=1');
      expect(envelopePath(`${form}?done=1#x`)).toBe('/c/[token]');
    }
    // Other paths are left alone.
    expect(redactPath('/api/v1/clients/123')).toBe('/api/v1/clients/123');
    expect(redactPath('/api/v1/orders/abc/confirmation')).toBe('/api/v1/orders/abc/confirmation');
  });

  it('REV23 security-04 the Caddy access-log filter hides it on every host', () => {
    for (const form of forms) {
      const logged = caddyLogged(`${form}?done=1`);
      expect({ form, logged, leaks: logged.toLowerCase().replace(/[^0-9a-z]/g, '').includes(TOKEN.slice(4)) }).toEqual({
        form,
        logged: '/c/[token]?done=1',
        leaks: false,
      });
    }
    expect(caddyLogged('/api/v1/health')).toBe('/api/v1/health');
  });
});
