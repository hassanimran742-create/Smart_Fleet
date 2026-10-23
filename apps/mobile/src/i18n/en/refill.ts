/**
 * `refill.*` copy: the shop app's Refills list and New refill (UX_MOBILE §4 S12b; shop spec §X1, §X2,
 * the same screens as the Inc 3 spec's S16 and S17). Owned by the mobile-distributor lane. Refills
 * carry no money (ADR-16): no price, total or balance appears here. The stage words are the
 * foundation's `stages.refill.*`.
 */
export const refill = {
  /** S17 New refill. */
  request: {
    title: 'New refill',
    size: 'Size',
    sizeHelp: 'One size per refill.',
    count: 'How many',
    countHelp: 'Up to {{max}} per refill.',
    station: 'Filling station',
    noStation: 'No station is taking refills. Call the office.',
    noSizes: 'No sizes to refill yet. Call the office.',
    /** The button names what is asked for. */
    submit: 'Request refill · {{count}} × {{size}}',
    submit_plural: 'Request refill · {{count}} × {{size}}',
    /** The button before a size is picked (disabled, with `needSize` above it). */
    submitNoSize: 'Request refill',
    needSize: 'Pick a size first.',
    sending: 'Sending…',
    requested: 'Refill requested',
  },

  /** S16 Refills. */
  list: {
    title: 'Refills',
    row: '{{count}} × {{size}}',
    row_plural: '{{count}} × {{size}}',
    /** Inc 1 only: the row's cancel, until refills get a detail screen (Inc 3, S18). */
    cancel: 'Cancel',
    cancelA11y: 'Cancel this refill',
    /** The Fab, and the empty state's button. */
    new: 'New refill',
    empty: 'No refills yet.',
  },

  cancel: {
    title: 'Cancel this refill?',
    body: "The driver won't pick up these cylinders.",
    confirm: 'Cancel refill',
    keep: 'Keep refill',
    cancelling: 'Cancelling…',
    done: 'Refill cancelled',
    /** Sent as the cancel `reason` (3–300 characters) and shown to the office. */
    reasonSent: 'Cancelled by the shop in the app',
  },
} as const;
