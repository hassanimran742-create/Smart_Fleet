/**
 * Distributors and their one store (UX_ADMIN §2.4). Owned by the admin-web-ops lane.
 *
 * Contract with app/router.tsx (foundation):
 * - `DistributorsPage`: `/distributors` (route id '/distributors'); search `DistributorsSearch`
 *   (`suspended`).
 * - `NewDistributorDrawer`: `/distributors/new` (route id '/distributors/new'), the 640 px Add drawer,
 *   rendered over `DistributorsPage`; it closes with `useCloseDrawer()` from app/drawer.ts.
 * - `DistributorPage`: `/distributors/$id` (route id '/distributors/$id'), a full page of its own.
 */
export { DistributorPage } from './DistributorPage';
export { DistributorsPage } from './DistributorsPage';
export { NewDistributorDrawer } from './NewDistributorDrawer';
