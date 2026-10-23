/**
 * `scan.*` copy: the ScanPanel on the driver's step screens (ui/scan/ScanPanel.tsx; driver spec §1.3;
 * UX_MOBILE §5, §7.1 in Inc 2). Owned by the mobile-driver lane.
 *
 * Each step has the idle strip's hint (8 words at most) and the word of a recorded scan. The step's
 * title is the screen's, not the panel's. A refused scan shows `errors.<CODE>`, never words of its own.
 * The CountBar's words ("2 of 3", "All 3 scanned") are `common.count.*`; the panel only gives the verb.
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
    UNLOAD: {
      hint: 'Scan each cylinder you bring back.',
      recorded: 'Unloaded',
    },
  },

  /**
   * The CountBar's verb. Inc 1 counts the cylinders the server confirmed on this screen (a tally, not
   * the server's count), so it says "scanned"; Inc 2 adds "loaded", "delivered" and "unloaded".
   */
  verb: {
    SCANNED: 'scanned',
    TAKE_BACK: 'taken back',
  },

  /** When the step's store or customer isn't known yet. */
  theStore: 'the store',
  theCustomer: 'the customer',

  checking: 'Checking…',
  already: 'Already scanned',
  /** No answer: the strip keeps the read, with Retry. */
  notSent: 'Not sent',
  retry: 'Retry',

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
