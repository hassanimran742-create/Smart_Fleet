/**
 * The confirmation lane's unit cases: the snapshot builder (CNF-008), the link tokens (CNF-025), the
 * boot guards and the provider choice (CNF-030), no wallet anywhere (CNF-038), the page's error filter
 * (CNF-047), the mock provider (MSG-002), the SMS text (MSG-005, MSG-006) and the phone forms (MSG-013).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { formatPkPhone, maskPhone } from '@smartfleet/shared-utils';
import { bootRefusalLine, checkBootEnvironment } from '../../../src/common/bootstrap/boot-guards';
import { AppError } from '../../../src/common/errors/app-error';
import {
  buildSnapshot,
  CONFIRM_TOKEN_LENGTH,
  confirmationLinkProblems,
  ConfirmationModule,
  ConfirmationServiceImpl,
  confirmationTokenHash,
  deriveConfirmationToken,
  normalizeConfirmationToken,
  pageForError,
  PublicPageExceptionFilter,
  smsUrl,
  telHref,
  waMeNumber,
} from '../../../src/modules/confirmation/confirmation.interface';
import type { PageContext } from '../../../src/modules/confirmation/public/page-context';
import { attachPageContext } from '../../../src/modules/confirmation/public/page-context';
import type { PageLink } from '../../../src/modules/confirmation/page/pages';
import {
  chooseMessagingProvider,
  isGsm7Basic,
  messagingProviderProblem,
  MessagingModule,
  MessagingServiceImpl,
  MockMessagingProvider,
  renderSms,
  smsShopName,
} from '../../../src/modules/messaging/messaging.interface';
import { TEST_CONFIRM_LINK_SECRET } from '../../helpers/customer-links';

const SRC = path.resolve(__dirname, '..', '..', '..', 'src');
const CYLINDER_NUMBER = /[A-Z][A-Z0-9]{1,5}-C[0-9]{4,}/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Every import specifier of the confirmation and messaging modules. */
function importsOf(...dirs: string[]): Array<{ file: string; from: string }> {
  return dirs.flatMap((dir) =>
    sourceFiles(path.join(SRC, 'modules', dir)).flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => ({
        file: path.relative(SRC, file).split(path.sep).join('/'),
        from: m[1] ?? m[2],
      })),
    ),
  );
}

describe('CNF-008 Snapshot groups sizes and take-backs correctly', () => {
  const sizes = { kg6: 't-6', kg11_8: 't-11.8', kg15: 't-15', kg45_4: 't-45.4' };
  const w = { [sizes.kg6]: '6.00', [sizes.kg11_8]: '11.80', [sizes.kg15]: '15.00', [sizes.kg45_4]: '45.40' };
  const of = (id: string) => ({ cylinderTypeId: id, weightKg: { toString: () => w[id] } });
  const base = { shop: { name: 'Ahmed Gas', phoneE164: '+923211234567' }, orderNo: 'AG-0001', deliveredAt: new Date('2026-10-22T11:12:00.000Z') };

  it('CNF-008 groups the GIVEN list by size (ascending, no trailing zeros) and the take-backs by size and state', () => {
    const snapshot = buildSnapshot({
      ...base,
      given: [of(sizes.kg45_4), of(sizes.kg11_8), of(sizes.kg11_8), of(sizes.kg6), of(sizes.kg15)],
      takenBack: [{ ...of(sizes.kg15), state: 'FULL' }],
      unlabelled: [
        { ...of(sizes.kg11_8), state: 'PART_FILLED', count: 1 },
        { ...of(sizes.kg11_8), state: 'EMPTY', count: 1 },
      ],
    });
    expect(snapshot.delivered).toEqual([
      { cylinderTypeId: sizes.kg6, size: '6 kg', count: 1 },
      { cylinderTypeId: sizes.kg11_8, size: '11.8 kg', count: 2 },
      { cylinderTypeId: sizes.kg15, size: '15 kg', count: 1 },
      { cylinderTypeId: sizes.kg45_4, size: '45.4 kg', count: 1 },
    ]);
    expect(snapshot.takenBack).toEqual([
      { cylinderTypeId: sizes.kg11_8, size: '11.8 kg', state: 'EMPTY', count: 1, unlabelled: true },
      { cylinderTypeId: sizes.kg11_8, size: '11.8 kg', state: 'PART_FILLED', count: 1, unlabelled: true },
      { cylinderTypeId: sizes.kg15, size: '15 kg', state: 'FULL', count: 1, unlabelled: false },
    ]);
    expect(snapshot).toMatchObject({ v: 1, shop: { name: 'Ahmed Gas', phoneE164: '+923211234567' }, orderNo: 'AG-0001', deliveredAt: '2026-10-22T11:12:00.000Z' });
    const json = JSON.stringify(snapshot);
    expect(json).not.toMatch(CYLINDER_NUMBER);
    expect(Object.keys(snapshot).sort()).toEqual(['delivered', 'deliveredAt', 'orderNo', 'shop', 'takenBack', 'v']);
    expect(json).not.toMatch(/Paisa|price|address|customer|client/i);
  });

  it('CNF-008 with nothing taken back, takenBack is empty', () => {
    const snapshot = buildSnapshot({ ...base, given: [of(sizes.kg11_8)], takenBack: [], unlabelled: [] });
    expect(snapshot.takenBack).toEqual([]);
  });
});

