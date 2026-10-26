/**
 * FND-009: the shop and driver apps (`toUserMessage`, apps/mobile/src/api/errors.ts) and the office
 * website (`messageFor`, apps/admin-web/src/api/errors.ts) fill error messages from `details` with the
 * real English resources, showing every *Paisa value as rupees (API_CONTRACT §2.1, UX_MOBILE §3.2,
 * UX_ADMIN §1.7). The apps have no test runner of their own, so their pure modules run here; only the
 * website's i18n entry is replaced, because it reads Vite's `import.meta.env`.
 */
import * as path from 'path';

const APPS = path.resolve(__dirname, '..', '..', '..');
const ADMIN_I18N = path.join(APPS, 'admin-web', 'src', 'i18n', 'index.ts');

type MessageOf = (error: unknown) => string;

interface Case {
  code: string;
  details?: Record<string, unknown>;
  message?: string;
}

/** The body the server sends, as an axios error would carry it. */
function axiosError({ code, details, message }: Case): unknown {
  const status = 409;
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: 'Request failed',
    config: { headers: {} },
    response: {
      status,
      data: { statusCode: status, code, error: code, message, details: details ?? {}, requestId: 'req-1' },
      headers: {},
    },
    toJSON: () => ({}),
  };
}

function loadMobile(): MessageOf {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const errors = require(path.join(APPS, 'mobile', 'src', 'api', 'errors.ts')) as typeof import('../../../mobile/src/api/errors');
  return (error) => errors.toUserMessage(errors.toApiError(error));
}

function loadAdmin(): MessageOf {
  jest.doMock(ADMIN_I18N, () => {
    const i18next = jest.requireActual('i18next') as typeof import('i18next');
    const { errors } = jest.requireActual(path.join(APPS, 'admin-web', 'src', 'i18n', 'en', 'errors.ts'));
    const { validation } = jest.requireActual(path.join(APPS, 'admin-web', 'src', 'i18n', 'en', 'validation.ts'));
    const instance = i18next.createInstance();
    void instance.init({
      lng: 'en',
      resources: { en: { errors, validation } },
      ns: ['errors', 'validation'],
      defaultNS: 'errors',
      initImmediate: false,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    const translateDynamic = (key: string, params?: Record<string, unknown>): string | null =>
      instance.exists(key) ? (instance.t as unknown as (k: string, o?: unknown) => string)(key, params) : null;
    return { __esModule: true, default: instance, translateDynamic, currentLanguage: () => 'en' };
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const errors = require(path.join(APPS, 'admin-web', 'src', 'api', 'errors.ts')) as { messageFor: MessageOf };
  return errors.messageFor;
}

const CASES: [string, Case, string][] = [
  [
    'insufficient balance (example X4, Rs 249)',
    { code: 'WALLET_INSUFFICIENT_BALANCE', details: { requiredPaisa: '25000', balancePaisa: '24900', shortByPaisa: '100' } },
    'Not enough balance. This needs Rs 250 and you have Rs 249. Add money to continue.',
  ],
  ['top-up too small', { code: 'TOPUP_AMOUNT_TOO_SMALL', details: { minPaisa: '50000', maxPaisa: '5000000' } }, 'The minimum top-up is Rs 500.'],
  [
    'wrong app',
    { code: 'AUTH_WRONG_APP', details: { role: 'DRIVER', app: 'Smart Fleet Driver app' } },
    'This account is for the Smart Fleet Driver app.',
  ],
  ['an unknown code with a server message', { code: 'SOMETHING_NEW', message: 'Server says hi.' }, 'Server says hi.'],
  ['an unknown code without a message', { code: 'SOMETHING_NEW' }, 'Something went wrong. Please try again.'],
];

describe('FND-009 The apps fill error messages from details and show *Paisa values as rupees', () => {
  let mobile: MessageOf;
  let admin: MessageOf;

  beforeAll(() => {
    mobile = loadMobile();
    admin = loadAdmin();
  });

  it.each(CASES)('FND-009 the shop and driver apps word %s', (_label, error, expected) => {
    expect(mobile(axiosError(error))).toBe(expected);
  });

  it.each(CASES)('FND-009 the office website words %s', (_label, error, expected) => {
    expect(admin(axiosError(error))).toBe(expected);
  });
});
