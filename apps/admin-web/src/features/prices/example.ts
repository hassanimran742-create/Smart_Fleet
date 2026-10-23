import type { DistributorDto, PriceGridPrice, PriceGridSize } from '@smartfleet/shared-types';
import i18n from '../../i18n';
import { formatRs } from '../../i18n/format';

/** The example order in the price drawer: two full cylinders of one size (website spec W16). */
const EXAMPLE_COUNT = 2;

/** 11.8 kg, the size most orders are for. */
function isCommonSize(size: PriceGridSize): boolean {
  return /^11[.,]8\s*kg$/i.test(size.label.trim()) || /11_8/.test(size.code);
}

/** The size the example uses: 11.8 kg when it has an amount, else the first size that has one. */
function exampleSize(sizes: readonly PriceGridSize[], amounts: ReadonlyMap<string, bigint>): PriceGridSize | undefined {
  const priced = sizes.filter((size) => (amounts.get(size.cylinderTypeId) ?? 0n) > 0n);
  return priced.find(isCommonSize) ?? priced[0];
}

/**
 * The drawer's live example, with zero parts left out: "2 × 11.8 kg: Rs 250 + 2 × Rs 40 = Rs 330", or
 * "Every order: Rs 250" when no size has an amount. Null while the base per order isn't an amount yet:
 * Rs 0 is a real price, so a blank base must never read as "Every order: Rs 0" (the drawer then shows
 * no example at all).
 */
export function priceExample(
  basePaisa: bigint | null,
  sizes: readonly PriceGridSize[],
  amounts: ReadonlyMap<string, bigint>,
): string | null {
  if (basePaisa === null) return null;
  const t = i18n.t;
  const base = formatRs(basePaisa);
  const size = exampleSize(sizes, amounts);
  if (!size) return t('prices:drawer.example.baseOnly', { base });
  const per = amounts.get(size.cylinderTypeId) ?? 0n;
  const total = basePaisa + BigInt(EXAMPLE_COUNT) * per;
  const parts = { n: EXAMPLE_COUNT, size: size.label, base, per: formatRs(per), total: formatRs(total) };
  return basePaisa === 0n ? t('prices:drawer.example.sizeOnly', parts) : t('prices:drawer.example.both', parts);
}

/** ["11.8 kg Rs 40", "45.4 kg Rs 150"]: only the sizes with an amount, in the grid's size order. */
export function sizeAmounts(price: PriceGridPrice | null, sizes: readonly PriceGridSize[]): string[] {
  if (!price) return [];
  return sizes.flatMap((size) => {
    const amount = price.sizes.find((entry) => entry.cylinderTypeId === size.cylinderTypeId)?.perCylinderPaisa;
    return amount && amount !== '0' ? [i18n.t('prices:grid.sizeAmount', { size: size.label, amount: formatRs(amount) })] : [];
  });
}

/** The distributor a bare `/prices` opens: the first active one by name, else the first waiting, else any. */
export function firstDistributor(list: readonly DistributorDto[]): DistributorDto | undefined {
  return list.find((d) => d.status === 'ACTIVE') ?? list.find((d) => d.status === 'PENDING') ?? list[0];
}
