import type { DistributorDto } from '@smartfleet/shared-types';
import i18n from '../../i18n';
import { formatRs } from '../../i18n/format';

/**
 * The drawer's live example (website spec W16): "Any order → Rs 250", the one delivery cost per order
 * whatever cylinders it holds (ADR-08). Null while the box isn't an amount yet: Rs 0 is a real price, so a
 * blank box must never read as "Any order → Rs 0" (the drawer then shows no example at all).
 */
export function priceExample(basePaisa: bigint | null): string | null {
  if (basePaisa === null) return null;
  return i18n.t('prices:drawer.example', { cost: formatRs(basePaisa) });
}

/** The distributor a bare `/prices` opens: the first active one by name, else the first waiting, else any. */
export function firstDistributor(list: readonly DistributorDto[]): DistributorDto | undefined {
  return list.find((d) => d.status === 'ACTIVE') ?? list.find((d) => d.status === 'PENDING') ?? list[0];
}
