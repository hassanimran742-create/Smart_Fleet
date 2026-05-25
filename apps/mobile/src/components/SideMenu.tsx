import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { Animated, Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { api } from '../api/client';
import { setLanguage } from '../i18n/persist';
import { Body, Caption, Heading } from './ui';
import { colors, radius, space } from '../theme';

export type SideMenuItem = {
  icon: string;
  label: string;
  subtitle?: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
};

export type SideMenuHeader = {
  title: string;
  subtitle?: string;
  extra?: string;
};

/**
 * Right-side slide-in menu. Variant decides which hook builds the header
 * + items (separate components keep React's rules-of-hooks satisfied).
 */
export function SideMenu({
  visible,
  onClose,
  variant,
}: {
  visible: boolean;
  onClose: () => void;
  variant: 'distributor' | 'driver' | 'client';
}) {
  const { width } = useWindowDimensions();
  const sheetWidth = Math.min(width * 0.82, 360);
  const translateX = useRef(new Animated.Value(sheetWidth)).current;

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : sheetWidth,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <Animated.View
          onStartShouldSetResponder={() => true}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: sheetWidth,
            backgroundColor: colors.background,
            transform: [{ translateX }],
            paddingTop: 48,
            paddingHorizontal: space.lg,
            shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12,
          }}
        >
          {variant === 'distributor'
            ? <DistributorBody visible={visible} onClose={onClose} />
            : variant === 'driver'
              ? <DriverBody visible={visible} onClose={onClose} />
              : <ClientBody visible={visible} onClose={onClose} />}
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function SheetBody({ header, items }: { header: SideMenuHeader; items: SideMenuItem[] }): ReactNode {
  return (
    <>
      <View
        style={{
          padding: space.md, borderRadius: radius.lg,
          backgroundColor: colors.primary, marginBottom: space.md,
        }}
      >
        <View
          style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: 'rgba(255,255,255,0.2)',
            alignItems: 'center', justifyContent: 'center', marginBottom: space.sm,
          }}
        >
          <Body style={{ fontSize: 28 }}>👤</Body>
        </View>
        <Heading size="h3" style={{ color: 'white' }} numberOfLines={1}>{header.title}</Heading>
        {header.subtitle && (
          <Caption style={{ color: 'rgba(255,255,255,0.85)' }} numberOfLines={1}>{header.subtitle}</Caption>
        )}
        {header.extra && (
          <Body style={{ color: 'white', marginTop: 6, fontWeight: '700' }}>{header.extra}</Body>
        )}
      </View>

      {items.map((it) => (
        <Pressable
          key={it.label}
          onPress={it.onPress}
          style={({ pressed }: any) => ({
            paddingVertical: 12, paddingHorizontal: 10,
            marginBottom: 4, borderRadius: radius.md,
            backgroundColor: pressed ? colors.surface : 'transparent',
            flexDirection: 'row', alignItems: 'center', gap: 12,
          })}
        >
          <View
            style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: it.tone === 'danger' ? '#fee2e2' : '#f1f5fb',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Body style={{ fontSize: 18 }}>{it.icon}</Body>
          </View>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '600', color: it.tone === 'danger' ? colors.danger : colors.text }}>
              {it.label}
            </Body>
            {it.subtitle && <Caption style={{ marginTop: 2 }}>{it.subtitle}</Caption>}
          </View>
          {it.tone !== 'danger' && (
            <Body style={{ color: colors.textMuted, fontSize: 20 }}>›</Body>
          )}
        </Pressable>
      ))}
    </>
  );
}

