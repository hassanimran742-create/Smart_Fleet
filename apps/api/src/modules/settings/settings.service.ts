import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  SETTING_KEYS,
  type AnySettingRow,
  type AppEnvironment,
  type PublicAppConfig,
  type SettingKey,
  type SettingRowDto,
  type SettingValue,
} from '@smartfleet/shared-types';
import { actorUserId, type Actor } from '../../common/auth/actor';
import { AppError } from '../../common/errors/app-error';
import { validationMessage } from '../../common/errors/messages';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { isEditableOverApi, isSettingKey, isShipped, RELEASE_INCREMENT, settingDefinition, SETTINGS } from './registry';

/** Settings rows are global for the pilot; `distributor:<uuid>` scopes come later. */
export const GLOBAL_SCOPE = 'global';

/** How long a process trusts its copy of `app_settings` (API_CONTRACT §5.2). */
export const SETTINGS_CACHE_MS = 30_000;
const RETRY_AFTER_FAILURE_MS = 5_000;

interface StoredSetting {
  value: unknown;
  updatedAt: Date;
  updatedByUserId: string | null;
}

interface Snapshot {
  loadedAt: number;
  rows: Map<SettingKey, StoredSetting>;
}

export interface SetSettingOptions {
  /** Lets a SYSTEM actor (the settings CLI) change keys that are not editable over the API. */
  allowNotEditable?: boolean;
}

