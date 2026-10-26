/**
 * The Increment 2 contracts this lane ships (no database): the shared-types mirrors of the inc2 Prisma
 * enums, the Inc 2 settings unlocked by RELEASE_INCREMENT 2 (confirmation stays off, ADR-15), the Inc 2
 * request schemas, the cross-lane stubs, the link-token rules (CUSTOMER_PAGE §2) and the two migration
 * files (UTF-8, LF, their generated DDL exactly what `prisma migrate diff` makes from the schema
 * snapshots, no new enum value used as a literal, every pre-check naming its fix and migration).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as prismaEnums from '@prisma/client';
import * as types from '@smartfleet/shared-types';
import {
  casesQuerySchema,
  cleanCustomerComment,
  customerAnswerSchema,
  finishStopSchema,
  finishTripSchema,
  manualDeliveryV2Schema,
  parseRequest,
  storeScanSchema,
  tripScanSchema,
  unlabelledReturnsSchema,
  updateClientSchema,
} from '@smartfleet/shared-validation';
import { AppError } from '../../../src/common/errors/app-error';
import { AuditLogService } from '../../../src/modules/audit-log/audit-log.service';
import {
  CONFIRM_TOKEN_LENGTH,
  confirmationTokenHash,
  deriveConfirmationToken,
  NoopConfirmationService,
  normalizeConfirmationToken,
} from '../../../src/modules/confirmation/confirmation.interface';
import {
  chooseMessagingProvider,
  MockMessagingProvider,
  NoopMessagingService,
} from '../../../src/modules/messaging/messaging.interface';
import { isEditableOverApi, isShipped, RELEASE_INCREMENT, SETTINGS } from '../../../src/modules/settings/registry';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { INC1A_SCHEMA, INC1B_MIGRATION, INC1B_SCHEMA, INC2_MIGRATION, INC2_SCHEMA, MIGRATIONS_DIR } from '../../helpers/migrations';

const API_DIR = path.resolve(__dirname, '..', '..', '..');

describe('inc2 enum mirrors (shared-types = schema.prisma)', () => {
  const valuesOf = (source: unknown) =>
    Object.values(source as Record<string, unknown>)
      .filter((v): v is string => typeof v === 'string')
      .sort();

  it.each(['CylinderEventSource', 'StopCylinderDirection', 'ConfirmationStatus', 'ConfirmationResponse', 'MessageChannel', 'MessageStatus'])(
    '%s holds the schema.prisma values',
    (name) => {
      const fromPrisma = (prismaEnums as unknown as Record<string, unknown>)[name];
      const fromShared = (types as unknown as Record<string, unknown>)[name];
      expect(fromPrisma).toBeDefined();
      expect(valuesOf(fromShared)).toEqual(valuesOf(fromPrisma));
    },
  );

  it('the changed enums carry their inc2 values', () => {
    expect(valuesOf(types.CylinderState)).toContain('PART_FILLED');
    expect(valuesOf(types.CylinderEventType)).toContain('REGISTERED');
    expect(valuesOf(types.AlertType)).toEqual(expect.arrayContaining(['CUSTOMER_PROBLEM', 'VAN_NOT_EMPTY']));
    expect(types.MESSAGE_SKIP_REASONS).toEqual(['MOCK_PROVIDER', 'NOT_A_TEST_PHONE']);
    expect(types.MESSAGE_FAIL_CODES).toEqual(['INVALID_NUMBER', 'REJECTED', 'TIMEOUT', 'AUTH', 'UNAVAILABLE', 'UNKNOWN']);
  });
});

describe('Inc 2 settings (API_CONTRACT §6, §9.1)', () => {
  const INC2_KEYS = types.SETTING_KEYS.filter((key) => SETTINGS[key].inc === 2);

  it('from Increment 2 on, the Inc 2 keys are live; the Inc 3 key ships with Increment 3', () => {
    expect(RELEASE_INCREMENT).toBeGreaterThanOrEqual(2);
    expect(INC2_KEYS).toEqual([
      'confirmation.enabled',
      'confirmation.linkTtlHours',
      'confirmation.caseOnAnswers',
      'messaging.testMode',
      'messaging.allowlist',
      'custody.typedEntry.enabled',
      'custody.forgottenInPolicy',
      'trip.allowFinishWithLeftovers',
      'walkIn.counterSwap.enabled',
    ]);
    for (const key of INC2_KEYS) expect({ key, shipped: isShipped(key) }).toEqual({ key, shipped: true });
    expect(isShipped('dayEnd.enabled')).toBe(RELEASE_INCREMENT >= 3);
    expect(isEditableOverApi('dayEnd.enabled')).toBe(RELEASE_INCREMENT >= 3);
  });

  it('only the built Inc 2 keys can be changed over the API; confirmation stays off by default (ADR-15)', () => {
    const editable = INC2_KEYS.filter((key) => isEditableOverApi(key));
    expect(editable).toEqual([
      'confirmation.enabled',
      'confirmation.linkTtlHours',
      'confirmation.caseOnAnswers',
      'messaging.testMode',
      'messaging.allowlist',
      'custody.typedEntry.enabled',
      'trip.allowFinishWithLeftovers',
    ]);
    expect(SETTINGS['confirmation.enabled'].default).toBe(false);
    expect(SETTINGS['messaging.testMode'].default).toBe(true);
    expect(SETTINGS['custody.typedEntry.enabled'].default).toBe(true);
  });

  function serviceWith(initial: Array<{ key: string; value: unknown }>) {
    const rows = initial.map((row) => ({ ...row }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      appSetting: {
        findMany: jest.fn(async () =>
          rows.map((row) => ({ ...row, scope: 'global', updatedAt: new Date(), createdAt: new Date(), updatedByUserId: null })),
        ),
        upsert: jest.fn(async (args: { create: { key: string; value: unknown }; update: { value: unknown } }) => {
          const existing = rows.find((row) => row.key === args.create.key);
          if (existing) existing.value = args.update.value;
          else rows.push({ key: args.create.key, value: args.create.value });
        }),
      },
      user: { findMany: jest.fn(async () => []) },
      auditLog: { create: jest.fn(async () => undefined) },
      $queryRaw: jest.fn(async () => []),
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db)),
    };
    const config = new ConfigService({ app: { environment: 'test', updateUrl: null } });
    return { db, service: new SettingsService(db as never, new AuditLogService(db as never), config) };
  }

  it('GET /app/config reports the scan flow on; confirmations follow the stored switch; day-end is on from Inc 3', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const defaults = await serviceWith([]).service.publicConfig();
    expect(defaults.features).toMatchObject({ scanFlow: true, confirmations: false, typedCylinderNumber: true, dayEnd: RELEASE_INCREMENT >= 3 });
    const switched = await serviceWith([
      { key: 'confirmation.enabled', value: true },
      { key: 'custody.typedEntry.enabled', value: false },
      { key: 'dayEnd.enabled', value: true },
    ]).service.publicConfig();
    expect(switched.features).toMatchObject({ scanFlow: true, confirmations: true, typedCylinderNumber: false, dayEnd: RELEASE_INCREMENT >= 3 });
  });

  it('PATCH /settings/:key accepts the editable Inc 2 keys and refuses the reserved ones and bad values', async () => {
    const office = { kind: 'USER' as const, userId: 'u-office', role: 'SUPER_ADMIN' as never };
    const { db, service } = serviceWith([]);
    await expect(service.update('confirmation.enabled', true, office, 'Owner switched it on')).resolves.toMatchObject({ value: true });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    const code = async (key: string, value: unknown) => {
      try {
        await service.update(key, value, office, 'A reason here');
      } catch (error) {
        return (error as AppError).code;
      }
      return 'OK';
    };
    expect(await code('custody.forgottenInPolicy', 'BLOCK_OUT_MANUAL_DELIVERY')).toBe('SETTING_NOT_EDITABLE');
    expect(await code('walkIn.counterSwap.enabled', true)).toBe('SETTING_NOT_EDITABLE');
    expect(await code('dayEnd.enabled', true)).toBe(RELEASE_INCREMENT >= 3 ? 'OK' : 'SETTING_NOT_EDITABLE');
    expect(await code('confirmation.linkTtlHours', 23)).toBe('SETTING_INVALID_VALUE');
    expect(await code('confirmation.linkTtlHours', 169)).toBe('SETTING_INVALID_VALUE');
    expect(await code('confirmation.caseOnAnswers', ['NO', 'NO'])).toBe('SETTING_INVALID_VALUE');
    expect(await code('confirmation.caseOnAnswers', ['MAYBE'])).toBe('SETTING_INVALID_VALUE');
    expect(await code('messaging.allowlist', ['0300 1234567'])).toBe('SETTING_INVALID_VALUE');
    expect(await code('messaging.allowlist', ['+923001234567'])).toBe('OK');
    expect(await code('confirmation.linkTtlHours', 168)).toBe('OK');
  });
});

describe('Inc 2 request schemas (shared-validation)', () => {
  const fields = (result: ReturnType<typeof parseRequest>) => (result.success ? [] : result.fields.map((f) => `${f.path}:${f.code}`));
  const scan = { scanId: '11111111-1111-4111-8111-111111111111', stopId: '22222222-2222-4222-8222-222222222222', code: 'AG-C0042', entryMethod: 'TYPED' };

  it('a scan body never names where a cylinder goes, and a take-back needs its return state', () => {
    expect(fields(parseRequest(tripScanSchema, { ...scan, action: 'LOAD', toCustodyType: 'CLIENT' }))).toEqual(['toCustodyType:NOT_ALLOWED']);
    expect(fields(parseRequest(storeScanSchema, { scanId: scan.scanId, code: '42', entryMethod: 'QR', toCustodyId: scan.stopId }))).toEqual([
      'toCustodyId:NOT_ALLOWED',
    ]);
    const short = parseRequest(tripScanSchema, { ...scan, action: 'TAKE_BACK' });
    expect(short.success ? 'ok' : short.errorCode).toBe('SCAN_RETURN_STATE_REQUIRED');
    const ok = parseRequest(tripScanSchema, { ...scan, action: 'TAKE_BACK', returnState: 'PART_FILLED', extra: 'dropped' });
    expect(ok).toMatchObject({ success: true, data: { action: 'TAKE_BACK', returnState: 'PART_FILLED' } });
    expect(ok.success && 'extra' in ok.data).toBe(false);
    expect(fields(parseRequest(tripScanSchema, { ...scan, action: 'REGISTER' }))).toEqual(['action:INVALID_CHOICE']);
  });

  it('unlabelled returns: at most 20 items, a count of 0–30, one per size and state', () => {
    const size = '33333333-3333-4333-8333-333333333333';
    expect(parseRequest(unlabelledReturnsSchema, { items: [{ cylinderTypeId: size, state: 'EMPTY', count: 0 }] }).success).toBe(true);
    expect(fields(parseRequest(unlabelledReturnsSchema, { items: [{ cylinderTypeId: size, state: 'EMPTY', count: 31 }] }))).toEqual([
      'items.0.count:TOO_LARGE',
    ]);
    expect(
      fields(
        parseRequest(unlabelledReturnsSchema, {
          items: [
            { cylinderTypeId: size, state: 'FULL', count: 1 },
            { cylinderTypeId: size, state: 'FULL', count: 2 },
          ],
        }),
      ),
    ).toEqual(['items.1.state:DUPLICATE_ITEM']);
    expect(fields(parseRequest(unlabelledReturnsSchema, { items: [{ cylinderTypeId: size, state: 'LOST', count: 1 }] }))).toEqual([
      'items.0.state:INVALID_CHOICE',
    ]);
  });

  it('finishing: a short take-back with OTHER needs a note; a leftover reason is 5–300 characters', () => {
    expect(fields(parseRequest(finishStopSchema, { takeBackShort: { reasonCode: 'OTHER' } }))).toEqual(['takeBackShort.note:NOTE_REQUIRED']);
    expect(parseRequest(finishStopSchema, { takeBackShort: { reasonCode: 'CUSTOMER_KEPT' } }).success).toBe(true);
    expect(fields(parseRequest(finishTripSchema, { leftoverReason: 'shut' }))).toEqual(['leftoverReason:TOO_SHORT']);
    expect(parseRequest(finishTripSchema, { leftoverReason: 'Store closed' }).success).toBe(true);
  });

  it('manual delivery v2 names 1–100 cylinders with a 10–300 character reason', () => {
    expect(fields(parseRequest(manualDeliveryV2Schema, { reason: 'too short', cylinders: [] }))).toEqual([
      'reason:TOO_SHORT',
      'cylinders:TOO_FEW_ITEMS',
    ]);
    expect(
      parseRequest(manualDeliveryV2Schema, {
        reason: 'Driver forgot the load scan',
        cylinders: [{ code: '42' }],
        takenBack: [{ code: 'AG-C0007', returnState: 'EMPTY' }],
      }).success,
    ).toBe(true);
  });

  it('PATCH /clients/:id takes a name, phone and notes; blank notes clear them; addresses are dropped', () => {
    const parsed = parseRequest(updateClientSchema, { name: ' Sana ', notes: '  ', address: { label: 'x', lat: 1, lng: 2 } });
    expect(parsed).toEqual({ success: true, data: { name: 'Sana', notes: null } });
    expect(parseRequest(updateClientSchema, {}).success).toBe(true);
    expect(fields(parseRequest(updateClientSchema, { name: '' }))).toEqual(['name:REQUIRED']);
  });

  it('the cases list is CUSTOMER_PROBLEM only, OPEN by default', () => {
    expect(parseRequest(casesQuerySchema, { type: 'CUSTOMER_PROBLEM' })).toMatchObject({ success: true, data: { status: 'OPEN', limit: 30 } });
    expect(fields(parseRequest(casesQuerySchema, { type: 'LOW_STOCK' }))).toEqual(['type:INVALID_CHOICE']);
    expect(fields(parseRequest(casesQuerySchema, { type: 'CUSTOMER_PROBLEM', status: 'ACKNOWLEDGED' }))).toEqual(['status:INVALID_CHOICE']);
  });

  it("the customer's comment is cleaned in the CUSTOMER_PAGE §4 order, and Other needs 3 characters of it", () => {
    expect(cleanCustomerComment('  Gas\r\nwas\tlow\u0007 ,  thanks  ')).toBe('Gas was low , thanks');
    expect(cleanCustomerComment('\u0000\u001f\u007f\u009f')).toBeNull();
    expect(cleanCustomerComment(42)).toBeNull();
    expect(Array.from(cleanCustomerComment('😀'.repeat(400)) ?? '')).toHaveLength(300);
    expect(parseRequest(customerAnswerSchema, { answer: 'YES', v: '1' })).toEqual({ success: true, data: { answer: 'YES', comment: null } });
    expect(fields(parseRequest(customerAnswerSchema, { answer: 'OTHER', comment: ' a\n ' }))).toEqual(['comment:NOTE_REQUIRED']);
    expect(parseRequest(customerAnswerSchema, { answer: 'OTHER', comment: 'Wrong size came' }).success).toBe(true);
    expect(fields(parseRequest(customerAnswerSchema, { answer: 'MAYBE' }))).toEqual(['answer:INVALID_CHOICE']);
    expect(fields(parseRequest(customerAnswerSchema, {}))).toEqual(['answer:REQUIRED']);
  });
});

describe('cross-lane stubs (API_CONTRACT §5.9)', () => {
  it('the no-op confirmation service issues nothing and has no data; its route methods are not built yet', async () => {
    const service = new NoopConfirmationService();
    expect(await service.issueForDeliveredOrder({} as never, { orderId: 'o', stopId: 's', deliveredAt: new Date() })).toBeNull();
    await expect(service.sendIssued(null)).resolves.toBeUndefined();
    expect(await service.summariesFor(['o'])).toEqual(new Map());
    expect(await service.hasPendingForClient('c')).toBe(false);
    expect(await service.expireDue()).toBe(0);
    const office = { kind: 'USER' as const, userId: 'u', role: 'SUPER_ADMIN' as never };
    await expect(service.view('o', office)).rejects.toMatchObject({ code: 'INTERNAL_ERROR', details: { reason: 'NOT_IMPLEMENTED' } });
    await expect(service.share('o', 'COPY', undefined, office)).rejects.toBeInstanceOf(AppError);
    await expect(service.newLink('o', {}, office)).rejects.toBeInstanceOf(AppError);
    await expect(service.record('t', 'YES', null)).rejects.toBeInstanceOf(AppError);
  });

  it('the mock provider sends nothing and logs only the masked number, the template and the length', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const provider = new MockMessagingProvider();
    const text = 'Ahmed Gas: Order AG-0142 delivered. Did you get it? Tap https://x.pk/c/3h7k9m2q4r6t8v0w1x5y7z9a2b Help: 03211234567';
    const result = await provider.send({
      messageId: 'm1',
      channel: 'SMS',
      toE164: '+923001234567',
      templateKey: 'sms.deliveryConfirm.v1',
      locale: 'en',
      params: {},
      text,
    });
    expect(result).toEqual({ kind: 'SKIPPED', reason: 'MOCK_PROVIDER' });
    const logged = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).not.toContain('3h7k9m2q4r6t8v0w1x5y7z9a2b');
    expect(logged).not.toContain('+923001234567');
    expect(logged).toContain('sms.deliveryConfirm.v1');
    expect(logged).toContain(`"chars":${text.length}`);
    const noop = new NoopMessagingService();
    const request = { channel: 'SMS' as const, toE164: '+923001234567', templateKey: 'sms.deliveryConfirm.v1' as const, locale: 'en' as const, params: {}, text };
    expect(await noop.sendQueued('m1', request)).toEqual({ kind: 'SKIPPED', reason: 'MOCK_PROVIDER' });
    await expect(noop.record({} as never, {} as never)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('MESSAGING_PROVIDER picks the mock by default and refuses an unknown name', () => {
    const mock = new MockMessagingProvider();
    expect(chooseMessagingProvider(undefined, { mock })).toBe(mock);
    expect(chooseMessagingProvider(' mock ', { mock })).toBe(mock);
    expect(() => chooseMessagingProvider('eocean', { mock })).toThrow(/MESSAGING_PROVIDER "eocean" is not a known provider/);
  });
});

describe('confirmation link tokens (CUSTOMER_PAGE §2)', () => {
  const SECRET = 'a-secret-of-at-least-thirty-two-characters!';

  it('are 26 Crockford characters, stable for one (id, version), and new for the next version', () => {
    const id = '0b5c0d8e-1f2a-4b3c-8d4e-5f6a7b8c9d0e';
    const token = deriveConfirmationToken(SECRET, id, 1);
    expect(token).toMatch(new RegExp(`^[0-9abcdefghjkmnpqrstvwxyz]{${CONFIRM_TOKEN_LENGTH}}$`));
    expect(deriveConfirmationToken(SECRET, id, 1)).toBe(token);
    expect(deriveConfirmationToken(SECRET, id, 2)).not.toBe(token);
    expect(deriveConfirmationToken(`${SECRET}x`, id, 1)).not.toBe(token);
    expect(confirmationTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('read I, L and O as 1, 1 and 0, ignore case and stray characters, and refuse anything else without a lookup', () => {
    const token = deriveConfirmationToken(SECRET, 'x', 1);
    expect(normalizeConfirmationToken(token.toUpperCase())).toBe(token);
    expect(normalizeConfirmationToken(token.replace(/1/g, 'I').replace(/0/g, 'o'))).toBe(token);
    expect(normalizeConfirmationToken(`${token.slice(0, 13)}-${token.slice(13)}`)).toBe(token);
    expect(normalizeConfirmationToken(token.slice(1))).toBeNull();
    expect(normalizeConfirmationToken(`${token}a`)).toBeNull();
    expect(normalizeConfirmationToken(`${token}${'-'.repeat(40)}`)).toBeNull();
    expect(normalizeConfirmationToken('')).toBeNull();
  });

  it('have no collisions over 100,000 confirmations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) seen.add(deriveConfirmationToken(SECRET, `id-${i}`, 1));
    expect(seen.size).toBe(100_000);
  });
});

describe('the inc1b and inc2 migration files', () => {
  const file = (name: string) => path.join(MIGRATIONS_DIR, name, 'migration.sql');
  const sql = (name: string) => fs.readFileSync(file(name), 'utf8');
  const section = (text: string, from: string, to: string) => text.slice(text.indexOf(from) + from.length, text.indexOf(to)).trim();
  const diff = (from: string, to: string): string => {
    const run = spawnSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-schema-datamodel', from, '--to-schema-datamodel', to, '--script'],
      { cwd: API_DIR, encoding: 'utf8', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' }, maxBuffer: 64 * 1024 * 1024 },
    );
    if (run.status !== 0) throw new Error(`prisma migrate diff failed: ${run.stderr}`);
    return run.stdout.replace(/\r\n/g, '\n').trim();
  };

  it.each([INC1B_MIGRATION, INC2_MIGRATION])('%s is UTF-8 without a BOM, with LF line endings', (name) => {
    const bytes = fs.readFileSync(file(name));
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(bytes.includes(Buffer.from('\r\n'))).toBe(false);
    expect(Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)).toBe(true);
  });

  it('inc1b keeps the generated DDL unchanged (the diff from the inc1a schema to the inc1b schema)', () => {
    expect(section(sql(INC1B_MIGRATION), '-- (4) GENERATED DDL (unchanged)', '-- (5) WALLET INVARIANTS')).toBe(diff(INC1A_SCHEMA, INC1B_SCHEMA));
  }, 120_000);

  it('inc2 keeps the generated DDL unchanged (the diff from the inc1b schema to the Inc 2 schema)', () => {
    expect(section(sql(INC2_MIGRATION), '-- (2) GENERATED DDL (unchanged)', '-- (3) BACKFILLS')).toBe(diff(INC1B_SCHEMA, INC2_SCHEMA));
  }, 120_000);

  it('inc2 uses no value it adds to an existing enum as a literal (55P04), except through ::text', () => {
    const text = sql(INC2_MIGRATION);
    const added = [...text.matchAll(/ALTER TYPE "\w+" ADD VALUE '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(added.sort()).toEqual(['CUSTOMER_PROBLEM', 'PART_FILLED', 'REGISTERED', 'VAN_NOT_EMPTY']);
    const handEdits = text.slice(text.indexOf('-- (3) BACKFILLS'));
    for (const value of added) {
      const uses = [...handEdits.matchAll(new RegExp(`'${value}'`, 'g'))].length;
      const textUses = [...handEdits.matchAll(new RegExp(`::text IN \\([^)]*'${value}'`, 'g'))].length;
      expect({ value, literalUses: uses - textUses }).toEqual({ value, literalUses: 0 });
    }
  });

  it.each([
    [INC1B_MIGRATION, 'inc1b', 3],
    [INC2_MIGRATION, 'inc2', 1],
  ])('%s: every pre-check raises MIGRATION_BLOCKED %s with its fix and the resolve command', (name, short, count) => {
    const text = sql(name);
    const raises = [...text.matchAll(/RAISE EXCEPTION 'MIGRATION_BLOCKED ([a-z0-9]+): ([^']|'')+'/g)].map((m) => m[0]);
    expect(raises).toHaveLength(count);
    for (const raise of raises) {
      expect(raise).toContain(`MIGRATION_BLOCKED ${short}: `);
      expect(raise).toContain(`run "prisma migrate resolve --rolled-back ${name}", then deploy again.`);
    }
  });
});