describe('CNF-025 The token is stable, 26 characters, never stored raw, and does not collide', () => {
  const secret = 'test-secret-of-exactly-32-chars!';
  const x = '4f7f8a64-3b0c-4c0e-9a9a-2d3c1e5f6a7b';
  const y = '0b5c0d8e-1f2a-4b3c-8d4e-5f6a7b8c9d0e';

  it('CNF-025 the same (id, version) gives the same 26-character token', () => {
    expect(secret).toHaveLength(32);
    const token = deriveConfirmationToken(secret, x, 1);
    expect(deriveConfirmationToken(secret, x, 1)).toBe(token);
    expect(token).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{26}$/);
    expect(CONFIRM_TOKEN_LENGTH).toBe(26);
  });

  it('CNF-025 another version, another id or another secret gives another token; only the sha256 is stored', () => {
    const token = deriveConfirmationToken(secret, x, 1);
    expect(deriveConfirmationToken(secret, x, 2)).not.toBe(token);
    expect(deriveConfirmationToken(secret, y, 1)).not.toBe(token);
    expect(deriveConfirmationToken(`${secret}-other`, x, 1)).not.toBe(token);
    expect(confirmationTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(confirmationTokenHash(token)).toBe(require('crypto').createHash('sha256').update(token).digest('hex'));
    expect(normalizeConfirmationToken(token.toUpperCase())).toBe(token);
  });

  it('CNF-025 100,000 ids give 100,000 distinct tokens', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) seen.add(deriveConfirmationToken(secret, `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`, 1));
    expect(seen.size).toBe(100_000);
  });
});

