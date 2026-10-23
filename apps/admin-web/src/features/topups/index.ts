/**
 * Top-up requests and the review drawer (UX_ADMIN §2.2). Owned by the admin-web-money lane.
 *
 * Contract with app/router.tsx (foundation):
 * - `TopupsPage`: `/topups` (route id '/topups'); search `TopupsSearch` from app/search.ts (`tab`, `q`).
 * - `TopupDrawer`: `/topups/$paymentId` (route id '/topups/$paymentId'), rendered over `TopupsPage`; it
 *   closes with `useCloseDrawer()` from app/drawer.ts.
 * Approve and reject go through `useApiMutation({ idempotent: true })`, then invalidate `qk.topups.all`,
 * the wallets, the activity log and `qk.summary()` (the navigation badge).
 */
export { TopupsPage } from './TopupsPage';
export { TopupDrawer } from './TopupDrawer';
