import { CustodyType } from '@prisma/client';
import type { CylinderHolderDto, CylinderStateValue, ScannedCylinderDto } from '@smartfleet/shared-types';
import { sizeLabelOf } from '../pricing/size-label';
import type { Db } from '../orders/support/tx';
import { cylinderShortCode } from './cylinder-codes';

/** A holder as stored: `custody_type` + `custody_id`. */
export interface HolderRef {
  type: CustodyType;
  id: string;
}

/** The holder type the apps show. The legacy DISTRIBUTOR holder reads as the distributor's store. */
export type ShownHolderType = CylinderHolderDto['type'];

export function shownHolderType(type: CustodyType): ShownHolderType {
  return type === CustodyType.DISTRIBUTOR ? 'STORE' : (type as ShownHolderType);
}

function key(ref: HolderRef): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * The words for each holder: a store's name, a van's plate, a customer's name. Unknown ids read as an
 * empty string (the holder id isn't checked to exist; owner decision).
 */
export async function holderLabels(db: Db, refs: readonly (HolderRef | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = refs.filter((ref): ref is HolderRef => !!ref);
  const ids = (type: CustodyType) => [...new Set(wanted.filter((ref) => ref.type === type).map((ref) => ref.id))];
  const [stores, vans, clients, distributors] = await Promise.all([
    ids(CustodyType.STORE).length ? db.store.findMany({ where: { id: { in: ids(CustodyType.STORE) } }, select: { id: true, name: true } }) : [],
    ids(CustodyType.VEHICLE).length
      ? db.vehicle.findMany({ where: { id: { in: ids(CustodyType.VEHICLE) } }, select: { id: true, plateNo: true } })
      : [],
    ids(CustodyType.CLIENT).length ? db.client.findMany({ where: { id: { in: ids(CustodyType.CLIENT) } }, select: { id: true, name: true } }) : [],
    ids(CustodyType.DISTRIBUTOR).length
      ? db.distributor.findMany({ where: { id: { in: ids(CustodyType.DISTRIBUTOR) } }, select: { id: true, businessName: true } })
      : [],
  ]);
  const out = new Map<string, string>();
  for (const row of stores) out.set(key({ type: CustodyType.STORE, id: row.id }), row.name);
  for (const row of vans) out.set(key({ type: CustodyType.VEHICLE, id: row.id }), row.plateNo);
  for (const row of clients) out.set(key({ type: CustodyType.CLIENT, id: row.id }), row.name);
  for (const row of distributors) out.set(key({ type: CustodyType.DISTRIBUTOR, id: row.id }), row.businessName);
  return out;
}

export function labelOf(labels: Map<string, string>, ref: HolderRef | null | undefined): string | null {
  if (!ref) return null;
  return labels.get(key(ref)) ?? '';
}

/** One holder's words. */
export async function holderLabel(db: Db, ref: HolderRef): Promise<string> {
  return labelOf(await holderLabels(db, [ref]), ref) ?? '';
}

/** The cylinder of a scan answer, as it is now (API_CONTRACT §9.3 `ScanResult.cylinder`). */
export async function scannedCylinder(db: Db, cylinderId: string): Promise<ScannedCylinderDto> {
  const cylinder = await db.cylinder.findUniqueOrThrow({
    where: { id: cylinderId },
    select: {
      id: true,
      qrCode: true,
      shortNo: true,
      state: true,
      custodyType: true,
      custodyId: true,
      cylinderType: { select: { id: true, name: true, weightKg: true } },
      distributor: { select: { code: true } },
    },
  });
  const holder: HolderRef = { type: cylinder.custodyType, id: cylinder.custodyId };
  return {
    id: cylinder.id,
    code: cylinder.qrCode,
    shortNo: cylinder.shortNo,
    shortCode: cylinderShortCode(cylinder.distributor.code, cylinder.shortNo),
    size: { id: cylinder.cylinderType.id, label: sizeLabelOf(cylinder.cylinderType) },
    state: cylinder.state as CylinderStateValue,
    holder: { type: shownHolderType(holder.type), label: await holderLabel(db, holder) },
  };
}

/** Size words for cylinder types, by id ("11.8 kg"). */
export async function sizeLabels(db: Db, typeIds: readonly string[]): Promise<Map<string, { label: string; code: string; weightKg: number }>> {
  const unique = [...new Set(typeIds)];
  if (unique.length === 0) return new Map();
  const types = await db.cylinderType.findMany({ where: { id: { in: unique } }, select: { id: true, code: true, name: true, weightKg: true } });
  return new Map(
    types.map((type) => [type.id, { label: sizeLabelOf(type), code: type.code, weightKg: Number(type.weightKg?.toString() ?? 0) }]),
  );
}