/** JSON with object keys sorted, so jsonb's key order never makes equal values look different. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return inner;
  });
}

function toPaisaText(value: number): string {
  return String(value);
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private snapshot: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;
  private generation = 0;
  private readonly warnedInvalid = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService,
  ) {}

  /** The current value: the stored row when valid, else the registry default. Cached for 30 seconds. */
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    return this.valueOf(key, await this.load());
  }

  /** Drops the cached copy; the next read loads `app_settings` again. */
  invalidate(): void {
    this.generation += 1;
    this.snapshot = null;
    this.loading = null;
  }

  /**
   * Changes one setting (API_CONTRACT §5.2): validates the value against the registry
   * (SETTING_INVALID_VALUE), refuses keys that are not editable (SETTING_NOT_EDITABLE) unless the
   * settings CLI asks, and writes the row and the `setting.update` audit row `{ key, from, to }` in
   * one transaction. Saving the value it already has changes nothing. Returns the updated row.
   */
  async set<K extends SettingKey>(
    key: K,
    value: SettingValue<K>,
    actor: Actor,
    reason: string,
    options: SetSettingOptions = {},
  ): Promise<SettingRowDto<K>> {
    return this.write(key, value, actor, reason, options);
  }

  /**
   * `PATCH /settings/:key` with an unchecked key and value: SETTING_UNKNOWN, then
   * SETTING_NOT_EDITABLE, then SETTING_INVALID_VALUE.
   */
  async update(key: string, value: unknown, actor: Actor, reason: string): Promise<AnySettingRow> {
    if (!isSettingKey(key)) throw new AppError('SETTING_UNKNOWN');
    return (await this.write(key, value, actor, reason, {})) as AnySettingRow;
  }

  private async write<K extends SettingKey>(
    key: K,
    value: unknown,
    actor: Actor,
    reason: string,
    options: SetSettingOptions,
  ): Promise<SettingRowDto<K>> {
    if (!isSettingKey(key)) throw new AppError('SETTING_UNKNOWN');
    const definition = settingDefinition(key);
    const bypass = options.allowNotEditable === true && actor.kind === 'SYSTEM';
    if (!bypass && !isEditableOverApi(key)) throw new AppError('SETTING_NOT_EDITABLE');
    const next = this.parseValue(key, value);
    const why = reason?.trim();
    if (!why) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'reason', code: 'REQUIRED', message: validationMessage('REQUIRED') }],
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.$queryRaw<{ value: unknown }[]>`
        SELECT value FROM app_settings WHERE key = ${key} AND scope = ${GLOBAL_SCOPE} FOR UPDATE`;
      const from = current.length > 0 ? this.validStored(key, current[0].value) : definition.default;
      await this.assertConsistent(key, next, tx);
      if (current.length > 0 && stableJson(from) === stableJson(next)) return;

      const json = next === null ? Prisma.JsonNull : (next as Prisma.InputJsonValue);
      const updatedByUserId = actorUserId(actor);
      await tx.appSetting.upsert({
        where: { key_scope: { key, scope: GLOBAL_SCOPE } },
        create: { key, scope: GLOBAL_SCOPE, value: json, updatedByUserId },
        update: { value: json, updatedByUserId },
      });
      await this.audit.record(
        { action: 'setting.update', actor, resourceType: 'setting', reason: why, diff: { key, from, to: next } },
        tx,
      );
    });
    this.invalidate();
    return this.row(key);
  }

  /**
   * Validates a value for `key` and returns the stored form (for example an IBAN without spaces).
   * SETTING_UNKNOWN or SETTING_INVALID_VALUE otherwise.
   */
  parseValue<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
    if (!isSettingKey(key)) throw new AppError('SETTING_UNKNOWN');
    const parsed = settingDefinition(key).schema.safeParse(value);
    if (!parsed.success) throw new AppError('SETTING_INVALID_VALUE');
    return parsed.data;
  }

  /** `GET /settings` (office): every key with its value, default, form hints and who changed it. */
  async list(): Promise<AnySettingRow[]> {
    const snapshot = await this.load();
    const names = await this.userNames([...snapshot.rows.values()].map((row) => row.updatedByUserId));
    return SETTING_KEYS.map((key) => this.toRow(key, snapshot, names) as AnySettingRow);
  }

  /** One row of `GET /settings`, read fresh. */
  async row<K extends SettingKey>(key: K): Promise<SettingRowDto<K>> {
    const snapshot = await this.load();
    const names = await this.userNames([snapshot.rows.get(key)?.updatedByUserId ?? null]);
    return this.toRow(key, snapshot, names);
  }

  /** `GET /app/config` (public): the settings marked public, money as digit strings (API_CONTRACT §6). */
  async publicConfig(): Promise<PublicAppConfig> {
    const snapshot = await this.load();
    const v = <K extends SettingKey>(key: K): SettingValue<K> => this.valueOf(key, snapshot);
    const shippedAndOn = (key: 'confirmation.enabled' | 'dayEnd.enabled' | 'custody.typedEntry.enabled') =>
      isShipped(key) && v(key);
    const environment = (this.config.get<AppEnvironment>('app.environment') ?? 'development') as AppEnvironment;
    const cap = v('wallet.maxBalancePaisa');
    return {
      environment,
      training: environment === 'training',
      minVersion: { driver: v('app.minVersion.driver'), distributor: v('app.minVersion.distributor') },
      support: { phone: v('support.phone'), whatsApp: v('support.whatsApp'), hours: v('support.hours') },
      features: {
        autoAssign: v('dispatch.autoAssign.enabled'),
        transfers: v('features.transfers'),
        fuelRefills: v('features.fuelRefills'),
        accessories: v('features.accessories'),
        support: v('features.support'),
        clientApp: v('features.clientApp'),
        refills: true,
        scanFlow: RELEASE_INCREMENT >= 2,
        confirmations: shippedAndOn('confirmation.enabled'),
        dayEnd: shippedAndOn('dayEnd.enabled'),
        typedCylinderNumber: shippedAndOn('custody.typedEntry.enabled'),
        languageSwitch: false,
      },
      topup: {
        minPaisa: toPaisaText(v('topup.minPaisa')),
        maxPaisa: toPaisaText(v('topup.maxPaisa')),
        quickAmountsPaisa: v('topup.quickAmountsPaisa').map(toPaisaText),
        checkingHours: v('topup.checkingHours'),
      },
      wallet: { lowBalancePaisa: toPaisaText(v('wallet.lowBalancePaisa')), capPaisa: cap === null ? null : toPaisaText(cap) },
      orders: { maxCylindersPerOrder: v('orders.maxCylindersPerOrder'), deliveryStartedAt: v('orders.deliveryStartedAt') },
      refill: { maxCylinders: v('refill.maxCylinders') },
      day: { timezone: v('day.timezone'), cutoffLocalTime: v('day.cutoffLocalTime') },
      links: { updateUrl: this.config.get<string | null>('app.updateUrl') ?? null },
    };
  }

  // ---- internals ----

  private load(): Promise<Snapshot> {
    if (this.snapshot && Date.now() - this.snapshot.loadedAt < SETTINGS_CACHE_MS) return Promise.resolve(this.snapshot);
    if (this.loading) return this.loading;
    // A write that commits while this read is in flight bumps the generation, so the older copy
    // is returned to its callers but never cached.
    const generation = this.generation;
    const loading: Promise<Snapshot> = this.fetch()
      .then((snapshot) => {
        if (generation === this.generation) this.snapshot = snapshot;
        return snapshot;
      })
      .catch((error: unknown) => {
        if (!this.snapshot) throw error;
        // Keep serving the last good copy while the database is unreachable; retry shortly.
        this.logger.warn(`Settings reload failed, using the cached copy: ${(error as Error)?.message ?? error}`);
        this.snapshot = { ...this.snapshot, loadedAt: Date.now() - SETTINGS_CACHE_MS + RETRY_AFTER_FAILURE_MS };
        return this.snapshot;
      })
      .finally(() => {
        if (this.loading === loading) this.loading = null;
      });
    this.loading = loading;
    return loading;
  }

  private async fetch(): Promise<Snapshot> {
    const rows = await this.prisma.appSetting.findMany({ where: { scope: GLOBAL_SCOPE } });
    const map = new Map<SettingKey, StoredSetting>();
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      map.set(row.key, { value: row.value, updatedAt: row.updatedAt, updatedByUserId: row.updatedByUserId });
    }
    return { loadedAt: Date.now(), rows: map };
  }

  private valueOf<K extends SettingKey>(key: K, snapshot: Snapshot): SettingValue<K> {
    const stored = snapshot.rows.get(key);
    return stored ? this.validStored(key, stored.value) : SETTINGS[key].default;
  }

  /** A stored value that no longer fits the registry (a hand edit) falls back to the default, with a warning. */
  private validStored<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
    const parsed = settingDefinition(key).schema.safeParse(value);
    if (parsed.success) return parsed.data;
    const marker = `${key}:${stableJson(value)}`;
    if (!this.warnedInvalid.has(marker)) {
      this.warnedInvalid.add(marker);
      this.logger.warn(`Stored setting ${key} is not valid; using its default`);
    }
    return SETTINGS[key].default;
  }

  /** Cross-key rules: the top-up minimum can't exceed the maximum. */
  private async assertConsistent(key: SettingKey, next: unknown, tx: Prisma.TransactionClient): Promise<void> {
    if (key !== 'topup.minPaisa' && key !== 'topup.maxPaisa') return;
    const other = key === 'topup.minPaisa' ? 'topup.maxPaisa' : 'topup.minPaisa';
    const rows = await tx.$queryRaw<{ value: unknown }[]>`
      SELECT value FROM app_settings WHERE key = ${other} AND scope = ${GLOBAL_SCOPE}`;
    const otherValue = rows.length > 0 ? this.validStored(other, rows[0].value) : SETTINGS[other].default;
    const [min, max] = key === 'topup.minPaisa' ? [next as number, otherValue] : [otherValue, next as number];
    if (min > max) throw new AppError('SETTING_INVALID_VALUE');
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  private toRow<K extends SettingKey>(key: K, snapshot: Snapshot, names: Map<string, string>): SettingRowDto<K> {
    const definition = settingDefinition(key);
    const stored = snapshot.rows.get(key);
    const updatedById = stored?.updatedByUserId ?? null;
    return {
      key,
      value: this.valueOf(key, snapshot),
      default: definition.default,
      type: definition.type,
      ...(definition.options ? { options: definition.options } : {}),
      ...(definition.min !== undefined ? { min: definition.min } : {}),
      ...(definition.max !== undefined ? { max: definition.max } : {}),
      editable: isEditableOverApi(key),
      public: definition.public,
      updatedAt: stored ? stored.updatedAt.toISOString() : null,
      updatedBy: updatedById ? { id: updatedById, name: names.get(updatedById) ?? '' } : null,
    };
  }
}
