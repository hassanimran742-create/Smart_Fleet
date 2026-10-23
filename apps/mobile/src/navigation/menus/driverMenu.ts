import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { formatPkPhone } from '@smartfleet/shared-utils';
import { qk } from '../../api/keys';
import { fetchMe } from '../../api/me';
import type { DriverStackParams } from '../DriverStack';
import type { MenuActions, MenuItem, MenuModel } from './types';

/** The routes the menu opens (typed against the driver stack). */
type MenuRoute = Extract<keyof DriverStackParams, 'Profile' | 'VehicleInfo' | 'FillingRuns' | 'Help'>;

/**
 * The driver app's side menu (UX_MOBILE §5), owned by the mobile-driver lane: Profile, My van, Refill
 * runs, Help and Sign out. Fuel refill, Notifications and the language switch are not in the pilot
 * (`features.fuelRefills` is off and the driver app has no fuel-log screen, API_CONTRACT §7.2).
 */
export function useDriverMenu({ visible, go, signOut }: MenuActions): MenuModel {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: qk.me, queryFn: fetchMe, enabled: visible });
  const open = (route: MenuRoute) => () => go(route);

  const profile = me.data?.driverProfile;
  const plate = profile?.currentVehicle?.plateNo ?? null;
  const phone = me.data?.phone ? formatPkPhone(me.data.phone) : '';
  const licence = profile?.licenceNo ? t('common.menu.licence', { number: profile.licenceNo }) : '';
  const header = {
    title: me.data?.name ?? '',
    subtitle: [phone, licence].filter(Boolean).join(' · ') || undefined,
    extra: plate ?? undefined,
  };

  const items: MenuItem[] = [
    {
      key: 'profile',
      icon: 'profile',
      label: t('common.menu.profile'),
      subtitle: t('common.menu.driverProfileHelp'),
      onPress: open('Profile'),
    },
    {
      key: 'van',
      icon: 'van',
      label: t('common.menu.van'),
      subtitle: plate ?? t('common.menu.vanNone'),
      onPress: open('VehicleInfo'),
    },
    {
      key: 'refillRuns',
      icon: 'cylinder',
      label: t('common.menu.refillRuns'),
      subtitle: t('common.menu.refillRunsHelp'),
      onPress: open('FillingRuns'),
    },
    {
      key: 'help',
      icon: 'help',
      label: t('common.menu.help'),
      subtitle: t('driver.menu.helpHelp'),
      onPress: open('Help'),
    },
    { key: 'signOut', icon: 'signOut', label: t('common.menu.signOut'), tone: 'danger', onPress: signOut },
  ];

  return { header, items };
}
