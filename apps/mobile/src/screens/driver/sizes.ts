import type { TFunction } from 'i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { ApiError } from '../../api/errors';
import type { ChoiceChipOption } from '../../ui';

/** A cylinder size as `GET /cylinder-types` sends it (any signed-in user; API_CONTRACT §7.2). */
export interface CylinderTypeRow {
  id: string;
  code: string;
  name: string;
  /** A decimal on the wire ("11.80"). */
  weightKg: string | number | null;
}

/** The sizes change only when the office adds one: kept for a day, shared by the visit and My van. */
const SIZES_QUERY_KEY = ['driver', 'cylinderTypes'] as const;
const SIZES_STALE_MS = 24 * 60 * 60_000;

async function fetchCylinderTypes(): Promise<CylinderTypeRow[]> {
  const { data } = await api.get<CylinderTypeRow[]>('/cylinder-types');
  return Array.isArray(data) ? data : [];
}

/** Every known size, lightest first; empty until loaded (or when it can't load). */
export function useCylinderTypes(): CylinderTypeRow[] {
  const query = useQuery<CylinderTypeRow[], ApiError>({
    queryKey: SIZES_QUERY_KEY,
    queryFn: fetchCylinderTypes,
    staleTime: SIZES_STALE_MS,
  });
  return [...(query.data ?? [])].sort((a, b) => weightOf(a) - weightOf(b) || a.code.localeCompare(b.code));
}

function weightOf(type: Pick<CylinderTypeRow, 'weightKg'>): number {
  const kg = Number(type.weightKg);
  return Number.isFinite(kg) && kg > 0 ? kg : Number.MAX_SAFE_INTEGER;
}

/** "11.8 kg" from the type's weight, as the server words sizes; its name without a weight. */
export function sizeLabelOfType(type: Pick<CylinderTypeRow, 'name' | 'weightKg'>, t: TFunction): string {
  const kg = Number(type.weightKg);
  return Number.isFinite(kg) && kg > 0 ? t('driver.size', { kg: String(Math.round(kg * 100) / 100) }) : type.name;
}

/**
 * The size chips of the No label sheet: the order's sizes first (the likely ones), then every other
 * known size, since a customer may hand back any size (API_CONTRACT §9.12).
 */
export function sizeOptions(
  first: readonly { cylinderTypeId: string; sizeLabel: string }[],
  types: readonly CylinderTypeRow[],
  t: TFunction,
): ChoiceChipOption<string>[] {
  const options: ChoiceChipOption<string>[] = [];
  const seen = new Set<string>();
  for (const line of first) {
    if (seen.has(line.cylinderTypeId)) continue;
    seen.add(line.cylinderTypeId);
    options.push({ value: line.cylinderTypeId, label: line.sizeLabel });
  }
  for (const type of types) {
    if (seen.has(type.id)) continue;
    seen.add(type.id);
    options.push({ value: type.id, label: sizeLabelOfType(type, t) });
  }
  return options;
}
