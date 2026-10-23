import { create } from 'zustand';

/**
 * @deprecated Legacy navigation shim. The website now uses TanStack Router (app/router.tsx), so every
 * page has a URL. Old screens still call `useRouteStore(s => s.go)('drivers')`; `go` maps the old page
 * id to its route and navigates there. New code uses `<Link to>` or `useNavigate()`.
 */
export type Page =
  | 'dashboard'
  | 'zones'
  | 'stores'
  | 'orders'
  | 'drivers'
  | 'vehicles'
  | 'pricing'
  | 'distributors'
  | 'reports'
  | 'inventory'
  | 'accessories'
  | 'live'
  | 'transfers'
  | 'alerts'
  | 'filling-stations'
  | 'fuel-report'
  | 'expenses'
  | 'qr-generator'
  | 'payments'
  | 'profile';

/** Where each old page lives now (UX_ADMIN §1.2). */
export const LEGACY_PAGE_PATHS: Readonly<Record<Page, string>> = {
  dashboard: '/today',
  zones: '/zones',
  stores: '/stores',
  orders: '/orders',
  drivers: '/drivers',
  vehicles: '/vans',
  pricing: '/prices',
  distributors: '/distributors',
  reports: '/reports',
  inventory: '/cylinders',
  accessories: '/accessories',
  live: '/live',
  transfers: '/transfers',
  alerts: '/alerts',
  'filling-stations': '/stations',
  'fuel-report': '/expenses?tab=fuel-logs',
  expenses: '/expenses',
  'qr-generator': '/cylinders?tab=labels',
  payments: '/topups',
  profile: '/profile',
};

type Navigate = (href: string) => void;
let navigate: Navigate | null = null;

/** Called once by the router so `go()` can change the URL without importing the router here. */
export function registerLegacyNavigator(fn: Navigate): void {
  navigate = fn;
}

interface RouteState {
  page: Page;
  params: Record<string, string>;
  go: (p: Page, params?: Record<string, string>) => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  page: 'dashboard',
  params: {},
  go: (p, params = {}) => {
    set({ page: p, params });
    navigate?.(LEGACY_PAGE_PATHS[p]);
  },
}));
