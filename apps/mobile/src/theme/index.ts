/**
 * The legacy theme names, pointed at the design tokens (UX_MOBILE §2 Migration). Older screens keep
 * compiling and get the AA colours and the larger type for free. New code imports from `src/ui`.
 *
 * | Old name | Token |
 * |---|---|
 * | primary | brand |
 * | primaryDark | brandPressed |
 * | primarySoft | brandSoft |
 * | ok | success |
 * | okSoft | successSoft |
 * | warn | warning |
 * | warnSoft | warningSoft |
 * | textMuted | textSecondary |
 * | background | canvas |
 */
import {
  colors as tokens,
  elevation,
  radius as tokenRadius,
  space as tokenSpace,
  typography,
} from '../ui/tokens';

export const colors = {
  primary: tokens.brand,
  primaryDark: tokens.brandPressed,
  primarySoft: tokens.brandSoft,
  ok: tokens.success,
  okSoft: tokens.successSoft,
  warn: tokens.warning,
  warnSoft: tokens.warningSoft,
  danger: tokens.danger,
  dangerSoft: tokens.dangerSoft,
  text: tokens.text,
  textMuted: tokens.textSecondary,
  border: tokens.border,
  surface: tokens.surface,
  background: tokens.canvas,
  shadow: tokens.shadow,
};

export const radius = {
  sm: tokenRadius.sm,
  md: tokenRadius.md,
  lg: tokenRadius.lg,
  xl: tokenRadius.sheet,
  pill: tokenRadius.pill,
};

export const space = {
  xs: tokenSpace.xs,
  sm: tokenSpace.sm,
  md: tokenSpace.md,
  lg: tokenSpace.lg,
  xl: tokenSpace.xl,
  xxl: tokenSpace.xxl,
};

/** Shadow only: older screens spread it onto coloured tiles too, which must not gain a grey border. */
export const shadow = {
  card: elevation.raised,
} as const;

/** h1 → title, h2 → heading, h3 → bodyStrong; body and caption keep their names. */
export const text = {
  h1: { ...typography.title, color: tokens.text },
  h2: { ...typography.heading, color: tokens.text },
  h3: { ...typography.bodyStrong, color: tokens.text },
  body: { ...typography.body, color: tokens.text },
  caption: { ...typography.caption, color: tokens.textSecondary },
};
