import { Injectable } from '@nestjs/common';
import { CustodyType, CylinderState, DistributorStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import type { SettingKey } from '@smartfleet/shared-types';
import type { PilotSetupFile } from '@smartfleet/shared-validation';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { systemActor, type SystemActor, type UserActor } from '../../../common/auth/actor';
import { AppError } from '../../../common/errors/app-error';
import { IdempotentResponse } from '../../../common/idempotency/idempotency';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { CitiesService } from '../../cities/cities.service';
import { ClientsService } from '../../clients/clients.service';
import { cylinderShortCode } from '../../custody/cylinder-codes';
import { ScanService } from '../../custody/scan.service';
import { CylinderTypesService } from '../../cylinder-types/cylinder-types.service';
import { DistributorsService } from '../../distributors/distributors.service';
import { DriversService } from '../../drivers/drivers.service';
import { FillingStationsService } from '../../filling-stations/filling-stations.service';
import { PricingService } from '../../pricing/pricing.service';
import { sizeLabelOf } from '../../pricing/size-label';
import { ZonePriceLookup } from '../../pricing/zone-price.lookup';
import { isEditableOverApi, isSettingKey } from '../../settings/registry';
import { SettingsService } from '../../settings/settings.service';
import { VehiclesService } from '../../vehicles/vehicles.service';
import { WalletService } from '../../wallet/wallet.service';
import { walletKeys } from '../../wallet/wallet.types';
import { ZonesService } from '../../zones/zones.service';
import { PilotRefusal, formatPath, type JsonPath } from '../refusal';
import { runInTransaction } from '../tx-scope';
import { entryLabel, type CheckedSetupFile } from './setup-file';
import { generateSetupPassword, type CylinderLabel, type NewLogin } from './setup-output';

/** The audit label of every change a setup run makes (API_CONTRACT §10.3, Appendix B `pilot.setup`). */
export const PILOT_SETUP_LABEL = 'cli:pilot-setup';

/** Long enough for argon2 hashes and a few hundred cylinders on a slow machine; a run is one transaction. */
const RUN_TX = { maxWait: 15_000, timeout: 300_000 } as const;

/** Two zones overlap when their interiors share more than this many square metres (API_CONTRACT §10.3). */
const OVERLAP_M2 = 1;

/** What a setup run created and changed, per kind of row; `unchanged` counts the entries left as they were. */
export const SETUP_KINDS = [
  'city',
  'zones',
  'officeUsers',
  'cylinderTypes',
  'distributors',
  'prices',
  'drivers',
  'vans',
  'stations',
  'settings',
  'cylinders',
  'customers',
  'openingBalances',
] as const;
export type SetupKind = (typeof SETUP_KINDS)[number];

export interface KindTally {
  /** What was created, by name ("North", "AG", "AG-C0001"…). */
  created: string[];
  changed: string[];
  unchanged: number;
}

export interface SetupOptions {
  /** `--test`: the shops, their users, the drivers' users and the vans become `is_test` rows. */
  test: boolean;
  /** `--dry-run`: every check and write runs, then the transaction is rolled back. */
  dryRun: boolean;
  /** For the audit row and the settings' reason: the file's name. */
  fileName: string;
}

export interface SetupOutcome {
  tally: Record<SetupKind, KindTally>;
  /** Logins the run created, with their one-time passwords (empty on a dry run). */
  logins: NewLogin[];
  /** Cylinders the run registered, for the labels CSV. */
  labels: CylinderLabel[];
  /** Things worth knowing that didn't stop the run ("stock is never removed" …). */
  notes: string[];
}

/** Thrown at the end of a dry run so the transaction rolls back; carries what the run would have done. */
class DryRunRollback extends Error {
  constructor(readonly outcome: SetupOutcome) {
    super('dry run');
  }
}

interface ShopRef {
  id: string;
  userId: string;
  code: string;
  businessName: string;
  homeStoreId: string;
}

interface TypeRef {
  id: string;
  code: string;
  name: string;
  weightKg: Prisma.Decimal | number;
}

/** The ids a run has resolved so far, by the file's natural keys (upper-cased). */
interface RunState {
  tx: Prisma.TransactionClient;
  options: SetupOptions;
  raw: unknown;
  outcome: SetupOutcome;
  cityId: string;
  zones: Map<string, string>;
  officeUserIds: string[];
  types: Map<string, TypeRef>;
  shops: Map<string, ShopRef>;
  eventActorUserId?: string;
}

function key(value: string): string {
  return value.trim().toUpperCase();
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

/** JSON with object keys sorted, so equal settings compare equal whatever their key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

function emptyTally(): Record<SetupKind, KindTally> {
  return Object.fromEntries(SETUP_KINDS.map((kind) => [kind, { created: [], changed: [], unchanged: 0 }])) as unknown as Record<
    SetupKind,
    KindTally
  >;
}

/**
 * The pilot setup (API_CONTRACT §10.3, settled point G10-01). It checks the zone shapes and overlaps first
 * (read-only), then writes the whole file in **one database transaction through the services**: zones by
 * ZonesService, shops and their one store by DistributorsService, prices by PricingService, drivers by
 * DriversService, vans by VehiclesService, stations by FillingStationsService, settings by SettingsService,
 * customers by ClientsService and opening balances by WalletService, so their rules and audit rows apply.
 * Every entry is upserted by its natural key; the first refusal rolls everything back and names the entry.
 */
@Injectable()
export class PilotSetupService {
  private readonly actor: SystemActor = systemActor(PILOT_SETUP_LABEL);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly cities: CitiesService,
    private readonly zones: ZonesService,
    private readonly cylinderTypes: CylinderTypesService,
    private readonly distributors: DistributorsService,
    private readonly pricing: PricingService,
    private readonly prices: ZonePriceLookup,
    private readonly drivers: DriversService,
    private readonly vehicles: VehiclesService,
    private readonly stations: FillingStationsService,
    private readonly settings: SettingsService,
    private readonly clients: ClientsService,
    private readonly wallet: WalletService,
    private readonly scans: ScanService,
  ) {}

  /**
   * The services typed for the office's own requests (`UserActor`: DriversService.create and
   * assignVehicle) only hand the actor to the audit log, which takes any actor; their rows then say
   * SYSTEM `cli:pilot-setup`, like every other row of the run.
   */
  private get officeApiActor(): UserActor {
    return this.actor as unknown as UserActor;
  }

  // ---------- checks before any write ----------

  /**
   * The zone checks that come before the write (read-only): every shape passes `ST_IsValid` with an area
   * above 0, and no two active zones overlap, among the file's zones or with the active zones already
   * stored (a stored zone the file names is replaced by the file's shape). A shared border or point is
   * fine. Returns the first refusal, or null.
   */
  async precheckZones(file: PilotSetupFile, raw: unknown): Promise<PilotRefusal | null> {
    for (const [index, zone] of file.zones.entries()) {
      const where: JsonPath = ['zones', index, 'shape'];
      const label = entryLabel(raw, ['zones', index]) ?? zone.name;
      let rows: Array<{ valid: boolean; empty: boolean; reason: string | null; area_m2: number | null }>;
      try {
        rows = await this.prisma.$queryRaw`
          SELECT ST_IsValid(g) AS valid, ST_IsEmpty(g) AS empty, ST_IsValidReason(g) AS reason,
                 CASE WHEN ST_IsValid(g) THEN ST_Area(g::geography) ELSE NULL END AS area_m2
          FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(zone.shape)}), 4326) AS g) AS shape`;
      } catch (error) {
        return PilotRefusal.of(where, 'ZONE_INVALID_SHAPE', { label, detail: `PostGIS can't read it: ${(error as Error).message.split('\n').pop()}` });
      }
      const shape = rows[0];
      if (!shape || !shape.valid || shape.empty || !(Number(shape.area_m2) > 0)) {
        const why = !shape?.valid ? `ST_IsValid: ${shape?.reason ?? 'not valid'}` : shape.empty ? 'It is empty.' : 'Its area is 0.';
        return PilotRefusal.of(where, 'ZONE_INVALID_SHAPE', { label, detail: why });
      }
    }

    const active = file.zones.map((zone, index) => ({ zone, index })).filter(({ zone }) => zone.active);
    if (active.length === 0) return null;
    const shapes = JSON.stringify(active.map(({ zone, index }) => ({ i: index, g: JSON.stringify(zone.shape) })));

    const pairs = await this.prisma.$queryRaw<Array<{ a: number; b: number; m2: number }>>`
      WITH f AS (
        SELECT (e->>'i')::int AS i, ST_SetSRID(ST_GeomFromGeoJSON(e->>'g'), 4326) AS g
        FROM jsonb_array_elements(${shapes}::jsonb) AS e
      )
      SELECT x.i AS a, y.i AS b, ST_Area(ST_Intersection(x.g, y.g)::geography) AS m2
      FROM f x JOIN f y ON x.i < y.i
      WHERE ST_Intersects(x.g, y.g) AND ST_Area(ST_Intersection(x.g, y.g)::geography) > ${OVERLAP_M2}
      ORDER BY x.i, y.i
      LIMIT 1`;
    if (pairs[0]) {
      const { a, b, m2 } = pairs[0];
      const nameA = file.zones[a].name;
      const nameB = file.zones[b].name;
      return PilotRefusal.of(['zones', a, 'shape'], 'ZONE_INVALID_SHAPE', {
        label: nameA,
        detail: `${nameA} overlaps ${nameB} (${formatPath(['zones', b])}) by ${Math.round(Number(m2)).toLocaleString('en-US')} m². Active zones may not overlap; a shared border is fine.`,
      });
    }

    const replaced = await this.storedZonesNamedByFile(file);
    const stored = await this.prisma.$queryRaw<Array<{ i: number; name: string; city: string; m2: number }>>`
      WITH f AS (
        SELECT (e->>'i')::int AS i, ST_SetSRID(ST_GeomFromGeoJSON(e->>'g'), 4326) AS g
        FROM jsonb_array_elements(${shapes}::jsonb) AS e
      )
      SELECT f.i, z.name, c.name AS city, ST_Area(ST_Intersection(f.g, z.polygon)::geography) AS m2
      FROM f
      JOIN zones z ON z.is_active AND ST_Intersects(f.g, z.polygon)
      JOIN cities c ON c.id = z.city_id
      WHERE NOT (z.id = ANY(${replaced}::uuid[]))
        AND ST_Area(ST_Intersection(f.g, z.polygon)::geography) > ${OVERLAP_M2}
      ORDER BY f.i, z.created_at, z.id
      LIMIT 1`;
    if (stored[0]) {
      const { i, name, city, m2 } = stored[0];
      return PilotRefusal.of(['zones', i, 'shape'], 'ZONE_INVALID_SHAPE', {
        label: file.zones[i].name,
        detail: `${file.zones[i].name} overlaps the stored active zone "${name}" (${city}) by ${Math.round(Number(m2)).toLocaleString('en-US')} m². Archive that zone first, or change the shape.`,
      });
    }
    return null;
  }

  /** The stored zones the file names (its city, the same name in any letter case): the file replaces them. */
  private async storedZonesNamedByFile(file: PilotSetupFile): Promise<string[]> {
    const names = file.zones.map((zone) => zone.name.trim().toLowerCase());
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT z.id FROM zones z JOIN cities c ON c.id = z.city_id
      WHERE lower(c.name) = lower(${file.city.name}) AND lower(z.name) = ANY(${names}::text[])`;
    return rows.map((row) => row.id);
  }

  // ---------- the write ----------

  /**
   * Writes the file in one transaction. A dry run does exactly the same, then rolls back, and returns what
   * it would have done. Throws a {@link PilotRefusal} naming the first entry that failed.
   */
  async apply(checked: CheckedSetupFile, raw: unknown, options: SetupOptions): Promise<SetupOutcome> {
    try {
      return await this.prisma.$transaction(
        (tx) =>
          runInTransaction(tx, async () => {
            const outcome = await this.write(tx, checked, raw, options);
            if (options.dryRun) throw new DryRunRollback(outcome);
            return outcome;
          }),
        RUN_TX,
      );
    } catch (error) {
      if (error instanceof DryRunRollback) return error.outcome;
      throw error;
    }
  }

  private async write(tx: Prisma.TransactionClient, checked: CheckedSetupFile, raw: unknown, options: SetupOptions): Promise<SetupOutcome> {
    const { file } = checked;
    const run: RunState = {
      tx,
      options,
      raw,
      outcome: { tally: emptyTally(), logins: [], labels: [], notes: [] },
      cityId: '',
      zones: new Map(),
      officeUserIds: [],
      types: new Map(),
      shops: new Map(),
    };
    await this.step(['city'], file.city.name, () => this.writeCity(run, file));
    for (const [index, zone] of file.zones.entries()) await this.step(['zones', index], zone.name, () => this.writeZone(run, zone));
    for (const [index, user] of file.officeUsers.entries()) {
      await this.step(['officeUsers', index], user.name, () => this.writeOfficeUser(run, user, checked.phones.officeUsers[index]));
    }
    for (const [index, type] of file.cylinderTypes.entries()) {
      await this.step(['cylinderTypes', index], type.code, () => this.writeCylinderType(run, type, index));
    }
    for (const [index, shop] of file.distributors.entries()) {
      await this.step(['distributors', index], shop.businessName, () => this.writeDistributor(run, shop, checked.phones.distributors[index], index));
    }
    for (const [index, price] of file.prices.entries()) {
      await this.step(['prices', index], `${price.distributor} in ${price.zone}`, () => this.writePrice(run, price));
    }
    for (const [index, driver] of file.drivers.entries()) {
      await this.step(['drivers', index], driver.name, () => this.writeDriver(run, driver, checked.phones.drivers[index], index));
    }
    for (const [index, station] of file.stations.entries()) {
      await this.step(['stations', index], station.name, () => this.writeStation(run, station));
    }
    for (const [settingKey, value] of Object.entries(file.settings)) {
      await this.step(['settings', settingKey], settingKey, () => this.writeSetting(run, settingKey, value));
    }
    for (const [index, stock] of file.stock.entries()) {
      await this.step(['stock', index], `${stock.distributor} ${stock.cylinderType}`, () => this.writeStock(run, stock));
    }
    for (const [index, customer] of file.customers.entries()) {
      await this.step(['customers', index], customer.name, () => this.writeCustomer(run, customer, checked.phones.customers[index]));
    }
    for (const [index, balance] of file.openingBalances.entries()) {
      await this.step(['openingBalances', index], balance.distributor, () => this.writeOpeningBalance(run, balance));
    }

    const counts = (pick: (tally: KindTally) => number) =>
      Object.fromEntries(SETUP_KINDS.map((kind) => [kind, pick(run.outcome.tally[kind])]).filter(([, count]) => (count as number) > 0));
    await this.audit.record(
      {
        action: 'pilot.setup',
        actor: this.actor,
        resourceType: 'pilot',
        diff: {
          file: options.fileName,
          test: options.test,
          created: counts((tally) => tally.created.length),
          changed: counts((tally) => tally.changed.length),
        },
      },
      tx,
    );
    return run.outcome;
  }

  /** Runs one entry's work; any failure becomes a refusal naming that entry (or the field it names). */
  private async step(path: JsonPath, label: string | undefined, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (error instanceof PilotRefusal) throw error.path.length === 0 ? error.at(path, label) : error;
      throw PilotRefusal.from(error, path, label);
    }
  }

  private created(run: RunState, kind: SetupKind, name: string): void {
    run.outcome.tally[kind].created.push(name);
  }

  private changed(run: RunState, kind: SetupKind, name: string): void {
    run.outcome.tally[kind].changed.push(name);
  }

  private unchanged(run: RunState, kind: SetupKind): void {
    run.outcome.tally[kind].unchanged += 1;
  }

  /** A run with `--test` touches only test rows, and a run without it only live rows. */
  private assertTestMode(run: RunState, isTest: boolean, what: string): void {
    if (isTest === run.options.test) return;
    throw PilotRefusal.field([], 'NOT_ALLOWED', {
      detail: isTest
        ? `${what} is a test row (made with --test): run with --test, or reset the test data first (npm run pilot:reset).`
        : `${what} is a live row: a --test run may only change test rows.`,
    });
  }

  /** A password for a login this run creates, and its argon2 hash (a dry run makes neither). */
  private async newPassword(run: RunState): Promise<{ password: string; hash: string }> {
    if (run.options.dryRun) return { password: '', hash: 'dry-run' };
    const password = generateSetupPassword();
    return { password, hash: await argon2.hash(password) };
  }

  // ---------- one section each ----------

  private async writeCity(run: RunState, file: PilotSetupFile): Promise<void> {
    const { name, countryCode } = file.city;
    const existing = await run.tx.city.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    if (!existing) {
      const city = await this.cities.createCity({ name, countryCode });
      run.cityId = city.id;
      this.created(run, 'city', name);
      return;
    }
    run.cityId = existing.id;
    if (existing.countryCode !== countryCode) {
      await run.tx.city.update({ where: { id: existing.id }, data: { countryCode } });
      this.changed(run, 'city', existing.name);
    } else {
      this.unchanged(run, 'city');
    }
  }

  private async writeZone(run: RunState, zone: PilotSetupFile['zones'][number]): Promise<void> {
    const geojson = JSON.stringify(zone.shape);
    const rows = await run.tx.$queryRaw<Array<{ id: string; name: string; is_active: boolean; same: boolean }>>`
      SELECT id, name, is_active, ST_Equals(polygon, ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)) AS same
      FROM zones
      WHERE city_id = ${run.cityId}::uuid AND lower(name) = lower(${zone.name})
      ORDER BY created_at, id
      LIMIT 1`;
    const stored = rows[0];
    if (!stored) {
      const { id } = await this.zones.create(this.actor, { cityId: run.cityId, name: zone.name, polygonGeoJson: zone.shape });
      if (!zone.active) await this.zones.archive(this.actor, id);
      run.zones.set(key(zone.name), id);
      this.created(run, 'zones', zone.name);
      return;
    }
    run.zones.set(key(zone.name), stored.id);
    let changed = false;
    if (stored.name !== zone.name || !stored.same) {
      await this.zones.update(this.actor, stored.id, { name: zone.name, polygonGeoJson: zone.shape });
      changed = true;
    }
    if (stored.is_active !== zone.active) {
      await (zone.active ? this.zones.reactivate(this.actor, stored.id) : this.zones.archive(this.actor, stored.id));
      changed = true;
    }
    if (changed) this.changed(run, 'zones', zone.name);
    else this.unchanged(run, 'zones');
  }

  /**
   * An office login, as `npm run users:create-office` makes it (API_CONTRACT §8.5 step 8): an ACTIVE
   * SUPER_ADMIN with a generated password, audited `user.create_office`. Never a test row. A phone that is
   * already an office login is that login (no new password); any other user's phone is USER_PHONE_IN_USE.
   */
  private async writeOfficeUser(run: RunState, user: PilotSetupFile['officeUsers'][number], phone: string): Promise<void> {
    const existing = await run.tx.user.findUnique({ where: { phone }, select: { id: true, role: true } });
    if (existing) {
      if (existing.role !== UserRole.SUPER_ADMIN) throw new AppError('USER_PHONE_IN_USE', { existingRole: existing.role });
      run.officeUserIds.push(existing.id);
      this.unchanged(run, 'officeUsers');
      return;
    }
    const { password, hash } = await this.newPassword(run);
    const created = await run.tx.user.create({
      data: { phone, name: user.name, role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE, passwordHash: hash },
      select: { id: true, name: true, phone: true },
    });
    await this.audit.record(
      {
        action: 'user.create_office',
        actor: this.actor,
        resourceType: 'user',
        resourceId: created.id,
        after: { name: created.name, phone: created.phone, role: UserRole.SUPER_ADMIN },
      },
      run.tx,
    );
    run.officeUserIds.push(created.id);
    if (!run.options.dryRun) run.outcome.logins.push({ name: created.name, role: UserRole.SUPER_ADMIN, phone, password });
    this.created(run, 'officeUsers', user.name);
  }

  /**
   * A size, matched by its code, else by its weight (one stored type per size): the file's code then
   * names the stored type within the file. A new size is created by CylinderTypesService.
   */
  private async writeCylinderType(run: RunState, type: PilotSetupFile['cylinderTypes'][number], index: number): Promise<void> {
    const byCode = await run.tx.cylinderType.findUnique({ where: { code: type.code } });
    if (byCode) {
      if (!sameNumber(Number(byCode.weightKg.toString()), type.weightKg)) {
        throw PilotRefusal.field(['cylinderTypes', index, 'weightKg'], 'INVALID_VALUE', {
          label: type.code,
          detail: `${type.code} is stored as ${byCode.weightKg.toString()} kg; a size's weight never changes.`,
        });
      }
      if (byCode.name !== type.name || byCode.capacityUnits !== type.capacityUnits) {
        await run.tx.cylinderType.update({ where: { id: byCode.id }, data: { name: type.name, capacityUnits: type.capacityUnits } });
        this.changed(run, 'cylinderTypes', type.code);
      } else {
        this.unchanged(run, 'cylinderTypes');
      }
      run.types.set(key(type.code), byCode);
      return;
    }
    const sameSize = await run.tx.cylinderType.findMany({ where: { weightKg: new Prisma.Decimal(type.weightKg) }, orderBy: { code: 'asc' } });
    if (sameSize.length > 1) {
      throw PilotRefusal.of(['cylinderTypes', index, 'code'], 'CONFLICT_DUPLICATE', {
        label: type.code,
        detail: `${sameSize.length} stored types are ${type.weightKg} kg (${sameSize.map((row) => row.code).join(', ')}): use one of their codes.`,
      });
    }
    if (sameSize.length === 1) {
      run.types.set(key(type.code), sameSize[0]);
      run.outcome.notes.push(`cylinderTypes[${index}] ${type.code} is the stored size ${sameSize[0].code} (${type.weightKg} kg).`);
      this.unchanged(run, 'cylinderTypes');
      return;
    }
    const created = await this.cylinderTypes.create({ code: type.code, name: type.name, weightKg: type.weightKg, capacityUnits: type.capacityUnits });
    run.types.set(key(type.code), created);
    this.created(run, 'cylinderTypes', type.code);
  }

  /**
   * A shop with its one store and code, by DistributorsService (the phone, the code, the store pin in an
   * active zone, the CNIC: API_CONTRACT §7.3), then activated and given its app password. An existing code
   * is that shop: its contact and store follow the file through the same service, and a PENDING shop is
   * activated; a suspended one stays suspended.
   */
  private async writeDistributor(run: RunState, shop: PilotSetupFile['distributors'][number], phone: string, index: number): Promise<void> {
    const name = shop.ownerName ?? shop.businessName;
    const existing = await run.tx.distributor.findUnique({
      where: { code: shop.code },
      select: { id: true, businessName: true, status: true, isTest: true, homeStoreId: true, user: { select: { id: true, name: true, phone: true } } },
    });
    if (!existing) {
      const answer = await this.distributors.create(
        this.actor,
        { phone, name, businessName: shop.businessName, code: shop.code, cnic: shop.cnic, store: shop.store },
        undefined,
      );
      const created = answer instanceof IdempotentResponse ? answer.body : answer;
      await this.distributors.approve(this.actor, created.id, {});
      const { password, hash } = await this.newPassword(run);
      await run.tx.user.update({ where: { id: created.userId }, data: { passwordHash: hash, isTest: run.options.test } });
      if (run.options.test) await run.tx.distributor.update({ where: { id: created.id }, data: { isTest: true } });
      const stored = await run.tx.distributor.findUniqueOrThrow({ where: { id: created.id }, select: { homeStoreId: true } });
      run.shops.set(key(shop.code), { id: created.id, userId: created.userId, code: shop.code, businessName: shop.businessName, homeStoreId: stored.homeStoreId });
      if (!run.options.dryRun) run.outcome.logins.push({ name, role: UserRole.DISTRIBUTOR, phone, password });
      this.created(run, 'distributors', shop.code);
      return;
    }

    this.assertTestMode(run, existing.isTest, `${formatPath(['distributors', index])} ${shop.code} (${existing.businessName})`);
    let changed = false;
    if (existing.businessName !== shop.businessName || existing.user.name !== name || existing.user.phone !== phone) {
      await this.distributors.update(this.actor, existing.id, { businessName: shop.businessName, name, phone });
      changed = true;
    }
    const [store] = await run.tx.$queryRaw<Array<{ name: string; address: string; lat: number; lng: number }>>`
      SELECT name, address, ST_Y(location) AS lat, ST_X(location) AS lng FROM stores WHERE id = ${existing.homeStoreId}::uuid`;
    if (!store || store.name !== shop.store.name || store.address !== shop.store.address || !sameNumber(store.lat, shop.store.lat) || !sameNumber(store.lng, shop.store.lng)) {
      await this.distributors.updateStore(this.actor, existing.id, shop.store);
      changed = true;
    }
    if (existing.status === DistributorStatus.PENDING) {
      await this.distributors.approve(this.actor, existing.id, {});
      changed = true;
    } else if (existing.status === DistributorStatus.SUSPENDED) {
      run.outcome.notes.push(`${shop.code} is suspended; setup leaves it suspended (the office reactivates it with a reason).`);
    }
    run.shops.set(key(shop.code), {
      id: existing.id,
      userId: existing.user.id,
      code: shop.code,
      businessName: shop.businessName,
      homeStoreId: existing.homeStoreId,
    });
    if (changed) this.changed(run, 'distributors', shop.code);
    else this.unchanged(run, 'distributors');
  }

  /** A delivery price by PricingService (`price.set`), compared first so an equal price writes nothing. */
  private async writePrice(run: RunState, price: PilotSetupFile['prices'][number]): Promise<void> {
    const shop = this.shopOf(run, price.distributor);
    const zoneId = run.zones.get(key(price.zone));
    if (!zoneId) throw new AppError('NOT_FOUND', { field: 'zone' });
    const sizes = price.sizes.map((size) => ({ cylinderTypeId: this.typeOf(run, size.cylinderType).id, perCylinderPaisa: size.perCylinderPaisa }));
    const wanted = {
      basePaisa: price.basePaisa,
      note: price.note ?? null,
      sizes: sizes
        .filter((size) => BigInt(size.perCylinderPaisa) !== 0n)
        .map((size) => `${size.cylinderTypeId}:${BigInt(size.perCylinderPaisa).toString()}`)
        .sort(),
    };
    const current = await this.prices.priceFor(shop.id, zoneId, run.tx);
    const name = `${shop.code} in ${price.zone}`;
    if (current) {
      const stored = {
        basePaisa: current.basePaisa.toString(),
        note: current.note ?? null,
        sizes: current.sizes
          .filter((size) => size.perCylinderPaisa !== 0n)
          .map((size) => `${size.cylinderTypeId}:${size.perCylinderPaisa.toString()}`)
          .sort(),
      };
      if (JSON.stringify(stored) === JSON.stringify(wanted)) {
        this.unchanged(run, 'prices');
        return;
      }
    }
    await this.pricing.putPrice(this.actor, shop.id, zoneId, { basePaisa: price.basePaisa, sizes, note: price.note });
    if (current) this.changed(run, 'prices', name);
    else this.created(run, 'prices', name);
  }

  /**
   * A driver by DriversService (the phone, the licence, the CNIC), given its app password, and its van by
   * VehiclesService, linked with DriversService.assignVehicle (refused while a van holds cylinders). An
   * existing driver (the phone) keeps its profile.
   */
  private async writeDriver(run: RunState, driver: PilotSetupFile['drivers'][number], phone: string, index: number): Promise<void> {
    const where = `${formatPath(['drivers', index])} ${driver.name}`;
    const user = await run.tx.user.findUnique({
      where: { phone },
      select: { id: true, role: true, isTest: true, driverProfile: { select: { id: true, currentVehicleId: true } } },
    });
    let driverId: string;
    let currentVehicleId: string | null;
    let isNew = false;
    if (user && user.role === UserRole.DRIVER && user.driverProfile) {
      this.assertTestMode(run, user.isTest, where);
      driverId = user.driverProfile.id;
      currentVehicleId = user.driverProfile.currentVehicleId;
    } else {
      const view = await this.drivers.create(this.officeApiActor, { name: driver.name, phone, licenceNo: driver.licenceNo, cnic: driver.cnic });
      const { password, hash } = await this.newPassword(run);
      await run.tx.user.update({ where: { id: view.userId }, data: { passwordHash: hash, isTest: run.options.test } });
      if (!run.options.dryRun) run.outcome.logins.push({ name: driver.name, role: UserRole.DRIVER, phone, password });
      driverId = view.id;
      currentVehicleId = view.currentVehicleId;
      isNew = true;
    }

    let driverChanged = false;
    if (driver.van) {
      const van = driver.van;
      const homeZoneId = run.zones.get(key(van.homeZone));
      if (!homeZoneId) throw new AppError('NOT_FOUND', { field: 'homeZone' });
      const stored = await run.tx.vehicle.findUnique({ where: { plateNo: van.plateNo } });
      let vehicleId: string;
      if (!stored) {
        const created = await this.vehicles.create({ plateNo: van.plateNo, capacityUnits: van.capacityUnits, homeZoneId });
        if (run.options.test) await run.tx.vehicle.update({ where: { id: created.id }, data: { isTest: true } });
        vehicleId = created.id;
        this.created(run, 'vans', van.plateNo);
      } else {
        this.assertTestMode(run, stored.isTest, `${formatPath(['drivers', index, 'van'])} ${van.plateNo}`);
        vehicleId = stored.id;
        if (stored.capacityUnits !== van.capacityUnits || stored.homeZoneId !== homeZoneId) {
          await this.vehicles.update(stored.id, { capacityUnits: van.capacityUnits, homeZoneId });
          this.changed(run, 'vans', van.plateNo);
        } else {
          this.unchanged(run, 'vans');
        }
      }
      if (currentVehicleId !== vehicleId) {
        await this.drivers.assignVehicle(this.officeApiActor, driverId, { vehicleId });
        driverChanged = true;
      }
    }
    if (isNew) this.created(run, 'drivers', driver.name);
    else if (driverChanged) this.changed(run, 'drivers', driver.name);
    else this.unchanged(run, 'drivers');
  }

  /** A refill station by FillingStationsService, by its name (the price is always 0: ADR-16). */
  private async writeStation(run: RunState, station: PilotSetupFile['stations'][number]): Promise<void> {
    const rows = await run.tx.$queryRaw<Array<{ id: string; name: string; address: string; is_active: boolean; lat: number; lng: number }>>`
      SELECT id, name, address, is_active, ST_Y(location) AS lat, ST_X(location) AS lng
      FROM filling_stations WHERE lower(name) = lower(${station.name})
      ORDER BY created_at, id
      LIMIT 1`;
    const stored = rows[0];
    if (!stored) {
      const created = await this.stations.create({ name: station.name, address: station.address, lat: station.lat, lng: station.lng });
      if (!station.active) await this.stations.update(created.id, { isActive: false });
      this.created(run, 'stations', station.name);
      return;
    }
    const moved = !sameNumber(stored.lat, station.lat) || !sameNumber(stored.lng, station.lng);
    if (stored.name === station.name && stored.address === station.address && !moved && stored.is_active === station.active) {
      this.unchanged(run, 'stations');
      return;
    }
    await this.stations.update(stored.id, {
      name: station.name,
      address: station.address,
      ...(moved ? { lat: station.lat, lng: station.lng } : {}),
      isActive: station.active,
    });
    this.changed(run, 'stations', station.name);
  }

  /**
   * A setting by SettingsService (`setting.update`, the file's name as the reason): a known key
   * (SETTING_UNKNOWN), one the office may edit, or `topup.account`, which only a CLI sets
   * (SETTING_NOT_EDITABLE otherwise), and a valid value (SETTING_INVALID_VALUE). An equal value writes nothing.
   */
  private async writeSetting(run: RunState, settingKey: string, value: unknown): Promise<void> {
    if (!isSettingKey(settingKey)) throw new AppError('SETTING_UNKNOWN');
    const keyName: SettingKey = settingKey;
    if (!isEditableOverApi(keyName) && keyName !== 'topup.account') throw new AppError('SETTING_NOT_EDITABLE');
    const next = this.settings.parseValue(keyName, value);
    const current = await this.settings.get(keyName);
    if (stableJson(current) === stableJson(next)) {
      this.unchanged(run, 'settings');
      return;
    }
    await this.settings.set(keyName, next, this.actor, `Pilot setup from ${run.options.fileName}`, { allowNotEditable: true });
    this.changed(run, 'settings', keyName);
  }

  /**
   * Labelled stock, topped up to the file's count per shop and size and never removed. New cylinders are
   * registered as bulk registration makes them (API_CONTRACT §9.5): FULL or EMPTY in the shop's one store,
   * each with the next short number and one REGISTERED move (ScanService.registerMoves, in the run's
   * transaction), audited `cylinders.bulk_register`.
   */
  private async writeStock(run: RunState, stock: PilotSetupFile['stock'][number]): Promise<void> {
    const shop = this.shopOf(run, stock.distributor);
    const type = this.typeOf(run, stock.cylinderType);
    const have = await run.tx.cylinder.count({ where: { distributorId: shop.id, cylinderTypeId: type.id } });
    const need = stock.count - have;
    const sizeLabel = sizeLabelOf(type);
    if (need <= 0) {
      if (need < 0) run.outcome.notes.push(`${shop.code} has ${have} × ${sizeLabel}, more than the file's ${stock.count}: stock is never removed.`);
      this.unchanged(run, 'cylinders');
      return;
    }
    const state = stock.state === 'EMPTY' ? CylinderState.EMPTY : CylinderState.FULL;
    const serials = await this.freshSerials(run.tx, type.code, need);
    const [{ first }] = await run.tx.$queryRaw<Array<{ first: number }>>`
      UPDATE distributors SET next_cylinder_no = next_cylinder_no + ${need}, updated_at = (now() AT TIME ZONE 'UTC')
      WHERE id = ${shop.id}::uuid
      RETURNING next_cylinder_no - ${need} AS first`;
    const start = Number(first);
    await run.tx.cylinder.createMany({
      data: serials.map((serial, index) => ({
        serial,
        qrCode: serial,
        distributorId: shop.id,
        cylinderTypeId: type.id,
        shortNo: start + index,
        custodyType: CustodyType.STORE,
        custodyId: shop.homeStoreId,
        state,
      })),
    });
    const created = await run.tx.cylinder.findMany({
      where: { serial: { in: serials } },
      orderBy: [{ shortNo: 'asc' }],
      select: { id: true, qrCode: true, shortNo: true },
    });
    await this.scans.registerMoves(run.tx, { actorUserId: await this.eventActor(run, shop), storeId: shop.homeStoreId, cylinderIds: created.map((row) => row.id) });
    await run.tx.inventoryLot.upsert({
      where: {
        inventory_unique: { holderType: CustodyType.STORE, holderId: shop.homeStoreId, distributorId: shop.id, cylinderTypeId: type.id, state },
      },
      update: { count: { increment: created.length } },
      create: { holderType: CustodyType.STORE, holderId: shop.homeStoreId, distributorId: shop.id, cylinderTypeId: type.id, state, count: created.length },
    });
    const from = cylinderShortCode(shop.code, start) as string;
    const to = cylinderShortCode(shop.code, start + created.length - 1) as string;
    await this.audit.record(
      {
        action: 'cylinders.bulk_register',
        actor: this.actor,
        resourceType: 'distributor',
        resourceId: shop.id,
        distributorId: shop.id,
        diff: { cylinderTypeId: type.id, count: created.length, state, distributor: shop.businessName, from, to },
      },
      run.tx,
    );
    for (const row of created) {
      const shortNo = row.shortNo as number;
      const shortCode = cylinderShortCode(shop.code, shortNo) as string;
      run.outcome.labels.push({
        shortNo,
        shortCode,
        qrValue: row.qrCode,
        sizeLabel,
        state: state === CylinderState.EMPTY ? 'EMPTY' : 'FULL',
        distributorCode: shop.code,
        distributorName: shop.businessName,
      });
      this.created(run, 'cylinders', shortCode);
    }
  }

  /**
   * The user named on the REGISTERED moves (cylinder_events.actor_user_id is required): the file's first
   * office login, else the oldest active office login, else the shop's own login. The audit row says SYSTEM.
   */
  private async eventActor(run: RunState, shop: ShopRef): Promise<string> {
    if (run.officeUserIds[0]) return run.officeUserIds[0];
    if (run.eventActorUserId) return run.eventActorUserId;
    const office = await run.tx.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    run.eventActorUserId = office?.id ?? shop.userId;
    return run.eventActorUserId;
  }

  /** `<type code>-<8 hex>` QR values, as bulk registration makes them, none already used. */
  private async freshSerials(tx: Prisma.TransactionClient, typeCode: string, count: number): Promise<string[]> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const serials = new Set<string>();
      while (serials.size < count) serials.add(`${typeCode}-${randomBytes(4).toString('hex').toUpperCase()}`);
      const list = [...serials];
      const used = await tx.cylinder.count({ where: { OR: [{ serial: { in: list } }, { qrCode: { in: list } }] } });
      if (used === 0) return list;
    }
    throw new AppError('CONFLICT_DUPLICATE');
  }

  /**
   * A customer by ClientsService, with the normal rules (a Pakistani mobile, unique per shop, a pin in an
   * active zone where the shop has a price). A shop's existing customer (its phone) is left as it is: the
   * shop owns its customers' details.
   */
  private async writeCustomer(run: RunState, customer: PilotSetupFile['customers'][number], phone: string): Promise<void> {
    const shop = this.shopOf(run, customer.distributor);
    const existing = await run.tx.client.findUnique({ where: { distributorId_phone: { distributorId: shop.id, phone } }, select: { id: true } });
    if (existing) {
      this.unchanged(run, 'customers');
      return;
    }
    await this.clients.create(
      shop.id,
      { name: customer.name, phone, address: { label: customer.address.label, lat: customer.address.lat, lng: customer.address.lng }, notes: customer.notes },
      undefined,
    );
    this.created(run, 'customers', `${customer.name} (${shop.code})`);
  }

  /**
   * An opening balance (only with `--test`, checked before the run): once per shop, a correction ADD with
   * reason OPENING_BALANCE, request key `pilot-setup:opening:<distributorId>`, by WalletService. A re-run
   * never changes a balance.
   */
  private async writeOpeningBalance(run: RunState, balance: PilotSetupFile['openingBalances'][number]): Promise<void> {
    const shop = this.shopOf(run, balance.distributor);
    const requestKey = `pilot-setup:opening:${shop.id}`;
    const existing = await run.tx.ledgerEntry.findUnique({ where: { idempotencyKey: walletKeys.correction(requestKey) }, select: { amountPaisa: true } });
    if (existing) {
      if (existing.amountPaisa.toString() !== balance.amountPaisa) {
        run.outcome.notes.push(`${shop.code}'s opening balance was written before (${existing.amountPaisa} paisa); a re-run never changes a balance.`);
      }
      this.unchanged(run, 'openingBalances');
      return;
    }
    await this.wallet.correct(run.tx, {
      distributorId: shop.id,
      direction: 'ADD',
      amountPaisa: BigInt(balance.amountPaisa),
      reasonCode: 'OPENING_BALANCE',
      note: balance.note,
      requestKey,
      actor: this.actor,
    });
    this.created(run, 'openingBalances', shop.code);
  }

  private shopOf(run: RunState, code: string): ShopRef {
    const shop = run.shops.get(key(code));
    if (!shop) throw new AppError('NOT_FOUND', { field: 'distributor' });
    return shop;
  }

  private typeOf(run: RunState, code: string): TypeRef {
    const type = run.types.get(key(code));
    if (!type) throw new AppError('NOT_FOUND', { field: 'cylinderType' });
    return type;
  }
}
