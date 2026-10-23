/**
 * `auth`: copy for sign-in, the role gate and the session pages (UX_ADMIN §2.10, website spec W01–W02).
 * Owned by the admin-web-ops lane. The session and environment strings the shell needs live in
 * `common`.
 *
 * Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('auth:…')` is
 * type-checked. Sign-in errors come from `errors:<CODE>` (the server catalogue), never from here,
 * and no text here may mention one-time codes (API_CONTRACT §2.1).
 */
export const auth = {
  signIn: {
    documentTitle: 'Sign in',
    title: 'Smart Fleet · Office',
    phone: 'Mobile number',
    password: 'Password',
    show: 'Show',
    hide: 'Hide',
    showLabel: 'Show the password',
    hideLabel: 'Hide the password',
    submit: 'Sign in',
    /** The button while sign-in is locked after too many tries: "Try again in 9:42". */
    tryAgainIn: 'Try again in {{time}}',
    forgot: 'Forgot your password? Ask the tech team.',
    phoneRequired: 'Type your mobile number.',
    passwordRequired: 'Type your password.',
    /** The second line under `AUTH_WRONG_APP` (a shop or driver account). */
    wrongAppHint: 'Use the Smart Fleet app on your phone.',
    footer: 'Drivers and distributors use the Smart Fleet app.',
    notOffice: 'This website is for office staff. Drivers and distributors use the Smart Fleet app.',
  },
  roleGate: {
    documentTitle: 'Office staff only',
  },
} as const;
