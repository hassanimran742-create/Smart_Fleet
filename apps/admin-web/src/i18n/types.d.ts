import 'i18next';
import type { defaultNS, resources } from './index';

/**
 * Types every `t()` call from the bundled English resources (UX_ADMIN §1.6): a key that doesn't exist
 * fails `tsc`, and so does an options object that leaves out a `{{param}}` of the text. English is the
 * source; other languages must have the same keys.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['en'];
    returnNull: false;
  }
}
