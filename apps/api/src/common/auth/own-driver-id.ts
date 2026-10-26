import type { AuthContext } from '../decorators/current-user.decorator';
import { AppError } from '../errors/app-error';

/**
 * The caller's own profile id on a DISTRIBUTOR- or DRIVER-scoped route: always the token's, never an id
 * from the path, query or body (API_CONTRACT §3.2). A token without it (a legacy user whose role has no
 * distributors or drivers row) gets 403 PERMISSION_DENIED before anything is read: a missing id must
 * never reach a query as `undefined`, which Prisma drops from the filter, so the caller would read every
 * tenant's rows.
 */

/** The driver of a DRIVER-scoped route (`GET /trips/mine`, `/trips/next-suggestions`, `/filling-orders/driver/mine`). */
export function ownDriverId(user: Pick<AuthContext, 'driverId'> | undefined): string {
  const id = user?.driverId;
  if (!id) throw new AppError('PERMISSION_DENIED');
  return id;
}

/**
 * The distributor of a DISTRIBUTOR-scoped route (orders, customers, refills, prices, the money routes).
 * wallet/caller.ts re-exports it for the money routes; modules that must not depend on the wallet (the
 * refill modules carry no money) import it from here.
 */
export function ownDistributorId(user: Pick<AuthContext, 'distributorId'> | undefined): string {
  const id = user?.distributorId;
  if (!id) throw new AppError('PERMISSION_DENIED');
  return id;
}
