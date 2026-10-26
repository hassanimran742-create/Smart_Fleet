import { useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { formatRupeesInput, normalizePkPhone, toAsciiDigits } from '@smartfleet/shared-utils';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, fontScale, radius, sizes, space, typography } from './tokens';

export interface FieldAction {
  label: string;
  onPress: () => void;
  /** Read by screen readers instead of `label` ("Show password"). */
  accessibilityLabel?: string;
}

export interface FieldProps {
  /** The label above the box. A search box can go without one: give it `accessibilityLabel` instead. */
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  helper?: string;
  error?: string | null;
  /** Adds "(optional)" after the label. Required fields have no marker. */
  optional?: boolean;
  /** An icon at the start of the box, e.g. `search` on a search field. */
  leadingIcon?: IconName;
  /** A fixed text before the input. */
  prefix?: 'Rs' | '+92';
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  maxLength?: number;
  /** Hides what is typed (passwords). */
  secure?: boolean;
  /** A text button inside the field, such as Show / Hide. */
  rightAction?: FieldAction;
  onBlur?: () => void;
  onFocus?: () => void;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  blurOnSubmit?: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
  editable?: boolean;
  inputRef?: Ref<TextInput>;
  /** What screen readers hear as the field's name when there is no visible label ("Search customers"). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A labelled text input (UX_MOBILE §2.2 #9). The label sits above; focus is a 2 px brand border; an
 * error is a 2 px danger border with an icon and the message below. Screen readers hear the label and
 * the error together.
 */
export function Field({
  label = '',
  value,
  onChangeText,
  helper,
  error,
  optional = false,
  leadingIcon,
  prefix,
  placeholder,
  keyboardType,
  autoCapitalize,
  autoComplete,
  textContentType,
  maxLength,
  secure = false,
  rightAction,
  onBlur,
  onFocus,
  returnKeyType,
  onSubmitEditing,
  blurOnSubmit,
  autoFocus,
  multiline = false,
  editable = true,
  inputRef,
  accessibilityLabel,
  style,
  testID,
}: FieldProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const hasError = !!error;
  const borderWidth = hasError || focused ? 2 : 1;
  const borderColor = hasError ? colors.danger : focused ? colors.brand : colors.borderStrong;
  const shownLabel = label && optional ? `${label} ${t('common.optional')}` : label;
  const spokenLabel = shownLabel || accessibilityLabel || placeholder || '';
  const a11yLabel = hasError
    ? `${spokenLabel}. ${t('common.field.errorA11y', { message: error ?? '' })}`
    : spokenLabel;

  return (
    <View style={[styles.wrap, style]}>
      {shownLabel ? (
        <Text variant="label" style={styles.label} importantForAccessibility="no">
          {shownLabel}
        </Text>
      ) : null}
      <View
        style={[
          styles.box,
          {
            minHeight: multiline ? sizes.input * 2 : sizes.input,
            borderWidth,
            borderColor,
            // Keep the text still when the border thickens.
            paddingHorizontal: space.md - (borderWidth - 1),
            backgroundColor: editable ? colors.surface : colors.sunken,
          },
        ]}
      >
        {leadingIcon ? <Icon name={leadingIcon} size={20} tone="secondary" style={styles.leadingIcon} /> : null}
        {prefix ? (
          <Text variant="bodyStrong" tone="secondary" style={styles.prefix}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={inputRef}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          textContentType={textContentType}
          maxLength={maxLength}
          secureTextEntry={secure}
          autoFocus={autoFocus}
          multiline={multiline}
          editable={editable}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={blurOnSubmit}
          maxFontSizeMultiplier={fontScale.max}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          accessibilityLabel={a11yLabel}
          accessibilityHint={helper}
          accessibilityState={{ disabled: !editable }}
          selectionColor={colors.brand}
          cursorColor={colors.brand}
          style={[styles.input, multiline ? styles.multiline : null]}
        />
        {rightAction ? (
          <Pressable
            onPress={rightAction.onPress}
            accessibilityRole="button"
            accessibilityLabel={rightAction.accessibilityLabel ?? rightAction.label}
            hitSlop={sizes.hitSlop}
            // A full 48 / 56 dp target from border to border (UX_MOBILE S1 "48 dp Show/Hide"; hitSlop
            // doesn't count for the Accessibility Scanner). The negative margin lets it cover the
            // border, so the box keeps its own height and doesn't jump when the border thickens.
            style={({ pressed }) => [styles.action, { marginVertical: -borderWidth }, pressed ? styles.actionPressed : null]}
          >
            <Text variant="label" tone="brand">
              {rightAction.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {hasError ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Icon name="error" size={16} tone="danger" />
          <Text variant="caption" tone="danger" style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : helper ? (
        <Text variant="caption" tone="secondary" style={styles.helper}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

/** A Pakistani mobile has 10 digits after +92: "300 1234567". */
const PK_NATIONAL_DIGITS = 10;

/**
 * What a phone field shows after its fixed "+92": the national number, spaced as it is typed
 * ("300 1234567"). A typed leading 0 is dropped, and a pasted "+92 300 …", "0092 …" or "0300 …"
 * becomes the same 10 digits, so the box never reads "+92 0300…". Accepts any digits (Urdu too).
 */
export function phoneFieldText(raw: string): string {
  let digits = toAsciiDigits(raw).replace(/\D/g, '');
  const international = raw.trim().startsWith('+');
  // A typed trunk zero, or the "00" of "0092".
  digits = digits.replace(/^0+/, '');
  if ((international || digits.length > PK_NATIONAL_DIGITS) && digits.startsWith('92')) {
    digits = digits.slice(2).replace(/^0+/, '');
  }
  digits = digits.slice(0, PK_NATIONAL_DIGITS);
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

export interface PhoneFieldProps extends Omit<FieldProps, 'prefix' | 'keyboardType' | 'onBlur'> {
  /** Called on blur with the E.164 number (`+923001234567`), or null when it isn't a Pakistani mobile. */
  onBlur?: (e164: string | null) => void;
}

/**
 * A Pakistani mobile field (UX_MOBILE §4 S1, S8; UX_PRINCIPLES §3): "+92" fixed, the phone pad, and the
 * number spaced as it is typed ("300 1234567"), with a typed leading 0 dropped. The placeholder is
 * "300 1234567", never "0300…" beside the +92. Any value given (a saved "+923001234567", "0300 …")
 * shows in that form. Read the value with `normalizePkPhone(value)`.
 */
export function PhoneField({ value, onChangeText, onBlur, placeholder, ...rest }: PhoneFieldProps) {
  const { t } = useTranslation();
  const shown = phoneFieldText(value);
  return (
    <Field
      {...rest}
      value={shown}
      onChangeText={(text) => onChangeText(phoneFieldText(text))}
      prefix="+92"
      placeholder={placeholder ?? t('common.phoneExample')}
      keyboardType="phone-pad"
      autoComplete={rest.autoComplete ?? 'tel'}
      textContentType={rest.textContentType ?? 'telephoneNumber'}
      // Room for a pasted "+92 300 1234567"; the text above keeps 10 digits.
      maxLength={rest.maxLength ?? 20}
      onBlur={() => onBlur?.(normalizePkPhone(shown))}
    />
  );
}

export type RupeeFieldProps = Omit<FieldProps, 'prefix' | 'keyboardType'>;

/**
 * A whole-rupee amount field (UX_MOBILE §3.7): the Rs prefix and digits only, grouped as you type
 * ("5,000"). Read the amount with `parseRupeesInput(value)` (paisa) from shared-utils.
 */
export function RupeeField({ onChangeText, ...rest }: RupeeFieldProps) {
  return (
    <Field
      {...rest}
      prefix="Rs"
      keyboardType="number-pad"
      onChangeText={(text) => onChangeText(formatRupeesInput(text))}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  label: { marginBottom: space.xs },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  leadingIcon: { marginEnd: space.sm },
  prefix: { marginEnd: space.sm },
  input: {
    flex: 1,
    alignSelf: 'stretch',
    paddingVertical: space.sm,
    color: colors.text,
    fontSize: typography.body.fontSize,
    // A single-line input needs no lineHeight; Android would clip the text.
  },
  multiline: {
    textAlignVertical: 'top',
    lineHeight: typography.body.lineHeight,
  },
  action: {
    alignSelf: 'stretch',
    minHeight: sizes.touch,
    minWidth: sizes.touch,
    marginStart: space.sm,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  actionPressed: { backgroundColor: colors.brandSoft },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    marginTop: space.xs,
  },
  errorText: { flex: 1 },
  helper: { marginTop: space.xs },
});
