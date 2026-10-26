import { I18nManager } from 'react-native';

const LRI = '\u2066';
const PDI = '\u2069';

/**
 * Wraps numbers, amounts and cylinder codes in a left-to-right isolate so they keep their order inside
 * right-to-left text (UX_MOBILE §3.3, Urdu-ready). In the English-only pilot the layout is LTR and the
 * text is returned unchanged, so no invisible characters reach the screen or screen readers.
 */
export function ltr(text: string): string {
  return I18nManager.isRTL ? `${LRI}${text}${PDI}` : text;
}
