/**
 * `refill.*` copy: the shop app's Refills list, New refill and (Inc 3) the refill detail (UX_MOBILE §4
 * S12b, §8.1 S16–S18; shop spec §X1, §X2; Inc 2/3 spec §4.1–§4.3). Owned by the mobile-distributor
 * lane. Refills carry no money (ADR-16): no price, total or balance appears here. The stage words are
 * the foundation's `stages.refill.*`.
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

  /** S16 Refills. From Inc 3 a row opens the refill, which holds the cancel (§4.3). */
  list: {
    title: 'Refills',
    row: '{{count}} × {{size}}',
    row_plural: '{{count}} × {{size}}',
    /** The stage chip with its count while the refill moves: "Picking up empties · 1 of 2". */
    progress: '{{stage}} · {{done}} of {{total}}',
    /** The Fab, and the empty state's button. */
    new: 'New refill',
    empty: 'No refills yet.',
  },

  /** [Inc 3] S18 Refill detail: one big count for the step that matters now, and the timeline. */
  detail: {
    title: 'Refill {{refillNo}}',
    titleLoading: 'Refill',
    notFound: "We couldn't find this refill.",
    /** The CountBar's verbs: "1 of 2 picked up", "2 of 2 filled", "1 of 2 back". */
    count: {
      picked: 'picked up',
      filled: 'filled',
      back: 'back',
    },
    requested: 'Requested',
    assigned: 'Driver assigned',
    pickedUp: 'Picked up',
    filledStep: 'Filled',
    backAtStore: 'Back at store',
    done: 'Done',
    /** A finished step's count, as its timeline detail. */
    stepCount: '{{done}} of {{total}}',
    /** A refill that finished with fewer cylinders filled than picked up. */
    doneShort: 'Done · {{filled}} of {{picked}} filled',
    doneShortNote: 'The rest came back unfilled.',
    /** The driver card: "Imran · LEB-202". */
    driverLine: '{{name}} · {{plate}}',
    call: 'Call',
    /** What screen readers hear for the driver's Call button. */
    callA11y: 'Call {{name}}',
    cancel: 'Cancel refill',
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
