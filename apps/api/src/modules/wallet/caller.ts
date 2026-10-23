import { AppError } from '../../common/errors/app-error';
import { isUuid } from './wallet.service';

/**
 * The distributor of a DISTRIBUTOR-only route: always the token's, never an id from the path, query or
 * body (API_CONTRACT §3.2). A distributor token without one can't use money routes (403). It lives in
 * common/auth with `ownDriverId`, so every scoped module can use it without depending on the wallet.
 */
export { ownDistributorId } from '../../common/auth/own-driver-id';

/** A path id: a value that isn't a UUID can name no row, so it answers 404 like an unknown one (§3.2). */
export function pathId(id: string): string {
  if (!isUuid(id)) throw new AppError('NOT_FOUND');
  return id.toLowerCase();
}
