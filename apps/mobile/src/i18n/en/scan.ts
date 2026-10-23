/**
 * `scan.*` copy: the ScanPanel (ui/scan/ScanPanel.tsx; UX_MOBILE §5 v1 core, §7.1 in Inc 2). Owned by
 * the mobile-driver lane.
 *
 * Each step has a title, a hint and the words of a recorded scan. `{{place}}` is the store or the
 * customer of the step. A refused scan shows `errors.<CODE>`, never words of its own. Every string
 * that shows a count has a `_plural` form (i18next v3).
 */
export const scan = {
  step: {
    LOAD: {
      title: 'Load at {{place}}',
      hint: 'Scan each full cylinder as you put it on the van.',
      recorded: 'Loaded onto the van',
    },
    HANDOVER: {
      title: 'Hand over to {{place}}',
      hint: 'Scan each cylinder as you give it to the customer.',
      recorded: 'Handed over to the customer',
    },
    TAKE_BACK: {
      title: 'Take back from {{place}}',
      hint: 'Scan each empty cylinder the customer gives back.',
      recorded: 'Taken back onto the van',
    },
    HAND_BACK: {
      title: 'Hand back at {{place}}',
      hint: 'Scan each cylinder as you take it off the van into the store.',
      recorded: 'Back in the store',
    },
  },
  /** When the step's store or customer isn't known yet. */
  theStore: 'the store',
  theCustomer: 'the customer',

  aim: 'Point the camera at the QR label.',
  checking: 'Checking…',
  already: 'Already scanned',
  count: '{{count}} cylinder scanned here',
  count_plural: '{{count}} cylinders scanned here',
  retry: 'Retry',
  done: 'Done',

  camera: {
    label: "Camera. Point it at the cylinder's QR label.",
    why: 'The camera reads the QR label on each cylinder.',
    allow: 'Allow camera',
    blocked: 'The camera is blocked for Smart Fleet. Allow it in your phone settings.',
    openSettings: 'Open settings',
    starting: 'Starting the camera…',
    failed: "The camera didn't start. Go back and open the scan again.",
  },

  torch: {
    turnOn: 'Turn the torch on',
    turnOff: 'Turn the torch off',
  },
} as const;
