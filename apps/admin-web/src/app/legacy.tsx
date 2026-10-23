import { lazy, Suspense, type ComponentType, type FC, type LazyExoticComponent } from 'react';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { nav } from '../i18n/en/nav';
import { cx } from '../ui/cx';
import { EmptyState } from '../ui/EmptyState';
import { SkeletonText } from '../ui/Skeleton';
import { Tabs } from '../ui/Tabs';
import { stringifySearch } from './search';

/**
 * The screens moved to src/legacy (UX_ADMIN §1.1), mounted unchanged inside the new shell until their
 * lane replaces them. Each file exports a component with the file's name.
 *
 * They are loaded through `import.meta.glob`, so deleting a legacy file never breaks the build: its
 * route then says "This screen has moved". Each one renders inside `.legacy`, which scopes the old
 * stylesheet (src/styles.css) so it can't leak into the new design system.
 */
export type LegacyScreenName =
  | 'AlertsScreen'
  | 'DriversScreen'
  | 'FillingOrdersScreen'
  | 'FillingStationsScreen'
  | 'InventoryScreen'
  | 'LiveDeliveriesScreen'
  | 'ProfileScreen'
  | 'QrGeneratorScreen'
  | 'ReportsScreen'
  | 'StoresScreen'
  | 'TransfersScreen'
  | 'VehiclesScreen'
  | 'ZonesScreen';

const loaders = import.meta.glob<Record<string, unknown>>('../legacy/*.tsx');

function MovedScreen() {
  const { t } = useTranslation();
  return <EmptyState title={t('legacy.movedTitle')} body={t('legacy.movedBody')} />;
}

const lazyScreens = new Map<LegacyScreenName, LazyExoticComponent<ComponentType>>();

function lazyScreen(name: LegacyScreenName): LazyExoticComponent<ComponentType> {
  let screen = lazyScreens.get(name);
  if (!screen) {
    screen = lazy(async () => {
      const load = loaders[`../legacy/${name}.tsx`];
      if (!load) return { default: MovedScreen };
      const mod = await load();
      const component = mod[name];
      return { default: typeof component === 'function' ? (component as ComponentType) : MovedScreen };
    });
    lazyScreens.set(name, screen);
  }
  return screen;
}

/** True while `src/legacy/<name>.tsx` exists. */
export function hasLegacyScreen(name: LegacyScreenName): boolean {
  return `../legacy/${name}.tsx` in loaders;
}

export interface LegacyScreenProps {
  name: LegacyScreenName;
  /** `page` (default) for a screen inside the shell; `bare` for a full page such as the old sign-in. */
  frame?: 'page' | 'bare';
}

/** Renders one legacy screen inside the `.legacy` style scope, with a skeleton while its code loads. */
export function LegacyScreen({ name, frame = 'page' }: LegacyScreenProps) {
  const Screen = lazyScreen(name);
  return (
    <div className={cx('legacy', `legacy--${frame}`)} data-legacy-screen={name}>
      <Suspense fallback={<SkeletonText lines={6} />}>
        <Screen />
      </Suspense>
    </div>
  );
}

/** A route component for one legacy screen: `component: legacyScreen('DriversScreen')`. */
export function legacyScreen(name: LegacyScreenName, frame: LegacyScreenProps['frame'] = 'page'): FC {
  function LegacyRoute() {
    return <LegacyScreen name={name} frame={frame} />;
  }
  LegacyRoute.displayName = `Legacy(${name})`;
  return LegacyRoute;
}

export interface LegacyTab {
  /** The `?tab=` value; the first tab is the default and leaves `tab` out of the URL. */
  id: string;
  labelKey: keyof typeof nav.tabs;
  screen: LegacyScreenName;
}

/**
 * A route component showing legacy screens as tabs kept in `?tab=` (for example Cylinders & labels:
 * the old inventory screen and the QR label screen).
 */
export function legacyTabs(options: { titleKey: keyof typeof nav.pages; tabs: readonly [LegacyTab, ...LegacyTab[]] }): FC {
  const [first] = options.tabs;
  function LegacyTabsRoute() {
    const { t } = useTranslation('nav');
    const router = useRouter();
    const location = useLocation();
    const search = location.search as Record<string, unknown>;
    const active = options.tabs.find((tab) => tab.id === search.tab) ?? first;
    const select = (id: string) => {
      const next = { ...search, tab: id === first.id ? undefined : id };
      void router.navigate({ href: `${location.pathname}${stringifySearch(next)}`, replace: true });
    };
    return (
      <div className="sf-legacy-tabs">
        <Tabs
          label={t(`pages.${options.titleKey}`)}
          items={options.tabs.map((tab) => ({ id: tab.id, label: t(`tabs.${tab.labelKey}`) }))}
          value={active.id}
          onChange={select}
        />
        <LegacyScreen key={active.screen} name={active.screen} />
      </div>
    );
  }
  LegacyTabsRoute.displayName = `LegacyTabs(${options.titleKey})`;
  return LegacyTabsRoute;
}
