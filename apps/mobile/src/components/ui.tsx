import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle, TextStyle } from 'react-native';
import { colors, radius, shadow, space, text } from '../theme';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Heading({ children, size = 'h2', style, numberOfLines }: { children: ReactNode; size?: 'h1' | 'h2' | 'h3'; style?: TextStyle; numberOfLines?: number }) {
  return <Text style={[text[size], style]} numberOfLines={numberOfLines}>{children}</Text>;
}

export function Body({ children, muted = false, style, numberOfLines }: { children: ReactNode; muted?: boolean; style?: TextStyle; numberOfLines?: number }) {
  return <Text style={[text.body, muted && { color: colors.textMuted }, style]} numberOfLines={numberOfLines}>{children}</Text>;
}

export function Caption({ children, style, numberOfLines }: { children: ReactNode; style?: TextStyle; numberOfLines?: number }) {
  return <Text style={[text.caption, style]} numberOfLines={numberOfLines}>{children}</Text>;
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
};

export function Button({ title, onPress, variant = 'primary', disabled, fullWidth = true, style }: ButtonProps) {
  const palette = {
    primary:   { bg: colors.primary, fg: '#fff' },
    secondary: { bg: colors.primarySoft, fg: colors.primary },
    ghost:     { bg: 'transparent', fg: colors.text },
    danger:    { bg: colors.danger, fg: '#fff' },
    success:   { bg: colors.ok, fg: '#fff' },
  }[variant];
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        fullWidth && { alignSelf: 'stretch' },
        { backgroundColor: palette.bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: palette.fg }]}>{title}</Text>
    </Pressable>
  );
}

type PillProps = {
  label: string;
  tone?: 'ok' | 'warn' | 'danger' | 'primary' | 'neutral';
  style?: ViewStyle;
};

export function Pill({ label, tone = 'neutral', style }: PillProps) {
  const palette = {
    ok: { bg: colors.okSoft, fg: colors.ok },
    warn: { bg: colors.warnSoft, fg: colors.warn },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    primary: { bg: colors.primarySoft, fg: colors.primary },
    neutral: { bg: '#EEF0F4', fg: colors.textMuted },
  }[tone];
  return (
    <View style={[{ alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: palette.bg }, style]}>
      <Text style={{ color: palette.fg, fontWeight: '600', fontSize: 12 }}>{label}</Text>
    </View>
  );
}

export function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ paddingVertical: space.sm }}>
      <Caption>{label}</Caption>
      <Text style={{ ...text.h2, marginTop: 2 }}>{value}</Text>
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
  keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'numeric' | 'number-pad' | 'decimal-pad';
  maxLength?: number;
  secureTextEntry?: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
}) {
  // Importing TextInput here to keep usage local
  const { TextInput } = require('react-native');
  return (
    <View style={{ marginBottom: space.md }}>
      {label && <Text style={[text.caption, { marginBottom: space.xs }]}>{label}</Text>}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        maxLength={maxLength}
        secureTextEntry={secureTextEntry}
        autoFocus={autoFocus}
        multiline={multiline}
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingVertical: 12,
          paddingHorizontal: 14,
          fontSize: 15,
          color: colors.text,
          minHeight: multiline ? 80 : undefined,
        }}
      />
    </View>
  );
}

export function Screen({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  const Wrapper = scroll
    ? require('react-native').ScrollView
    : View;
  return (
    <Wrapper
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={scroll ? { padding: space.lg, paddingBottom: space.xxl } : undefined}
    >
      {!scroll ? <View style={{ flex: 1, padding: space.lg }}>{children}</View> : children}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    ...shadow.card,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    alignItems: 'center',
    marginVertical: space.xs,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
