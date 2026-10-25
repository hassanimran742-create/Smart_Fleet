import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { formatPkPhone } from '@smartfleet/shared-utils';
import { qk } from '../../api/keys';
import { fetchMe } from '../../api/me';
import { fetchHome } from '../../screens/distributor/shared/api';
import { keepTogether } from '../../ui';
import type { MenuActions, MenuItem, MenuModel } from './types';

/**
 * The shop app's side menu (UX_MOBILE S2 Menu; shop spec §E). Owned by the mobile-distributor lane.
 * The header names who is signed in: the business name and the phone, with no balance (Home shows
 * it). Three 56 dp rows with an icon and one word and no grey line: Profile, Help and Sign out (red;
 * SideMenu asks "Sign out?" first). Wallet and My orders are Home tiles, and Home is the only screen
 * that opens the menu.
 */
export function useDistributorMenu({ visible, go, signOut }: MenuActions): MenuModel {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: qk.me, queryFn: fetchMe, enabled: visible });
  // Home has usually loaded this already: the menu reads the business name from it first.
  const home = useQuery({ queryKey: qk.home, queryFn: fetchHome, enabled: visible });

  const businessName = home.data?.distributor.businessName || me.data?.distributorProfile?.businessName || '';
  const phone = me.data?.phone ? keepTogether(formatPkPhone(me.data.phone)) : '';

  const items: MenuItem[] = [
    { key: 'profile', icon: 'profile', label: t('home.menu.profile'), onPress: () => go('Profile') },
    { key: 'help', icon: 'help', label: t('home.menu.help'), onPress: () => go('Help') },
    { key: 'signOut', icon: 'signOut', label: t('home.menu.signOut'), tone: 'danger', onPress: signOut },
  ];

  return { header: { title: businessName || me.data?.name || '', subtitle: phone || undefined }, items };
}