describe('CNF-030 The API refuses to start with an unsafe link secret, link URL or message provider', () => {
  /** A staging environment that passes every other guard. */
  const ready = (extra: Record<string, string | undefined>): Record<string, string | undefined> => ({
    NODE_ENV: 'staging',
    APP_ENV: 'staging',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    DATABASE_URL: 'postgresql://x/y',
    REDIS_URL: 'redis://x',
    BULLMQ_PREFIX: 'sf-staging',
    S3_BUCKET: 'bucket',
    S3_ACCESS_KEY: 'key',
    S3_SECRET_KEY: 'secret',
    CORS_ORIGINS: 'https://admin.smartfleetpk.com',
    ENCRYPTION_KEY: 'a'.repeat(64),
    BLIND_INDEX_KEY: 'b'.repeat(64),
    PUBLIC_LINK_BASE_URL: 'https://smartfleetpk.com',
    CONFIRM_LINK_SECRET: 'c'.repeat(32),
    ...extra,
  });
  const linkLines = (env: Record<string, string | undefined>) => confirmationLinkProblems(env);

  it('CNF-030 the link secret: missing or 31 characters is refused, naming CONFIRM_LINK_SECRET; 32 boots', () => {
    expect(linkLines(ready({ CONFIRM_LINK_SECRET: undefined }))).toEqual(['CONFIRM_LINK_SECRET is not set']);
    expect(linkLines(ready({ CONFIRM_LINK_SECRET: 'c'.repeat(31) }))).toEqual(['CONFIRM_LINK_SECRET must be at least 32 characters']);
    expect(linkLines(ready({}))).toEqual([]);
    // The boot guards main.ts runs already refuse a short secret with one line.
    const problems = checkBootEnvironment(ready({ CONFIRM_LINK_SECRET: 'c'.repeat(31) }));
    expect(problems).toEqual(['CONFIRM_LINK_SECRET must be at least 32 characters']);
    expect(bootRefusalLine(problems)).toBe('BOOT_REFUSED: CONFIRM_LINK_SECRET must be at least 32 characters');
    expect(bootRefusalLine(problems)).not.toContain('\n');
    expect(checkBootEnvironment(ready({}))).toEqual([]);
  });

  it('CNF-030 the link URL: http is refused in production, naming PUBLIC_LINK_BASE_URL; https boots', () => {
    const production = (url: string) => ready({ NODE_ENV: 'production', APP_ENV: 'production', BULLMQ_PREFIX: 'sf-prod', PUBLIC_LINK_BASE_URL: url });
    expect(linkLines(production('http://smartfleetpk.com'))).toEqual(['PUBLIC_LINK_BASE_URL must be an https URL']);
    expect(checkBootEnvironment(production('http://smartfleetpk.com'))).toEqual(['PUBLIC_LINK_BASE_URL must be an https URL']);
    expect(linkLines(production('https://smartfleetpk.com'))).toEqual([]);
    expect(checkBootEnvironment(production('https://smartfleetpk.com'))).toEqual([]);
  });

  it('CNF-030 the message provider: an unknown name refuses to boot; unset or mock boots the mock', () => {
    const mock = new MockMessagingProvider();
    expect(() => chooseMessagingProvider('whatsapp', { mock })).toThrow(/MESSAGING_PROVIDER "whatsapp" is not a known provider/);
    expect(messagingProviderProblem({ MESSAGING_PROVIDER: 'whatsapp' })).toBe('MESSAGING_PROVIDER must be one of mock');
    expect(chooseMessagingProvider(undefined, { mock })).toBe(mock);
    expect(chooseMessagingProvider('mock', { mock })).toBe(mock);
    expect(messagingProviderProblem({})).toBeNull();
    expect(messagingProviderProblem({ MESSAGING_PROVIDER: 'mock' })).toBeNull();
    expect(mock).toBeInstanceOf(MockMessagingProvider);
  });

  const gateWired = (process.env.SF_READY_LANES ?? '').split(',').map((s) => s.trim()).some((s) => s === 'all' || s === 'inc2-gate');
  (gateWired ? it : it.skip)('CNF-030 the boot guards require the link env and check MESSAGING_PROVIDER from Inc 2 [waits on the inc2 gate]', () => {
    expect(checkBootEnvironment(ready({ CONFIRM_LINK_SECRET: undefined }))).toEqual(['CONFIRM_LINK_SECRET is not set']);
    expect(checkBootEnvironment(ready({ PUBLIC_LINK_BASE_URL: undefined }))).toEqual(['PUBLIC_LINK_BASE_URL is not set']);
    expect(checkBootEnvironment(ready({ MESSAGING_PROVIDER: 'whatsapp' }))).toEqual(['MESSAGING_PROVIDER must be one of mock']);
  });
});

