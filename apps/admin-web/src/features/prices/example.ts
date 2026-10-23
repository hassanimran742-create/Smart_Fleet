import type { DistributorDto, PriceGridSize } from '@smartfleet/shared-types';
import i18n from '../../i18n';
import { formatRs } from '../../i18n/format';

/** The example order in the price drawer: two full cylinders of one size (UX_ADMIN §2.3). */
const EXAMPLE_COUNT = 2;

/**
 * The drawer's live example, with zero parts left out so a flat price reads only the base:
 * "An order of 2 × 11.8 kg costs Rs 250 + 2 × Rs 40 = Rs 330", "… costs Rs 250", "… costs 2 × Rs 40 = Rs 80".
 * The example size is the first with an amount, else the first size. Null while the base per order
 * isn't an amount yet: Rs 0 is a real price, so a blank base must never read as "costs Rs 0".
 */
export function priceExample(
  basePaisa: bigint | null,
  sizes: readonly PriceGridSize[],
  amounts: ReadonlyMap<string, bigint>,
): string | null {
  if (basePaisa === null) return null;
  const t = i18n.t;
  const base = formatRs(basePaisa);
  if (sizes.length === 0) return t('prices:drawer.example.noSizes', { base });
  const size = sizes.find((candidate) => (amounts.get(candidate.cylinderTypeId) ?? 0n) > 0n) ?? sizes[0];
  const per = amounts.get(size.cylinderTypeId) ?? 0n;
  const total = basePaisa + BigInt(EXAMPLE_COUNT) * per;
  const parts = { n: EXAMPLE_COUNT, size: size.label, base, per: formatRs(per), total: formatRs(total) };
  if (per === 0n) return t('prices:drawer.example.baseOnly', parts);
  if (basePaisa === 0n) return t('prices:drawer.example.sizeOnly', parts);
  return t('prices:drawer.example.both', parts);
}

/** The distributor a bare `/prices` opens: the first active one by name, else the first waiting, else any. */
export function firstDistributor(list: readonly DistributorDto[]): DistributorDto | undefined {
  return list.find((d) => d.status === 'ACTIVE') ?? list.find((d) => d.status === 'PENDING') ?? list[0];
}
