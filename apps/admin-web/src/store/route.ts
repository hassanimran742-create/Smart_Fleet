import { create } from 'zustand';

type Page = 'dashboard' | 'zones' | 'stores' | 'orders' | 'drivers' | 'pricing' | 'distributors' | 'reports';

interface RouteState {
  page: Page;
  go: (p: Page) => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  page: 'dashboard',
  go: (p) => set({ page: p }),
}));