describe('CNF-038 Confirmation and messaging code cannot reach the wallet', () => {
  it('CNF-038 no file of the confirmation or messaging module imports the wallet or the ledger', () => {
    const imports = importsOf('confirmation', 'messaging');
    expect(imports.length).toBeGreaterThan(20);
    const wallet = imports.filter((use) => /wallet|ledger/i.test(use.from) || /WalletService|LedgerService|WalletModule/.test(use.from));
    expect(wallet).toEqual([]);
    for (const file of sourceFiles(path.join(SRC, 'modules', 'confirmation')).concat(sourceFiles(path.join(SRC, 'modules', 'messaging')))) {
      expect({ file, uses: /WalletService|LedgerService|WalletModule|LedgerModule/.test(fs.readFileSync(file, 'utf8')) }).toEqual({ file, uses: false });
    }
  });

  it('CNF-038 neither module imports WalletModule, and the services take no wallet or ledger', () => {
    for (const module of [ConfirmationModule, MessagingModule]) {
      const imported = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ?? []) as Array<{ name?: string }>;
      expect(imported.map((m) => m?.name)).not.toContain('WalletModule');
      const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) ?? []) as unknown[];
      expect(JSON.stringify(providers.map((p) => (typeof p === 'function' ? p.name : String((p as { provide?: unknown }).provide?.toString?.()))))).not.toMatch(/Wallet|Ledger/);
    }
    for (const service of [ConfirmationServiceImpl, MessagingServiceImpl]) {
      const params = (Reflect.getMetadata('design:paramtypes', service) ?? []) as Array<{ name?: string }>;
      expect(params.length).toBeGreaterThan(0);
      for (const param of params) expect(param?.name ?? '').not.toMatch(/Wallet|Ledger/);
    }
  });
});

describe('CNF-047 The link page\'s error filter turns each CONFIRM_* code into its HTML page, never JSON', () => {
  const link: PageLink = {
    shop: 'Ahmed Gas',
    shopPhone: '+923211234567',
    orderNo: 'AG-0001',
    deliveredAt: new Date('2026-10-22T11:12:00.000Z'),
    expiresAt: new Date('2026-10-25T11:12:00.000Z'),
    delivered: [{ size: '11.8 kg', count: 2 }],
    takenBack: [],
    response: 'YES',
    respondedAt: new Date('2026-10-22T11:20:00.000Z'),
  };
  const token = '3h7k9m2q4r6t8v0w1x5y7z9a2b';

  function run(exception: unknown, step: PageContext['step'] = null) {
    const req = { method: 'POST', url: `/c/${token}`, originalUrl: `/c/${token}` } as never;
    attachPageContext(req, { ip: '1.2.3.4', token, step, link, form: { answer: 'OTHER', comment: 'ok' }, supportPhone: '+923331234567', frame: { environment: 'test' }, retryAfterSeconds: 60 });
    const sent: { status?: number; type?: string; body?: string; headers: Record<string, string> } = { headers: {} };
    const res = {
      headersSent: false,
      setHeader: (name: string, value: string) => (sent.headers[name.toLowerCase()] = value),
      status(code: number) {
        sent.status = code;
        return this;
      },
      type(value: string) {
        sent.type = value;
        sent.headers['content-type'] = value === 'html' ? 'text/html; charset=utf-8' : value;
        return this;
      },
      send(body: string) {
        sent.body = body;
        return this;
      },
      end() {
        return this;
      },
    };
    const host = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as never;
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    new PublicPageExceptionFilter().catch(exception, host);
    error.mockRestore();
    const text = (sent.body ?? '').replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
    return { ...sent, text };
  }

  it('CNF-047 each code draws its page with its status, as HTML, echoing neither the URL nor the token', () => {
    const cases: Array<[unknown, number, string[]]> = [
      [new AppError('CONFIRM_LINK_INVALID'), 404, ["We can't find this link", 'Call Smart Fleet support · 0333 1234567']],
      [new AppError('CONFIRM_LINK_EXPIRED'), 410, ['This link has expired', 'Problem? Call Ahmed Gas · 0321 1234567']],
      [new AppError('CONFIRM_NOTE_REQUIRED'), 400, ['Other problem', 'Please write a few words.']],
      [new AppError('CONFIRM_ALREADY_ANSWERED'), 409, ['You already answered', 'You said: All received · Thu 22 Oct, 4:20 pm']],
      [new AppError('CONFIRM_LINK_INACTIVE'), 410, ['This link is closed', 'No answer is needed.']],
      [new AppError('VALIDATION_FAILED', { fields: [] }), 400, ['Did you get your delivery?', 'Please tap one answer below.']],
      [new AppError('RATE_LIMITED', { minutes: 1 }), 429, ['Too many tries', 'Please wait 1 minute, then try again.']],
      [new Error('connection refused'), 500, ['Something went wrong', 'Your answer was not saved.', 'Try again']],
    ];
    for (const [exception, status, words] of cases) {
      const out = run(exception);
      expect(out.status).toBe(status);
      expect(out.headers['content-type']).toBe('text/html; charset=utf-8');
      for (const word of words) expect({ status, has: out.text.includes(word) }).toEqual({ status, has: true });
      expect(out.body?.trim().startsWith('{')).toBe(false);
      expect(out.body).not.toContain('connection refused');
      expect(out.body).not.toMatch(/at \w+ \(/);
      const outside = (out.body ?? '').replace(/(?:href|action)="[^"]*"/g, '');
      expect(outside).not.toContain(token);
    }
    expect(run(new AppError('CONFIRM_NOTE_REQUIRED')).body).toContain('role="alert"');
    expect(run(new AppError('VALIDATION_FAILED', { fields: [] })).body).toContain('<p class="err" role="alert">Please tap one answer below.</p>');
    expect(run(new AppError('RATE_LIMITED', { minutes: 1 })).headers['retry-after']).toBe('60');
    expect(pageForError('CONFIRM_LINK_INVALID', { ip: '', token: null, step: null, link: null, form: null, supportPhone: null, frame: { environment: 'production' } }).status).toBe(404);
  });
});

describe('MSG-002 The mock provider never logs the message text or the link', () => {
  it('MSG-002 it answers SKIPPED MOCK_PROVIDER and logs only the masked number, the template and the length', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const token = deriveConfirmationToken(TEST_CONFIRM_LINK_SECRET, 'id', 1);
      const text = `Ahmed Gas: Order AG-0001 delivered. Did you get it? Tap https://smartfleetpk.com/c/${token} Help: 03211234567`;
      expect(text).toHaveLength(127);
      const result = await new MockMessagingProvider().send({
        messageId: 'm1',
        channel: 'SMS',
        toE164: '+923001234567',
        templateKey: 'sms.deliveryConfirm.v1',
        locale: 'en',
        params: { shop: 'Ahmed Gas', orderNo: 'AG-0001', link: `https://smartfleetpk.com/c/${token}`, phone: '03211234567' },
        text,
      });
      expect(result).toEqual({ kind: 'SKIPPED', reason: 'MOCK_PROVIDER' });
      expect(log).toHaveBeenCalledTimes(1);
      const logged = String(log.mock.calls[0][0]);
      expect(JSON.parse(logged)).toEqual({ to: '+923*****67', templateKey: 'sms.deliveryConfirm.v1', chars: 127 });
      for (const banned of ['http', token, 'Ahmed Gas', '+923001234567', '03211234567']) expect(logged).not.toContain(banned);
    } finally {
      log.mockRestore();
    }
  });

  it('MSG-002 the confirmation and messaging modules never use the OTP SmsService or its mock (which logs whole bodies)', () => {
    const uses = importsOf('confirmation', 'messaging').filter((use) => /sms\.service|mock-sms\.provider|modules\/sms\b|\.\.\/sms\//.test(use.from));
    expect(uses).toEqual([]);
    for (const file of sourceFiles(path.join(SRC, 'modules', 'confirmation')).concat(sourceFiles(path.join(SRC, 'modules', 'messaging')))) {
      expect({ file, uses: /\bSmsService\b|MockSmsProvider/.test(fs.readFileSync(file, 'utf8')) }).toEqual({ file, uses: false });
    }
  });
});

