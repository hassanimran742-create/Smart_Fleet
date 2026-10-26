import type { ComponentType, FC } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { ActivityPage } from '../features/activity';
import { CylinderPage } from '../features/cylinders';
import { DayEndPage, DayEndReviewPage, validateDayEndSearch } from '../features/dayend';
import { DistributorPage, DistributorsPage, NewDistributorDrawer } from '../features/distributors';
import { ExpensesPage, ExpenseTypesDrawer } from '../features/expenses';
import { OrderDrawer, OrdersPage } from '../features/orders';
import { PriceDrawer, PricesIndexPage, PricesPage } from '../features/prices';
import { ProblemsPage } from '../features/problems';
import { RefillDrawer, RefillsPage, validateRefillsSearch } from '../features/refills';
import { SettingsPage } from '../features/settings';
import { TodayPage } from '../features/today';
import { TopupDrawer, TopupsPage } from '../features/topups';
import { WalletPage, WalletsPage } from '../features/wallets';
import { AppShell } from './AppShell';
import { legacyScreen, legacyTabs } from './legacy';
import { ModuleGate } from './ModuleGate';
import type { ModuleId } from './modules';
import { NotFoundPage, RouteErrorPage } from './NotFoundPage';
import { RequireStaff } from './RequireStaff';
import './routeMeta';
import {
  parseSearch,
  stringifySearch,
  validateActivitySearch,
  validateCylindersSearch,
  validateDistributorsSearch,
  validateExpensesSearch,
  validateOrdersSearch,
  validatePricesSearch,
  validateSettingsSearch,
  validateTopupsSearch,
  validateWalletSearch,
} from './search';

/**
 * Every route of the office website (UX_ADMIN §1.2), code-based TanStack Router. The foundation owns
 * this file: each lane fills the components exported by its `features/<area>/index.ts`, so lanes never
 * edit it. Drawers are child routes rendered over their page: a link opens the exact record, a refresh
 * keeps it open and Back closes it. Tabs and filters are search params (app/search.ts).
 *
 * Inc 2 adds `/problems` and `/cylinders/find/$number`; Inc 3 adds `/day-end` and `/day-end/$dayEndId`.
 */

export interface RouterContext {
  queryClient: QueryClient;
}

function RootLayout() {
  return (
    <RequireStaff>
      <AppShell />
    </RequireStaff>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
});

/** A page with a drawer child route: the page, then its drawer (when the URL names a record). */
function withDrawer(Page: ComponentType): FC {
  function PageWithDrawer() {
    return (
      <>
        <Page />
        <Outlet />
      </>
    );
  }
  PageWithDrawer.displayName = `WithDrawer(${Page.displayName ?? Page.name})`;
  return PageWithDrawer;
}

/** A screen shown only while its module is on; otherwise "{{module}} is switched off". */
function gated(module: ModuleId, Screen: ComponentType): FC {
  function GatedScreen() {
    return (
      <ModuleGate module={module}>
        <Screen />
      </ModuleGate>
    );
  }
  GatedScreen.displayName = `Gated(${module})`;
  return GatedScreen;
}

// ---- Increment 1 pages -------------------------------------------------------------------------

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/today', replace: true });
  },
});

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'today',
  component: TodayPage,
  staticData: { titleKey: 'today', navId: 'today' },
});

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'orders',
  validateSearch: validateOrdersSearch,
  component: withDrawer(OrdersPage),
  staticData: { titleKey: 'orders', navId: 'orders' },
});

const orderRoute = createRoute({
  getParentRoute: () => ordersRoute,
  path: '$orderId',
  component: OrderDrawer,
  staticData: { titleKey: 'order', navId: 'orders' },
});

const topupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'topups',
  validateSearch: validateTopupsSearch,
  component: withDrawer(TopupsPage),
  staticData: { titleKey: 'topups', navId: 'topups' },
});

const topupRoute = createRoute({
  getParentRoute: () => topupsRoute,
  path: '$paymentId',
  component: TopupDrawer,
  staticData: { titleKey: 'topup', navId: 'topups' },
});

const walletsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'wallets',
});

const walletsIndexRoute = createRoute({
  getParentRoute: () => walletsRoute,
  path: '/',
  component: WalletsPage,
  staticData: { titleKey: 'wallets', navId: 'wallets' },
});

const walletRoute = createRoute({
  getParentRoute: () => walletsRoute,
  path: '$distributorId',
  validateSearch: validateWalletSearch,
  component: WalletPage,
  staticData: { titleKey: 'wallet', navId: 'wallets', parent: { titleKey: 'wallets', href: '/wallets' } },
});

const pricesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'prices',
});

const pricesIndexRoute = createRoute({
  getParentRoute: () => pricesRoute,
  path: '/',
  component: PricesIndexPage,
  staticData: { titleKey: 'prices', navId: 'prices' },
});

const priceGridRoute = createRoute({
  getParentRoute: () => pricesRoute,
  path: '$distributorId',
  validateSearch: validatePricesSearch,
  component: withDrawer(PricesPage),
  staticData: { titleKey: 'prices', navId: 'prices' },
});

const priceRoute = createRoute({
  getParentRoute: () => priceGridRoute,
  path: '$zoneId',
  component: PriceDrawer,
  staticData: { titleKey: 'price', navId: 'prices' },
});

const distributorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'distributors',
  validateSearch: validateDistributorsSearch,
  component: withDrawer(DistributorsPage),
  staticData: { titleKey: 'distributors', navId: 'distributors' },
});

const newDistributorRoute = createRoute({
  getParentRoute: () => distributorsRoute,
  path: 'new',
  component: NewDistributorDrawer,
  staticData: { titleKey: 'newDistributor', navId: 'distributors' },
});

/** A full page, not a drawer, so it isn't a child of the list (its static sibling `new` wins over `$id`). */
const distributorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'distributors/$id',
  component: DistributorPage,
  staticData: {
    titleKey: 'distributor',
    navId: 'distributors',
    parent: { titleKey: 'distributors', href: '/distributors' },
  },
});

const expensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'expenses',
  validateSearch: validateExpensesSearch,
  component: withDrawer(ExpensesPage),
  staticData: { titleKey: 'expenses', navId: 'expenses' },
});

const expenseTypesRoute = createRoute({
  getParentRoute: () => expensesRoute,
  path: 'types',
  component: ExpenseTypesDrawer,
  staticData: { titleKey: 'expenseTypes', navId: 'expenses' },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  validateSearch: validateSettingsSearch,
  component: SettingsPage,
  staticData: { titleKey: 'settings', navId: 'settings' },
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'activity',
  validateSearch: validateActivitySearch,
  component: ActivityPage,
  staticData: { titleKey: 'activity', navId: 'activity' },
});

// ---- Increment 2 pages (UX_ADMIN §3) -------------------------------------------------------------

const problemsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'problems',
  component: ProblemsPage,
  staticData: { titleKey: 'problems', navId: 'problems' },
});

/** Find cylinder (§3.5): a full page; the search box at the top of the menu opens it. */
const cylinderFindRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'cylinders/find/$number',
  component: CylinderPage,
  staticData: { titleKey: 'findCylinder' },
});

// ---- Increment 3 pages (UX_ADMIN §4) -------------------------------------------------------------

/** Refills, rebuilt with the Orders pattern (§4.1): it replaces the legacy refill screen. */
const refillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'refills',
  validateSearch: validateRefillsSearch,
  component: withDrawer(RefillsPage),
  staticData: { titleKey: 'refills', navId: 'refills' },
});

const refillRoute = createRoute({
  getParentRoute: () => refillsRoute,
  path: '$refillId',
  component: RefillDrawer,
  staticData: { titleKey: 'refill', navId: 'refills' },
});

const dayEndRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'day-end',
  validateSearch: validateDayEndSearch,
  component: DayEndPage,
  staticData: { titleKey: 'dayEnd', navId: 'dayEnd' },
});

