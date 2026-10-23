/**
 * Delivery prices and the price drawer (UX_ADMIN §2.3). Owned by the admin-web-money lane.
 *
 * Contract with app/router.tsx (foundation):
 * - `PricesIndexPage`: `/prices` (route id '/prices/'): redirects to the first distributor or says there
 *   are none.
 * - `PricesPage`: `/prices/$distributorId` (route id '/prices/$distributorId'), the grid; search
 *   `PricesSearch` from app/search.ts (`missing`, `archived`).
 * - `PriceDrawer`: `/prices/$distributorId/$zoneId` (route id '/prices/$distributorId/$zoneId'), rendered
 *   over `PricesPage`; it closes with `useCloseDrawer()` from app/drawer.ts.
 */
export { PricesIndexPage } from './PricesIndexPage';
export { PricesPage } from './PricesPage';
export { PriceDrawer } from './PriceDrawer';