describe('MSG-005 The SMS text template and its 160-character limit', () => {
  const host = (length: number) => `https://${'h'.repeat(length - 4)}.com/c/`;
  const token = '3h7k9m2q4r6t8v0w1x5y7z9a2b';
  const shop20 = 'ABCDEFGHIJKLMNOPQRST';
  const check = (text: string, link: string) => {
    expect(text.length).toBeLessThanOrEqual(160);
    expect(isGsm7Basic(text)).toBe(true);
    const after = text.indexOf(link) + link.length;
    expect(text.indexOf(link)).toBeGreaterThan(0);
    expect(after === text.length || text[after] === ' ').toBe(true);
  };

  it('MSG-005 the exact text and its length for the standard orders', () => {
    const link1 = 'https://smartfleetpk.com/c/3h7k9m2q4r6t8v0w1x5y7z9a2b';
    const one = renderSms({ shop: 'Ali Gas', orderNo: 'AG-0142', link: link1, phone: '03001234567' }).text;
    expect(one).toBe('Ali Gas: Order AG-0142 delivered. Did you get it? Tap https://smartfleetpk.com/c/3h7k9m2q4r6t8v0w1x5y7z9a2b Help: 03001234567');
    expect(one).toHaveLength(125);
    check(one, link1);
    const two = renderSms({ shop: 'Ahmed Gas', orderNo: 'AG-0001', link: link1, phone: formatPkPhone('+923211234567', 'compact') }).text;
    expect(two).toBe(`Ahmed Gas: Order AG-0001 delivered. Did you get it? Tap ${link1} Help: 03211234567`);
    expect(two).toHaveLength(127);
    check(two, link1);
  });

  it('MSG-005 the worst case fits; longer hosts drop the help part, then shorten the shop name', () => {
    const link24 = `${host(24)}${token}`;
    expect(link24.length).toBe(61);
    const worst = renderSms({ shop: shop20, orderNo: 'ABCDEF-9999', link: link24, phone: '03211234567' });
    expect(worst.text).toHaveLength(150);
    expect(worst.helpDropped).toBe(false);
    check(worst.text, link24);

    const link40 = `${host(40)}${token}`;
    const noHelp = renderSms({ shop: shop20, orderNo: 'ABCDEF-9999', link: link40, phone: '03211234567' });
    expect(noHelp.text).toHaveLength(148);
    expect(noHelp.text.endsWith(link40)).toBe(true);
    check(noHelp.text, link40);

    const link55 = `${host(55)}${token}`;
    const shorter = renderSms({ shop: shop20, orderNo: 'ABCDEF-9999', link: link55, phone: '03211234567' });
    expect(shorter.text).toHaveLength(160);
    expect(shorter.text.startsWith(`${shop20.slice(0, 17)}: Order`)).toBe(true);
    expect(shorter.text).toContain(link55);
    check(shorter.text, link55);

    const fiveDigits = renderSms({ shop: shop20, orderNo: 'ABCDEF-10000', link: link24, phone: '03211234567' });
    expect(fiveDigits.text).toHaveLength(151);
    expect(fiveDigits.helpDropped).toBe(false);
    check(fiveDigits.text, link24);
  });
});

