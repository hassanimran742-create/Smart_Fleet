/**
 * `settings`: copy for the Settings form (UX_ADMIN §2.8). Owned by the admin-web-money lane. Keep
 * `as const` and the export name: i18n/index.ts imports it by name, and `t('settings:…')` is
 * type-checked, so a missing key fails `tsc`.
 *
 * `labels` names every setting key in plain words (nested by the key's dots, so `t('labels.topup.maxPaisa')`
 * reads `topup.maxPaisa`). The Activity log uses the same labels, so it never shows a key name.
 */
export const settings = {
  page: {
    title: 'Settings',
    subtitle: 'How the pilot runs. Every change needs a reason and shows in the Activity log.',
    menuLabel: 'Settings sections',
    sectionLabel: 'Section',
    loadFailed: "Couldn't load the settings",
  },

  /** The local menu (`?section=`), in page order. */
  sections: {
    money: 'Money',
    orders: 'Orders and delivery',
    refills: 'Refills',
    modules: 'Modules',
    account: 'Company account',
    support: 'Support',
    versions: 'App versions',
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
    app: { minVersion: { driver: 'Lowest driver app version', distributor: 'Lowest shop app version' } },
    orders: { deliveryStartedAt: 'When delivery counts as started', maxCylindersPerOrder: 'Max cylinders per order' },
    pricing: { deliveryStrategy: 'How delivery prices are worked out' },
    wallet: { maxBalancePaisa: 'Wallet balance limit', lowBalancePaisa: 'Low-balance warning' },
    topup: {
      minPaisa: 'Top-up minimum',
      maxPaisa: 'Top-up maximum',
      quickAmountsPaisa: 'Quick top-up amounts',
      maxPendingPerDistributor: 'Top-ups being checked per distributor',
      onAmountMismatch: 'Bank amount differs from the request',
      checkingHours: 'Top-up checking hours',
      account: 'Company account',
      secondApproval: 'Second approval for large top-ups',
    },
    refill: { maxCylinders: 'Max cylinders per refill', deliveryCost: 'Refill delivery cost' },
    support: { phone: 'Office phone', whatsApp: 'Office WhatsApp', hours: 'Office hours' },
    day: { timezone: 'Business day time zone', cutoffLocalTime: 'Business day starts at' },
    confirmation: {
      enabled: 'Customer confirmation',
      linkTtlHours: 'Confirmation link lifetime',
      caseOnAnswers: 'Answers that open a problem',
    },
    messaging: { testMode: 'Texts only to team phones', allowlist: 'Team phones for test texts' },
    custody: { typedEntry: { enabled: 'Typed cylinder numbers' }, forgottenInPolicy: 'Forgotten scan-in' },
    trip: { allowFinishWithLeftovers: 'Finish a run with cylinders on the van' },
    walkIn: { counterSwap: { enabled: 'Walk-in counter swaps' } },
    dayEnd: { enabled: 'Day-end sheets' },
  },

  /** The descriptions under each row (UX_ADMIN §2.8). Rows the doc gives none have none. */
  descriptions: {
    topup: {
      minPaisa: 'The smallest single top-up a distributor can send.',
      maxPaisa: 'The largest single top-up a distributor can send.',
      onAmountMismatch: 'What approving does when the bank shows a different amount from the request.',
      checkingHours: 'When the office checks top-ups. Distributors see these hours in the app.',
    },
    wallet: {
      maxBalancePaisa: "Highest balance top-ups may bring a wallet to. Office corrections aren't limited by it.",
      lowBalancePaisa:
        'When the balance is below this (not equal to it), distributors see a low-balance warning. Rs 0 turns the warning off.',
    },
    orders: {
      deliveryStartedAt:
        "After this point, cancelling an order returns nothing. A change applies at once to every order that hasn't started yet, including orders already placed.",
    },
    dispatch: {
      autoAssign: { enabled: 'When off, every new order waits for you to assign a driver. Keep off for the pilot.' },
    },
    features: {
      transfers: 'Off for the pilot.',
      fuelRefills:
        "Not used in the pilot: the driver app has no fuel-log screen. On, it only opens the drivers' own fuel-log routes; older logs always show in Expenses.",
      accessories: 'Off for the pilot.',
      support: 'Off for the pilot.',
      clientApp: 'Customers confirm by link instead.',
    },
    support: {
      phone: "The number the apps call when someone taps “Call office”. Empty hides the button.",
      whatsApp: 'The number the apps open in WhatsApp.',
      hours: 'Shown next to the office phone, for example 9am–9pm.',
    },
    app: {
      minVersion: {
        driver: 'Phones below this version must update. Raise only after the new app is on every phone.',
        distributor: 'Phones below this version must update. Raise only after the new app is on every phone.',
      },
    },
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
    default: 'Default',
  },

  values: {
    on: 'On',
    off: 'Off',
    noLimit: 'No limit',
    notSet: 'Not set',
    hours: '{{from}}–{{to}}',
    from: 'From',
    to: 'To',
  },

  placeholders: {
    noLimit: 'No limit',
    phone: '0300 1234567',
    hours: '9am–9pm',
    version: '1.2.0',
  },

  meta: {
    default: 'Default',
    changedBy: 'Changed {{date}} by {{name}}',
    changed: 'Changed {{date}}',
    readOnly: "Can't be changed here",
  },

  refills: {
    deliveryCostValue: "Off · waiting for the owner's decision",
  },

  account: {
    name: 'Account name',
    bank: 'Bank',
    iban: 'IBAN',
    number: 'Account number',
    copyIban: 'Copy IBAN',
    note: "Shown to distributors in the app. Changed only on the owner's written request; engineering makes the change and it's logged.",
    missing: "Not set yet. Distributors can't send top-ups until engineering sets it.",
  },

  modules: {
    turnOnTitle: 'Turn on {{module}}?',
    turnOnBody: '{{module}} is off for the pilot. Once you save, it opens for everyone it covers, and the apps show it within 5 minutes.',
    turnOnConfirm: 'Turn on',
  },

  bar: {
    changes_one: '{{count}} change not saved',
    changes_other: '{{count}} changes not saved',
    discard: 'Discard',
    review: 'Review and save',
    saving: 'Saving…',
    fixFirst: 'Fix the highlighted values first.',
  },

  review: {
    title: 'Save these changes?',
    change: '{{from}} → {{to}}',
    reason: 'Why are you changing this?',
    reasonHint: 'Saved in the activity log with each change.',
    save_one: 'Save {{count}} change',
    save_other: 'Save {{count}} changes',
    discardTitle: 'Discard your changes?',
    discardBody: "The values go back to what is saved. Nothing has been changed on the server.",
  },

  saved: 'Settings saved. The server uses them now; the apps show them within 5 minutes.',
  offline: "Couldn't reach the server. Your changes are kept — try again.",
  saveFailed: "{{setting}} wasn't saved: {{message}}",
  saveFailedAfterOthers: "{{setting}} wasn't saved: {{message}} The changes before it were saved.",

  errors: {
    minAboveMax: "The minimum can't be more than the maximum.",
    version: 'Use a version like 1.2.0.',
    time: 'Use a time like 09:00.',
    sameHours: "The start and the end can't be the same.",
  },
} as const;
