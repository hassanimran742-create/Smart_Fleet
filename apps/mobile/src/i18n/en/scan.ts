/**
 * `scan.*` copy: the ScanPanel (ui/scan/ScanPanel.tsx; UX_MOBILE §7.1, driver spec R-SP) on the driver's
 * step screens and refill run, and on the shop's Receive scan (customer-and-inc23 §2.3). Owned by the
 * driver lane.
 *
 * Each step has the idle strip's hint (8 words at most) and the word of a recorded scan; a recorded scan
 * names its cylinder ("AG-C0042 · 11.8 kg loaded"). The step's title is the screen's, not the panel's.
 * A refused scan shows `errors.<CODE>`, never words of its own. The CountBar's words ("2 of 3", "All 3
 * loaded") are `common.count.*`; the panel gives the verb.
 */
export const scan = {
  step: {
    LOAD: {
      hint: 'Scan each full cylinder.',
      recorded: 'Loaded',
    },
    HANDOVER: {
      hint: 'Scan each cylinder you give.',
      recorded: 'Delivered',
    },
    TAKE_BACK: {
      hint: 'Scan each cylinder you take back.',
      recorded: 'Taken back',
    },
    /** The shop's Receive from driver (S13). */
    RECEIVE: {
      hint: 'Scan each cylinder from the van.',
      recorded: 'Received',
      already: 'Already in your store',
    },
    REFILL_PICKUP: {
      hint: 'Scan each cylinder you pick up.',
      recorded: 'Picked up',
    },
    REFILL_FILL: {
      hint: 'Scan each filled cylinder.',
      recorded: 'Filled',
    },
  },

  /** The verb after a count ("2 of 3 loaded") and in a recorded strip ("AG-C0042 · 11.8 kg loaded"). */
  verb: {
    LOAD: 'loaded',
    HANDOVER: 'delivered',
    TAKE_BACK: 'taken back',
    UNLOAD: 'unloaded',
    RECEIVE: 'received',
    REFILL_PICKUP: 'picked up',
    REFILL_FILL: 'filled',
    /** The shop's refill receive. */
    REFILL_BACK: 'back',
  },

  /** A recorded scan names its cylinder. */
  recorded: '{{shortCode}} · {{size}} {{verb}}',
  /** A take-back names the tapped state, so a wrong tap is caught at once. */
  recordedState: '{{shortCode}} · {{state}}',
  /** The shop's receive of a cylinder from another van than the one open. */
  recordedFrom: "{{shortCode}} · {{size}} {{verb}} · {{driver}}'s van",
  alreadyCode: 'Already scanned · {{shortCode}}',
  already: 'Already scanned',
  /** A size line with its progress, under the strip (SizeLines). */
  sizeProgress: '{{size}} · {{done}} of {{total}}',
  /** Reads that got no answer: one amber row and one Retry. */
  notSaved: 'Not saved: {{count}}',
  notSaved_plural: 'Not saved: {{count}}',
  retry: 'Retry',
  checking: 'Checking…',

  /** A cylinder number typed when the label can't be read (`features.typedCylinderNumber`). */
  typed: {
    open: 'Type number',
    instead: 'Type number instead',
    label: 'Cylinder number',
    placeholder: 'e.g. 42',
    /** The send button, named by the step's verb. */
    send: {
      LOAD: 'Load',
      HANDOVER: 'Deliver',
      TAKE_BACK: 'Take back',
      RECEIVE: 'Receive',
      REFILL_PICKUP: 'Pick up',
      REFILL_FILL: 'Fill',
    },
  },

  /** The take-back state tap (one word each, the same on every surface). */
  state: {
    label: 'This cylinder is:',
    EMPTY: 'Empty',
    PART_FILLED: 'Part-filled',
    FULL: 'Full',
  },

  /** Leaving a scan screen with reads that aren't saved (rule 7). */
  unsaved: {
    title: '{{count}} scan not saved',
    title_plural: '{{count}} scans not saved',
    body: "Leave now and it's lost.",
    body_plural: "Leave now and they're lost.",
    leave: 'Leave',
    stay: 'Stay and retry',
  },

  /** The shop's Receive: the CountBar's words once complete. */
  complete: {
    RECEIVE: 'All {{total}} received',
    RECEIVE_plural: 'All {{total}} received',
    REFILL_BACK: 'All {{total}} back · Refill done',
    REFILL_BACK_plural: 'All {{total}} back · Refill done',
  },
  fromVan: "{{driver}}'s van",

  /** When the step's store or customer isn't known yet. */
  theStore: 'the store',
  theCustomer: 'the customer',

  camera: {
    /** What screen readers hear for the running camera. */
    label: "Camera. Point it at the cylinder's QR label.",
    why: 'To read the QR labels.',
    allow: 'Allow camera',
    blocked: 'Camera blocked. Allow it in settings.',
    openSettings: 'Open settings',
    starting: 'Starting camera…',
    failed: "Camera didn't start. Go back and try again.",
  },

  torch: {
    turnOn: 'Turn the torch on',
    turnOff: 'Turn the torch off',
  },
} as const;
