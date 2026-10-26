/**
 * [Inc 2] `confirm.*` copy: the customer answer card on a delivered order, its Send link sheet and
 * "Make a new link?" (CUSTOMER_PAGE §10; UX_MOBILE §7.3 S14; Inc 2/3 spec §2.5–§2.6). Owned by the
 * mobile-distributor lane. The chip words are the foundation's `stages.answer.*`. The card is a record
 * only: no money line, ever (ADR-15).
 */
export const confirm = {
  /** The card's caption. */
  title: 'Customer answer',

  notSent: 'Link not sent yet · {{name}}, {{phone}}',
  smsFailed: "Text didn't send: {{reason}}.",
  /** CUSTOMER_PAGE §8's FAILED reasons. */
  smsFailReason: {
    INVALID_NUMBER: 'the number looks wrong',
    REJECTED: 'the SMS company refused it',
    TIMEOUT: 'the SMS company did not answer',
    AUTH: 'SMS account problem',
    UNAVAILABLE: 'the SMS company is down',
    UNKNOWN: 'something went wrong',
  },
  smsSending: 'Sending text…',
  smsSent: 'Text sent {{time}} · {{phone}}',
  /** The app can't see whether the shop pressed Send in WhatsApp, so it asks them to check. */
  shared: 'Shared {{time}} · {{via}}. Check it was sent.',
  via: {
    WHATSAPP: 'WhatsApp',
    SMS: 'text message',
    SHARE_SHEET: 'other app',
    COPY: 'copied',
  },
  until: 'Link open until {{time}}',
  /** The reserved CANCELLED state's grey chip. */
  cancelled: 'Not needed',
  /** The customer's note, in quotes. */
  comment: '“{{comment}}”',
  /** Shown while the customer's problem is open (`caseOpen`). */
  officeWillCheck: 'The office will look into it.',
  badPhone: 'Number looks wrong: {{phone}}',
  numberChanged: 'Number changed. Make a new link.',

  btn: {
    whatsapp: 'Send on WhatsApp',
    otherWays: 'Other ways',
    sendAgain: 'Send again',
    fixNumber: 'Fix number',
    makeNewLink: 'Make new link',
    sms: 'Text message',
    share: 'Other app',
    copy: 'Copy message',
    newLink: 'Make a new link',
  },

  /** The Send link sheet: a short action list, no search box. */
  sheet: {
    title: 'Send link',
    whatsapp: 'WhatsApp',
  },

  /** "Make a new link?" (rule 7: the old link stops working). */
  newLink: {
    title: 'Make a new link?',
    body: 'The old link stops working.',
    confirm: 'Make new link',
    keep: 'Keep old link',
    making: 'Making link…',
  },

  toast: {
    copied: 'Message copied',
    newLink: 'New link made',
  },

  loadError: "Couldn't load the customer answer.",
  linkError: "Couldn't get the link. Try again.",
} as const;
