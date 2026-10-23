/**
 * Money words (foundation namespace; UX_MOBILE §0, §2.2 MoneyText). Amounts themselves are always
 * printed by `formatRs` ("Rs 3,450"); these keys only carry the words around them.
 * There are no holds (DECISIONS ADR-06): money is never described as waiting to be taken later.
 */
export const money = {
  /** Screen-reader text of an amount. `{{amount}}` is the number without "Rs", e.g. "3,450". */
  a11y: '{{amount}} rupees',
  a11yNegative: 'minus {{amount}} rupees',
  a11yPositive: 'plus {{amount}} rupees',
  missing: 'Not available',

  words: {
    balance: 'Balance',
    beingChecked: 'Being checked',
    addMoney: 'Add money',
    deliveryCost: 'Delivery cost',
    paidFromWallet: 'Paid from your wallet',
    returnedToWallet: 'Returned to your wallet',
  },
} as const;
