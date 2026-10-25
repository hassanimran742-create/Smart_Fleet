/**
 * `orders.*` copy: New order, My orders and Order detail with cancel (UX_MOBILE §4 S9 to S11; shop spec
 * §N to §U). Owned by the mobile-distributor lane.
 *
 * Money words come from the order's own cost and cancel terms (G01-08): the cancel sheet never names
 * the refund rule. Every counted string has a `_plural` form (G16-04), even where English doesn't
 * change, so a translation can. No zone names (shop spec §3.5).
 */
export const orders = {
  /** A cylinder size label when the server didn't send one ("11.8 kg"). */
  sizeLabel: '{{weight}} kg',

  /** S9 New order. */
  new: {
    title: 'New order',
    who: 'Who is it for?',
    /** Chips on a customer or address that can't take an order. */
    noPrice: 'No price yet',
    outside: 'Outside delivery area',
    noAddress: 'No address yet',
    /** Read after the customer chosen on step 1. */
    selected: 'Chosen',
    customerRow: '{{phone}} · {{area}}',

    cylinders: 'Cylinders to deliver',
    forCustomer: 'For {{name}} · {{address}}',
    /** The one-tap chip that fills the customer's last order (DECIDED: counts start at 0). */
    sameAsLast: 'Same as last time',
    takeBack: 'Take back',
    costAbout: 'Delivery cost about {{fee}}',
    pickSome: 'Add at least 1 cylinder.',
    capReached: 'Up to {{count}} cylinder per order.',
    capReached_plural: 'Up to {{count}} cylinders per order.',
    noSizes: 'No cylinder sizes yet. Call the office.',

    review: 'Check and place',
    customerValue: '{{name}} · {{phone}}',
    change: 'Change',
    line: '{{count}} × {{size}} · take back {{back}}',
    line_plural: '{{count}} × {{size}} · take back {{back}}',
    lineNoBack: '{{count}} × {{size}}',
    lineNoBack_plural: '{{count}} × {{size}}',
    deliveryCost: 'Delivery cost',
    /** The cost's parts under the total: "Rs 250 + 2 × Rs 40" (data only). */
    costBase: '{{amount}}',
    costLine: '{{count}} × {{amount}}',
    costLine_plural: '{{count}} × {{amount}}',
    costJoin: ' + ',
    costNone: 'No delivery cost',
    costError: "Couldn't get the cost.",
    balanceNow: 'Balance now',
    balanceAfter: 'After this order',
    /** The refund rule in one line, worded by `orders.deliveryStartedAt` (also on Help). */
    refundRule: {
      FIRST_LOAD_SCAN: 'Refund only if cancelled before loading.',
      DRIVER_ASSIGNED: 'Refund only if cancelled before a driver is assigned.',
      LEFT_STORE: 'Refund only if cancelled before the van leaves.',
    },
    notEnough: 'You need {{required}}. You have {{balance}}.',
    addMoney: 'Add money',
    priceChanged: 'The delivery cost is now {{total}}. Check it, then tap again.',
    place: 'Place order · pay {{fee}}',
    placeFree: 'Place order',
    placing: 'Placing order…',
    placed: 'Order placed · {{fee}} paid',
    placedFree: 'Order placed',
    /** The footer line when "Place order" got no answer (UX_MOBILE S9, ORD-004). */
    notSent: "Not sent. Tap again. It won't be sent twice.",
    officeAssigns: 'The office will assign a driver.',
  },

  /** S10 My orders. */
  list: {
    title: 'My orders',
    tabsLabel: 'Which orders',
    active: 'Active ({{count}})',
    active_plural: 'Active ({{count}})',
    activeNoCount: 'Active',
    done: 'Done',
    subtitle: '{{items}} · {{code}}',
    item: '{{count}} × {{size}}',
    item_plural: '{{count}} × {{size}}',
    itemsJoin: ', ',
    /** A cancelled order whose cost was kept (Done rows only). */
    noRefund: 'No refund',
    emptyActive: 'No active orders.',
    emptyDone: 'No finished orders yet.',
    newOrder: 'New order',
    loadingMore: 'Loading more…',
    loadMoreError: "Couldn't load more.",
  },

  /** S11 Order detail. */
  detail: {
    title: 'Order {{code}}',
    titleLoading: 'Order',
    notFound: "We couldn't find this order.",
    timeline: {
      placed: 'Placed · {{fee}} paid',
      placedFree: 'Placed',
      assigned: 'Driver assigned',
      loading: 'Loading',
      onTheWay: 'On the way',
      delivered: 'Delivered',
      notDelivered: 'Not delivered',
      cancelledReturned: 'Cancelled · {{fee}} returned',
      cancelledNoRefund: 'Cancelled · no refund',
      cancelled: 'Cancelled',
    },
    /** The call button beside the customer (screen readers). */
    callCustomer: 'Call {{name}}',
    van: 'Van {{plate}}',
    driverLine: '{{name}} · {{van}}',
    itemLine: 'Deliver {{count}} × {{size}} · take back {{back}}',
    itemLine_plural: 'Deliver {{count}} × {{size}} · take back {{back}}',
    itemLineNoBack: 'Deliver {{count}} × {{size}}',
    itemLineNoBack_plural: 'Deliver {{count}} × {{size}}',
    costTitle: 'Delivery cost',
    /** [Inc 2] A delivered order's cost line (UX_MOBILE S14), in place of the fee chip. */
    costPaid: 'Delivery cost {{fee}} · paid when the order was placed',
    noRefund: 'No refund. Delivery had started.',
    /**
     * [Inc 2] What went to the customer and what came back (S14; Inc 2/3 spec §2.4), once the visit is
     * finished. A size short of the order reads like the scan screens: "11.8 kg · 1 of 2".
     */
    delivered: 'Delivered',
    deliveredLine: '{{count}} × {{size}}',
    deliveredLine_plural: '{{count}} × {{size}}',
    deliveredShort: '{{size}} · {{done}} of {{total}}',
    takenBack: 'Taken back',
    /** A state with its cylinders by number, from the order's visit: "Empty · AG-C0011, AG-C0012". */
    takenBackNumbers: '{{state}} · {{numbers}}',
    /** A state with its cylinders counted by size (the customer link's snapshot): "Empty · 1 × 11.8 kg". */
    takenBackCount: '{{state}} · {{count}} × {{size}}',
    takenBackCount_plural: '{{state}} · {{count}} × {{size}}',
    /** Cylinders with no label, after their state (the driver's and the office's "No label" piece). */
    noLabel: '{{state}} · No label · {{count}} × {{size}}',
    noLabel_plural: '{{state}} · No label · {{count}} × {{size}}',
    /** When the total taken back differs from the order's take-back. */
    expected: '{{count}} expected',
    expected_plural: '{{count}} expected',
    /** A cylinder's state on the taken-back lines. */
    state: {
      EMPTY: 'Empty',
      PART_FILLED: 'Part-filled',
      FULL: 'Full',
    },
    /** A finished order's caption: "Today, 10:30 am · Customer cancelled". */
    statusLine: '{{when}} · {{reason}}',
    allSteps: 'All steps',
    trackingTitle: 'Where the driver is',
    trackingMapA11y: 'Map with the driver and the delivery spot',
    driverPin: 'Driver',
    deliveryPin: 'Delivery spot',
    cancel: 'Cancel order',
    cancelNoRefund: 'Cancel · no refund',
    callDriver: 'Call driver',
    failureReason: {
      CUSTOMER_NOT_HOME: 'Customer not home',
      CUSTOMER_REFUSED: 'Customer refused',
      WRONG_ADDRESS: 'Wrong address',
      NOT_REACHABLE: "Couldn't reach the customer",
      VAN_PROBLEM: 'Van problem',
      OTHER: 'Other reason',
    },
  },

  /** S11 cancel sheet: its words come from the order's `cancel` terms. */
  cancel: {
    titleRefund: 'Cancel order {{code}}?',
    backToWallet: 'Back to your wallet',
    confirmRefund: 'Cancel · get {{fee}} back',
    titleNoRefund: 'Cancel without refund?',
    bodyNoRefund: 'Delivery has started.',
    notReturned: 'Not returned',
    confirmNoRefund: 'Cancel without refund',
    title: 'Cancel order {{code}}?',
    confirm: 'Cancel order',
    keep: 'Keep order',
    cancelling: 'Cancelling…',
    noteLabel: 'What happened?',
    reason: {
      CUSTOMER_CANCELLED: 'Customer cancelled',
      WRONG_ORDER: 'Wrong order',
      DUPLICATE: 'Duplicate order',
      OUT_OF_STOCK: 'Out of stock',
      OTHER: 'Other',
    },
    /** The same words as the shared catalogue's ORDER_CANCEL_TERMS_CHANGED. */
    termsChanged: 'Delivery has just started. The refund is now {{refund}}.',
    doneReturned: 'Order cancelled · {{fee}} returned',
    doneNoRefund: 'Order cancelled · no refund',
    doneFree: 'Order cancelled',
  },
} as const;
