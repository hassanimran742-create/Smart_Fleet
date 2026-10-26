import type { ComponentProps } from 'react';
import { I18nManager, type StyleProp, type TextStyle } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { iconTones, type IconTone } from './tokens';

type Glyph = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * Semantic icon names (UX_MOBILE §2.1) over MaterialCommunityIcons, which is already in the app
 * binary. Screens use these names, never glyphs or emoji, so an icon can change in one place.
 */
const GLYPHS = {
  wallet: 'wallet',
  addMoney: 'cash-plus',
  order: 'clipboard-list-outline',
  customer: 'account',
  store: 'storefront-outline',
  truck: 'truck-delivery',
  scan: 'qrcode-scan',
  cylinder: 'gas-cylinder',
  checking: 'clock-outline',
  ok: 'check-circle',
  error: 'alert-circle',
  warn: 'alert',
  call: 'phone',
  map: 'map-marker',
  navigate: 'navigation-variant',
  torch: 'flashlight',
  keyboard: 'keyboard-outline',
  copy: 'content-copy',
  share: 'share-variant',
  download: 'download',
  upload: 'upload',
  sheet: 'file-excel-outline',
  chevron: 'chevron-right',
  menu: 'menu',
  empty: 'gauge-empty',
  partFilled: 'gauge-low',
  full: 'gauge-full',
  receipt: 'receipt',
  // Foundation additions for controls and the menus:
  check: 'check',
  close: 'close',
  minus: 'minus',
  plus: 'plus',
  radioOn: 'radiobox-marked',
  radioOff: 'radiobox-blank',
  info: 'information-outline',
  help: 'help-circle-outline',
  offline: 'wifi-off',
  profile: 'account-circle-outline',
  notifications: 'bell-outline',
  van: 'van-utility',
  fuel: 'gas-station',
  signOut: 'logout',
  whatsApp: 'whatsapp',
  photo: 'image-plus',
  history: 'history',
  home: 'home-outline',
  lock: 'lock-outline',
  // The redesign's names (UX_PRINCIPLES §3; shop spec §10.3): search fields, the customer list.
  search: 'magnify',
  customers: 'account-multiple-outline',
  // Inc 2/3 (spec §0.2, §6): the Send link sheet's "Text message" and "Make a new link".
  sms: 'message-text-outline',
  link: 'link-variant',
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;
export type IconSize = 16 | 20 | 24 | 32 | 48;

export interface IconProps {
  name: IconName;
  /** 16 is for chips; 20, 24, 32 and 48 elsewhere. */
  size?: IconSize;
  tone?: IconTone;
  /** Gives the icon a screen-reader label. Without one the icon is decorative and hidden. */
  label?: string;
  style?: StyleProp<TextStyle>;
}

/** Chevrons point the reading direction (they flip with `I18nManager.isRTL`). */
function glyphFor(name: IconName): Glyph {
  if (name === 'chevron' && I18nManager.isRTL) return 'chevron-left';
  return GLYPHS[name];
}

/** An icon by semantic name (UX_MOBILE §2.2 #2). */
export function Icon({ name, size = 24, tone = 'default', label, style }: IconProps) {
  const decorative = !label;
  return (
    <MaterialCommunityIcons
      name={glyphFor(name)}
      size={size}
      color={iconTones[tone]}
      allowFontScaling={false}
      accessible={!decorative}
      accessibilityLabel={label}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      style={style}
    />
  );
}

/** Loads the icon font before the first screen, so icons never flash in empty (App.tsx boot). */
export function preloadIconFont(): Promise<void> {
  return MaterialCommunityIcons.loadFont().then(
    () => undefined,
    () => undefined,
  );
}
