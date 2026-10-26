import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button } from './Button';
import { space } from './tokens';

export interface AddMoreProps {
  /** The optional fields it opens. */
  children: ReactNode;
  /** Default "Add more"; the plus is the icon ("+ Add note", "+ Add taken back"). */
  label?: string;
  /** Opens it from the start, e.g. when a field inside already has a value. */
  open?: boolean;
  /** Called when the person opens it (focus the first field). */
  onOpen?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Optional details wait behind "+ Add more" (UX_PRINCIPLES §3, rule 10): a ghost button with the plus
 * icon that shows its fields in place. Once open it stays open, so nothing typed is hidden again.
 */
export function AddMore({ children, label, open = false, onOpen, style, testID }: AddMoreProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(open);

  // A prefill that arrives later (a saved transaction ID) opens it too; nothing ever closes it.
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);

  if (opened) {
    return (
      <View testID={testID} style={[styles.fields, style]}>
        {children}
      </View>
    );
  }
  return (
    <Button
      testID={testID}
      label={label ?? t('common.actions.addMore')}
      icon="plus"
      variant="ghost"
      fullWidth={false}
      onPress={() => {
        setOpened(true);
        onOpen?.();
      }}
      style={[styles.button, style]}
    />
  );
}

const styles = StyleSheet.create({
  fields: { gap: space.lg },
  // The ghost's text lines up with the fields' left edge.
  button: { paddingHorizontal: space.sm, marginStart: -space.sm },
});
