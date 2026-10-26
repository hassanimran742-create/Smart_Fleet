/**
 * Wallets, the wallet page and the correction dialog (website spec W12–W14, UX_ADMIN §2.6). Owned by the
 * admin-web-money lane.
 *
 * Contract with app/router.tsx (foundation):
 * - `WalletsPage`: `/wallets` (route id '/wallets/').
 * - `WalletPage`: `/wallets/$distributorId` (route id '/wallets/$distributorId'), a full page; search
 *   `WalletSearch` from app/search.ts (`from`, `to`, `kind`) for the history filters. The Corrections
 *   filter keeps `kind=CORRECTION` in the URL and asks the API for CORRECTION,OPENING_BALANCE.
 */
export { WalletsPage } from './WalletsPage';
export { WalletPage } from './WalletPage';
