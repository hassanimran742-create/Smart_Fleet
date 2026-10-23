/**
 * `wallets`: copy for Wallets, the wallet page, the history, the statement download and the correction
 * dialog (website spec W12–W14, UX_ADMIN §2.6). Owned by the admin-web-money lane. Keep `as const` and
 * the export name: i18n/index.ts imports it by name, and `t('wallets:…')` is type-checked, so a missing
 * key fails `tsc`.
 *
 * One balance, no holds (ADR-06): nothing here says "available", "held" or "on hold". Money copy never
 * names the refund rule (G01-08).
 */
export const wallets = {
  list: {
    title: 'Wallets',
    subtitle: 'Prepaid balances for delivery costs.',
    caption: "Distributors' wallets",
    distributor: 'Distributor',
    balance: 'Balance',
    /** The red chip beside a balance under the low-balance warning setting (`AdminWalletRow.lowBalance`). */
    low: 'Low',
    checking: 'To check',
    lastTopup: 'Last top-up',
    checkingValue_one: '{{amount}} · {{count}} top-up',
    checkingValue_other: '{{amount}} · {{count}} top-ups',
    none: '—',
    search: 'Distributor name',
    searchEmpty: 'No distributors match “{{q}}”',
    emptyTitle: 'No distributors yet.',
    emptyAction: 'Add distributor',
    loadFailed: "Couldn't load the wallets",
  },

  page: {
    title: '{{distributor}} wallet',
    recordCorrection: 'Record correction…',
    mismatchReason: 'Fix the history first.',
    download: 'Download statement',
    loadFailed: "Couldn't load this wallet",
  },

  balance: {
    label: 'Balance',
    checking: '{{amount}} in top-ups to check',
  },

  integrity: {
    ok: 'History adds up',
    mismatch: 'History is {{difference}} off. Tell the tech team before any correction.',
    /** The history adds up, but an old unguarded debit left the balance below Rs 0 (DATA_MODEL §3.5). */
    belowZero: 'Balance is below zero. Record a correction to bring it to Rs 0.',
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
      DELIVERY_COST_RETURNED: 'Returned costs',
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
      deliveryCostCustomer: 'Delivery cost · {{no}} · {{customer}}',
      deliveryCost: 'Delivery cost · {{no}}',
      deliveryCostBare: 'Delivery cost',
      returned: 'Delivery cost returned · {{no}} (cancelled before delivery started)',
      returnedBare: 'Delivery cost returned (cancelled before delivery started)',
      correction: 'Correction: {{reason}} — {{note}}',
      correctionNoNote: 'Correction: {{reason}}',
      opening: 'Opening balance',
      openingNote: 'Opening balance — {{note}}',
      legacy: 'Older entry',
      refillCost: 'Refill delivery cost · {{no}}',
      refillCostBare: 'Refill delivery cost',
    },
    /** The filters leave nothing (with Clear filters). */
    emptyTitle: 'Nothing in these dates.',
    /** The wallet has no history at all yet. */
    emptyNew: 'No money in or out yet.',
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
    tooMany: 'Pick a shorter date range.',
    nothing: 'There is nothing to download for these dates.',
    failed: "Couldn't make the statement. Try again.",
  },

  /** The correction dialog (W14): the form, then the confirmation in the same dialog. */
  correction: {
    title: 'Record a correction for {{distributor}}',
    intro: 'For mistakes only.',
    /** The add/take cards' group name, read out only. */
    direction: 'Direction',
    add: 'Add money',
    take: 'Take money',
    pickDirection: 'Pick add or take.',
    amount: 'Amount',
    amountHint: 'Up to {{max}}.',
    amountHintTake: 'Up to {{max}}, the balance.',
    amountMissing: 'Type the amount.',
    reason: 'Reason',
    pickReason: 'Pick a reason.',
    /** `CorrectionReason`, with the shop app's words (UX_MOBILE §3.4 `wallet.correction.*`, G16-06). */
    reasons: {
      WRONG_TOPUP_APPROVAL: 'Top-up approved by mistake',
      SYSTEM_ERROR: 'System error',
      BANK_REVERSAL: 'Bank reversed a top-up',
      OPENING_BALANCE: 'Opening balance',
      OTHER: 'Other',
    },
    note: 'Note',
    notePlaceholder: 'What went wrong?',
    noteMissing: 'Write what went wrong, at least {{min}} characters.',
    addRelated: 'Link a top-up or order',
    related: 'Top-up or order',
    relatedPlaceholder: 'Search by number',
    /** The picker's rows: "AG-T031 · Rs 5,000 · Approved", "AG-0142 · Sana · 21 Oct". */
    relatedTopup: '{{no}} · {{amount}} · {{status}}',
    relatedOrder: '{{no}} · {{customer}} · {{when}}',
    relatedNotTheirs: '{{distributor}} has no top-up or order {{number}}.',
    relatedFailed: "Couldn't check this number.",
    preview: 'Balance: {{from}} → {{to}}',
    tooMuch: "{{distributor}} has only {{balance}}. You can't take more than that.",
    continue: 'Continue',
    confirmAddTitle: 'Add {{amount}} to {{distributor}} wallet as a correction?',
    confirmTakeTitle: 'Take {{amount}} from {{distributor}} wallet as a correction?',
    confirmAdd: 'Add {{amount}}',
    confirmTake: 'Take {{amount}}',
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
