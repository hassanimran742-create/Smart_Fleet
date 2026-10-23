/**
 * Unit and static guards for verified review findings fixed in the domain modules (the DB cases are in
 * review-fixes.e2e-spec.ts and under test/review/**).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ownDistributorId, ownDriverId } from '../../src/common/auth/own-driver-id';
import { AppError } from '../../src/common/errors/app-error';
import type { Db } from '../../src/modules/orders/support/tx';
import { ZonePriceLookup } from '../../src/modules/pricing/zone-price.lookup';
import { ownDistributorId as walletOwnDistributorId } from '../../src/modules/wallet/caller';
import type { PrismaService } from '../../src/prisma/prisma.service';

const SRC = path.resolve(__dirname, '..', '..', 'src');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function code(fn: () => unknown): string {
  try {
    fn();
    return 'returned';
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
}

describe('REV security-03 scoped ids come from the token or the call is refused', () => {
  it('REV security-03 ownDriverId gives the token\'s driver, and 403 PERMISSION_DENIED without one', () => {
    expect(ownDriverId({ driverId: 'd8f830e5-7910-41f0-9ca2-3674137c7d92' })).toBe('d8f830e5-7910-41f0-9ca2-3674137c7d92');
    expect([code(() => ownDriverId({})), code(() => ownDriverId({ driverId: '' })), code(() => ownDriverId(undefined))]).toEqual([
      'PERMISSION_DENIED',
      'PERMISSION_DENIED',
      'PERMISSION_DENIED',
    ]);
    expect(code(() => ownDistributorId({}))).toBe('PERMISSION_DENIED');
    // The money routes keep using the same helper through wallet/caller.ts.
    expect(walletOwnDistributorId).toBe(ownDistributorId);
  });

  it('REV security-03 no route or service casts the caller\'s distributor or driver id (an undefined id drops a Prisma filter)', () => {
    const cast = /\b(actor|user|caller|auth)\??\.(distributorId|driverId)\s+as\s+string\b/;
    const offenders = files(SRC)
      .flatMap((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => ({ file, line, no: i + 1 })),
      )
      .filter(({ line }) => cast.test(line))
      .map(({ file, no, line }) => `${path.relative(SRC, file)}:${no}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});

describe('REV money-data-04 a price and its per-size amounts come from one read', () => {
  const DISTRIBUTOR = '11111111-1111-4111-8111-111111111111';
  const ZONE = '22222222-2222-4222-8222-222222222222';
  const updatedAt = new Date('2026-10-22T10:00:00.000Z');
  const row = (cylinderTypeId: string | null, perCylinderPaisa: bigint | null) => ({
    id: 'price-1',
    basePaisa: 25_000n,
    note: 'Ring road',
    updatedAt,
    updatedByUserId: 'office-1',
    cylinderTypeId,
    perCylinderPaisa,
  });

  it('REV money-data-04 priceFor sends one statement for the price and its sizes, never a second read a price edit could slip between', async () => {
    const queryRaw = jest.fn();
    // Only `$queryRaw`: a Prisma `findUnique({ include: { sizes } })` (two SELECTs) would throw here.
    const db = { $queryRaw: queryRaw } as unknown as Db;
    const lookup = new ZonePriceLookup({} as PrismaService);

    queryRaw.mockResolvedValueOnce([row('size-6', 3_000n), row('size-11.8', 4_000n)]);
    expect(await lookup.priceFor(DISTRIBUTOR, ZONE, db)).toEqual({
      id: 'price-1',
      basePaisa: 25_000n,
      note: 'Ring road',
      updatedAt,
      updatedByUserId: 'office-1',
      sizes: [
        { cylinderTypeId: 'size-6', perCylinderPaisa: 3_000n },
        { cylinderTypeId: 'size-11.8', perCylinderPaisa: 4_000n },
      ],
    });
    // A flat price: the join gives the price once, with no size.
    queryRaw.mockResolvedValueOnce([row(null, null)]);
    expect(await lookup.priceFor(DISTRIBUTOR, ZONE, db)).toMatchObject({ basePaisa: 25_000n, sizes: [] });
    // No price in that zone.
    queryRaw.mockResolvedValueOnce([]);
    expect(await lookup.priceFor(DISTRIBUTOR, ZONE, db)).toBeNull();

    expect(queryRaw).toHaveBeenCalledTimes(3);
    const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/FROM distributor_zone_prices p\s+LEFT JOIN distributor_zone_price_sizes s ON s\.price_id = p\.id/);
    expect(queryRaw.mock.calls[0].slice(1)).toEqual([DISTRIBUTOR, ZONE]);
  });
});
