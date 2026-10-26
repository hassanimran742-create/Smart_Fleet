/**
 * Orders board and order drawer (UX_ADMIN §2.5). Owned by the admin-web-ops lane.
 *
 * Contract with app/router.tsx (foundation):
 * - `OrdersPage`: `/orders` (route id '/orders'); search `OrdersSearch` from app/search.ts (`tab`, `q`,
 *   `distributor`).
 * - `OrderDrawer`: `/orders/$orderId` (route id '/orders/$orderId'). The router renders it after
 *   `OrdersPage`, so the board stays underneath; it closes with `useCloseDrawer()` from app/drawer.ts.
 *
 * The assign, cancel, could-not-deliver and manual-delivery dialogs belong to the drawer (no routes).
 */
export { OrderDrawer } from './OrderDrawer';
export { OrdersPage } from './OrdersPage';
