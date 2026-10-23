/**
 * `wallet.*` copy: the wallet card, wallet history, statement kinds and correction reasons
 * (UX_MOBILE §3.4, S2, S7). Owned by the mobile-distributor lane.
 *
 * There are no holds (DECISIONS ADR-06): money is "Balance" or "Being checked", never anything else.
 * Signed amounts are printed by MoneyText / formatRs ("−Rs 330", "+Rs 5,000"), never written here.
 */
export const wallet = {
  card: {
    title: 'Wallet',
    balance: 'Balance',
    beingChecked: 'Being checked',
    beingCheckedHint: 'Opens the top-up being checked',
    addMoney: 'Add money',
    history: 'History',
    loadError: "Couldn't load your balance.",
  },

  /** `StatementKind` (API_CONTRACT §1.4). */
  kind: {
    TOPUP_ADDED: 'Money added',
    DELIVERY_COST: 'Delivery cost',
    DELIVERY_COST_RETURNED: 'Delivery cost returned (order cancelled)',
    CORRECTION: 'Correction by the office',
    OPENING_BALANCE: 'Opening balance',
    LEGACY: 'Older entry',
    REFILL_DELIVERY_COST: 'Refill delivery cost',
  },

  /** `CorrectionReason` (API_CONTRACT §1.5). */
  correction: {
    WRONG_TOPUP_APPROVAL: 'Top-up approved by mistake',
    SYSTEM_ERROR: 'System error',
    BANK_REVERSAL: 'Bank reversed a top-up',
    OPENING_BALANCE: 'Opening balance',
    OTHER: 'Other',
  },

  empty: 'No money movements yet.',

  /** S7 Wallet history. */
  history: {
    title: 'Wallet',
    filtersLabel: 'Show',
    filter: {
      all: 'All',
      topups: 'Money added',
      deliveryCosts: 'Delivery costs',
      requests: 'Top-up requests',
    },
    rowWithCode: '{{kind}} · {{code}}',
    rowWithCodeAndName: '{{kind}} · {{code}} · {{name}}',
    balanceAfter: 'Balance after {{balance}}',
    timeWithReason: '{{time}} · {{reason}}',
    pinned: 'Being checked now',
    requestTitle: 'Top-up {{code}}',
    requestedAt: 'Sent {{when}}',
    emptyFiltered: 'Nothing here yet.',
    requestsEmpty: 'No top-up requests yet.',
    loadingMore: 'Loading more…',
    loadMoreError: "Couldn't load more.",
  },
} as const;
