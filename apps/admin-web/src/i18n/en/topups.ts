/**
 * `topups`: copy for Top-up requests and the review drawer (UX_ADMIN §2.2). Owned by the admin-web-money
 * lane. Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('topups:…')` is
 * type-checked, so a missing key fails `tsc`.
 *
 * Counted strings have `_one` and `_other` forms (i18next 23, `count` passed, G16-04). Error texts come
 * from `errors:<CODE>`; nothing here rewords a catalogue message.
 */
export const topups = {
  page: {
    title: 'Top-up requests',
    subtitle: 'Approve only after you see the money in the company bank app.',
    approvedToday_one: 'Approved today: {{amount}} · {{count}} top-up — compare with the bank app',
    approvedToday_other: 'Approved today: {{amount}} · {{count}} top-ups — compare with the bank app',
    tabsLabel: 'Top-up requests',
    searchPlaceholder: 'Name, transaction ID, bank reference or AG-T number',
    searchLabel: 'Search top-up requests',
    loadFailed: "Couldn't load the top-up requests",
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
      'to-check': 'Top-up requests to check, oldest first',
      approved: 'Approved top-ups, newest first',
      rejected: 'Rejected top-up requests, newest first',
      all: 'All top-up requests, newest first',
    },
    waiting: 'Waiting',
    distributor: 'Distributor',
    amount: 'Amount',
    paidFrom: 'Paid from',
    transactionId: 'Transaction ID',
    screenshot: 'Screenshot',
    action: 'Action',
    approvedAt: 'Approved',
    credited: 'Credited',
    bankReference: 'Bank reference',
    bankTime: 'Bank time',
    by: 'By',
    asked: 'Asked',
    rejectedAt: 'Rejected',
    amountAsked: 'Amount asked',
    reason: 'Reason',
    sent: 'Sent',
    number: 'Number',
    status: 'Status',
    review: 'Review',
    open: 'Open',
    noScreenshot: 'None',
    screenshotAlt: 'Screenshot from {{distributor}}',
    none: '—',
  },

  /** "Ali Raza · Easypaisa": the payer name and how they paid (`PayerChannel`). */
  paidFrom: '{{name}} · {{channel}}',
  channel: {
    EASYPAISA_APP: 'Easypaisa',
    BANK_APP: 'Bank app',
    OTHER: 'Other',
  },

  empty: {
    'to-check': {
      title: 'No top-ups to check',
      body: 'New requests from distributors show up here. This list refreshes every 20 seconds.',
    },
    approved: {
      title: 'No approved top-ups yet',
      body: 'Top-ups you approve show up here, newest first.',
    },
    rejected: {
      title: 'No rejected top-up requests',
      body: 'Requests you reject show up here with their reason.',
    },
    all: {
      title: 'No top-up requests yet',
      body: 'Requests from distributors show up here.',
    },
    searchTitle: 'No top-ups match “{{q}}”',
    searchBody: 'Search by distributor or payer name, transaction ID, bank reference or AG-T number.',
  },

  drawer: {
    title: '{{distributor}} asks for {{amount}}',
    subtitleWaiting: '{{no}} · sent {{time}} · waiting {{wait}}',
    subtitle: '{{no}} · sent {{time}}',
    loadFailed: "Couldn't load this top-up request",
    told: {
      title: 'What {{distributor}} told us',
      amount: 'Amount',
      paidFrom: 'Paid from',
      channel: 'How they paid',
      transactionId: 'Transaction ID',
      screenshot: 'Screenshot',
      none: 'None',
      openScreenshot: 'Open the screenshot',
      copy: 'Copy',
    },
    bank: {
      title: 'Find the payment in the company bank app, then type what it shows',
      account: 'Company account: {{accountTitle}} · {{bankName}} · ending {{last4}}',
      accountMissing: "The company account isn't set yet. Engineering sets it with the settings tool.",
      reference: 'Bank reference',
      referenceHint: "As shown in the bank app. Spaces and dashes don't matter. Each reference can be used once.",
      amount: 'Amount in the bank',
      time: 'Time in the bank',
      differs: 'The bank shows {{bank}} but {{distributor}} asked for {{asked}}. Only {{bank}} will be added.',
      mustMatch: 'Amounts must match. Reject and ask for a new request.',
      old: "This payment is from {{day}}, more than a day before the request. Make sure it's the right one.",
      amountOutOfLimits: 'A top-up must be from {{min}} to {{max}}.',
    },
    rule: 'Approve only from a payment you saw in the company bank app. Never from a screenshot or a WhatsApp message. A bank reference that has already been used is refused.',
    approve: 'Add {{amount}} to {{distributor}} wallet',
    approveDisabled: 'Type the bank details first',
    reject: 'Reject…',
    offline: "Couldn't reach the server. Your entries are kept — try again.",
    added: '{{amount}} added to {{distributor}} wallet. Balance now: {{balance}}.',
    /** Someone (maybe another office user) already finished it (TOPUP_NOT_PENDING, a re-poll, a repeat). */
    handled: {
      approved: '{{name}} approved this at {{time}}.',
      rejected: '{{name}} rejected this at {{time}}.',
      approvedNoName: 'This was approved at {{time}}.',
      rejectedNoName: 'This was rejected at {{time}}.',
    },
    done: {
      approvedTitle: 'Approved',
      rejectedTitle: 'Rejected',
      credited: 'Added to the wallet',
      asked: 'Asked for',
      bankReference: 'Bank reference',
      bankAmount: 'Amount in the bank',
      bankTime: 'Time in the bank',
      by: 'By',
      when: 'When',
      reason: 'Reason',
      note: 'Note to {{distributor}}',
    },
  },

  confirm: {
    title: 'Add {{amount}} to {{distributor}} wallet?',
    reference: 'Bank reference',
    bankAmount: 'Amount in the bank',
    bankTime: 'Time in the bank',
    asked: 'Asked for',
    body: "This can't be undone here. If it's a mistake, record a wallet correction.",
    yes: 'Yes, add {{amount}}',
  },

  reject: {
    title: "Reject {{distributor}}'s request for {{amount}}?",
    reasonLabel: 'Reason',
    /** `TopupRejectReason`, as the office says it (UX_ADMIN §2.2). */
    reasons: {
      NOT_IN_BANK: 'Money not found in the bank',
      AMOUNT_DIFFERENT: "Amount doesn't match",
      NAME_DIFFERENT: "Payer name doesn't match",
      DUPLICATE: 'Duplicate request',
      OTHER: 'Other',
    },
    note: 'Note',
    noteHint: '{{distributor}} sees this in the app',
    previewTitle: 'What {{distributor}} will see',
    /** The shop app's words for each reason (UX_MOBILE S6 `topup.reason.*`), for the preview. */
    preview: {
      NOT_IN_BANK: "We can't see this payment in our bank yet.",
      AMOUNT_DIFFERENT: 'The amount in our bank is different.',
      NAME_DIFFERENT: "The payer name doesn't match our bank.",
      DUPLICATE: 'This payment was already used for another top-up.',
      OTHER: "The office couldn't approve it.",
    },
    previewNote: 'The office wrote: “{{note}}”',
    previewEmpty: 'Pick a reason to see what they will read.',
    confirm: 'Reject request',
    done: 'Request rejected. {{distributor}} sees the reason in the app.',
  },

  proof: {
    title: 'Screenshot from {{distributor}}',
    alt: 'Screenshot of the payment {{distributor}} sent',
    zoomIn: 'Click the picture to zoom in',
    zoomOut: 'Click the picture to zoom out',
    loading: 'Loading the screenshot…',
    failed: "Can't load the screenshot. Close and open the request again.",
  },
} as const;
