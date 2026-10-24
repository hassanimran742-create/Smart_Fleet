import { z } from 'zod';
import { latSchema, lngSchema, optionalTextSchema, phoneInputSchema, rupeeAmountSchema, textSchema } from './common.schema';
import { distributorCodeSchema, optionalCnicSchema, storeInputSchema } from './distributor.schema';
import { priceAmountSchema } from './pricing.schema';
import { CORRECTION_MAX_PAISA } from './wallet.schema';
import { multiPolygonSchema } from './zone.schema';

/**
 * [Inc 3] The pilot setup file: `npm run pilot:setup -- --file pilot/<name>.json [--test] [--dry-run]`
 * (API_CONTRACT §10.3; there is no HTTP route). This schema checks the file's shape and that every
 * reference inside it resolves; the CLI then checks the rest against the database and the services'
 * rules (zone shapes `ST_IsValid` with area > 0 and no overlap, store and customer pins in an active zone
 * with a price, normalised phones, settings against the registry), and writes everything in one
 * transaction. A refused run names the first bad entry by its JSON path (a field issue's `path`) with its
 * code and English text.
 *
 * Re-runs upsert by natural key: city and zone names, phones, distributor codes, distributor and zone for
 * prices, the cylinder type code, plate numbers, station names, distributor and phone for customers. So
 * those keys must be unique in the file (`DUPLICATE_ITEM`), and references name them: `distributor` is a
 * distributor's `code`, `zone` and `homeZone` a zone's `name`, `cylinderType` a cylinder type's `code`
 * (an unknown one is `INVALID_CHOICE`).
 *
 * Every object is strict: an unknown key is refused (`NOT_ALLOWED`), so a typo can't be silently dropped.
 */

/** A zone shape: a GeoJSON MultiPolygon, or a Polygon read as a one-part MultiPolygon. */
const polygonSchema = z
  .object({ type: z.literal('Polygon'), coordinates: multiPolygonSchema.shape.coordinates.element })
  .strict()
  .transform((polygon) => ({ type: 'MultiPolygon' as const, coordinates: [polygon.coordinates] }));

export const pilotZoneShapeSchema = z.union([multiPolygonSchema.strict(), polygonSchema]);

const cylinderTypeCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9_.-]{1,40}$/, 'INVALID_FORMAT');

const pilotCitySchema = z
  .object({
    name: textSchema(1, 80),
    countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'INVALID_FORMAT').default('PK'),
  })
  .strict();

const pilotZoneSchema = z
  .object({
    name: textSchema(2, 60),
    shape: pilotZoneShapeSchema,
    /** Archived zones are kept for the record; only active zones may not overlap. */
    active: z.boolean().default(true),
  })
  .strict();

/** An office login: created as SUPER_ADMIN, never a test row (`--test` doesn't mark it). */
const pilotOfficeUserSchema = z
  .object({
    name: textSchema(1, 80),
    phone: phoneInputSchema,
  })
  .strict();

const pilotDistributorSchema = z
  .object({
    code: distributorCodeSchema,
    businessName: textSchema(1, 120),
    /** The shop-keeper's name, the login's name; the business name when left out. */
    ownerName: optionalTextSchema(80),
    phone: phoneInputSchema,
    cnic: optionalCnicSchema,
    store: storeInputSchema.strict(),
  })
  .strict();

const pilotCylinderTypeSchema = z
  .object({
    code: cylinderTypeCodeSchema,
    name: textSchema(1, 80),
    weightKg: z.number().finite().positive().max(1000),
    capacityUnits: z.number().int().min(1).max(100).default(1),
  })
  .strict();

const pilotPriceSchema = z
  .object({
    distributor: distributorCodeSchema,
    zone: textSchema(2, 60),
    basePaisa: priceAmountSchema,
    /** Optional amounts per size; a size left out costs 0 per cylinder. */
    sizes: z
      .array(z.object({ cylinderType: cylinderTypeCodeSchema, perCylinderPaisa: priceAmountSchema }).strict())
      .max(20)
      .default([]),
    note: optionalTextSchema(200),
  })
  .strict();