/** A full page, not a drawer: the differences table needs the width (§4.3). */
const dayEndReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'day-end/$dayEndId',
  component: DayEndReviewPage,
  staticData: { titleKey: 'dayEndReview', navId: 'dayEnd', parent: { titleKey: 'dayEnd', href: '/day-end' } },
});

// ---- Legacy screens inside the shell (UX_ADMIN §1.2, §2.11) ---------------------------------------

const stationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'stations',
  component: legacyScreen('FillingStationsScreen'),
  staticData: { titleKey: 'stations', navId: 'stations' },
});

const driversRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'drivers',
  component: legacyScreen('DriversScreen'),
  staticData: { titleKey: 'drivers', navId: 'drivers' },
});

const vansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'vans',
  component: legacyScreen('VehiclesScreen'),
  staticData: { titleKey: 'vans', navId: 'vans' },
});

const zonesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'zones',
  component: legacyScreen('ZonesScreen'),
  staticData: { titleKey: 'zones', navId: 'zones' },
});

const cylindersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'cylinders',
  validateSearch: validateCylindersSearch,
  component: legacyTabs({
    titleKey: 'cylinders',
    tabs: [
      { id: 'stock', labelKey: 'cylinderStock', screen: 'InventoryScreen' },
      { id: 'labels', labelKey: 'cylinderLabels', screen: 'QrGeneratorScreen' },
    ],
  }),
  staticData: { titleKey: 'cylinders', navId: 'cylinders' },
});

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'live',
  component: legacyScreen('LiveDeliveriesScreen'),
  staticData: { titleKey: 'live', navId: 'live' },
});

const alertsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'alerts',
  component: legacyScreen('AlertsScreen'),
  staticData: { titleKey: 'alerts', navId: 'alerts' },
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'profile',
  component: legacyScreen('ProfileScreen'),
  staticData: { titleKey: 'profile' },
});

/** Removed from the navigation (each store lives under its distributor); kept reachable by its URL. */
const storesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'stores',
  component: legacyScreen('StoresScreen'),
  staticData: { titleKey: 'stores', navId: 'distributors' },
});

/** Hidden on the website (ADR-04: the API stays); kept reachable by its URL only. */
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'reports',
  component: legacyScreen('ReportsScreen'),
  staticData: { titleKey: 'reports' },
});

/** `features.transfers` (off for the pilot). */
const transfersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'transfers',
  component: gated('transfers', legacyScreen('TransfersScreen')),
  staticData: { titleKey: 'transfers', navId: 'transfers' },
});

/** `features.accessories` (off for the pilot): the old inventory screen with its accessory tabs. */
const accessoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'accessories',
  component: gated('accessories', legacyScreen('InventoryScreen')),
  staticData: { titleKey: 'accessories', navId: 'accessories' },
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  todayRoute,
  ordersRoute.addChildren([orderRoute]),
  topupsRoute.addChildren([topupRoute]),
  walletsRoute.addChildren([walletsIndexRoute, walletRoute]),
  pricesRoute.addChildren([pricesIndexRoute, priceGridRoute.addChildren([priceRoute])]),
  distributorsRoute.addChildren([newDistributorRoute]),
  distributorRoute,
  expensesRoute.addChildren([expenseTypesRoute]),
  settingsRoute,
  activityRoute,
  problemsRoute,
  cylinderFindRoute,
  refillsRoute.addChildren([refillRoute]),
  dayEndRoute,
  dayEndReviewRoute,
  stationsRoute,
  driversRoute,
  vansRoute,
  zonesRoute,
  cylindersRoute,
  liveRoute,
  alertsRoute,
  profileRoute,
  storesRoute,
  reportsRoute,
  transfersRoute,
  accessoriesRoute,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    // Plain-text search params (`?tab=needs-driver&q=0142`); validateSearch types them.
    parseSearch,
    stringifySearch,
    defaultPreload: 'intent',
    // TanStack Query owns caching; the router never holds on to data.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: RouteErrorPage,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
