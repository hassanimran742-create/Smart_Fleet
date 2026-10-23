import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SETTING_KEYS, type SettingKey } from '@smartfleet/shared-types';
import { systemActor, type UserActor } from '../../src/common/auth/actor';
import { AppError } from '../../src/common/errors/app-error';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service';
import {
  isEditableOverApi,
  isShipped,
  RELEASE_INCREMENT,
  settingDefinition,
  SETTINGS,
} from '../../src/modules/settings/registry';
import { SETTINGS_CACHE_MS, SettingsService } from '../../src/modules/settings/settings.service';

/** API_CONTRACT §6, row by row: default, public, editable, increment. */
const CONTRACT: Record<SettingKey, { default: unknown; public: boolean; editable: boolean; inc: 1 | 2 | 3 }> = {
  'dispatch.autoAssign.enabled': { default: false, public: true, editable: true, inc: 1 },
  // Reserved: code sign-in isn't built in the pilot (G11-15).
  'auth.otpLogin.enabled': { default: false, public: false, editable: false, inc: 1 },
  'auth.lockedRoles': { default: ['ADMIN', 'DISPATCHER', 'STORE_KEEPER', 'CLIENT'], public: false, editable: true, inc: 1 },
  'features.transfers': { default: false, public: true, editable: true, inc: 1 },
  'features.fuelRefills': { default: false, public: true, editable: true, inc: 1 },
  'features.accessories': { default: false, public: true, editable: true, inc: 1 },
  'features.support': { default: false, public: true, editable: true, inc: 1 },
  'features.clientApp': { default: false, public: true, editable: true, inc: 1 },
  'app.minVersion.driver': { default: '0.0.0', public: true, editable: true, inc: 1 },
  'app.minVersion.distributor': { default: '0.0.0', public: true, editable: true, inc: 1 },
  'orders.deliveryStartedAt': { default: 'FIRST_LOAD_SCAN', public: true, editable: true, inc: 1 },
  'orders.maxCylindersPerOrder': { default: 30, public: true, editable: true, inc: 1 },
  'pricing.deliveryStrategy': { default: 'DISTRIBUTOR_ZONE', public: false, editable: false, inc: 1 },
  'wallet.maxBalancePaisa': { default: null, public: true, editable: true, inc: 1 },
  'wallet.lowBalancePaisa': { default: 100000, public: true, editable: true, inc: 1 },
  'topup.minPaisa': { default: 50000, public: true, editable: true, inc: 1 },
  'topup.maxPaisa': { default: 5000000, public: true, editable: true, inc: 1 },
  'topup.quickAmountsPaisa': { default: [200000, 500000, 1000000], public: true, editable: true, inc: 1 },
  'topup.maxPendingPerDistributor': { default: 3, public: false, editable: true, inc: 1 },
  'topup.onAmountMismatch': { default: 'CREDIT_BANK_AMOUNT', public: false, editable: true, inc: 1 },
  'topup.checkingHours': { default: { from: '09:00', to: '21:00' }, public: true, editable: true, inc: 1 },
  // "yes (distributors)": shown by GET /payments/topup-info, not by the anonymous /app/config.
  'topup.account': { default: null, public: false, editable: false, inc: 1 },
  'topup.secondApproval': { default: { enabled: false, thresholdPaisa: 2000000 }, public: false, editable: false, inc: 1 },
  'refill.maxCylinders': { default: 30, public: true, editable: true, inc: 1 },
  'refill.deliveryCost': { default: { enabled: false, basePaisa: 0, perCylinderPaisa: 0 }, public: false, editable: false, inc: 1 },
  'support.phone': { default: null, public: true, editable: true, inc: 1 },
  'support.whatsApp': { default: null, public: true, editable: true, inc: 1 },
  'support.hours': { default: '9am–9pm', public: true, editable: true, inc: 1 },
  'day.timezone': { default: 'Asia/Karachi', public: true, editable: true, inc: 1 },
  'day.cutoffLocalTime': { default: '03:00', public: true, editable: true, inc: 1 },
  'confirmation.enabled': { default: false, public: true, editable: true, inc: 2 },
  'confirmation.linkTtlHours': { default: 72, public: false, editable: true, inc: 2 },
  'confirmation.caseOnAnswers': { default: ['NO', 'OTHER'], public: false, editable: true, inc: 2 },
  'messaging.testMode': { default: true, public: false, editable: true, inc: 2 },
  'messaging.allowlist': { default: [], public: false, editable: true, inc: 2 },
  'custody.typedEntry.enabled': { default: true, public: true, editable: true, inc: 2 },
  'custody.forgottenInPolicy': { default: 'BLOCK_OUT_MANUAL_DELIVERY', public: false, editable: false, inc: 2 },
  'trip.allowFinishWithLeftovers': { default: false, public: false, editable: true, inc: 2 },
  'walkIn.counterSwap.enabled': { default: false, public: false, editable: false, inc: 2 },
  'dayEnd.enabled': { default: false, public: true, editable: true, inc: 3 },
};

