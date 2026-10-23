/**
 * `wallets`: copy for Wallets, the wallet page, the history, the statement download and the correction
 * dialog (UX_ADMIN §2.6). Owned by the admin-web-money lane. Keep `as const` and the export name:
 * i18n/index.ts imports it by name, and `t('wallets:…')` is type-checked, so a missing key fails `tsc`.
 *
 * One balance, no holds (ADR-06): nothing here says "available", "held" or "on hold". Money copy never
 * names the refund rule (G01-08).
 */
export const wallets = {
  list: {
    title: 'Wallets',
    subtitle: "Each distributor's prepaid balance for delivery costs.",
    caption: "Distributors' wallets",
    distributor: 'Distributor',
    balance: 'Balance',
    checking: 'Being checked',
    lastTopup: 'Last top-up',
    checkingValue_one: '{{amount}} · {{count}} request',
    checkingValue_other: '{{amount}} · {{count}} requests',
    noTopupYet: 'None yet',
    none: '—',
    emptyTitle: 'No distributors yet',
    emptyBody: 'A wallet shows up here when a distributor is added.',
    loadFailed: "Couldn't load the wallets",
  },

  page: {
    title: '{{distributor}} · Wallet',
    fallbackTitle: 'Wallet',
    recordCorrection: 'Record correction',
    mismatchReason: 'Fix the history mismatch first.',
    download: 'Download statement',
    loadFailed: "Couldn't load this wallet",
  },

  balance: {
    label: 'Balance',
    checking: '{{amount}} in top-ups being checked (not added yet)',
  },

  integrity: {
    ok: 'History matches the balance (checked {{ago}})',
    mismatch: "The history doesn't match the balance by {{difference}}. Tell engineering, and don't record corrections until it's fixed.",
    /** The history matches, but an old unguarded debit left the balance below Rs 0 (DATA_MODEL §3.5). */
    belowZero: 'The balance is below zero. Record a correction to bring it to Rs 0 or more.',
  },

  history: {
    title: 'History',
    caption: 'Wallet history, newest first',
    type: 'Type',
    /** The office type filter (G01-10); `CORRECTION` also sends OPENING_BALANCE. Older entries show under All only. */
    types: {
      all: 'All',
      TOPUP_ADDED: 'Top-ups',
      DELIVERY_COST: 'Delivery costs',
      DELIVERY_COST_RETURNED: 'Returned delivery costs',
      CORRECTION: 'Corrections',
    },
    when: 'When',
    what: 'What happened',
    change: 'Change',
    balanceAfter: 'Balance after',
    by: 'By',
    none: '—',
    /** "What happened" for each `StatementKind` (UX_ADMIN §2.6). */
    rows: {
      topup: 'Top-up · {{no}} · ref {{ref}}',
      topupNoRef: 'Top-up · {{no}}',
      topupBare: 'Top-up',
      deliveryCost: 'Delivery cost · {{no}}',
      deliveryCostBare: 'Delivery cost',
      returned: 'Delivery cost returned · {{no}} (cancelled before delivery started)',
      returnedBare: 'Delivery cost returned (cancelled before delivery started)',
      correction: 'Correction: {{reason}} — {{note}}',
      correctionNoNote: 'Correction: {{reason}}',
      opening: 'Opening balance',
      openingNote: 'Opening balance — {{note}}',
      legacy: 'Older entry (before the pilot)',
      refillCost: 'Refill delivery cost · {{no}}',
      refillCostBare: 'Refill delivery cost',
    },
    emptyTitle: 'Nothing in these dates',
    emptyBody: 'Money added to and taken from the wallet shows up here. Try other dates or another type.',
    loadFailed: "Couldn't load the history",
  },

  statement: {
    /** CSV column headers (UX_ADMIN §2.6). */
    columns: {
      date: 'Date',
      time: 'Time',
      what: 'What happened',
      reference: 'Reference',
      change: 'Change (Rs)',
      balanceAfter: 'Balance after (Rs)',
      by: 'By',
    },
    tooMany: 'Pick a shorter date range. One statement holds at most {{max}} rows.',
    nothing: 'There is nothing to download for these dates.',
    failed: "Couldn't make the statement. Try again.",
  },

  correction: {
    title: 'Record a correction for {{distributor}}',
    intro: 'Only for genuine mistakes. It is saved in the history and the activity log.',
    direction: 'Direction',
    add: 'Add money to the wallet',
    take: 'Take money from the wallet',
    amount: 'Amount',
    amountHint: 'Up to {{max}}.',
    reason: 'Reason',
    reasonPlaceholder: 'Pick a reason',
    /** `CorrectionReason`, with the shop app's words (UX_MOBILE §3.4 `wallet.correction.*`, G16-06). */
    reasons: {
      WRONG_TOPUP_APPROVAL: 'Top-up approved by mistake',
      SYSTEM_ERROR: 'System error',
      BANK_REVERSAL: 'Bank reversed a top-up',
      OPENING_BALANCE: 'Opening balance',
      OTHER: 'Other',
    },
    related: 'Related top-up or order',
    relatedPlaceholder: 'AG-T031 or AG-0142',
    relatedHint: "{{distributor}}'s own top-up or order, for tracing only.",
    relatedChecking: 'Checking the number…',
    relatedTopup: 'Top-up {{no}} · {{amount}} · {{status}}',
    relatedOrder: 'Order {{no}} · {{customer}} · placed {{when}}',
    relatedNotTheirs: '{{distributor}} has no top-up or order {{number}}.',
    relatedInvalid: 'Type a top-up number like {{topup}} or an order number like {{order}}.',
    relatedFailed: "Couldn't check this number.",
    relatedRetry: 'Check again',
    note: 'Note',
    noteHint: 'Why? Saved in the history and the activity log.',
    preview: 'Balance: {{from}} → {{to}}',
    tooMuch: "{{distributor}} has only {{balance}}. You can't take more than that.",
    continue: 'Continue',
    confirmAddTitle: 'Add {{amount}} to {{distributor}} wallet as a correction?',
    confirmTakeTitle: 'Take {{amount}} from {{distributor}} wallet as a correction?',
    confirmAdd: 'Add {{amount}}',
    confirmTake: 'Take {{amount}}',
    confirmBody: 'It shows in the history and the activity log with your name and the note.',
    facts: {
      reason: 'Reason',
      note: 'Note',
      related: 'Related',
      balance: 'Balance after',
    },
    saved: 'Correction saved. {{distributor}} balance: {{balance}}.',
    offline: "Couldn't reach the server. Your entries are kept — try again.",
  },
} as const;
