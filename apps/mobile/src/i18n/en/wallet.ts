/**
 * `wallet.*` copy: the wallet card, History, statement kinds and correction reasons (UX_MOBILE §3.4,
 * S2, S7; shop spec §D, §J; DECIDED "History rows"). Owned by the mobile-distributor lane.
 *
 * There are no holds (DECISIONS ADR-06): money is "Balance" or "Being checked", never anything else.
 * Signed amounts are printed by MoneyText / formatRs ("−Rs 330", "+Rs 5,000"), never written here.
 */
export const wallet = {
  card: {
    balance: 'Balance',
    beingChecked: 'Being checked',
    beingCheckedHint: 'Opens the top-up being checked',
    addMoney: 'Add money',
    loadError: "Couldn't load your balance.",
  },

  /**
   * `StatementKind` (API_CONTRACT §1.4): a History row's title is the kind only (DECIDED, review
   * finding mobile-ux-05): "Delivery cost", "Top-up", "Refund".
   */
  kind: {
    TOPUP_ADDED: 'Top-up',
    DELIVERY_COST: 'Delivery cost',
    DELIVERY_COST_RETURNED: 'Refund',
    CORRECTION: 'Office correction',
    OPENING_BALANCE: 'Opening balance',
    LEGACY: 'Older entry',
    REFILL_DELIVERY_COST: 'Refill delivery cost',
  },

  /**
   * `CorrectionReason` (API_CONTRACT §1.5), in the shop's words. OTHER shows no line (shop spec §J);
   * the office sees its own words on the website (UX_ADMIN §2.6).
   */
  correction: {
    WRONG_TOPUP_APPROVAL: 'Top-up added by mistake',
    SYSTEM_ERROR: 'Mistake fixed',
    BANK_REVERSAL: 'Bank reversed a top-up',
    OPENING_BALANCE: 'Opening balance',
  },

  empty: 'No money movements yet.',

  /** S7 History. */
  history: {
    title: 'History',
    /** The filter chips' screen-reader label. */
    filtersLabel: 'Show',
    filter: {
      all: 'All',
      topups: 'Top-ups',
      deliveryCosts: 'Delivery costs',
    },
    /** A row's grey line: the order or top-up number and the customer's (or payer's) name. */
    subjectLine: '{{code}} · {{name}}',
    /** A correction row's grey line when it also points at a top-up or order. */
    lineWithReason: '{{line}} · {{reason}}',
    /** A top-up request's title on the "Top-ups" filter. */
    topupTitle: 'Top-up',
    toldUs: 'You told us {{amount}}',
    emptyFiltered: 'Nothing here yet.',
    requestsEmpty: 'No top-ups yet.',
    loadingMore: 'Loading more…',
    loadMoreError: "Couldn't load more.",
  },
} as const;