function accepts(key: SettingKey, value: unknown): boolean {
  return settingDefinition(key).schema.safeParse(value).success;
}

describe('settings registry (API_CONTRACT §6)', () => {
  it('has exactly one entry per SettingKey', () => {
    expect(Object.keys(SETTINGS).sort()).toEqual([...SETTING_KEYS].sort());
    for (const key of SETTING_KEYS) expect(SETTINGS[key].key).toBe(key);
  });

  it.each(SETTING_KEYS.map((key) => [key]))('%s matches the contract table and its default is valid', (key) => {
    const definition = SETTINGS[key];
    expect({ default: definition.default, public: definition.public, editable: definition.editable, inc: definition.inc }).toEqual(
      CONTRACT[key],
    );
    expect(accepts(key, definition.default)).toBe(true);
  });

  it('marks the reserved keys not editable over the API', () => {
    for (const key of ['topup.secondApproval', 'refill.deliveryCost', 'pricing.deliveryStrategy', 'topup.account'] as const) {
      expect(isEditableOverApi(key)).toBe(false);
    }
  });

  it('keeps later-increment keys at their defaults until they ship', () => {
    expect(RELEASE_INCREMENT).toBe(1);
    expect(isShipped('confirmation.enabled')).toBe(false);
    expect(isEditableOverApi('confirmation.enabled')).toBe(false);
    expect(isEditableOverApi('dayEnd.enabled')).toBe(false);
    expect(isEditableOverApi('topup.minPaisa')).toBe(true);
  });

  it.each<[SettingKey, unknown]>([
    ['orders.maxCylindersPerOrder', 0],
    ['orders.maxCylindersPerOrder', 101],
    ['orders.maxCylindersPerOrder', 2.5],
    ['refill.maxCylinders', 31],
    ['app.minVersion.driver', 'v1.0'],
    ['app.minVersion.driver', '1.2'],
    ['topup.minPaisa', 50050],
    ['topup.minPaisa', '50000'],
    ['wallet.maxBalancePaisa', -100],
    ['topup.quickAmountsPaisa', [200000, 200000]],
    ['auth.lockedRoles', ['ADMIN', 'SUPER_ADMIN']],
    ['auth.lockedRoles', ['NOBODY']],
    ['orders.deliveryStartedAt', 'LATER'],
    ['day.timezone', 'Mars/Olympus_Mons'],
    ['day.cutoffLocalTime', '3am'],
    ['topup.checkingHours', { from: '09:00', to: '09:00' }],
    ['topup.checkingHours', { from: '09:00', to: '21:00', extra: 1 }],
    ['support.phone', 'call me'],
    ['dispatch.autoAssign.enabled', 'true'],
    ['topup.account', { accountTitle: 'Smart Fleet', bankName: 'HBL', iban: 'not an iban', accountNumber: '1234' }],
  ])('refuses %s = %j', (key, value) => {
    expect(accepts(key, value)).toBe(false);
  });

  it.each<[SettingKey, unknown]>([
    ['wallet.maxBalancePaisa', null],
    ['wallet.maxBalancePaisa', 10000000],
    ['app.minVersion.driver', '0.2.0'],
    ['support.phone', '0300 1234567'],
    ['support.phone', null],
    ['auth.lockedRoles', []],
    ['day.timezone', 'Asia/Dubai'],
  ])('accepts %s = %j', (key, value) => {
    expect(accepts(key, value)).toBe(true);
  });

  it('stores an IBAN without spaces, upper-cased', () => {
    const parsed = settingDefinition('topup.account').schema.parse({
      accountTitle: 'Smart Fleet Pvt Ltd',
      bankName: 'HBL',
      iban: 'pk36 scbl 0000 0011 2345 6702',
      accountNumber: '0011-2345-6702',
    });
    expect(parsed?.iban).toBe('PK36SCBL0000001123456702');
  });
});

// ---- SettingsService with an in-memory database ----

interface Row {
  key: string;
  scope: string;
  value: unknown;
  updatedByUserId: string | null;
  updatedAt: Date;
  createdAt: Date;
}

