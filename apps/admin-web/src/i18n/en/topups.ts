/**
 * `topups`: copy for Top-ups and the review drawer (website spec W06–W11, UX_ADMIN §2.2). Owned by the
 * admin-web-money lane. Keep `as const` and the export name: i18n/index.ts imports it by name, and
 * `t('topups:…')` is type-checked, so a missing key fails `tsc`.
 *
 * Counted strings have `_one` and `_other` forms (i18next 23, `count` passed, G16-04). Error texts come
 * from `errors:<CODE>`; nothing here rewords a catalogue message.
 */
export const topups = {
  page: {
    title: 'Top-ups',
    subtitle: 'Approve only after you see the money in the company bank app.',
    approvedToday_one: 'Approved today: {{amount}} · {{count}} top-up',
    approvedToday_other: 'Approved today: {{amount}} · {{count}} top-ups',
    tabsLabel: 'Top-ups',
    searchPlaceholder: 'Name, transaction ID or bank reference',
    searchLabel: 'Search top-ups',
    loadFailed: "Couldn't load the top-ups",
  },

  /** `AdminTopupTab` (API_CONTRACT §7.9). */
  tabs: {
    'to-check': 'To check',
    approved: 'Approved',
    rejected: 'Rejected',
    all: 'All',
  },

  table: {
    caption: {
      'to-check': 'Top-ups to check, oldest first',
      approved: 'Approved top-ups, newest first',
      rejected: 'Rejected top-ups, newest first',
      all: 'All top-ups, newest first',
    },
    waiting: 'Waiting',
    distributor: 'Distributor',
    amount: 'Amount',
    paidFrom: 'Paid from',
    transactionId: 'Transaction ID',
    action: 'Action',
    approvedAt: 'Approved',
    credited: 'Added',
    /** A muted second line under "Added" when the bank amount differed from the request. */
    askedLine: 'Asked {{amount}}',
    bankReference: 'Bank reference',
    by: 'By',
    rejectedAt: 'Rejected',
    reason: 'Reason',
    sent: 'Sent',
    status: 'Status',
    review: 'Review',
    screenshotAlt: 'Screenshot from {{distributor}}',
    none: '—',
  },

  /** "Ali Raza · Easypaisa": the name on the account and how they paid (`PayerChannel`). */
  paidFrom: '{{name}} · {{channel}}',
  channel: {
    EASYPAISA_APP: 'Easypaisa',
    BANK_APP: 'Bank app',
    OTHER: 'Other',
  },

  /** One line each (UX_PRINCIPLES §6): "Updated just now" already says the list refreshes itself. */
  empty: {
    'to-check': { title: 'No top-ups to check' },
    approved: { title: 'No approved top-ups yet' },
    rejected: { title: 'No rejected top-ups' },
    all: { title: 'No top-ups yet' },
    searchTitle: 'No top-ups match “{{q}}”',
    /** Under the search-empty line on every tab but All. */
    searchTab: 'Only {{tab}} was searched.',
  },

  drawer: {
    title: '{{distributor}} · {{amount}}',
    subtitleWaiting: '{{no}} · sent {{time}} · waiting {{wait}}',
    subtitle: '{{no}} · sent {{time}}',
    loadFailed: "Couldn't load this top-up",
    told: {
      title: 'From {{distributor}}',
      amount: 'Amount',
      paidFrom: 'Paid from',
      channel: 'Paid with',
      transactionId: 'Transaction ID',
      screenshot: 'Screenshot',
      none: '—',
      openScreenshot: 'Open the screenshot',
      copy: 'Copy',
    },
    bank: {
      title: 'In the company bank app',
      never: 'Never copy from the screenshot or WhatsApp.',
      account: '{{accountTitle}} · {{bankName}} · ending {{last4}}',
      accountMissing: "The company account isn't set. Ask the tech team.",
      reference: 'Bank reference',
      referenceHint: 'Each reference can be used once.',
      amount: 'Amount',
      date: 'Date',
      time: 'Time',
      match: 'Amounts match',
      differs: 'The bank shows {{bank}}, not {{asked}}. Only {{bank}} will be added.',
      /** The same words as the shared TOPUP_AMOUNT_MISMATCH (consistency rule 16). */
      mustMatch: 'Amounts must match. Reject and ask for a new request.',
      /** The main button's visible reason while it is disabled. */
      mustMatchShort: 'Amounts must match',
      old: 'Paid {{day}}, over a day before the request. Is it the right one?',
      amountOutOfLimits: 'A top-up must be from {{min}} to {{max}}.',
      amountMissing: 'Type the amount the bank shows.',
      dateMissing: 'Pick the date.',
      timeMissing: 'Type the time.',
    },
    approve: 'Add {{amount}} to {{distributor}} wallet',
    reject: 'Reject…',
    openWallet: 'Open wallet',
    offline: "Couldn't reach the server. Your entries are kept — try again.",
    added: '{{amount}} added to {{distributor}} wallet. Balance now: {{balance}}.',
    /** Someone (maybe another office user) already finished it (TOPUP_NOT_PENDING, a re-poll, a repeat). */
    handled: {
      approved: '{{name}} approved this at {{time}}.',
      rejected: '{{name}} rejected this at {{time}}.',
      approvedNoName: 'This was approved at {{time}}.',
      rejectedNoName: 'This was rejected at {{time}}.',
    },
    /** The decided request (W10): facts only, the state is the title chip. */
    done: {
      credited: 'Added',
      asked: 'Asked for',
      bankReference: 'Bank reference',
      bankTime: 'Bank time',
      approvedBy: 'Approved by',
      rejectedBy: 'Rejected by',
      byWhen: '{{name}} · {{when}}',
      reason: 'Reason',
      note: 'Note to {{distributor}}',
    },
  },

  /** The approve confirmation (W08). */
  confirm: {
    title: 'Add {{amount}} to {{distributor}} wallet?',
    reference: 'Bank reference',
    bankAmount: 'Bank amount',
    bankTime: 'Bank time',
    asked: 'Asked for',
    different: 'different',
    body: "This can't be undone. A mistake needs a wallet correction.",
    yes: 'Yes, add {{amount}}',
  },

  /** The reject dialog (W09). */
  reject: {
    title: "Reject {{distributor}}'s request for {{amount}}?",
    reasonLabel: 'Reason',
    /** `TopupRejectReason`, as the office says it. */
    reasons: {
      NOT_IN_BANK: 'Money not found in the bank',
      AMOUNT_DIFFERENT: "Amount doesn't match",
      NAME_DIFFERENT: "Name on the account doesn't match",
      DUPLICATE: 'Duplicate request',
      OTHER: 'Other',
    },
    pickReason: 'Pick a reason.',
    note: 'Note to {{distributor}}',
    previewTitle: '{{distributor}} will see:',
    /**
     * The shop app's words for each reason (`topup.reason.*`), word for word (consistency rule 16):
     * NAME_DIFFERENT is the shop spec's "The name on the account doesn't match our bank."
     */
    preview: {
      NOT_IN_BANK: "We can't see this payment in our bank yet.",
      AMOUNT_DIFFERENT: 'The amount in our bank is different.',
      NAME_DIFFERENT: "The name on the account doesn't match our bank.",
      DUPLICATE: 'This payment was already used for another top-up.',
      OTHER: "The office couldn't approve it.",
    },
    previewNote: 'The office wrote: “{{note}}”',
    confirm: 'Reject request',
    done: 'Rejected. {{distributor}} sees the reason.',
  },

  /** The screenshot viewer (W11). */
  proof: {
    title: 'Screenshot from {{distributor}}',
    alt: 'Screenshot of the payment {{distributor}} sent',
    zoomIn: 'Click to zoom',
    zoomOut: 'Click to zoom out',
    loading: 'Loading the screenshot…',
    failed: "Can't load the screenshot. Close and open the request again.",
  },
} as const;
