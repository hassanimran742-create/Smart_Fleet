/**
 * `topup.*` copy: the Add money flow and top-up reasons (UX_MOBILE §4 S3 to S6; shop spec §F to §I).
 * Owned by the mobile-distributor lane.
 *
 * Amounts are passed in already formatted by formatRs ("Rs 5,000"); checking hours by `formatClock`
 * from shared-utils ("9 am", "9:30 pm"), never "09:00–21:00".
 */
export const topup = {
  flowTitle: 'Add money',

  /** S3 Amount. */
  amount: {
    title: 'How much do you want to add?',
    /** The last amount chip, and the label of the field it opens. */
    other: 'Other amount',
    /** The Other-amount field's helper. */
    limits: '{{min}} to {{max}}',
    tooLow: 'The minimum is {{min}}',
    tooHigh: 'Up to {{max}} per top-up. Send two for more.',
    pick: 'Pick an amount.',
    hours: 'Money is checked {{from}} to {{to}}.',
  },

  /** `PayerChannel`: how the shop paid. */
  channel: {
    EASYPAISA_APP: 'Easypaisa',
    BANK_APP: 'Bank app',
    OTHER: 'Other',
  },

  /** S4 How to pay. */
  howToPay: {
    title: 'Pay {{amount}}',
    /** The channel segment's screen-reader label. */
    payWith: 'Pay with',
    easypaisa: 'Easypaisa',
    bankApp: 'Bank app',
    checkName: 'Check this name before sending.',
    copyIban: 'Copy IBAN',
    /** The copy icon beside the title (screen readers). */
    copyAmount: 'Copy amount',
    copied: 'Copied',
    /** The path in Easypaisa: "Bank Transfer › {{bank}} › Paste IBAN". */
    ep: {
      transfer: 'Bank Transfer',
      bank: '{{bank}}',
    },
    /** The path in a bank app: "Transfer › Paste IBAN". */
    app: {
      transfer: 'Transfer',
    },
    pasteIban: 'Paste IBAN',
    noWhatsApp: 'We never send account numbers on WhatsApp.',
    paid: "I've paid",
  },

  /** S5 Tell us you paid. The amount and channel come from steps 1 and 2. */
  tellUs: {
    title: 'Tell us you paid',
    summary: '{{amount}} · {{channel}}',
    payerName: 'Name on the account',
    /** The name field's helper follows the channel picked on step 2. */
    payerNameHelp: {
      EASYPAISA_APP: 'As Easypaisa shows it.',
      BANK_APP: 'As your bank app shows it.',
    },
    payerNameRequired: 'Write the name on the account.',
    txnId: 'Transaction ID',
    txnIdInvalid: 'Use letters, numbers and dashes only.',
    screenshot: 'Add screenshot',
    /** The screenshot tile's screen-reader hint. */
    screenshotHelp: 'Helps us find it faster',
    screenshotUploading: 'Uploading…',
    screenshotAdded: 'Screenshot added',
    screenshotA11y: 'Screenshot of the payment',
    remove: 'Remove',
    submit: 'Send for checking',
    sending: 'Sending…',
    sent: 'Sent for checking',
    /** The footer line when the request got no answer (UX_MOBILE S5). */
    notSent: "Not sent. Tap again. It won't be sent twice.",
  },

  /** S6 Status. */
  status: {
    title: 'Top-up {{code}}',
    titleLoading: 'Top-up',
    sent: 'Sent',
    beingChecked: 'Being checked',
    usually: 'Usually within 1 hour, {{from}} to {{to}}',
    startsAt: 'Checking starts at {{from}}.',
    addedStep: 'Added to your balance',
    balanceNow: 'Balance now',
    addedAt: 'Added {{when}}',
    addedDifferent: 'You told us {{amount}}. Call office if this is wrong.',
    officeNote: 'The office wrote: “{{note}}”',
    backHome: 'Back to home',
    /** A top-up that wasn't added: opens Tell us you paid, prefilled. */
    tellAgain: 'Tell us again',
    notFound: "We couldn't find this top-up.",
  },

  /** `TopupRejectReason` (API_CONTRACT §1.5). NAME_DIFFERENT matches the website's reject preview. */
  reason: {
    NOT_IN_BANK: "We can't see this payment in our bank yet.",
    AMOUNT_DIFFERENT: 'The amount in our bank is different.',
    NAME_DIFFERENT: "The name on the account doesn't match our bank.",
    DUPLICATE: 'This payment was already used for another top-up.',
    OTHER: "The office couldn't approve it.",
  },
} as const;
