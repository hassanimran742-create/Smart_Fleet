import { UserRole } from '@prisma/client';
import { AppError } from '../errors/app-error';

/**
 * Ownership policies (API_CONTRACT §3.2). Each takes the caller and the loaded record (or null when it
 * wasn't found) and returns the record when the caller may see it. Otherwise it throws a 404, so a
 * record's existence never leaks to someone who doesn't own it:
 *
 *   const order = canSeeOrder(user, await this.prisma.order.findUnique({ where: { id }, include: { trip: true } }));
 *
 * "The office" is SUPER_ADMIN only (ADR-02). Ids from the token are compared, never ids from the body.
 */
export interface PolicyCaller {
  role: string;
  distributorId?: string | null;
  driverId?: string | null;
}

export interface OwnedByDistributor {
  distributorId: string;
}

function isOffice(caller: PolicyCaller): boolean {
  return caller.role === UserRole.SUPER_ADMIN;
}

function isOwningDistributor(caller: PolicyCaller, record: OwnedByDistributor): boolean {
  return (
    caller.role === UserRole.DISTRIBUTOR && !!caller.distributorId && caller.distributorId === record.distributorId
  );
}

function isDriver(caller: PolicyCaller, driverId: string | null | undefined): boolean {
  return caller.role === UserRole.DRIVER && !!caller.driverId && caller.driverId === driverId;
}

type NotFoundCode = 'NOT_FOUND' | 'CLIENT_NOT_FOUND';

function allow<T>(record: T | null | undefined, allowed: (record: T) => boolean, code: NotFoundCode = 'NOT_FOUND'): T {
  if (record === null || record === undefined || !allowed(record)) throw new AppError(code);
  return record;
}

/** The office, the owning distributor, or the driver of the order's trip. */
export function canSeeOrder<T extends OwnedByDistributor & { trip?: { driverId: string | null } | null }>(
  caller: PolicyCaller,
  order: T | null | undefined,
): T {
  return allow(order, (o) => isOffice(caller) || isOwningDistributor(caller, o) || isDriver(caller, o.trip?.driverId));
}

/** The trip's driver only. */
export function canActOnTrip<T extends { driverId: string | null }>(caller: PolicyCaller, trip: T | null | undefined): T {
  return allow(trip, (t) => isDriver(caller, t.driverId));
}

/** The office or the owning distributor. */
export function canSeePayment<T extends OwnedByDistributor>(caller: PolicyCaller, payment: T | null | undefined): T {
  return allow(payment, (p) => isOffice(caller) || isOwningDistributor(caller, p));
}

/** The office, the owning distributor, or the assigned driver. */
export function canSeeRefill<T extends OwnedByDistributor & { assignedDriverId: string | null }>(
  caller: PolicyCaller,
  refill: T | null | undefined,
): T {
  return allow(
    refill,
    (r) => isOffice(caller) || isOwningDistributor(caller, r) || isDriver(caller, r.assignedDriverId),
  );
}

/**
 * The owning distributor; the office may read (`access: 'read'`, the default) but not change a
 * customer. Answers CLIENT_NOT_FOUND (404), the code the order and address rules use.
 */
export function canSeeClient<T extends OwnedByDistributor>(
  caller: PolicyCaller,
  client: T | null | undefined,
  options: { access?: 'read' | 'write' } = {},
): T {
  const officeMayPass = (options.access ?? 'read') === 'read';
  return allow(client, (c) => (officeMayPass && isOffice(caller)) || isOwningDistributor(caller, c), 'CLIENT_NOT_FOUND');
}

/** The office or the owning distributor. */
export function canSeeCylinder<T extends OwnedByDistributor>(caller: PolicyCaller, cylinder: T | null | undefined): T {
  return allow(cylinder, (c) => isOffice(caller) || isOwningDistributor(caller, c));
}
