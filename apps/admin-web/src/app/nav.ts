import {
  ArrowLeftRight,
  Banknote,
  Bell,
  ClipboardList,
  Factory,
  History,
  Map as MapIcon,
  MapPinned,
  QrCode,
  Receipt,
  RefreshCw,
  Settings,
  Store,
  Sun,
  Tags,
  Truck,
  UserRound,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { nav } from '../i18n/en/nav';
import type { ModuleId } from './modules';

/**
 * Where a badge count comes from: `/admin/summary` (waiting, needsDriver, topupsToCheck) or alerts.
 * `waiting` is the Today badge: top-ups to check + orders needing a driver (+ open customer problems
 * from Inc 2), the same count as the browser tab (navBadgeCounts, REV web-ux-04).
 */
export type NavBadge = 'waiting' | 'needsDriver' | 'topupsToCheck' | 'alerts';

export type NavItemId = keyof typeof nav.items;
export type NavGroupId = 'today' | keyof typeof nav.groups;

/** The paths the navigation links to (each is a route in app/router.tsx). */
export type NavPath =
  | '/today'
  | '/orders'
  | '/topups'
  | '/refills'
  | '/live'
  | '/wallets'
  | '/prices'
  | '/expenses'
  | '/distributors'
  | '/drivers'
  | '/vans'
  | '/zones'
  | '/stations'
  | '/cylinders'
  | '/transfers'
  | '/accessories'
  | '/alerts'
  | '/settings'
  | '/activity'
  | '/profile';

export interface NavItem {
  id: NavItemId;
  to: NavPath;
  icon: LucideIcon;
  /** Shown only while this module is on (`features.*`). */
  module?: ModuleId;
  badge?: NavBadge;
}

export interface NavGroup {
  id: NavGroupId;
  /**
   * `none`: no heading (Today); `plain`: a small heading (Work, Money); `toggle`: a heading button that
   * opens and closes the group (Setup).
   */
  heading: 'none' | 'plain' | 'toggle';
  items: readonly NavItem[];
}

/**
 * The navigation (UX_ADMIN §1.3, website spec §1.1): Today, then Work, Money and Setup. Setup opens and
 * closes; a feature's item joins it while its switch is on. Inc 2 adds "Customer problems" and Inc 3
 * "Day-end" to Work, each with a badge. Removed from it: Stores (each store lives under its distributor),
 * the inventory roll plan, Fuel & km (a tab of Expenses), Reports (the API stays) and the old Pricing
 * placeholder.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'today',
    heading: 'none',
    items: [{ id: 'today', to: '/today', icon: Sun, badge: 'waiting' }],
  },
  {
    id: 'work',
    heading: 'plain',
    items: [
      { id: 'orders', to: '/orders', icon: ClipboardList, badge: 'needsDriver' },
      { id: 'topups', to: '/topups', icon: Banknote, badge: 'topupsToCheck' },
      { id: 'refills', to: '/refills', icon: RefreshCw },
      { id: 'alerts', to: '/alerts', icon: Bell, badge: 'alerts' },
    ],
  },
  {
    id: 'money',
    heading: 'plain',
    items: [
      { id: 'wallets', to: '/wallets', icon: Wallet },
      { id: 'prices', to: '/prices', icon: Tags },
      { id: 'expenses', to: '/expenses', icon: Receipt },
    ],
  },
  {
    id: 'setup',
    heading: 'toggle',
    items: [
      { id: 'distributors', to: '/distributors', icon: Store },
      { id: 'drivers', to: '/drivers', icon: UserRound },
      { id: 'vans', to: '/vans', icon: Truck },
      { id: 'cylinders', to: '/cylinders', icon: QrCode },
      { id: 'stations', to: '/stations', icon: Factory },
      { id: 'zones', to: '/zones', icon: MapIcon },
      { id: 'live', to: '/live', icon: MapPinned },
      { id: 'transfers', to: '/transfers', icon: ArrowLeftRight, module: 'transfers' },
      { id: 'accessories', to: '/accessories', icon: Wrench, module: 'accessories' },
    ],
  },
];

/** Pinned at the foot of the navigation, above the account row: they never scroll away. */
export const NAV_PINNED: readonly NavItem[] = [
  { id: 'settings', to: '/settings', icon: Settings },
  { id: 'activity', to: '/activity', icon: History },
];

/** The group a navigation item sits in (Setup opens by itself when the current page is inside it). */
export function groupOf(id: NavItemId): NavGroup | undefined {
  return NAV_GROUPS.find((group) => group.items.some((item) => item.id === id));
}

/**
 * The tab a queue page opens on whenever it has work (UX_ADMIN §1.4): the menu link then skips the
 * remembered filters. Each is that page's default tab, so the link is just its path.
 */
export const QUEUE_BADGES: Partial<Record<NavItemId, NavBadge>> = {
  topups: 'topupsToCheck',
  orders: 'needsDriver',
};