const pilotVanSchema = z
  .object({
    plateNo: textSchema(1, 20).transform((plate) => plate.toUpperCase()),
    capacityUnits: z.number().int().min(1).max(1000),
    homeZone: textSchema(2, 60),
  })
  .strict();

const pilotDriverSchema = z
  .object({
    name: textSchema(1, 80),
    phone: phoneInputSchema,
    licenceNo: textSchema(1, 40),
    cnic: optionalCnicSchema,
    /** The driver's van; a driver with no van can't be given trips or refills. */
    van: pilotVanSchema.optional(),
  })
  .strict();

const pilotStationSchema = z
  .object({
    name: textSchema(1, 120),
    address: textSchema(1, 255),
    lat: latSchema,
    lng: lngSchema,
    active: z.boolean().default(true),
  })
  .strict();

/** Labelled starting stock: topped up to `count` per distributor and size, never removed. */
const pilotStockSchema = z
  .object({
    distributor: distributorCodeSchema,
    cylinderType: cylinderTypeCodeSchema,
    count: z.number().int().min(1).max(500),
    state: z.enum(['FULL', 'EMPTY']).default('FULL'),
  })
  .strict();

/** A customer, added through the normal rules: a Pakistani mobile, unique per distributor, a pin in an active zone with a price. */
const pilotCustomerSchema = z
  .object({
    distributor: distributorCodeSchema,
    name: textSchema(1, 80),
    phone: phoneInputSchema,
    address: z.object({ label: textSchema(1, 60), lat: latSchema, lng: lngSchema }).strict(),
    notes: optionalTextSchema(200),
  })
  .strict();

/**
 * An opening balance (only with `--test`; a file with any and no `--test` is refused): written once per
 * distributor as a correction ADD with reason OPENING_BALANCE, request key
 * `pilot-setup:opening:<distributorId>`. The note follows the correction rule (10–300 characters).
 */
const pilotOpeningBalanceSchema = z
  .object({
    distributor: distributorCodeSchema,
    amountPaisa: rupeeAmountSchema(CORRECTION_MAX_PAISA),
    note: textSchema(10, 300),
  })
  .strict();

type Issue = { path: (string | number)[]; message: string };

/** Adds DUPLICATE_ITEM on each repeat of `key` (compared upper-cased and trimmed). */
function uniqueBy<T>(items: readonly T[], key: (item: T) => string, path: (index: number) => (string | number)[], out: Issue[]): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const value = key(item).trim().toUpperCase();
    if (seen.has(value)) out.push({ path: path(index), message: 'DUPLICATE_ITEM' });
    seen.add(value);
  });
}

/** Adds INVALID_CHOICE when `value` names nothing in `known` (compared upper-cased and trimmed). */
function mustName(known: ReadonlySet<string>, value: string, path: (string | number)[], out: Issue[]): void {
  if (!known.has(value.trim().toUpperCase())) out.push({ path, message: 'INVALID_CHOICE' });
}

