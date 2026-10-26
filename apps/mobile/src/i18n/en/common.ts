import { FORMAT_WHEN_EN } from '@smartfleet/shared-utils';

/**
 * Words both apps share (foundation namespace, UX_MOBILE §3.3): actions, states, banners, the update
 * gate, the menus' initial labels and the date words `formatWhen` asks for.
 *
 * Keys follow `area.screen.element`. Plurals use the v3 `_plural` suffix. Never build a sentence by
 * joining strings: interpolate (`{{time}}`) instead.
 */
export const common = {
  appName: 'Smart Fleet',
  loading: 'Loading…',
  updating: 'Updating…',
  optional: '(optional)',

  actions: {
    tryAgain: 'Try again',
    /** The only label of a button that calls the office, in both apps (UX_PRINCIPLES §5.2). */
    callOffice: 'Call office',
    whatsAppOffice: 'WhatsApp office',
    addMoney: 'Add money',
    /** AddMore's default label ("+ Add more"; the plus is the icon). */
    addMore: 'Add more',
    signIn: 'Sign in',
    signOut: 'Sign out',
    updateApp: 'Update the app',
    cancel: 'Cancel',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    done: 'Done',
    save: 'Save',
    retry: 'Retry',
    remove: 'Remove',
    copy: 'Copy',
    menu: 'Menu',
    help: 'Help',
  },

  /** `formatWhen` / `formatDayLabel` (shared-utils) read these four keys. */
  when: FORMAT_WHEN_EN.when,
  day: FORMAT_WHEN_EN.day,

  copied: 'Copied',
  note: 'Note',
  /** The QueryBoundary strip over saved data, and Home's wallet card stamp. */
  stale: 'Saved {{time}}',
  /** The one connection banner (OfflineBanner), shown with "Try again". True offline and when the server is down. */
  offline: 'No connection',
  /** No data and no answer: the body under the banner (QueryBoundary). */
  offlineEmpty: 'Nothing saved yet.',
  /** A footer or sheet button's request got no answer: the line above the button (ActionLine). */
  notSent: 'Not sent. Tap again.',
  step: 'Step {{step}} of {{total}}',
  /** PhoneField's placeholder after the fixed +92. */
  phoneExample: '300 1234567',

  env: {
    training: 'Training · test money only',
    test: 'Test server · test money only',
  },

  update: {
    title: 'Update the app',
    body: 'This version is too old.',
    download: 'Get new version',
  },

  leaveGuard: {
    title: 'Leave without saving?',
    body: 'What you typed will be lost.',
    leave: 'Leave',
    stay: 'Stay',
  },

  signOut: {
    title: 'Sign out?',
    body: "You'll need your password.",
    confirm: 'Sign out',
    cancel: 'Stay signed in',
  },

  /** ConfirmSheet's reasons: the label above the radio rows, and what it says when confirm is pressed without one. */
  confirm: {
    why: 'Why?',
    pickReason: 'Pick a reason.',
  },

  /** PickerSheet. */
  picker: {
    search: 'Search',
    noMatch: 'Nothing matches “{{query}}”.',
    /** Read after the row that is the current choice. */
    chosen: 'Chosen',
  },

  /**
   * CountBar (UX_PRINCIPLES §3; driver spec §1.4). `{{verb}}` is the caller's word: "scanned",
   * "loaded", "taken back", "received", "on the van". Counts are digits.
   */
  count: {
    progress: '{{done}} of {{total}}',
    progressA11y: '{{done}} of {{total}} {{verb}}',
    complete: 'All {{total}} {{verb}}',
    over: '{{done}} {{verb}} · {{total}} needed',
    expected: '{{verb}} · {{total}} expected',
    expectedA11y: '{{done}} {{verb}} · {{total}} expected',
    alone: '{{done}} {{verb}}',
  },

  /** The side menus' first labels. The shop and driver lanes may move their menu copy to their own namespace. */
  menu: {
    open: 'Open menu',
    van: 'My van',
    vanNone: 'No van yet',
    about: 'About',
    help: 'Help',
    deliveries: 'My deliveries',
    signOut: 'Sign out',
  },

  timeline: {
    done: 'Done',
    current: 'Now',
    todo: 'Not yet',
    problem: 'Problem',
    /** A cancelled order's last step: the neutral cross, never a tick. */
    stopped: 'Stopped',
  },

  stepper: {
    decrease: 'One less',
    increase: 'One more',
  },

  field: {
    /** Read by screen readers after a field's label. */
    errorA11y: 'Error: {{message}}',
  },

  upload: {
    cameraDenied: 'Allow the camera in your phone settings to take a photo.',
    libraryDenied: 'Allow photos in your phone settings to add a picture.',
    failed: 'Upload failed. Try again.',
  },
} as const;