class FakeDb {
  rows: Row[] = [];
  audits: Record<string, unknown>[] = [];
  findManyCalls = 0;

  appSetting = {
    findMany: jest.fn(async () => {
      this.findManyCalls += 1;
      return this.rows.map((row) => ({ ...row }));
    }),
    upsert: jest.fn(async (args: { where: { key_scope: { key: string } }; create: Row; update: Partial<Row> }) => {
      const value = (v: unknown) => (v === Prisma.JsonNull ? null : v);
      const existing = this.rows.find((row) => row.key === args.where.key_scope.key);
      if (existing) Object.assign(existing, { ...args.update, value: value(args.update.value), updatedAt: new Date() });
      else this.rows.push({ ...args.create, value: value(args.create.value), updatedAt: new Date(), createdAt: new Date() });
    }),
  };

  user = {
    findMany: jest.fn(async () => [{ id: 'u-office', name: 'Sana' }]),
  };

  auditLog = {
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      this.audits.push(args.data);
    }),
  };

  $queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (!sql.includes('FROM app_settings')) throw new Error(`unexpected SQL ${sql}`);
    return this.rows.filter((row) => row.key === values[0]).map((row) => ({ value: row.value }));
  });

  $transaction = jest.fn(async <T>(fn: (tx: FakeDb) => Promise<T>) => fn(this));
}

function setup(rows: Partial<Row>[] = []) {
  const db = new FakeDb();
  db.rows = rows.map((row) => ({
    scope: 'global',
    updatedByUserId: null,
    updatedAt: new Date('2026-10-21T10:00:00.000Z'),
    createdAt: new Date('2026-10-21T10:00:00.000Z'),
    value: null,
    key: '',
    ...row,
  }));
  const config = new ConfigService({ app: { environment: 'staging', updateUrl: null } });
  const audit = new AuditLogService(db as never);
  const service = new SettingsService(db as never, audit, config);
  return { db, service };
}

