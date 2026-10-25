/**
 * `settings`: copy for the Settings form and its save review (website spec W38–W39, UX_ADMIN §2.8).
 * Owned by the admin-web-money lane. Keep `as const` and the export name: i18n/index.ts imports it by
 * name, and `t('settings:…')` is type-checked, so a missing key fails `tsc`.
 *
 * `labels` names every setting key in plain words (nested by the key's dots, so `t('labels.topup.maxPaisa')`
 * reads `topup.maxPaisa`). The Activity log uses the same labels, so it never shows a key name. Each row
 * has a label of 5 words or fewer and, only where it is needed, a description of 12 or fewer.
 */
export const settings = {
  page: {
    title: 'Settings',
    subtitle: 'Each change needs a reason and shows in the activity log.',
    menuLabel: 'Settings sections',
    sectionLabel: 'Section',
    loadFailed: "Couldn't load the settings",
  },

  /**
   * The local menu (`?section=`), in page order. Refills is folded into Orders and delivery
   * (`?section=refills` opens it); `modules` keeps its URL value, so "Open settings" links still work.
   */
  sections: {
    money: 'Money',
    orders: 'Orders and delivery',
    /** [Inc 2] UX_ADMIN §3.6. */
    messages: 'Customer messages',
    scans: 'Scans',
    modules: 'Features',
    support: 'Support',
    account: 'Company account',
    versions: 'Tech team',
  },

  labels: {
    dispatch: { autoAssign: { enabled: 'Automatic driver assignment' } },
    auth: { otpLogin: { enabled: 'Code sign-in' }, lockedRoles: 'Locked sign-in roles' },
    features: {
      transfers: 'Store-to-store transfers',
      fuelRefills: 'Driver fuel logs',
      accessories: 'Accessories',
      support: 'Support tickets',
      clientApp: 'Customer app sign-in',
    },
    app: { minVersion: { driver: 'Lowest driver app version', distributor: 'Lowest distributor app version' } },
    orders: { deliveryStartedAt: 'When delivery counts as started', maxCylindersPerOrder: 'Max cylinders per order' },
    pricing: { deliveryStrategy: 'How delivery prices are worked out' },
    wallet: { maxBalancePaisa: 'Wallet balance limit', lowBalancePaisa: 'Low-balance warning' },
    topup: {
      minPaisa: 'Top-up minimum',
      maxPaisa: 'Top-up maximum',
      quickAmountsPaisa: 'Quick top-up amounts',
      maxPendingPerDistributor: 'Top-ups waiting per distributor',
      onAmountMismatch: 'If the bank amount differs',
      checkingHours: 'Top-up checking hours',
      account: 'Company account',
      secondApproval: 'Second approval for large top-ups',
    },
    refill: { maxCylinders: 'Max cylinders per refill', deliveryCost: 'Refill delivery cost' },
    support: { phone: 'Office phone', whatsApp: 'Office WhatsApp', hours: 'Office hours' },
    day: { timezone: 'Time zone', cutoffLocalTime: 'New day starts at' },
    confirmation: {
      enabled: 'Customer confirmation',
      linkTtlHours: 'How long the link works',
      caseOnAnswers: 'Answers that open a problem',
    },
    messaging: { testMode: 'Test mode', allowlist: 'Team phones' },
    custody: { typedEntry: { enabled: 'Typed cylinder numbers' }, forgottenInPolicy: 'Not scanned at the store' },
    trip: { allowFinishWithLeftovers: 'Finish with cylinders left' },
    walkIn: { counterSwap: { enabled: 'Walk-in counter swaps' } },
    dayEnd: { enabled: 'Day-end sheet' },
  },

  /** The line under a row, only where the label isn't enough (W38). */
  descriptions: {
    topup: {
      maxPendingPerDistributor: "A distributor can't send more until these are checked.",
      checkingHours: 'Distributors see these hours in the app.',
    },
    wallet: {
      maxBalancePaisa: "Top-ups can't raise a wallet above this. Corrections can.",
      lowBalancePaisa: 'Distributors are warned below this. Rs 0 turns it off.',
    },
    orders: {
      deliveryStartedAt: 'After this, cancelling returns nothing. Changes apply to unstarted orders too.',
    },
    dispatch: {
      autoAssign: { enabled: 'Keep off: the office assigns every order by hand.' },
    },
    features: {
      fuelRefills: 'The driver app has no fuel screen yet.',
      clientApp: 'Customers confirm by link instead.',
    },
    /** [Inc 2] Customer messages and Scans (UX_ADMIN §3.6). */
    confirmation: { enabled: 'Customers confirm by link. It never changes money.' },
    messaging: { testMode: 'Send real texts only to the team phones.' },
    custody: { typedEntry: { enabled: "Drivers and shops can type a number when a label won't scan." } },
    trip: { allowFinishWithLeftovers: 'Lets a driver finish a trip before the store scans everything.' },
    /** [Inc 3] UX_ADMIN §4.4. */
    dayEnd: { enabled: 'Distributors send a daily cylinder sheet.' },
    day: { cutoffLocalTime: 'Change only when no day-end is waiting.' },
    support: {
      phone: 'The apps call this for “Call office”. Empty hides it.',
      whatsApp: 'The apps open this in WhatsApp.',
      hours: 'Shown next to the office phone.',
    },
    app: {
      minVersion: {
        driver: 'Older apps must update. Change only when the tech team asks.',
        distributor: 'Older apps must update. Change only when the tech team asks.',
      },
    },
    company: "Only the tech team changes this, on the owner's request.",
  },

  /** Choice words, used by the form and by the Activity log. */
  options: {
    onAmountMismatch: {
      CREDIT_BANK_AMOUNT: 'Add the bank amount (after a warning)',
      REJECT: 'Refuse, so the distributor makes a new request',
    },
    deliveryStartedAt: {
      FIRST_LOAD_SCAN: 'First load scan at the store',
      DRIVER_ASSIGNED: 'Driver assigned',
      LEFT_STORE: 'Van leaves the store',
    },
    noLimit: 'No limit',
    setLimit: 'Set a limit',
    /** [Inc 2] The answer chips ("Answers that open a problem"), as toggles. */
    answers: {
      NO: 'Not received',
      OTHER: 'Other problem',
      PARTLY: 'Partly received',
      YES: 'All received',
    },
  },

  values: {
    on: 'On',
    off: 'Off',
    noLimit: 'No limit',
    notSet: 'Not set',
    /** "9 am–9 pm" (`formatClock` puts each time in words). */
    hours: '{{from}}–{{to}}',
    from: 'From',
    to: 'To',
    none: 'None',
    /** [Inc 2] `custody.forgottenInPolicy`, the only rule built. */
    forgottenIn: 'Blocked · the office marks it delivered',
  },

  /** The unit after a number box: "30 cylinders", "3 top-ups". */
  units: {
    cylinders: 'cylinders',
    topups: 'top-ups',
    hours: 'hours',
  },

  /** [Inc 2] Team phones (`messaging.allowlist`): a list of numbers with "+ Add phone". */
  phones: {
    label: 'Team phone {{n}}',
    add: 'Add phone',
    remove: 'Remove {{phone}}',
    removeEmpty: 'Remove this phone',
  },

  placeholders: {
    hours: 'For example 9am–9pm',
    version: 'For example 1.2.0',
  },

  meta: {
    changedBy: 'Changed {{date}} by {{name}}',
    changed: 'Changed {{date}}',
    unsaved: 'Not saved',
    readOnly: "Can't be changed here",
  },

  refills: {
    deliveryCostValue: "Off · waiting for the owner's decision",
  },

  account: {
    name: 'Account name',
    bank: 'Bank',
    iban: 'IBAN',
    copyIban: 'Copy IBAN',
    missing: "Not set yet. Distributors can't top up until the tech team sets it.",
  },

  bar: {
    changes_one: '{{count}} change not saved',
    changes_other: '{{count}} changes not saved',
    discard: 'Discard',
    review: 'Review and save',
    saving: 'Saving…',
    fixFirst: 'Fix the highlighted values first.',
  },

  /** The save review (W39): the one confirmation, also for turning a feature on. */
  review: {
    title: 'Save these changes?',
    change: '{{from}} → {{to}}',
    reason: 'Why?',
    turnOn: '{{module}} opens in the apps within 5 minutes.',
    save_one: 'Save {{count}} change',
    save_other: 'Save {{count}} changes',
    discardTitle: 'Discard your changes?',
    discardBody: 'The values go back to what is saved.',
  },

  saved: 'Settings saved. Apps update within 5 minutes.',
  offline: "Couldn't reach the server. Your changes are kept — try again.",
  saveFailed: "{{setting}} wasn't saved: {{message}}",
  saveFailedAfterOthers: "{{setting}} wasn't saved: {{message}} The changes before it were saved.",

  errors: {
    minAboveMax: "The minimum can't be more than the maximum.",
    version: 'Use a version like 1.2.0.',
    time: 'Use a time like 9:00 am.',
    sameHours: "The start and the end can't be the same.",
    phone: 'Enter a number like 300 1234567.',
    phoneTwice: 'This number is on the list twice.',
    limitMissing: 'Type the limit.',
    amountMissing: 'Type the amount.',
    numberMissing: 'Type a number.',
  },
} as const;
