import type { PaisaLike } from '@smartfleet/shared-utils';
import type { IconName } from '../../ui/Icon';

/** One row of the side menu (56 dp). */
export interface MenuItem {
  key: string;
  icon: IconName;
  label: string;
  subtitle?: string;
  /** Danger rows (Sign out) are red and have no chevron. */
  tone?: 'default' | 'danger';
  onPress: () => void;
}

/** The menu's header card: who is signed in. */
export interface MenuHeader {
  title: string;
  subtitle?: string;
  /** An amount shown on the card (printed by MoneyText). */
  balancePaisa?: PaisaLike | null;
  /** A short extra line, e.g. the van's plate. */
  extra?: string;
}

export interface MenuModel {
  header: MenuHeader;
  items: MenuItem[];
}

/** What SideMenu gives a menu definition. */
export interface MenuActions {
  /** True while the menu is open: use it as the `enabled` flag of the menu's queries. */
  visible: boolean;
  /** Closes the menu, then opens a route of this app's stack. */
  go: (route: string, params?: object) => void;
  /** Closes the menu and asks "Sign out of Smart Fleet?" before signing out. */
  signOut: () => void;
  close: () => void;
}

/**
 * A menu definition is a hook, so it can read its own data (`useQuery`) and words (`useTranslation`).
 * The shop and driver lanes each own one file: navigation/menus/distributorMenu.ts and driverMenu.ts.
 */
export type UseMenu = (actions: MenuActions) => MenuModel;
