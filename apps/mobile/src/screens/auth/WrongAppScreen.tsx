import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { UserRoleValue } from '@smartfleet/shared-types';
import type { MobileVariant } from '../../api/appInfo';
import { signOut } from '../../api/session';
import { Button, Icon, Screen, Text, colors, space } from '../../ui';

const FULL_SCREEN = ['top', 'left', 'right', 'bottom'] as const;
const OFFICE_ROLES: readonly UserRoleValue[] = ['SUPER_ADMIN', 'ADMIN', 'DISPATCHER', 'STORE_KEEPER'];

type Body =
  | 'auth.wrongApp.shopAccount'
  | 'auth.wrongApp.driverAccount'
  | 'auth.wrongApp.officeAccount'
  | 'auth.wrongApp.otherAccount';

function bodyFor(role: UserRoleValue | null, variant: MobileVariant): Body {
  if (role === 'DISTRIBUTOR' && variant === 'driver') return 'auth.wrongApp.shopAccount';
  if (role === 'DRIVER' && variant === 'distributor') return 'auth.wrongApp.driverAccount';
  if (role && OFFICE_ROLES.includes(role)) return 'auth.wrongApp.officeAccount';
  return 'auth.wrongApp.otherAccount';
}

/**
 * The signed-in account belongs to another app (UX_MOBILE §3.6 gate 3, §4 S1; shop spec §B, driver
 * spec D2): "Wrong app", one line in the sign-in refusal's own words, and one button, Sign out.
 */
export function WrongAppScreen({ role, variant }: { role: UserRoleValue | null; variant: MobileVariant }) {
  const { t } = useTranslation();
  return (
    <Screen
      edges={FULL_SCREEN}
      footer={<Button label={t('auth.wrongApp.signOut')} onPress={() => void signOut()} size="lg" />}
    >
      <View style={styles.body}>
        <View style={styles.badge}>
          <Icon name="lock" size={32} tone="secondary" />
        </View>
        <Text variant="title" align="center">
          {t('auth.wrongApp.title')}
        </Text>
        <Text tone="secondary" align="center">
          {t(bodyFor(role, variant))}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.sm },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
