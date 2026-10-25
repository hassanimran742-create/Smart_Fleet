/**
 * Refills for the office (UX_ADMIN §4.1, Inc 3), rebuilt with the Orders pattern; it replaces the legacy
 * refill screen (whose "Mark complete" the Inc 3 server refuses with 410). Owned by the office UI lane.
 *
 * Contract with app/router.tsx:
 * - `RefillsPage`: `/refills` (route id '/refills'), search `RefillsSearch` (`validateRefillsSearch`).
 * - `RefillDrawer`: `/refills/$refillId` (route id '/refills/$refillId'), rendered over the page; it
 *   closes with `useCloseDrawer()`.
 */
export { RefillDrawer } from './RefillDrawer';
export { RefillsPage } from './RefillsPage';
export { REFILL_TABS, validateRefillsSearch, type RefillTab, type RefillsSearch } from './search';
