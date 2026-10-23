import 'i18next';
import type { en } from './en';

/**
 * Typed i18n keys (UX_MOBILE §3.3, DECISIONS ADR-18): `t()` only accepts keys that exist in the
 * English resources, so a missing key fails `npm run typecheck`. Namespaces declared `as const` also
 * check `{{param}}` interpolation values.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
    /** Plurals use the v3 `_plural` suffix (Hermes has no full Intl.PluralRules). */
    jsonFormat: 'v3';
    returnNull: false;
  }
}
