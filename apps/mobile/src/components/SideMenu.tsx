import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { signOut } from '../api/session';
import { useDistributorMenu } from '../navigation/menus/distributorMenu';
import { useDriverMenu } from '../navigation/menus/driverMenu';
import type { MenuActions, MenuModel, UseMenu } from '../navigation/menus/types';
import {
  colors,
  confirm,
  HeaderIconButton,
  Icon,
  motion,
  radius,
  sizes,
  space,
  Text,
  useReduceMotion,
} from '../ui';

export type { MenuHeader as SideMenuHeader, MenuItem as SideMenuItem } from '../navigation/menus/types';

/** Lets the close animation run before the next screen opens. */
const NAVIGATE_DELAY_MS = 200;

/**
 * The right-side slide-in menu. It renders the items of `navigation/menus/distributorMenu.ts` or
 * `driverMenu.ts` (each owned by its app's lane), with the slide animation kept from the first app.
 * The header card says who is signed in (the shop: name and phone; the driver: name and van plate);
 * the rows are 56 dp, an icon and one word, with no grey second line (shop spec §E, driver spec D5).
 * Home shows the balance, so the menu doesn't.
 */
export function SideMenu({
  visible,
  onClose,
  variant,
}: {
  visible: boolean;
  onClose: () => void;
  /** `client` is the retired customer app (ClientStack is out of navigation for the pilot). */
  variant: 'distributor' | 'driver' | 'client';
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const sheetWidth = Math.min(width * 0.82, 360);
  const translateX = useRef(new Animated.Value(sheetWidth)).current;

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : sheetWidth,
      duration: reduceMotion ? 0 : motion.sheet,
      useNativeDriver: true,
    }).start();
  }, [visible, sheetWidth, reduceMotion, translateX]);

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'fade'}
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.fill}>
        <Pressable style={styles.scrim} onPress={onClose} importantForAccessibility="no" />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { width: sheetWidth, paddingTop: insets.top + space.md, transform: [{ translateX }] },
          ]}
        >
          {/* One body per variant (keyed), so each menu hook always runs in its own component. */}
          {variant === 'distributor' ? (
            <MenuBody key="distributor" useMenu={useDistributorMenu} visible={visible} onClose={onClose} />
          ) : variant === 'driver' ? (
            <MenuBody key="driver" useMenu={useDriverMenu} visible={visible} onClose={onClose} />
          ) : (
            <MenuBody key="client" useMenu={useClientMenu} visible={visible} onClose={onClose} />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The retired customer app's menu (kept so ClientStack still compiles). */
function useClientMenu({ go, signOut: askSignOut }: MenuActions): MenuModel {
  const { t } = useTranslation();
  return {
    header: { title: t('common.appName') },
    items: [
      { key: 'deliveries', icon: 'home', label: t('common.menu.deliveries'), onPress: () => go('Home') },
      { key: 'about', icon: 'info', label: t('common.menu.about'), onPress: () => go('About') },
      { key: 'signOut', icon: 'signOut', label: t('common.menu.signOut'), tone: 'danger', onPress: askSignOut },
    ],
  };
}

function MenuBody({ useMenu, visible, onClose }: { useMenu: UseMenu; visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  const go = useCallback(
    (route: string, params?: object) => {
      onClose();
      setTimeout(() => navigation.navigate(route, params), NAVIGATE_DELAY_MS);
    },
    [navigation, onClose],
  );

  const askSignOut = useCallback(() => {
    onClose();
    setTimeout(() => {
      // Kept by rule 7: getting back in needs the password, and the body says so.
      void confirm({
        title: t('common.signOut.title'),
        body: t('common.signOut.body'),
        confirmLabel: t('common.signOut.confirm'),
        confirmTone: 'danger',
        cancelLabel: t('common.signOut.cancel'),
        onConfirm: () => signOut(),
      });
    }, NAVIGATE_DELAY_MS);
  }, [onClose, t]);

  const { header, items } = useMenu({ visible, go, signOut: askSignOut, close: onClose });

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.lg }}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Icon name="customer" size={32} tone="onBrand" />
        </View>
        {header.title ? (
          <Text variant="heading" tone="onBrand" numberOfLines={2}>
            {header.title}
          </Text>
        ) : null}
        {header.subtitle ? (
          <Text variant="caption" tone="onBrandMuted" numberOfLines={2}>
            {header.subtitle}
          </Text>
        ) : null}
        {header.extra ? (
          <Text variant="bodyStrong" tone="onBrand">
            {header.extra}
          </Text>
        ) : null}
      </View>

      {items.map((item) => {
        const danger = item.tone === 'danger';
        return (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            android_ripple={{ color: colors.ripple }}
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          >
            <View style={[styles.rowIcon, { backgroundColor: danger ? colors.dangerSoft : colors.brandSoft }]}>
              <Icon name={item.icon} size={20} tone={danger ? 'danger' : 'brand'} />
            </View>
            <View style={styles.rowText}>
              <Text variant="bodyStrong" tone={danger ? 'danger' : 'default'}>
                {item.label}
              </Text>
            </View>
            {!danger ? <Icon name="chevron" size={24} tone="secondary" /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** The header's menu button (48 / 56 dp). */
export function HamburgerButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return <HeaderIconButton icon="menu" label={t('common.menu.open')} onPress={onPress} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute',
    top: 0,
    end: 0,
    bottom: 0,
    backgroundColor: colors.canvas,
    paddingHorizontal: space.lg,
    elevation: 8,
  },
  header: {
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.brandText,
    marginBottom: space.md,
    gap: space.xs,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.onBrandSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  row: {
    minHeight: sizes.menuRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    marginBottom: space.xs,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  rowPressed: { backgroundColor: colors.surface },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
});