export const pilotSetupFileSchema = z
  .object({
    /** Free text for the people who keep the file; ignored by the CLI. */
    description: optionalTextSchema(500),
    city: pilotCitySchema,
    zones: z.array(pilotZoneSchema).min(1).max(50),
    officeUsers: z.array(pilotOfficeUserSchema).max(10).default([]),
    distributors: z.array(pilotDistributorSchema).min(1).max(50),
    cylinderTypes: z.array(pilotCylinderTypeSchema).min(1).max(20),
    prices: z.array(pilotPriceSchema).max(500).default([]),
    drivers: z.array(pilotDriverSchema).max(100).default([]),
    stations: z.array(pilotStationSchema).max(20).default([]),
    /**
     * Settings to apply, by registry key (for example `topup.account`, `support.phone`,
     * `refill.maxCylinders`, `messaging.allowlist`). The CLI checks each against the registry
     * (`SETTING_UNKNOWN`, `SETTING_INVALID_VALUE`) and writes it with actor SYSTEM `cli:pilot-setup`.
     */
    settings: z.record(z.string().trim().min(1).max(64), z.unknown()).default({}),
    stock: z.array(pilotStockSchema).max(200).default([]),
    customers: z.array(pilotCustomerSchema).max(500).default([]),
    openingBalances: z.array(pilotOpeningBalanceSchema).max(50).default([]),
  })
  .strict()
  .superRefine((file, ctx) => {
    const issues: Issue[] = [];
    uniqueBy(file.zones, (z) => z.name, (i) => ['zones', i, 'name'], issues);
    uniqueBy(file.officeUsers, (u) => u.phone, (i) => ['officeUsers', i, 'phone'], issues);
    uniqueBy(file.distributors, (d) => d.code, (i) => ['distributors', i, 'code'], issues);
    uniqueBy(file.distributors, (d) => d.phone, (i) => ['distributors', i, 'phone'], issues);
    uniqueBy(file.cylinderTypes, (t) => t.code, (i) => ['cylinderTypes', i, 'code'], issues);
    uniqueBy(file.prices, (p) => `${p.distributor}|${p.zone}`, (i) => ['prices', i, 'zone'], issues);
    uniqueBy(file.drivers, (d) => d.phone, (i) => ['drivers', i, 'phone'], issues);
    uniqueBy(file.drivers, (d) => d.licenceNo, (i) => ['drivers', i, 'licenceNo'], issues);
    const plates = new Set<string>();
    file.drivers.forEach((driver, i) => {
      if (!driver.van) return;
      const plate = driver.van.plateNo.trim().toUpperCase();
      if (plates.has(plate)) issues.push({ path: ['drivers', i, 'van', 'plateNo'], message: 'DUPLICATE_ITEM' });
      plates.add(plate);
    });
    uniqueBy(file.stations, (s) => s.name, (i) => ['stations', i, 'name'], issues);
    uniqueBy(file.stock, (s) => `${s.distributor}|${s.cylinderType}`, (i) => ['stock', i, 'cylinderType'], issues);
    uniqueBy(file.customers, (c) => `${c.distributor}|${c.phone}`, (i) => ['customers', i, 'phone'], issues);
    uniqueBy(file.openingBalances, (b) => b.distributor, (i) => ['openingBalances', i, 'distributor'], issues);

    const zones = new Set(file.zones.map((z) => z.name.trim().toUpperCase()));
    const shops = new Set(file.distributors.map((d) => d.code.trim().toUpperCase()));
    const sizes = new Set(file.cylinderTypes.map((t) => t.code.trim().toUpperCase()));
    file.prices.forEach((price, i) => {
      mustName(shops, price.distributor, ['prices', i, 'distributor'], issues);
      mustName(zones, price.zone, ['prices', i, 'zone'], issues);
      uniqueBy(price.sizes, (s) => s.cylinderType, (j) => ['prices', i, 'sizes', j, 'cylinderType'], issues);
      price.sizes.forEach((size, j) => mustName(sizes, size.cylinderType, ['prices', i, 'sizes', j, 'cylinderType'], issues));
    });
    file.drivers.forEach((driver, i) => {
      if (driver.van) mustName(zones, driver.van.homeZone, ['drivers', i, 'van', 'homeZone'], issues);
    });
    file.stock.forEach((stock, i) => {
      mustName(shops, stock.distributor, ['stock', i, 'distributor'], issues);
      mustName(sizes, stock.cylinderType, ['stock', i, 'cylinderType'], issues);
    });
    file.customers.forEach((customer, i) => mustName(shops, customer.distributor, ['customers', i, 'distributor'], issues));
    file.openingBalances.forEach((balance, i) => mustName(shops, balance.distributor, ['openingBalances', i, 'distributor'], issues));

    for (const issue of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
  });

export type PilotSetupFileInput = z.input<typeof pilotSetupFileSchema>;
export type PilotSetupFile = z.output<typeof pilotSetupFileSchema>;
