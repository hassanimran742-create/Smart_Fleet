import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  formatDayLabel,
  formatWhen,
  type FormatWhenKey,
  type TimeInput,
  type WhenTranslate,
} from '@smartfleet/shared-utils';
import { en } from './en';

/** English only for the pilot (DECISIONS ADR-18). Urdu is added later as another resource. */
export const DEFAULT_LANGUAGE = 'en';
export const SUPPORTED_LANGUAGES = ['en'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const resources = { en: { translation: en } };

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  // Hermes (React Native's JS engine) doesn't ship the full Intl.PluralRules API, so plurals use the
  // v3 `_plural` suffix. Switch to v4 plus an intl-pluralrules polyfill only if Urdu needs more forms.
  compatibilityJSON: 'v3',
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

/** The translate function `formatWhen` and `formatDayLabel` take, bound to the app's resources. */
export const whenTranslate: WhenTranslate = (key: FormatWhenKey, options?: { time: string }): string => {
  const time = options?.time ?? '';
  switch (key) {
    case 'common.when.today':
      return i18n.t('common.when.today', { time });
    case 'common.when.yesterday':
      return i18n.t('common.when.yesterday', { time });
    case 'common.day.today':
      return i18n.t('common.day.today');
    case 'common.day.yesterday':
      return i18n.t('common.day.yesterday');
  }
};

/** "Today, 4:12 pm", "Yesterday, 9:05 am" or "Mon 19 Oct, 4:12 pm" in Asia/Karachi (UX_MOBILE §3.3). */
export function formatWhenText(at: TimeInput, now: TimeInput = Date.now()): string {
  return formatWhen(at, now, whenTranslate);
}

/** A day heading for grouped lists: "Today", "Yesterday" or "Mon 19 Oct", in Asia/Karachi. */
export function formatDayLabelText(at: TimeInput, now: TimeInput = Date.now()): string {
  return formatDayLabel(at, now, whenTranslate);
}

export default i18n;
