import type { Prisma } from '@prisma/client';

/** A cylinder size as the API shows it. */
export interface CylinderSize {
  id: string;
  code: string;
  /** For example "11.8 kg". */
  label: string;
  /** For sorting: lighter sizes first. */
  weightKg: number;
}

type WeightLike = Prisma.Decimal | number | string | null | undefined;

/**
 * The size words of a cylinder type, "11.8 kg", from its weight (the seeded names read "LPG 11.8 kg").
 * A type without a usable weight falls back to its name.
 */
export function sizeLabelOf(type: { name: string; weightKg: WeightLike }): string {
  const kg = Number(type.weightKg?.toString());
  return Number.isFinite(kg) && kg > 0 ? `${kg} kg` : type.name;
}

export function toCylinderSize(type: { id: string; code: string; name: string; weightKg: WeightLike }): CylinderSize {
  const kg = Number(type.weightKg?.toString());
  return { id: type.id, code: type.code, label: sizeLabelOf(type), weightKg: Number.isFinite(kg) ? kg : 0 };
}

/** Lighter sizes first, then by code: the order every size list and breakdown uses. */
export function compareSizes(a: { weightKg: number; code: string }, b: { weightKg: number; code: string }): number {
  return a.weightKg - b.weightKg || a.code.localeCompare(b.code);
}
