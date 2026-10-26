/**
 * PRC-012: the DISTRIBUTOR_ZONE fee strategy against a fake price lookup (no database). The cost is ONE
 * flat amount per order, whatever cylinders it holds (ADR-08, owner 2026-10-26).
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
};
const SOUTH: ZonePriceRow = { ...NORTH, id: 'price-south', basePaisa: 40_000n };

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
  it('PRC-012 the cost is the zone price once per order, whatever cylinders the order holds', async () => {
    // X1 against North: Rs 250 once (a per-line cost would give Rs 500).
    const x1 = await strategyWith(NORTH).quote(
      ctx([
        { cylinderTypeId: KG11, fullCount: 2 },
        { cylinderTypeId: KG45, fullCount: 1 },
      ]),
    );
    expect(x1).toEqual({
      strategy: 'DISTRIBUTOR_ZONE',
      zone: { id: 'zone-north', name: 'North' },
      basePaisa: 25_000n,
      totalPaisa: 25_000n,
      price: { id: 'price-north', updatedAt: NORTH.updatedAt },
    });
    expect(x1.totalPaisa).not.toBe(50_000n);

    // 10 × 15 kg, or one 6 kg cylinder, against North: the same Rs 250.
    expect((await strategyWith(NORTH).quote(ctx([{ cylinderTypeId: KG15, fullCount: 10 }]))).totalPaisa).toBe(25_000n);
    expect((await strategyWith(NORTH).quote(ctx([{ cylinderTypeId: KG6, fullCount: 1 }]))).totalPaisa).toBe(25_000n);

    // X2 (3 × 15 kg) against South: Rs 400.
    const x2 = await strategyWith(SOUTH).quote(ctx([{ cylinderTypeId: KG15, fullCount: 3 }], { id: 'zone-south', name: 'South' }));
    expect([x2.basePaisa, x2.totalPaisa]).toEqual([40_000n, 40_000n]);

    // A price of Rs 0 costs nothing, however many cylinders.
    const free: ZonePriceRow = { ...NORTH, basePaisa: 0n };
    expect((await strategyWith(free).quote(ctx([{ cylinderTypeId: KG45, fullCount: 4 }]))).totalPaisa).toBe(0n);

    // Every money value is a BigInt.
    for (const quote of [x1, x2]) {
      expect(typeof quote.basePaisa).toBe('bigint');
      expect(typeof quote.totalPaisa).toBe('bigint');
    }
  });

  it('PRC-012 a size that is not a cylinder type is 404 NOT_FOUND on the lines, though it would not change the cost', async () => {
    const quote = strategyWith(NORTH).quote(ctx([{ cylinderTypeId: '00000000-0000-4000-8000-000000000099', fullCount: 1 }]));
    await expect(quote).rejects.toMatchObject({ code: 'NOT_FOUND', details: { field: 'lines' } });
  });

  it('PRC-012 no price row for the zone is 422 PRICING_PRICE_NOT_SET naming the zone', async () => {
    const quote = strategyWith(null).quote(ctx([{ cylinderTypeId: KG11, fullCount: 1 }], { id: 'zone-east', name: 'East' }));
    await expect(quote).rejects.toBeInstanceOf(AppError);
    await expect(quote).rejects.toMatchObject({ code: 'PRICING_PRICE_NOT_SET', details: { zoneId: 'zone-east', zoneName: 'East' } });
  });
});
