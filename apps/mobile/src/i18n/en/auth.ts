/**
 * Sign in, Wrong app and the session (foundation namespace; UX_MOBILE §4 S1).
 * `subtitle_<variant>` is chosen by the build variant.
 */
export const auth = {
  signIn: {
    subtitle_distributor: 'Shop app',
    subtitle_driver: 'Driver app',
    phone: 'Mobile number',
    phonePlaceholder: '300 1234567',
    phoneInvalid: 'Enter a number like 300 1234567.',
    password: 'Password',
    passwordRequired: 'Enter your password.',
    show: 'Show',
    hide: 'Hide',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    /** The ghost button under "Sign in"; its phone icon says it calls the office. */
    forgot: 'Forgot password?',
    /** What screen readers hear for that button. */
    forgotA11y: 'Forgot password? Call the office',
  },

  wrongApp: {
    title: 'Wrong app',
    /** The same words as the sign-in refusal `errors.AUTH_WRONG_APP`. */
    shopAccount: 'This account is for the Smart Fleet shop app.',
    driverAccount: 'This account is for the Smart Fleet Driver app.',
    officeAccount: 'Office accounts use the Smart Fleet website.',
    otherAccount: "This account can't use this app. Call the office.",
    signOut: 'Sign out',
  },

  session: {
    expired: 'Please sign in again.',
  },

  /** The retired one-time-code screen (kept out of navigation). */
  otp: {
    back: 'Back to sign in',
  },
} as const;
