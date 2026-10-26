/**
 * `orders`: copy for the Orders board, the order drawer and its dialogs (UX_ADMIN §2.5, website spec
 * W27–W32). Owned by the admin-web-ops lane. Stage words are `status:order.*` and fee chips
 * `status:fee.*` (foundation).
 *
 * Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('orders:…')` is
 * type-checked. Money copy never names the refund rule: refund words come from the order's own cancel
 * terms (G01-08). No text here says "on hold" (ADR-06), and an order is "not delivered", never "failed".
 */
export const orders = {
  page: {
    title: 'Orders',
    tabsLabel: 'Order lists',
    search: 'Order number, customer or phone',
    /** The distributor filter's name for screen readers. */
    distributor: 'Distributor',
    /** The first chip of the distributor filter. */
    allChip: 'All',
    /** The distributor filter as a search box (more than 5 distributors). */
    allDistributors: 'All distributors',
    caption: 'Orders',
    loadFailed: "Couldn't load the orders",
  },
  tabs: {
    needsDriver: 'Needs a driver',
    inProgress: 'In progress',
    doneToday: 'Done today',
    cancelledFailed: 'Cancelled or not delivered',
    all: 'All',
  },
  columns: {
    order: 'Order',
    status: 'Status',
    customer: 'Customer',
    cylinders: 'Cylinders',
    cost: 'Delivery cost',
    driver: 'Driver',
  },
  row: {
    assign: 'Assign driver',
    noDriver: '—',
    /** The muted line under the order number, by tab. */
    when: {
      placed: 'Placed {{ago}}',
      delivered: 'Delivered {{time}}',
      cancelled: 'Cancelled {{time}}',
      notDelivered: 'Not delivered {{time}}',
    },
    /** The muted line under the customer while every distributor's orders show. */
    zoneDistributor: '{{zone}} · {{distributor}}',
  },
  empty: {
    needsDriver: { title: 'No orders need a driver' },
    inProgress: { title: 'No orders in progress' },
    doneToday: { title: 'Nothing delivered yet today' },
    cancelledFailed: { title: 'None in the last 7 days' },
    all: { title: 'No orders yet' },
    search: {
      title: 'No orders match “{{q}}”',
      tab: 'Only {{tab}} was searched.',
    },
  },
  format: {
    cylinderLine: '{{n}} × {{size}}',
    driverVan: '{{driver}} · {{plate}}',
    storeAt: '{{store}} · {{address}}',
  },
  drawer: {
    title: 'Order {{no}}',
    subtitle: '{{distributor}} · placed {{when}}',
    subtitleNoDistributor: 'Placed {{when}}',
    subtitleDelivered: '{{distributor}} · delivered {{when}}',
    subtitleDeliveredNoDistributor: 'Delivered {{when}}',
    subtitleCancelled: '{{distributor}} · cancelled {{when}}',
    subtitleCancelledNoDistributor: 'Cancelled {{when}}',
    subtitleNotDelivered: '{{distributor}} · not delivered {{when}}',
    subtitleNotDeliveredNoDistributor: 'Not delivered {{when}}',
    loadFailed: "Couldn't load this order",
    notFound: "We couldn't find this order. It may have been removed, or the link is old.",
    sections: {
      customer: 'Customer',
      cylinders: 'Cylinders',
      cost: 'Delivery cost',
      driver: 'Driver',
      timeline: 'Timeline',
    },
    /** The outcome line at the top of a finished order: what happened to the money, and why. */
    outcome: {
      returned: '{{amount}} returned to the wallet · {{reason}}',
      returnedNoReason: '{{amount}} returned to the wallet',
      noRefund: 'No refund: delivery had started · {{reason}}',
      noRefundNoReason: 'No refund: delivery had started',
      notDelivered: '{{reason}} · The driver brings the cylinders back to the store.',
      notDeliveredNoReason: 'The driver brings the cylinders back to the store.',
    },
    customerZone: 'Zone {{zone}}',
    callCustomer: 'Call {{name}} on {{phone}}',
    cylinderTakeBack: 'Take back {{n}}',
    noTakeBack: 'Nothing to take back',
    driverNone: 'No driver yet.',
    callDriver: 'Call {{name}} on {{phone}}',
    startsAt: 'Starts at {{store}}',
    noRefund: 'Cancelling now returns nothing: delivery has started.',
  },
  timeline: {
    placedPaid: 'Placed · {{amount}} taken from wallet',
    placed: 'Placed',
    assignedBy: 'Driver assigned (by {{name}})',
    assigned: 'Driver assigned',
    changedBy: 'Driver changed to {{driver}} (by {{name}})',
    loading: 'Loading started',
    onTheWay: 'On the way',
    delivered: 'Delivered',
    deliveredByOffice: 'Delivered · recorded by the office',
    cancelledReturned: 'Cancelled · {{amount}} returned',
    cancelledNoRefund: 'Cancelled · no refund',
    cancelled: 'Cancelled',
    failed: 'Not delivered',
    reason: 'Reason: {{reason}}',
  },
  actions: {
    assign: 'Assign driver',
    reassign: 'Change driver',
    cancel: 'Cancel order…',
    fail: 'Could not deliver…',
    manualDelivery: 'Mark delivered…',
  },
  assign: {
    title: 'Assign a driver to {{no}}',
    titleChange: 'Change driver for {{no}}',
    summary: '{{customer}} · {{cylinders}} · {{zone}}',
    startsAt: 'Starts at: {{store}}',
    noStoreTitle: 'This distributor has no store set up',
    noStoreBody: "No trip can start until the store is set up on the distributor's page.",
    changeWarning: "{{driver}}'s stop will be cancelled. Only the new driver can deliver this order.",
    driversLabel: 'Driver',
    search: 'Find a driver',
    van: 'Van {{plate}}',
    vanTrip: 'Van {{plate}} · on a trip',
    noVan: 'No van',
    unavailable: {
      noVan: 'No van — give one in Vans',
      onLeaveUntil: 'On leave until {{date}}',
      onLeave: 'On leave',
      offDuty: 'Off duty — change it in Drivers',
      suspended: 'Account suspended',
      notActive: "Account isn't active yet",
      current: 'Has this order now',
    },
    noDrivers: {
      title: 'No drivers yet',
      body: 'Add drivers in Drivers and give each one a van.',
    },
    driversFailed: "Couldn't load the drivers",
    offlineNote: '{{driver}} is offline. He sees it when he opens the app.',
    confirm: 'Assign to {{driver}}',
    confirmNone: 'Assign driver',
    pickFirst: 'Pick a driver.',
    toast: '{{no}} assigned to {{driver}}',
  },
  cancel: {
    title: 'Cancel {{no}}?',
    bodyRefund: "{{amount}} goes back to {{distributor}}'s wallet.",
    bodyRefundNoName: "{{amount}} goes back to the distributor's wallet.",
    bodyNoRefund: 'Delivery has started. Cancelling now returns nothing.',
    bodyNothing: 'Nothing goes back to the wallet for this order.',
    confirmRefund: 'Cancel and return {{amount}}',
    confirmNoRefund: 'Cancel without refund',
    confirmNothing: 'Cancel order',
    reasonLabel: 'Reason',
    noteLabel: 'Note',
    notePlaceholder: 'Who asked, and why?',
    needReason: 'Pick a reason first.',
    needNote: 'Write a note of at least 5 characters.',
    /** `ORDER_HANDOVER_STARTED`, in the office's own words and button names. */
    handoverStarted: "The driver has started delivering. Use 'Could not deliver…' or 'Mark delivered…'.",
    toastReturned: '{{no}} cancelled · {{amount}} returned',
    toastNoRefund: '{{no}} cancelled · no refund',
    toastDone: '{{no}} cancelled',
    reason: {
      CUSTOMER_CANCELLED: 'Customer cancelled',
      WRONG_ORDER: 'Wrong order',
      DUPLICATE: 'Duplicate order',
      OUT_OF_STOCK: 'Out of stock at the store',
      OTHER: 'Other',
    },
  },
  fail: {
    title: 'Mark {{no}} not delivered?',
    facts: {
      money: 'No refund: {{amount}} stays paid.',
      driver: 'The driver brings the cylinders back to the store.',
    },
    notePlaceholder: 'What happened?',
    confirm: 'Mark not delivered',
    toast: '{{no}} marked not delivered.',
    reason: {
      CUSTOMER_NOT_HOME: 'Customer not home',
      CUSTOMER_REFUSED: 'Customer refused',
      WRONG_ADDRESS: 'Wrong address',
      NOT_REACHABLE: "Couldn't reach the customer",
      VAN_PROBLEM: 'Van problem',
      OTHER: 'Other',
    },
  },
  /**
   * Mark delivered by the office, naming each cylinder (Inc 2, UX_ADMIN §3.4, Inc 2/3 spec §3.3): the
   * forgotten-IN path. No money moves. A chip reads "AG-C0001 · 11.8 kg", or names its problem after "·".
   */
  manual: {
    title: 'Mark {{no}} delivered?',
    body: "Only when the driver can't scan. No money moves.",
    delivered: 'Delivered',
    sizeProgress: '{{size}} · {{done}} of {{total}}',
    number: 'Cylinder number',
    numberPlaceholder: 'For example AG-C0042 or 42',
    add: 'Add',
    addTakenBack: 'Add taken back',
    takenBack: 'Taken back',
    /** Names the state chips for screen readers: the state the next number is taken back in. */
    takenBackState: 'Taken back as',
    state: {
      EMPTY: 'Empty',
      PART_FILLED: 'Part-filled',
      FULL: 'Full',
    },
    reason: 'Reason',
    reasons: {
      NOT_SCANNED: 'Not scanned at the store',
      PHONE: "Driver's phone not working",
      OTHER: 'Other',
    },
    otherNote: 'What happened?',
    needNote: 'Write a reason of at least 10 characters.',
    stillNeeded: 'Still needed: {{list}}',
    pickReason: 'Pick a reason.',
    /** A chip: "AG-C0001 · 11.8 kg" or "AG-C0014 · with another customer". */
    chip: '{{code}} · {{detail}}',
    checking: 'Checking {{code}}',
    remove: 'Remove {{code}}',
    confirm: 'Mark delivered',
    toast: '{{no}} delivered · cylinders moved to the customer',
    mismatch: "Some cylinders can't be used. Fix the red ones.",
    /** What is wrong with a named cylinder (from the check as it is added, or the server's refusal). */
    problem: {
      WRONG_OWNER: "another shop's cylinder",
      NOT_FULL: 'not full',
      BLOCKED: 'marked damaged or lost',
      WRONG_SIZE: "order doesn't need {{size}}",
      WITH_CUSTOMER: 'with another customer',
      ON_VAN: 'on a van, not for this trip',
      NOT_AVAILABLE: 'not in the store or on this van',
      NOT_WITH_THIS_CUSTOMER: 'not with this customer',
      LISTED_TWICE: 'listed twice',
      UNKNOWN: 'unknown number',
      TOO_MANY: 'more than the order needs',
      NOT_CHECKED: "couldn't check",
    },
  },
  /**
   * The order drawer's "Customer answer" (Inc 2, UX_ADMIN §3.2, CUSTOMER_PAGE §8): the answer chip
   * (`status:answer.*`), the comment and one link-status line. Never a money line.
   */
  answer: {
    title: 'Customer answer',
    comment: '“{{comment}}”',
    link: {
      notSent: 'Not sent',
      smsOff: 'Not sent · text messages are off',
      sending: 'Sending text…',
      sent: 'Text sent {{time}}',
      failed: "Text didn't send · {{reason}}",
      shared: 'Shared {{time}} by {{name}} ({{via}})',
      sharedNoName: 'Shared {{time}} ({{via}})',
      answered: 'Answered {{time}}',
      expired: 'Expired',
    },
    failReason: {
      INVALID_NUMBER: 'the number looks wrong',
      REJECTED: 'the SMS company refused it',
      TIMEOUT: 'the SMS company did not answer',
      AUTH: 'SMS account problem',
      UNAVAILABLE: 'the SMS company is down',
      UNKNOWN: 'something went wrong',
    },
    via: {
      WHATSAPP: 'WhatsApp',
      SMS: 'text message',
      SHARE_SHEET: 'other app',
      COPY: 'copied',
    },
    copy: 'Copy customer link',
    copied: 'Link copied',
    /** The link, when the browser blocks the clipboard. */
    linkLabel: 'Customer link',
    loadFailed: "Couldn't load the customer answer.",
  },
  /**
   * The Cylinders section's Inc 2 lines (UX_ADMIN §3.2), from the trip's scans: the load, what was
   * delivered and what was taken back, grouped by state.
   */
  scans: {
    loaded: 'Loaded {{done}} of {{total}} · {{time}} · {{driver}}',
    delivered: 'Delivered',
    /** One delivered cylinder by number: "AG-C0001 · 11.8 kg". */
    deliveredItem: '{{no}} · {{size}}',
    /** A size given in full: "2 × 11.8 kg"; short: "11.8 kg · 1 of 2". */
    deliveredLine: '{{count}} × {{size}}',
    deliveredShort: '{{size}} · {{done}} of {{total}}',
    takenBack: 'Taken back',
    /** A taken-back cylinder with its label: "AG-C0011 · 11.8 kg". */
    takenBackItem: '{{no}} · {{size}}',
    takenBackLine: '{{count}} × {{size}}',
    noLabel: 'No label · {{count}} × {{size}}',
    expected_one: '{{count}} expected',
    expected_other: '{{count}} expected',
  },
} as const;
