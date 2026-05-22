import { useEffect } from 'react';
import { Animated, Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { api } from '../api/client';
import { setLanguage } from '../i18n/persist';
import { Body, Caption, Heading } from './ui';
import { colors, radius, space } from '../theme';

type Item = {
  icon: string;
  label: string;
  subtitle?: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
};

/**
 * Right-side slide-in menu for the distributor app. Shows the signed-in
 * profile summary, then a list of common destinations + sign out. Use
 * the hamburger button in the home screen's header to open it.
 */
export function SideMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const nav = useNavigation<any>();
  const { clear } = useAuthStore();
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const sheetWidth = Math.min(width * 0.82, 360);
  const translateX = new Animated.Value(sheetWidth);

  useEffect(() => {
    if (visible) {
      Animated.timing(translateX, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    }
  }, [visible]);

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

  const businessName = me.data?.distributorProfile?.businessName ?? '—';
  const userName = me.data?.name ?? '—';
  const phone = me.data?.phone ?? '';
  const balanceRs = balance.data ? Number(balance.data.balancePaisa) / 100 : null;

  function go(screen: string) {
    onClose();
    setTimeout(() => nav.navigate(screen), 200);
  }

  async function flipLanguage() {
    const next = i18n.language === 'ur' ? 'en' : 'ur';
    await setLanguage(next);
  }

  const items: Item[] = [
    { icon: '👤', label: 'Profile settings', subtitle: 'Name, business name, phone', onPress: () => go('Profile') },
    { icon: '🔔', label: 'Notifications', subtitle: 'Recent updates', onPress: () => go('Notifications') },
    { icon: '🌐', label: i18n.language === 'ur' ? 'Switch to English' : 'اردو میں دیکھیں', onPress: flipLanguage },
    { icon: '💳', label: 'Top up balance', subtitle: balanceRs != null ? `Rs. ${balanceRs.toLocaleString()}` : 'Add money', onPress: () => go('Topup') },
    { icon: '⛽', label: 'Refill cylinders', subtitle: 'Send empties for refill', onPress: () => go('RequestFilling') },
    { icon: '🛒', label: 'My orders', onPress: () => go('OrderHistory') },
    { icon: 'ℹ️', label: 'About', subtitle: 'LPG Management', onPress: () => go('About') },
    { icon: '↪️', label: 'Sign out', tone: 'danger', onPress: () => { onClose(); setTimeout(() => clear(), 150); } },
  ];

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <Animated.View
          // Stop bubbling so taps inside the sheet don't close it
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
          {/* Profile header */}
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
            <Heading size="h3" style={{ color: 'white' }} numberOfLines={1}>{businessName}</Heading>
            <Caption style={{ color: 'rgba(255,255,255,0.85)' }} numberOfLines={1}>
              {userName}{phone ? ` · ${phone}` : ''}
            </Caption>
            {balanceRs != null && (
              <Body style={{ color: 'white', marginTop: 6, fontWeight: '700' }}>
                Rs. {balanceRs.toLocaleString()}
              </Body>
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
        </Animated.View>
      </Pressable>
    </Modal>
  );
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
