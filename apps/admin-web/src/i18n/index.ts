import i18n, { type PostProcessorModule } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { activity } from './en/activity';
import { auth } from './en/auth';
import { common } from './en/common';
import { distributors } from './en/distributors';
import { errors } from './en/errors';
import { expenses } from './en/expenses';
import { nav } from './en/nav';
import { orders } from './en/orders';
import { prices } from './en/prices';
import { settings } from './en/settings';
import { status } from './en/status';
import { today } from './en/today';
import { topups } from './en/topups';
import { validation } from './en/validation';
import { wallets } from './en/wallets';

/**
 * i18n for the office website (UX_ADMIN §1.6): i18next 23 + react-i18next 14, English now, Urdu-ready.
 *
 * - Foundation namespaces: `common`, `nav`, `status`, `errors` (= ERROR_MESSAGE_EN), `validation`.
 * - Lane namespaces (each lane owns its file in `en/`): `today`, `orders`, `distributors`, `auth`,
 *   `topups`, `wallets`, `prices`, `settings`, `activity`, `expenses`. Inc 2 adds `problems` and `cylinders`;
 *   Inc 3 adds `refills` and `dayend`: register a new namespace here and nowhere else.
 * - `types.d.ts` types `t()` from these resources, so a missing key fails `tsc`.
 * - Keys are `namespace:path.to.key`. Never pass a default value to `t()`: that overload skips the key check.
 */
export const defaultNS = 'common';

export const resources = {
  en: {
    common,
    nav,
    status,
    errors,
    validation,
    today,
    orders,
    distributors,
    auth,
    topups,
    wallets,
    prices,
    settings,
    activity,
    expenses,
  },
} as const;

export type AppNamespace = keyof (typeof resources)['en'];
export const NAMESPACES = Object.keys(resources.en) as AppNamespace[];

/**
 * The dev-only pseudo-locale (`?lng=en-XA`): every string is wrapped in ⟦…⟧ and made 30% longer, so
 * text that skips i18n, or a layout that can't take longer words, shows up at a glance.
 */
export const PSEUDO_LANGUAGE = 'en-XA';

export function pseudoLocalize(value: string): string {
  return `⟦${value}${'~'.repeat(Math.ceil(value.length * 0.3))}⟧`;
}

const pseudoProcessor: PostProcessorModule = {
  type: 'postProcessor',
  name: 'pseudo',
  process: (value) => pseudoLocalize(value),
};

function startLanguage(): string {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 'en';
  try {
    return new URLSearchParams(window.location.search).get('lng') === PSEUDO_LANGUAGE ? PSEUDO_LANGUAGE : 'en';
  } catch {
    return 'en';
  }
}

const language = startLanguage();

function syncDocumentLanguage(lng: string): void {
  if (typeof document === 'undefined') return;
  const base = lng === PSEUDO_LANGUAGE ? 'en' : lng;
  document.documentElement.lang = base;
  document.documentElement.dir = i18n.dir(base);
}

void i18n
  .use(initReactI18next)
  .use(pseudoProcessor)
  .init({
    resources,
    lng: language,
    fallbackLng: 'en',
    ns: NAMESPACES,
    defaultNS,
    // Resources are bundled, so initialise synchronously: the first render already has real text.
    initImmediate: false,
    // React escapes output; i18next must not escape a second time.
    interpolation: { escapeValue: false },
    returnNull: false,
    postProcess: language === PSEUDO_LANGUAGE ? ['pseudo'] : false,
    react: { useSuspense: false },
  });

syncDocumentLanguage(i18n.language);
i18n.on('languageChanged', syncDocumentLanguage);

/** The base language for the `Accept-Language` header ("en"; the pseudo-locale is still English). */
export function currentLanguage(): string {
  const lng = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  return lng === PSEUDO_LANGUAGE ? 'en' : lng;
}

type LooseT = (key: string, options?: Record<string, unknown>) => string;

/**
 * Translates a key that is only known at run time (an error code, an enum value, an audit action), or
 * returns null when the key doesn't exist, so the caller can fall back. Everywhere else use the typed
 * `t` from `useTranslation()`, which fails `tsc` on a missing key.
 */
export function translateDynamic(key: string, params?: Record<string, unknown>): string | null {
  if (!i18n.exists(key)) return null;
  return (i18n.t as unknown as LooseT)(key, params);
}

export default i18n;
