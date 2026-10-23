/**
 * PRC-012: the DISTRIBUTOR_ZONE fee strategy against a fake price lookup (no database).
 */
import { AppError } from '../../src/common/errors/app-error';
import { DistributorZoneStrategy } from '../../src/modules/pricing/distributor-zone.strategy';
import type { FeeQuoteContext } from '../../src/modules/pricing/delivery-fee.strategy';
import type { CylinderSize } from '../../src/modules/pricing/size-label';
import type { ZonePriceLookup, ZonePriceRow } from '../../src/modules/pricing/zone-price.lookup';

const KG6 = '00000000-0000-4000-8000-000000000006';
const KG11 = '00000000-0000-4000-8000-000000000011';
const KG15 = '00000000-0000-4000-8000-000000000015';
const KG45 = '00000000-0000-4000-8000-000000000045';

const SIZES: CylinderSize[] = [
  { id: KG6, code: 'LPG_6KG', label: '6 kg', weightKg: 6 },
  { id: KG11, code: 'LPG_11.8KG', label: '11.8 kg', weightKg: 11.8 },
  { id: KG15, code: 'LPG_15KG', label: '15 kg', weightKg: 15 },
  { id: KG45, code: 'LPG_45.4KG', label: '45.4 kg', weightKg: 45.4 },
];

const NORTH: ZonePriceRow = {
  id: 'price-north',
  basePaisa: 25_000n,
  note: null,
  updatedAt: new Date('2026-10-20T10:00:00Z'),
  updatedByUserId: null,
  sizes: [
    { cylinderTypeId: KG6, perCylinderPaisa: 3_000n },
    { cylinderTypeId: KG11, perCylinderPaisa: 4_000n },
    { cylinderTypeId: KG15, perCylinderPaisa: 8_000n },
    { cylinderTypeId: KG45, perCylinderPaisa: 15_000n },
  ],
};
const SOUTH: ZonePriceRow = { ...NORTH, id: 'price-south', basePaisa: 40_000n, sizes: [] };

function strategyWith(price: ZonePriceRow | null): DistributorZoneStrategy {
  const lookup = {
    priceFor: jest.fn(async () => price),
    sizes: jest.fn(async () => SIZES),
  } as unknown as ZonePriceLookup;
  return new DistributorZoneStrategy(lookup);
}

function ctx(lines: FeeQuoteContext['lines'], zone = { id: 'zone-north', name: 'North' }): FeeQuoteContext {
  return {
    distributorId: 'distributor-da',
    originStore: { id: 'store-da', zoneId: 'zone-north', lat: 31.52, lng: 74.22 },
    zone,
    destination: { lat: 31.53, lng: 74.23 },
    lines,
  };
}

describe('api-orders: the DISTRIBUTOR_ZONE fee strategy', () => {
  it('PRC-012 the base is charged once per order plus each size amount times its full cylinders', async () => {
    // X1 against North: 25000 + 2 × 4000 + 1 × 15000 = 48000 (a per-line base would give 73000).
    const x1 = await strategyWith(NORTH).quote(
      ctx([
        { cylinderTypeId: KG11, fullCount: 2 },
        { cylinderTypeId: KG45, fullCount: 1 },
      ]),
    );
    expect(x1.totalPaisa).toBe(48_000n);
    expect(x1.totalPaisa).not.toBe(73_000n);
    expect(x1).toMatchObject({ strategy: 'DISTRIBUTOR_ZONE', zone: { name: 'North' }, basePaisa: 25_000n });
    expect(x1.lines).toEqual([
      { cylinderTypeId: KG11, sizeLabel: '11.8 kg', count: 2, perCylinderPaisa: 4_000n, subtotalPaisa: 8_000n },
      { cylinderTypeId: KG45, sizeLabel: '45.4 kg', count: 1, perCylinderPaisa: 15_000n, subtotalPaisa: 15_000n },
    ]);

    // 10 × 15 kg against North.
    expect((await strategyWith(NORTH).quote(ctx([{ cylinderTypeId: KG15, fullCount: 10 }]))).totalPaisa).toBe(105_000n);

    // X2 (3 × 15 kg) against South, which has no size rows.
    const x2 = await strategyWith(SOUTH).quote(ctx([{ cylinderTypeId: KG15, fullCount: 3 }], { id: 'zone-south', name: 'South' }));
    expect(x2.totalPaisa).toBe(40_000n);
    expect(x2.lines).toEqual([{ cylinderTypeId: KG15, sizeLabel: '15 kg', count: 3, perCylinderPaisa: 0n, subtotalPaisa: 0n }]);

    // A missing size row counts as 0, and base 0 with no sizes costs 0.
    const noEleven: ZonePriceRow = { ...NORTH, sizes: NORTH.sizes.filter((size) => size.cylinderTypeId !== KG11) };
    expect((await strategyWith(noEleven).quote(ctx([{ cylinderTypeId: KG11, fullCount: 1 }]))).totalPaisa).toBe(25_000n);
    const free: ZonePriceRow = { ...NORTH, basePaisa: 0n, sizes: [] };
    expect((await strategyWith(free).quote(ctx([{ cylinderTypeId: KG45, fullCount: 4 }]))).totalPaisa).toBe(0n);

    // Every money value is a BigInt.
    for (const quote of [x1, x2]) {
      expect(typeof quote.basePaisa).toBe('bigint');
      expect(typeof quote.totalPaisa).toBe('bigint');
      for (const line of quote.lines) {
        expect(typeof line.perCylinderPaisa).toBe('bigint');
        expect(typeof line.subtotalPaisa).toBe('bigint');
      }
    }
  });

  it('PRC-012 no price row for the zone is 422 PRICING_PRICE_NOT_SET naming the zone', async () => {
    const quote = strategyWith(null).quote(ctx([{ cylinderTypeId: KG11, fullCount: 1 }], { id: 'zone-east', name: 'East' }));
    await expect(quote).rejects.toBeInstanceOf(AppError);
    await expect(quote).rejects.toMatchObject({ code: 'PRICING_PRICE_NOT_SET', details: { zoneId: 'zone-east', zoneName: 'East' } });
  });
});
