import { Linking, Pressable, StyleSheet } from 'react-native';
import { telUrl } from '../../../hooks/useAppConfig';
import { colors, Icon, sizes } from '../../../ui';

/**
 * A 48 dp round call button with the `call` icon, for a row's trailing slot ("Call Sana" on Customers
 * and Order detail, shop spec §K, §T). It opens the dialler with a `tel:` link. `label` is what screen
 * readers hear, because the icon carries the meaning.
 */
export function CallButton({ phone, label, testID }: { phone: string; label: string; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={() => void Linking.openURL(telUrl(phone)).catch(() => undefined)}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={sizes.hitSlop}
      android_ripple={{ color: colors.ripple, borderless: true }}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      <Icon name="call" size={24} tone="brand" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: sizes.iconButton,
    height: sizes.iconButton,
    borderRadius: sizes.iconButton / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  pressed: { backgroundColor: colors.sunken },
});
