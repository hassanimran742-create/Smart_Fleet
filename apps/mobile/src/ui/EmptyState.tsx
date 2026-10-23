import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button, type ButtonVariant } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, space } from './tokens';

export interface EmptyStateAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
}

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body?: string;
  action?: EmptyStateAction;
  style?: StyleProp<ViewStyle>;
}

/** What a screen shows when there is nothing yet (UX_MOBILE §2.2 #14). */
export function EmptyState({ icon, title, body, action, style }: EmptyStateProps) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.badge}>
        <Icon name={icon} size={32} tone="secondary" />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {body ? (
        <Text tone="secondary" align="center">
          {body}
        </Text>
      ) : null}
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          icon={action.icon}
          variant={action.variant ?? 'secondary'}
          fullWidth={false}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  action: { marginTop: space.md, alignSelf: 'center' },
});
