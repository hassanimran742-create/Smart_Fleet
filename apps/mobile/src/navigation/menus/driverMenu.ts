import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../../api/keys';
import { fetchMe } from '../../api/me';
import { REFILLS_QUERY_KEY, fetchDriverRefills, openRefillsOf } from '../../screens/driver/refillModel';
import { ltr } from '../../ui';
import type { DriverStackParams } from '../DriverStack';
import type { MenuActions, MenuItem, MenuModel } from './types';

/** The routes the menu opens (typed against the driver stack). */
type MenuRoute = Extract<keyof DriverStackParams, 'Van' | 'Refills' | 'Help'>;

/**
 * The driver app's side menu (driver spec D5), owned by the mobile-driver lane: My van, Refills, Help
 * and Sign out, each one word with its icon and no grey second line. The header card is the driver's
 * name and the van's plate. Profile is merged into Help. Fuel refill, Notifications and the language
 * switch are not in the pilot. Refills shows how many are open (Today's cached list, review23 ux-02).
 */
export function useDriverMenu({ visible, go, signOut }: MenuActions): MenuModel {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: qk.me, queryFn: fetchMe, enabled: visible });
  const refills = useQuery({ queryKey: REFILLS_QUERY_KEY, queryFn: fetchDriverRefills, enabled: visible });
  const openRefills = refills.data ? openRefillsOf(refills.data).length : 0;
  const open = (route: MenuRoute) => () => go(route);

  const plate = me.data?.driverProfile?.currentVehicle?.plateNo ?? null;
  const header = {
    title: me.data?.name ?? '',
    extra: plate ? ltr(plate) : undefined,
  };

  const items: MenuItem[] = [
    { key: 'van', icon: 'van', label: t('common.menu.van'), onPress: open('Van') },
    {
      key: 'refills',
      icon: 'cylinder',
      label: t('driver.menu.refills'),
      badge: openRefills > 0 ? String(openRefills) : undefined,
      accessibilityLabel: openRefills > 0 ? t('driver.menu.refillsA11y', { count: openRefills }) : undefined,
      onPress: open('Refills'),
    },
    { key: 'help', icon: 'help', label: t('common.menu.help'), onPress: open('Help') },
    { key: 'signOut', icon: 'signOut', label: t('common.menu.signOut'), tone: 'danger', onPress: signOut },
  ];

  return { header, items };
}