describe('MSG-006 Shop names are made SMS-safe and cut to 20 characters', () => {
  const link = 'https://smartfleetpk.com/c/3h7k9m2q4r6t8v0w1x5y7z9a2b';
  it('MSG-006 each name becomes GSM-7 basic text of at most 20 characters', () => {
    const cases: Array<[string, string]> = [
      ['Ahmed Gas ✓', 'Ahmed Gas'],
      ['Ahmed’s Gas', "Ahmed's Gas"],
      ['Ahmed Gas & Sons Traders Lahore', 'Ahmed Gas & Sons Tra'],
      ['Gas {Best} [Lahore]', 'Gas Best Lahore'],
      ['احمد گیس', 'Smart Fleet'],
    ];
    for (const [name, expected] of cases) {
      expect(smsShopName(name)).toBe(expected);
      const text = renderSms({ shop: name, orderNo: 'AG-0001', link, phone: '03211234567' }).text;
      expect(text.startsWith(`${expected}: Order AG-0001`)).toBe(true);
      expect(isGsm7Basic(text)).toBe(true);
      expect(text.length).toBeLessThanOrEqual(160);
      expect(text).not.toMatch(/[✓’{}[\]]/);
    }
  });
});

describe('MSG-013 A stored +92 number is written correctly for each use', () => {
  it('MSG-013 display, SMS help, wa.me, sms:, tel: and the masked log form', () => {
    const e164 = '+923001234567';
    expect(formatPkPhone(e164, 'local')).toBe('0300 1234567');
    expect(formatPkPhone(e164, 'compact')).toBe('03001234567');
    expect(waMeNumber(e164)).toBe('923001234567');
    expect(smsUrl(e164, 'Hi')).toBe('sms:+923001234567?body=Hi');
    expect(telHref(e164)).toBe('tel:+923001234567');
    expect(maskPhone(e164)).toBe('+923*****67');
    expect(telHref('042 35551234')).toBe('tel:04235551234');
    expect(telHref(null)).toBeNull();
  });
});
