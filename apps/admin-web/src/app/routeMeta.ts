import type { nav } from '../i18n/en/nav';
import type { NavItemId } from './nav';

/** A page title: `nav:pages.<key>`. */
export type PageTitleKey = keyof typeof nav.pages;

declare module '@tanstack/react-router' {
  /** What each route says about itself (app/router.tsx sets it): its title, menu item and parent page. */
  interface StaticDataRouteOption {
    /** The page title (`nav:pages.<titleKey>`): the browser tab and the top bar under 1024 px. */
    titleKey?: PageTitleKey;
    /** The navigation item the route belongs to: it is highlighted in the menu. */
    navId?: NavItemId;
    /**
     * A page above this one that isn't a parent route, for example Distributors above one distributor:
     * the page header's back link ("← Distributors").
     */
    parent?: { titleKey: PageTitleKey; href: string };
  }
}

export {};
