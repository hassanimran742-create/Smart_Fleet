/**
 * `topup.*` copy: the Add money flow and top-up reasons (UX_MOBILE §4 S3 to S6).
 * Owned by the mobile-distributor lane.
 *
 * Amounts are passed in already formatted by formatRs ("Rs 5,000"); checking hours are the office's
 * "HH:mm" settings, shown as they are ("09:00").
 */
export const topup = {
  flowTitle: 'Add money',

  /** S3 Amount. */
  amount: {
    title: 'How much do you want to add?',
    label: 'Amount',
    limits: 'Minimum {{min}} · Maximum {{max}}',
    tooLow: 'The minimum is {{min}}',
    tooHigh: 'The maximum is {{max}} per top-up. Make two top-ups for more.',
    pending: 'You have {{amount}} being checked. You can still add more.',
  },

  /** `PayerChannel`: how the shop paid. */
  channel: {
    EASYPAISA_APP: 'Easypaisa',
    BANK_APP: 'Bank app',
    OTHER: 'Other',
  },

  /** S4 How to pay. */
  howToPay: {
    title: 'How to pay',
    payWith: 'Pay with',
    easypaisa: 'Easypaisa',
    bankApp: 'Bank app',
    accountName: 'Account name',
    bank: 'Bank',
    iban: 'IBAN',
    amount: 'Amount',
    copyIban: 'Copy IBAN',
    copyAmount: 'Copy amount',
    copied: 'Copied',
    stepsTitle: 'Steps',
    ep1: 'Open Easypaisa and tap Bank Transfer',
    ep2: 'Choose the bank and paste the IBAN',
    ep3: 'Enter {{amount}}. Any purpose is fine',
    ep4: 'Send it, then take a screenshot',
    bank1: 'Open your bank app and choose Transfer (Raast or IBFT)',
    bank2: 'Paste the IBAN',
    bank3: 'Enter {{amount}}',
    bank4: 'Send it, then take a screenshot',
    stepNumber: '{{number}}.',
    warning: 'The account name must be {{accountName}}. We never send account numbers on WhatsApp.',
    hours: 'Money is checked {{from}}–{{to}}. Send before {{to}} to use it today.',
    paid: 'I have paid',
  },

  /** S5 Tell us you paid. */
  tellUs: {
    title: 'Tell us you paid',
    amount: 'Amount sent',
    payerName: 'Paid from (name on the account)',
    payerNameHelp: 'The name your bank or Easypaisa shows for you',
    payerNameRequired: 'Write the name on the account you paid from.',
    channel: 'Paid with',
    txnId: 'Transaction ID',
    txnIdHelp: 'If you have it',
    screenshot: 'Add screenshot',
    screenshotHelp: 'Helps us find it faster',
    screenshotUploading: 'Uploading…',
    screenshotAdded: 'Screenshot added',
    screenshotA11y: 'Screenshot of the payment',
    remove: 'Remove',
    submit: 'Send for checking',
    sending: 'Sending…',
    sent: 'Sent for checking',
    notSent: "Not sent. Check your internet and tap Send again. You won't be added twice.",
  },

  /** S6 Status. */
  status: {
    title: 'Top-up {{code}}',
    titleLoading: 'Top-up',
    sent: 'Sent',
    beingChecked: 'Being checked',
    usually: 'Usually within 1 hour, {{from}}–{{to}}',
    startsAt: 'Checking starts at {{from}}.',
    addedStep: 'Added to your balance',
    added: '{{amount}} added. Balance now: {{balance}}',
    addedNoBalance: '{{amount}} added to your balance.',
    addedDifferent: '{{credited}} added (you told us {{amount}}). Call the office if this is wrong.',
    balanceNow: 'Balance now: {{balance}}',
    notAdded: 'Not added',
    officeNote: 'The office wrote: “{{note}}”',
    backHome: 'Back to home',
    tryAgain: 'Try again',
    notFound: "We couldn't find this top-up.",
  },

  /** `TopupRejectReason` (API_CONTRACT §1.5). */
  reason: {
    NOT_IN_BANK: "We can't see this payment in our bank yet.",
    AMOUNT_DIFFERENT: 'The amount in our bank is different.',
    NAME_DIFFERENT: "The payer name doesn't match our bank.",
    DUPLICATE: 'This payment was already used for another top-up.',
    OTHER: "The office couldn't approve it.",
  },
} as const;
