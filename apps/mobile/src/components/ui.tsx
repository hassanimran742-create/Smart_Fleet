/**
 * Legacy components, now thin wrappers over the design system in `src/ui` (UX_MOBILE §2 Migration).
 * They accept the props older screens pass (including `muted` on text), so those screens keep working
 * and get the AA colours, the 48 / 56 dp targets and the larger type. New screens import `src/ui`.
 */
import type { ReactNode } from 'react';
import { View, type KeyboardTypeOptions, type TextStyle, type ViewStyle } from 'react-native';
import {
  Button as UiButton,
  Card as UiCard,
  Field,
  Screen as UiScreen,
  StatusChip,
  Text,
  layout,
  space,
  type ButtonVariant,
  type ChipTone,
} from '../ui';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <UiCard style={[{ marginBottom: layout.cardGap }, style]}>{children}</UiCard>;
}

const HEADING_VARIANT = { h1: 'title', h2: 'heading', h3: 'bodyStrong' } as const;

export function Heading({
  children,
  size = 'h2',
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: 'h1' | 'h2' | 'h3';
  style?: TextStyle;
  numberOfLines?: number;
}) {
  return (
    <Text variant={HEADING_VARIANT[size]} accessibilityRole="header" style={style} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: TextStyle;
  numberOfLines?: number;
}) {
  return (
    <Text variant="body" tone={muted ? 'secondary' : 'default'} style={style} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

/** Captions are secondary text already; `muted` is accepted for older screens and changes nothing. */
export function Caption({
  children,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: TextStyle;
  numberOfLines?: number;
}) {
  return (
    <Text variant="caption" tone="secondary" style={style} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

type LegacyButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

/** Legacy "success" (green, 3.10:1) becomes primary; legacy "ghost" (outlined) becomes secondary. */
const BUTTON_VARIANT: Record<LegacyButtonVariant, ButtonVariant> = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'secondary',
  danger: 'danger',
  success: 'primary',
};

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: LegacyButtonVariant;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
};

export function Button({ title, onPress, variant = 'primary', disabled, fullWidth = true, style }: ButtonProps) {
  return (
    <UiButton
      label={title}
      onPress={onPress}
      variant={BUTTON_VARIANT[variant]}
      disabled={disabled}
      fullWidth={fullWidth}
      style={[{ marginVertical: space.xs }, style]}
    />
  );
}

type PillTone = 'ok' | 'warn' | 'danger' | 'primary' | 'neutral';

const PILL_TONE: Record<PillTone, ChipTone> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  primary: 'brand',
  neutral: 'neutral',
};

type PillProps = {
  label: string;
  tone?: PillTone;
  style?: ViewStyle;
};

export function Pill({ label, tone = 'neutral', style }: PillProps) {
  return <StatusChip tone={PILL_TONE[tone] ?? 'neutral'} label={label} style={style} />;
}

export function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ paddingVertical: space.sm }}>
      <Caption>{label}</Caption>
      <Text variant="heading" tabular style={{ marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  maxLength,
  secureTextEntry,
  autoFocus,
  multiline,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  secureTextEntry?: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
}) {
  return (
    <Field
      label={label ?? ''}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      keyboardType={keyboardType}
      maxLength={maxLength}
      secure={secureTextEntry}
      autoFocus={autoFocus}
      multiline={multiline}
      style={{ marginBottom: space.md }}
    />
  );
}

/** Legacy screens default to no scrolling (some hold their own FlatList). */
export function Screen({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  return <UiScreen scroll={scroll}>{children}</UiScreen>;
}
