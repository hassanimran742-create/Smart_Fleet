import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { formatPkPhone } from '@smartfleet/shared-utils';
import { qk } from '../../api/keys';
import { fetchMe } from '../../api/me';
import { fetchHome } from '../../screens/distributor/shared/api';
import type { MenuActions, MenuItem, MenuModel } from './types';

/**
 * The shop app's side menu (UX_MOBILE S2 Menu). Owned by the mobile-distributor lane.
 * A header with the business name and phone (and the balance from `GET /distributor/home`), then
 * 56 dp rows: Wallet, My orders, Profile, Help, and Sign out (red; SideMenu asks "Sign out of Smart
 * Fleet?" first). Notifications, the language switch and About are gone.
 */
export function useDistributorMenu({ visible, go, signOut }: MenuActions): MenuModel {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: qk.me, queryFn: fetchMe, enabled: visible });
  const home = useQuery({ queryKey: qk.home, queryFn: fetchHome, enabled: visible });

  const businessName = home.data?.distributor.businessName || me.data?.distributorProfile?.businessName || '';
  const phone = me.data?.phone ? formatPkPhone(me.data.phone) : '';
  const header = {
    title: businessName || me.data?.name || '',
    subtitle: phone || undefined,
    balancePaisa: home.data?.wallet.balancePaisa ?? null,
  };

  const items: MenuItem[] = [
    {
      key: 'wallet',
      icon: 'wallet',
      label: t('home.menu.wallet'),
      subtitle: t('home.menu.walletHelp'),
      onPress: () => go('Wallet'),
    },
    {
      key: 'orders',
      icon: 'order',
      label: t('home.menu.orders'),
      subtitle: t('home.menu.ordersHelp'),
      onPress: () => go('Orders'),
    },
    {
      key: 'profile',
      icon: 'profile',
      label: t('home.menu.profile'),
      subtitle: t('home.menu.profileHelp'),
      onPress: () => go('Profile'),
    },
    {
      key: 'help',
      icon: 'help',
      label: t('home.menu.help'),
      subtitle: t('home.menu.helpHelp'),
      onPress: () => go('Help'),
    },
    { key: 'signOut', icon: 'signOut', label: t('home.menu.signOut'), tone: 'danger', onPress: signOut },
  ];

  return { header, items };
}
