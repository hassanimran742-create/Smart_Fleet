import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { IS_DRIVER_APP } from '../api/appInfo';

/**
 * Design tokens for the shop and driver apps (UX_MOBILE §2.1). This is the only file with colour
 * literals: screens and components use these names. The app is light only (app.config.ts
 * `userInterfaceStyle`). Contrast ratios are measured against the background named in the comment.
 */
export const colors = {
  /** Screen background. */
  canvas: '#F4F5F9',
  /** Cards, sheets, inputs, header. */
  surface: '#FFFFFF',
  /** Neutral chips, skeletons, disabled buttons. */
  sunken: '#EEF0F4',
  /** Decorative dividers. */
  border: '#E3E4E8',
  /** Input borders, unselected chips: 3.18 on white (non-text). */
  borderStrong: '#8A919C',

  /** Main text: 16.3 on white, 14.9 on canvas. */
  text: '#1F2025',
  /** Meta and captions: 6.8 on white, 6.3 on canvas. */
  textSecondary: '#555B66',
  /** Disabled text only. */
  textDisabled: '#8A919C',

  /** Primary buttons, focus, selected: white text 4.75. */
  brand: '#0F6CF0',
  /** Links and brand text: 6.75 on white, 5.89 on brandSoft. */
  brandText: '#0A55C4',
  /** Pressed brand surfaces and the wallet card (same value as brandText). */
  brandPressed: '#0A55C4',
  /** Selected rows, info chips. */
  brandSoft: '#E8F0FE',
  /** Text on brand and brandText surfaces. */
  onBrand: '#FFFFFF',
  /** Secondary text on the wallet card: 5.26 on brandText. */
  onBrandMuted: '#D6E4FC',

  /** Solid success: white text 4.93. */
  success: '#12805A',
  /** Done chips and money in: 4.81 on successSoft. */
  successText: '#0E7A4F',
  successSoft: '#E7F6EF',
  /** Progress bars and ticks only: 3.10 (non-text). */
  successGraphic: '#1EA675',

  /** Rare solid warning and the TRAINING banner: white text 5.09. */
  warning: '#A85A00',
  /** "Being checked" and warnings: 6.23 on warningSoft. */
  warningText: '#8A4B00',
  warningSoft: '#FFF4DE',
  /** Icons only, never under white text. */
  warningGraphic: '#F59E0B',

  /** Danger button: white text 5.62. */
  danger: '#C62828',
  /** Errors and refusals: 5.75. */
  dangerText: '#B42318',
  dangerSoft: '#FDECEA',

  /** Neutral chips: 8.85 on neutralSoft. */
  neutralText: '#3D424B',
  neutralSoft: '#EEF0F4',

  /** Scanner strip with white text: 6.53 / 6.54. */
  scanOk: '#0B6B4A',
  scanError: '#B3261E',

  /** Sheet and menu backdrop. */
  scrim: 'rgba(16,18,22,0.55)',
  /** Shadow colour for the small elevations (iOS; Android uses `elevation`). */
  shadow: '#101216',
  /** Android ripple on light surfaces. */
  ripple: 'rgba(16,18,22,0.10)',
  /** Android ripple on brand and solid surfaces. */
  rippleOnBrand: 'rgba(255,255,255,0.24)',
  /** The avatar ring on the wallet-coloured menu header. */
  onBrandSubtle: 'rgba(255,255,255,0.18)',
  /** No fill (ghost buttons, borderless controls). */
  transparent: 'transparent',
} as const;

export type ColorToken = keyof typeof colors;

/** Text tones (UX_MOBILE §2.2 Text). */
export const textTones = {
  default: colors.text,
  secondary: colors.textSecondary,
  brand: colors.brandText,
  success: colors.successText,
  warning: colors.warningText,
  danger: colors.dangerText,
  onBrand: colors.onBrand,
  onBrandMuted: colors.onBrandMuted,
  disabled: colors.textDisabled,
} as const;
export type TextTone = keyof typeof textTones;

/** Icon tones: the text tones plus the graphic-only colours (never under text). */
export const iconTones = {
  ...textTones,
  brandSolid: colors.brand,
  successGraphic: colors.successGraphic,
  warningGraphic: colors.warningGraphic,
  neutral: colors.neutralText,
} as const;
export type IconTone = keyof typeof iconTones;

/** The tones shared by chips, cards and banners. */
export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

