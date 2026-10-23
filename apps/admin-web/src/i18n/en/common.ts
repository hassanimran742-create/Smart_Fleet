import { FORMAT_WHEN_EN } from '@smartfleet/shared-utils';

/**
 * `common`: words shared by every screen, the shell and the `ui` components (UX_ADMIN §1.6).
 * Owned by the foundation lane. Screen copy goes in the screen's own namespace.
 * Values are i18next templates; `{{param}}` names are type-checked by `t`.
 */
export const common = {
  appName: 'Smart Fleet Office',
  roleName: { SUPER_ADMIN: 'Super admin' },
  actions: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    goBack: 'Go back',
    tryAgain: 'Try again',
    refresh: 'Refresh',
    loadMore: 'Load more',
    showMore: 'Show more',
    copy: 'Copy',
    edit: 'Edit',
    remove: 'Remove',
    discard: 'Discard',
    discardChanges: 'Discard changes',
    keepEditing: 'Keep editing',
    signOut: 'Sign out',
    back: 'Back',
    clearFilters: 'Clear filters',
    addMore: 'Add more',
    openSettings: 'Open settings',
    reloadPage: 'Reload the page',
    goToToday: 'Go to Today',
    clearSearch: 'Clear search',
    moreActions: 'More actions',
    confirm: 'Confirm',
  },
  state: {
    loading: 'Loading…',
    working: 'Working…',
    refreshing: 'Refreshing…',
  },
  freshness: {
    updated: 'Updated {{ago}}',
    /** After 2 failed refreshes while online: the server can't be reached (UX_ADMIN §1.9). */
    stale: 'Not updated since {{time}}.',
    /** From the first failed refresh while the browser is offline (DECIDED: never "No internet"). */
    offline: 'No connection.',
  },
  ago: {
    justNow: 'just now',
    seconds: '{{count}} s ago',
    minutes: '{{count}} min ago',
    hours: '{{count}} h ago',
    days: '{{count}} d ago',
  },
  wait: {
    underMinute: 'Under 1 min',
    minutes: '{{count}} min',
    hours: '{{hours}} h',
    hoursMinutes: '{{hours}} h {{minutes}} min',
    days: '{{days}} d',
    daysHours: '{{days}} d {{hours}} h',
  },
  count: {
    of: '{{done}} of {{total}}',
    loaded: '{{done}} of {{total}} loaded',
  },
  when: FORMAT_WHEN_EN.when,
  day: FORMAT_WHEN_EN.day,
  money: {
    prefix: 'Rs',
    wholeRupeesOnly: 'Whole rupees only',
  },
  field: {
    optional: 'Optional',
    counter: '{{count}} / {{max}}',
  },
  switch: {
    on: 'On',
    off: 'Off',
  },
  phone: {
    /** Fixed before the box; the person types only "300 1234567". */
    prefix: '+92',
    placeholder: '300 1234567',
  },
  search: {
    shortcut: 'Press / to search',
    noMatches: 'No matches',
    /** A picked option's remove button in a multi-pick search box. */
    remove: 'Remove {{name}}',
  },
  dates: {
    preset: 'Dates',
    date: 'Date',
    time: 'Time',
    today: 'Today',
    yesterday: 'Yesterday',
    pickDate: 'Pick date',
    last7: 'Last 7 days',
    thisMonth: 'This month',
    lastMonth: 'Last month',
    custom: 'Custom',
    from: 'From',
    to: 'To',
  },
  dialog: {
    discardTitle: 'Discard changes?',
    discardBody: "What you typed hasn't been saved and will be lost.",
    reason: 'Reason',
    note: 'Note',
    /** The label of a free-text reason (UX_ADMIN §1.6). */
    why: 'Why?',
    pickReason: 'Pick a reason.',
  },
  toast: {
    region: 'Notifications',
    dismiss: 'Dismiss',
  },
  copy: {
    copied: 'Copied',
    failed: "Couldn't copy. Select the text and copy it.",
  },
  error: {
    title: "Couldn't load this",
    reference: 'Reference: {{id}}',
    copyReference: 'Copy reference',
  },
  unknownStatus: 'Unknown',
  actor: {
    system: 'System',
    customer: 'Customer',
  },
  activity: {
    title: 'Activity',
    /** The collapsed toggle at the end of a drawer: "Activity (3)". */
    toggle_one: 'Activity ({{count}})',
    toggle_other: 'Activity ({{count}})',
    /** The same toggle while older entries are still to load: "Activity (10+)". */
    toggleMore_one: 'Activity ({{count}}+)',
    toggleMore_other: 'Activity ({{count}}+)',
    empty: 'Nothing yet.',
    by: 'by {{name}}',
    why: 'Why: {{reason}}',
  },
  env: {
    test: 'Test server — not real money',
    training: 'Training — dummy bank details, no real money',
    titlePrefix: '[TEST]',
  },
  session: {
    idleWarning: "You'll be signed out in 2 minutes. Keep working to stay signed in.",
    idleSignedOut: 'You were signed out after 30 minutes without activity.',
    ended: 'Your session ended. Sign in again.',
  },
  roleGate: {
    title: 'This website is for office staff',
    body: 'Drivers and distributors use the Smart Fleet app on their phone.',
  },
  documentTitle: {
    page: '{{page}} · {{app}}',
    waiting: '({{count}}) {{title}}',
    env: '{{prefix}} {{title}}',
  },
  shell: {
    skipToContent: 'Skip to main content',
    mainNav: 'Main',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    accountMenu: 'Account menu',
  },
  moduleOff: {
    title: '{{module}} is switched off',
    body: 'Turn it on in Settings.',
  },
  modules: {
    transfers: 'Store-to-store transfers',
    fuelRefills: 'Driver fuel logs',
    accessories: 'Accessories',
    support: 'Support tickets',
    clientApp: 'Customer app sign-in',
  },
  legacy: {
    movedTitle: 'This screen has moved',
    movedBody: 'Use the menu to find what you need.',
    failedTitle: "This screen didn't load",
    failedBody: 'Reload the page. If it keeps happening, tell the tech team.',
  },
  notFound: {
    title: "We couldn't find this page",
    body: 'The link may be old or mistyped.',
  },
  routeError: {
    title: 'Something went wrong on this page',
    body: 'Reload the page. If it keeps happening, give the tech team the reference.',
  },
} as const;
