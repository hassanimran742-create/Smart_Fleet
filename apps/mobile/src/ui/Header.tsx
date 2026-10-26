import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { useOfficeContact } from '../hooks/useAppConfig';
import { Icon, type IconName } from './Icon';
import { colors, sizes } from './tokens';

/**
 * Native-stack options for every screen (UX_MOBILE §2.2 #4): a white header, a left-aligned
 * 18 semibold title (set the title from i18n per screen) and the canvas behind the content. The 1 px
 * line under the header is drawn by `Screen`.
 */
export function makeScreenOptions(options: { reduceMotion?: boolean } = {}): NativeStackNavigationOptions {
  return {
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerTitleAlign: 'left',
    headerTitleStyle: { fontSize: 18, fontWeight: '600', color: colors.text },
    headerShadowVisible: false,
    headerBackTitleVisible: false,
    contentStyle: { backgroundColor: colors.canvas },
    animation: options.reduceMotion ? 'none' : 'default',
  };
}

export interface HeaderIconButtonProps {
  icon: IconName;
  /** The spoken label, e.g. "Menu" or "Call office". */
  label: string;
  onPress: () => void;
  testID?: string;
}

/** A 48 / 56 dp header button with an 8 dp hit slop: the menu, "Call office", help. */
export function HeaderIconButton({ icon, label, onPress, testID }: HeaderIconButtonProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={sizes.hitSlop}
      android_ripple={{ color: colors.ripple, borderless: true }}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      <Icon name={icon} size={24} />
    </Pressable>
  );
}

/**
 * "Call office" for the header (always shown on driver screens). Hidden until the office's phone
 * (`support.phone`) is set.
 */
export function HeaderCallOfficeButton() {
  const { t } = useTranslation();
  const office = useOfficeContact();
  if (!office.phone) return null;
  return <HeaderIconButton icon="call" label={t('common.actions.callOffice')} onPress={office.call} />;
}

const styles = StyleSheet.create({
  button: {
    width: sizes.iconButton,
    height: sizes.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: sizes.iconButton / 2,
  },
  pressed: { backgroundColor: colors.sunken },
});