/** Soft background plus readable text for each tone (chips, banners, tinted cards). */
export const toneSurfaces: Record<Tone, { background: string; text: string; icon: IconTone }> = {
  neutral: { background: colors.neutralSoft, text: colors.neutralText, icon: 'neutral' },
  brand: { background: colors.brandSoft, text: colors.brandText, icon: 'brand' },
  success: { background: colors.successSoft, text: colors.successText, icon: 'success' },
  warning: { background: colors.warningSoft, text: colors.warningText, icon: 'warning' },
  danger: { background: colors.dangerSoft, text: colors.dangerText, icon: 'danger' },
};

/** Solid backgrounds that carry white text (toasts, solid banners). */
export const toneSolids: Record<Tone, string> = {
  neutral: colors.text,
  brand: colors.brand,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

// ---- Type -------------------------------------------------------------------------------------

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'button'
  | 'mono';

type TypeStyle = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight' | 'letterSpacing' | 'fontFamily'>;

const MONO_FAMILY = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Shop app (UX_MOBILE §2.1): body 16, minimum 13. */
const SHOP_TYPE: Record<TextVariant, TypeStyle> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  button: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
  mono: { fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0.5, fontFamily: MONO_FAMILY },
};

/** Driver app: one step larger everywhere (read at arm's length, in sunlight). */
const DRIVER_TYPE: Record<TextVariant, TypeStyle> = {
  display: { fontSize: 44, lineHeight: 52, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 18, lineHeight: 26, fontWeight: '400' },
  bodyStrong: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  label: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  button: { fontSize: 18, lineHeight: 22, fontWeight: '700' },
  mono: { fontSize: 18, lineHeight: 26, fontWeight: '400', letterSpacing: 0.5, fontFamily: MONO_FAMILY },
};

/** The type scale of this build, chosen once from the variant. */
export const typography: Record<TextVariant, TypeStyle> = IS_DRIVER_APP ? DRIVER_TYPE : SHOP_TYPE;

/** Font-scale caps: layouts must hold at the largest system size (UX_MOBILE §2.1). */
export const fontScale = {
  max: 1.3,
  maxDisplay: 1.2,
} as const;

/** Money and counters line up in columns. */
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };

// ---- Space, radius, sizes, elevation, motion ---------------------------------------------------

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const layout = {
  /** Screen side padding. */
  gutter: 16,
  cardPadding: 16,
  cardGap: 12,
  sectionGap: 24,
} as const;

export const radius = {
  /** Chips, inputs. */
  sm: 8,
  /** Buttons, cards. */
  md: 12,
  /** Hero cards (the wallet card). */
  lg: 16,
  sheet: 20,
  pill: 999,
} as const;

interface SizeTokens {
  /** The smallest touch target. */
  touch: number;
  buttonMd: number;
  buttonLg: number;
  iconButton: number;
  listRow: number;
  input: number;
  menuRow: number;
  chip: number;
  hitSlop: number;
}

/** Shop app: 48 dp targets. */
const SHOP_SIZES: SizeTokens = {
  touch: 48,
  buttonMd: 48,
  buttonLg: 56,
  iconButton: 48,
  listRow: 64,
  input: 48,
  menuRow: 56,
  chip: 28,
  hitSlop: 8,
};

/** Driver app: 56 dp targets, so every button is at least 56 (the primary always is). */
const DRIVER_SIZES: SizeTokens = {
  touch: 56,
  buttonMd: 56,
  buttonLg: 56,
  iconButton: 56,
  listRow: 72,
  input: 56,
  menuRow: 56,
  chip: 28,
  hitSlop: 8,
};

export const sizes: SizeTokens = IS_DRIVER_APP ? DRIVER_SIZES : SHOP_SIZES;

const RAISED: ViewStyle = {
  elevation: 1,
  shadowColor: colors.shadow,
  shadowOpacity: 0.06,
  shadowRadius: 2,
  shadowOffset: { width: 0, height: 1 },
};

/**
 * A 1 px border plus Android elevation 1; sheets 8. No large shadows (cheap on low-end GPUs).
 * `raised` is the shadow alone, for coloured tiles that must not get a grey border.
 */
export const elevation: { card: ViewStyle; raised: ViewStyle; sheet: ViewStyle } = {
  card: { ...RAISED, borderWidth: 1, borderColor: colors.border },
  raised: RAISED,
  sheet: {
    elevation: 8,
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
  },
};

/** Durations in ms. Only spinners loop; animation is skipped when reduce-motion is on. */
export const motion = {
  press: 150,
  sheet: 220,
  toast: 3000,
  pulse: 1200,
  /** The double-tap guard after a press (UX_MOBILE §2.2 Button). */
  pressGuard: 600,
} as const;

/** The sticky footer's height, so floating things (toasts) sit above it. */
export const footerHeight = sizes.buttonLg + space.md * 2 + 1;
