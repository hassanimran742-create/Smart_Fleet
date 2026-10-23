/**
 * Expenses, expense types and the driver fuel-log tab (UX_ADMIN §2.7). Owned by the expenses lane.
 *
 * Contract with app/router.tsx (foundation):
 * - `ExpensesPage`: `/expenses` (route id '/expenses'); search `ExpensesSearch` from app/search.ts
 *   (`tab` = 'expenses' | 'fuel-logs', `from`, `to`, `type`, `van`, `driver`, `removed`).
 * - `ExpenseTypesDrawer`: `/expenses/types` (route id '/expenses/types'), the Manage types drawer,
 *   rendered over `ExpensesPage`; it closes with `useCloseDrawer()` from app/drawer.ts.
 *
 * The add / edit drawer and the remove dialog are part of the page (no route of their own).
 */
export { ExpensesPage } from './ExpensesPage';
export { ExpenseTypesDrawer } from './ExpenseTypesDrawer';