function DistributorBody({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const nav = useNavigation<any>();
  const { clear } = useAuthStore();
  const { i18n } = useTranslation();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    enabled: visible,
  });
  const balance = useQuery({
    queryKey: ['balance'],
    queryFn: async () => (await api.get('/ledger/balance')).data,
    enabled: visible,
  });
  const balanceRs = balance.data ? Number(balance.data.balancePaisa) / 100 : null;

  const go = (s: string) => { onClose(); setTimeout(() => nav.navigate(s), 200); };
  const flipLang = async () => setLanguage(i18n.language === 'ur' ? 'en' : 'ur');

  const header: SideMenuHeader = {
    title: me.data?.distributorProfile?.businessName ?? '—',
    subtitle: `${me.data?.name ?? ''}${me.data?.phone ? ' · ' + me.data.phone : ''}`,
    extra: balanceRs != null ? `Rs. ${balanceRs.toLocaleString()}` : undefined,
  };

  const items: SideMenuItem[] = useMemo(() => [
    { icon: '👤', label: 'Profile settings', subtitle: 'Name, business name, phone', onPress: () => go('Profile') },
    { icon: '🔔', label: 'Notifications', subtitle: 'Recent updates', onPress: () => go('Notifications') },
    { icon: '🌐', label: i18n.language === 'ur' ? 'Switch to English' : 'اردو میں دیکھیں', onPress: flipLang },
    { icon: '💳', label: 'Top up balance', subtitle: balanceRs != null ? `Rs. ${balanceRs.toLocaleString()}` : 'Add money', onPress: () => go('Topup') },
    { icon: '⛽', label: 'Refill cylinders', subtitle: 'Send empties for refill', onPress: () => go('RequestFilling') },
    { icon: '🛒', label: 'My orders', onPress: () => go('OrderHistory') },
    { icon: 'ℹ️', label: 'About', subtitle: 'LPG Management', onPress: () => go('About') },
    { icon: '↪️', label: 'Sign out', tone: 'danger', onPress: () => { onClose(); setTimeout(() => clear(), 150); } },
  ], [i18n.language, balanceRs]);

  return <SheetBody header={header} items={items} />;
}

function DriverBody({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const nav = useNavigation<any>();
  const { clear } = useAuthStore();
  const { i18n } = useTranslation();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    enabled: visible,
  });

  const go = (s: string) => { onClose(); setTimeout(() => nav.navigate(s), 200); };
  const flipLang = async () => setLanguage(i18n.language === 'ur' ? 'en' : 'ur');

  const driverProfile = me.data?.driverProfile;
  const header: SideMenuHeader = {
    title: me.data?.name ?? '—',
    subtitle: `${me.data?.phone ?? ''}${driverProfile?.licenceNo ? ' · #' + driverProfile.licenceNo : ''}`,
    extra: driverProfile?.currentVehicle?.plateNo ?? undefined,
  };

  const items: SideMenuItem[] = useMemo(() => [
    { icon: '👤', label: 'Profile', subtitle: 'Name, phone, licence', onPress: () => go('Profile') },
    { icon: '🔔', label: 'Notifications', onPress: () => go('Notifications') },
    { icon: '🌐', label: i18n.language === 'ur' ? 'Switch to English' : 'اردو میں دیکھیں', onPress: flipLang },
    { icon: '🚐', label: 'My vehicle', subtitle: driverProfile?.currentVehicle?.plateNo ?? 'Not assigned', onPress: () => go('VehicleInfo') },
    { icon: '⛽', label: 'Fuel refill', onPress: () => go('FuelRefill') },
    { icon: 'ℹ️', label: 'About', onPress: () => go('About') },
    { icon: '↪️', label: 'Sign out', tone: 'danger', onPress: () => { onClose(); setTimeout(() => clear(), 150); } },
  ], [i18n.language, driverProfile?.currentVehicle?.plateNo]);

  return <SheetBody header={header} items={items} />;
}

function ClientBody({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const nav = useNavigation<any>();
  const { clear } = useAuthStore();
  const { i18n } = useTranslation();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    enabled: visible,
  });

  const go = (s: string) => { onClose(); setTimeout(() => nav.navigate(s), 200); };
  const flipLang = async () => setLanguage(i18n.language === 'ur' ? 'en' : 'ur');

  const header: SideMenuHeader = {
    title: me.data?.name ?? '—',
    subtitle: me.data?.phone ?? '',
  };

  const items: SideMenuItem[] = useMemo(() => [
    { icon: '📦', label: 'My deliveries', onPress: () => go('Home') },
    { icon: '🌐', label: i18n.language === 'ur' ? 'Switch to English' : 'اردو میں دیکھیں', onPress: flipLang },
    { icon: 'ℹ️', label: 'About', onPress: () => go('About') },
    { icon: '↪️', label: 'Sign out', tone: 'danger', onPress: () => { onClose(); setTimeout(() => clear(), 150); } },
  ], [i18n.language]);

  return <SheetBody header={header} items={items} />;
}

export function HamburgerButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: any) => ({
        padding: 10, marginRight: 4,
        opacity: pressed ? 0.6 : 1,
      })}
      hitSlop={8}
    >
      <View style={{ width: 22, height: 16, justifyContent: 'space-between' }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ height: 2, backgroundColor: colors.text, borderRadius: 1 }} />
        ))}
      </View>
    </Pressable>
  );
}