const office: UserActor = { kind: 'USER', userId: 'u-office', role: 'SUPER_ADMIN' };

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('SettingsService', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('reads defaults, then stored values, from a 30-second cache', async () => {
    const { db, service } = setup([{ key: 'topup.minPaisa', value: 100000 }]);
    expect(await service.get('topup.minPaisa')).toBe(100000);
    expect(await service.get('topup.maxPaisa')).toBe(5000000);
    expect(await service.get('features.transfers')).toBe(false);
    expect(db.findManyCalls).toBe(1);
    expect(SETTINGS_CACHE_MS).toBe(30_000);
  });

  it('never caches a copy that was read while a change committed', async () => {
    const { db, service } = setup([{ key: 'support.hours', value: '8am–8pm' }]);
    let release: () => void = () => undefined;
    const stale = db.rows.map((row) => ({ ...row }));
    db.appSetting.findMany.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(stale))) as never,
    );
    const slowRead = service.get('support.hours');
    // The office saves a new value while that read is still in flight.
    db.rows[0].value = '7am–11pm';
    service.invalidate();
    release();
    expect(await slowRead).toBe('8am–8pm');
    expect(await service.get('support.hours')).toBe('7am–11pm');
  });

  it('falls back to the default when a stored value is not valid', async () => {
    const { service } = setup([{ key: 'orders.maxCylindersPerOrder', value: 'lots' }]);
    expect(await service.get('orders.maxCylindersPerOrder')).toBe(30);
  });

  it('builds the public app config with money as digit strings', async () => {
    const { service } = setup([
      { key: 'wallet.maxBalancePaisa', value: 10000000 },
      { key: 'support.phone', value: '0300 1234567' },
      // Shipping in Inc 2: reported off in this build even when stored on.
      { key: 'confirmation.enabled', value: true },
    ]);
    const config = await service.publicConfig();
    expect(config).toMatchObject({
      environment: 'staging',
      training: false,
      minVersion: { driver: '0.0.0', distributor: '0.0.0' },
      support: { phone: '0300 1234567', whatsApp: null, hours: '9am–9pm' },
      topup: { minPaisa: '50000', maxPaisa: '5000000', quickAmountsPaisa: ['200000', '500000', '1000000'] },
      wallet: { lowBalancePaisa: '100000', capPaisa: '10000000' },
      orders: { maxCylindersPerOrder: 30, deliveryStartedAt: 'FIRST_LOAD_SCAN' },
      refill: { maxCylinders: 30 },
      day: { timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' },
      links: { updateUrl: null },
    });
    expect(config.features).toEqual({
      autoAssign: false,
      transfers: false,
      fuelRefills: false,
      accessories: false,
      support: false,
      clientApp: false,
      refills: true,
      scanFlow: false,
      confirmations: false,
      dayEnd: false,
      typedCylinderNumber: false,
      languageSwitch: false,
    });
    expect(JSON.stringify(config)).not.toMatch(/accountTitle|iban|thresholdPaisa/);
  });

  it('writes the row and the setting.update audit row {key, from, to} in one transaction', async () => {
    const { db, service } = setup();
    const row = await service.update('topup.maxPaisa', 7500000, office, 'Owner raised the limit');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.audits).toEqual([
      expect.objectContaining({
        action: 'setting.update',
        actorKind: 'USER',
        actorUserId: 'u-office',
        resourceType: 'setting',
        resourceId: null,
        reason: 'Owner raised the limit',
        diff: { key: 'topup.maxPaisa', from: 5000000, to: 7500000 },
      }),
    ]);
    expect(row).toMatchObject({ key: 'topup.maxPaisa', value: 7500000, default: 5000000, editable: true, public: true });
    expect(row.updatedBy).toEqual({ id: 'u-office', name: 'Sana' });
    expect(await service.get('topup.maxPaisa')).toBe(7500000);
  });

  it('changes nothing when the value is already stored', async () => {
    const { db, service } = setup([{ key: 'support.hours', value: '8am–8pm' }]);
    await service.update('support.hours', '8am–8pm', office, 'No change really');
    expect(db.appSetting.upsert).not.toHaveBeenCalled();
    expect(db.audits).toHaveLength(0);
  });

  it('refuses unknown keys, non-editable keys and invalid values, in that order', async () => {
    const { db, service } = setup();
    expect((await rejection(service.update('topup.nope', 1, office, 'a reason'))).code).toBe('SETTING_UNKNOWN');
    expect((await rejection(service.update('topup.account', 'garbage', office, 'a reason'))).code).toBe('SETTING_NOT_EDITABLE');
    expect((await rejection(service.update('confirmation.enabled', true, office, 'a reason'))).code).toBe('SETTING_NOT_EDITABLE');
    expect((await rejection(service.update('orders.maxCylindersPerOrder', 500, office, 'a reason'))).code).toBe(
      'SETTING_INVALID_VALUE',
    );
    expect(db.appSetting.upsert).not.toHaveBeenCalled();
  });

  it('keeps the top-up minimum at or below the maximum', async () => {
    const { service } = setup([{ key: 'topup.maxPaisa', value: 1000000 }]);
    expect((await rejection(service.update('topup.minPaisa', 2000000, office, 'too high'))).code).toBe('SETTING_INVALID_VALUE');
    await expect(service.update('topup.minPaisa', 100000, office, 'fine now')).resolves.toMatchObject({ value: 100000 });
  });

  it('lets only the SYSTEM settings CLI set a non-editable key such as topup.account', async () => {
    const { db, service } = setup();
    const account = { accountTitle: 'Smart Fleet', bankName: 'HBL', iban: 'PK36SCBL0000001123456702', accountNumber: '11234567' };
    expect(
      (await rejection(service.set('topup.account', account, office, 'not allowed', { allowNotEditable: true }))).code,
    ).toBe('SETTING_NOT_EDITABLE');
    await service.set('topup.account', account, systemActor('cli:settings'), "Owner's written request", {
      allowNotEditable: true,
    });
    expect(db.audits).toEqual([
      expect.objectContaining({
        action: 'setting.update',
        actorKind: 'SYSTEM',
        actorUserId: null,
        actorLabel: 'cli:settings',
        diff: { key: 'topup.account', from: null, to: account },
      }),
    ]);
    expect(await service.get('topup.account')).toEqual(account);
  });

  it('lists every key for the office form', async () => {
    const { service } = setup([{ key: 'features.support', value: true, updatedByUserId: 'u-office' }]);
    const rows = await service.list();
    expect(rows.map((row) => row.key)).toEqual([...SETTING_KEYS]);
    expect(rows.find((row) => row.key === 'features.support')).toMatchObject({
      value: true,
      default: false,
      type: 'boolean',
      updatedAt: '2026-10-21T10:00:00.000Z',
      updatedBy: { id: 'u-office', name: 'Sana' },
    });
    expect(rows.find((row) => row.key === 'orders.maxCylindersPerOrder')).toMatchObject({ type: 'integer', min: 1, max: 100 });
    expect(rows.find((row) => row.key === 'auth.lockedRoles')?.options).not.toContain('SUPER_ADMIN');
  });
});
