/**
 * `refill.*` copy: the shop app's refill request (UX_MOBILE §4 S12b). Owned by the mobile-distributor
 * lane. Refills carry no money (ADR-16): no price, total or balance appears here. The stage words are
 * the foundation's `stages.refill.*`.
 */
export const refill = {
  title: 'Refill cylinders',

  request: {
    title: 'New refill',
    size: 'Size',
    sizeHelp: 'One size per refill. For two sizes, make two requests.',
    count: 'How many',
    countHelp: 'Up to {{max}} per refill.',
    station: 'Filling station',
    noStation: 'No filling station is taking refills right now. Call the office.',
    noSizes: 'There are no cylinder sizes to refill yet. Call the office.',
    submit: 'Request refill',
    sending: 'Sending…',
    requested: 'Refill requested',
  },

  list: {
    title: 'Your refills',
    empty: 'No refills yet. Send empty cylinders to be filled.',
    row: '{{count}} × {{size}} · {{station}}',
    row_plural: '{{count}} × {{size}} · {{station}}',
    rowNoStation: '{{count}} × {{size}}',
    rowNoStation_plural: '{{count}} × {{size}}',
    requestedAt: 'Requested {{when}}',
    cancel: 'Cancel',
    cancelA11y: 'Cancel this refill',
  },

  cancel: {
    title: 'Cancel this refill?',
    body: "The driver won't pick up these cylinders.",
    confirm: 'Yes, cancel refill',
    keep: 'Keep refill',
    cancelling: 'Cancelling…',
    done: 'Refill cancelled',
    /** Sent as the cancel `reason` (3–300 characters) and shown to the office. */
    reasonSent: 'Cancelled by the shop in the app',
  },
} as const;
