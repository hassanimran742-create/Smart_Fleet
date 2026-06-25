import { create } from 'zustand';

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
  | 'profile';

interface RouteState {
  page: Page;
  params: Record<string, string>;
  go: (p: Page, params?: Record<string, string>) => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  page: 'dashboard',
  params: {},
  go: (p, params = {}) => set({ page: p, params }),
}));
