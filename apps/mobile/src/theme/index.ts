// Shared design tokens used by both distributor and driver variants.
// Tweak here and every screen picks it up.

export const colors = {
  primary: '#0F6CF0',
  primaryDark: '#0A55C4',
  primarySoft: '#E8F0FE',
  ok: '#1EA675',
  okSoft: '#E5F6EE',
  warn: '#F59E0B',
  warnSoft: '#FEF3C7',
  danger: '#D33A3A',
  dangerSoft: '#FCE7E7',
  text: '#1F2025',
  textMuted: '#6B6F76',
  border: '#E3E4E8',
  surface: '#FFFFFF',
  background: '#F4F5F9',
  shadow: 'rgba(15, 23, 42, 0.08)',
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;

export const text = {
  h1: { fontSize: 26, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: '600' as const, color: colors.text },
  h3: { fontSize: 16, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 14, color: colors.text },
  caption: { fontSize: 12, color: colors.textMuted },
};
