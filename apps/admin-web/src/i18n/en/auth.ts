/**
 * `auth`: copy for sign-in, the role gate and the session pages (UX_ADMIN §2.10). Owned by the
 * admin-web-ops lane. The session and environment strings the shell needs live in `common`.
 *
 * Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('auth:…')` is
 * type-checked. Sign-in errors come from `errors:<CODE>` (the server catalogue), never from here,
 * and no text here may mention one-time codes (API_CONTRACT §2.1).
 */
export const auth = {
  signIn: {
    documentTitle: 'Sign in',
    title: 'Smart Fleet · Office',
    subtitle: 'Office staff sign in with their mobile number and password.',
    phone: 'Mobile number',
    password: 'Password',
    show: 'Show',
    hide: 'Hide',
    showLabel: 'Show the password',
    hideLabel: 'Hide the password',
    submit: 'Sign in',
    footer: 'Drivers and distributors use the Smart Fleet app.',
    notOffice: 'This website is for office staff. Drivers and distributors use the Smart Fleet app.',
  },
  roleGate: {
    documentTitle: 'Office staff only',
  },
} as const;
