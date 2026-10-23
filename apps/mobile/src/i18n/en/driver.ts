/**
 * `driver.*` copy: the driver app's screens (UX_MOBILE §0, §5). Owned by the mobile-driver lane.
 *
 * Driver words: say "trip", and name the four actions Load, Deliver, Take back and Hand back. Keys
 * follow `area.screen.element`. Every string that shows a count has a `_plural` form (i18next v3:
 * `key` is the count of 1, `key_plural` every other count), with the count passed as `count`.
 * Keep `as const`, so a wrong {{param}} fails the typecheck. Error codes are never reworded here:
 * refusals show `errors.<CODE>`.
 */
export const driver = {
  /** Header titles (navigation/DriverStack.tsx); the menu's screens use their `common.menu.*` label. */
  nav: {
    home: 'My jobs',
    trip: 'Trip',
    stop: 'Step',
    scan: 'Scan',
  },

  /** The side menu (navigation/menus/driverMenu.ts) adds this to the `common.menu.*` labels. */
  menu: {
    helpHelp: 'Call the office, app version',
  },

  /** A cylinder size from its weight, e.g. "11.8 kg". */
  size: '{{kg}} kg',

  /** Live location and the duty switch (hooks/useLiveLocation.ts). */
  location: {
    paused: 'Location paused, no connection',
    onDuty: 'On duty',
    offDuty: 'Off duty',
    sharing: 'The office can see where you are.',
    notSharing: 'Your location is not shared.',
    starting: 'Turning on your location…',
    noPermission: 'Location is off for Smart Fleet. Allow it in your phone settings.',
    unavailable: "Your phone's location is switched off. Turn it on so the office can see where you are.",
    openSettings: 'Open settings',
  },

  /** Home: the van and the trips the office gave this driver. */
  home: {
    empty: {
      title: 'No jobs yet.',
      body: 'The office will assign your next job.',
    },
    openTrips: 'Your trips',
    finishedTrips: 'Finished',
    tripTo: 'Deliver to {{name}}',
    tripCustomers: '{{count}} customer',
    tripCustomers_plural: '{{count}} customers',
    tripDetail: '{{count}} cylinder · load at {{store}}',
    tripDetail_plural: '{{count}} cylinders · load at {{store}}',
    assigned: 'Assigned {{when}}',
    openTrip: 'Open trip',
    continueTrip: 'Continue trip',
  },

  /** The van card (components/VehicleLoad.tsx) and the My van screen. */
  van: {
    title: 'Your van',
    plate: 'Van {{plate}}',
    none: 'No van is assigned to you. Call the office.',
    counts: '{{full}} full · {{empty}} empty',
    total: '{{count}} cylinder on the van',
    total_plural: '{{count}} cylinders on the van',
    nothing: 'Nothing is on the van right now.',
    size: 'Size',
    full: 'Full',
    empty: 'Empty',
  },

  /** The trip: its steps in order, start and finish. */
  trip: {
    from: 'From {{store}}',
    loadAt: 'Load at {{store}}',
    deliverTo: 'Deliver to {{name}}',
    handBackAt: 'Hand back at {{store}}',
    handBackHelp: 'Scan in what you bring back, before you finish the trip.',
    loadHelp: 'Scan each full cylinder onto the van.',
    give: 'Give {{count}} cylinder · take back {{back}}',
    give_plural: 'Give {{count}} cylinders · take back {{back}}',
    start: 'Start trip',
    starting: 'Starting…',
    next: 'Next: {{step}}',
    finish: 'Finish trip',
    finishing: 'Finishing…',
    finishSheet: {
      title: 'Finish this trip?',
      body: "Hand back the cylinders on your van at {{store}} first. After you finish, you can't scan for this trip.",
      confirm: 'Finish trip',
      cancel: 'Not yet',
    },
    finished: 'Trip finished.',
    aborted: 'The office stopped this trip.',
    noSteps: 'This trip has no steps yet.',
  },

  /** One step of the trip at a time (screens/driver/DeliveryStepsScreen.tsx). */
  steps: {
    load: {
      body: 'Scan each full cylinder as you put it on the van. Tap Done loading when the van is ready.',
      scan: 'Scan to load',
      done: 'Done loading',
      finished: 'Loading done.',
    },
    drive: {
      body: "When you reach the customer, tap I've arrived.",
      map: 'Open in maps',
      arrive: "I've arrived",
    },
    deliver: {
      title: 'Hand over',
      body: 'Scan each cylinder as you give it to the customer.',
      scan: 'Scan to deliver',
      all: 'All delivered',
      sheet: {
        title: 'Mark all delivered?',
        body: 'Only do this after you have handed over every cylinder.',
        confirm: 'Yes, all delivered',
        cancel: 'Not yet',
      },
      marked: 'Marked delivered.',
      already: 'Already marked delivered',
      done: 'Delivered',
    },
    takeBack: {
      title: 'Take back',
      expected: 'The customer gives back {{count}} empty cylinder.',
      expected_plural: 'The customer gives back {{count}} empty cylinders.',
      body: 'Scan each empty cylinder the customer gives back.',
      scan: 'Scan to take back',
      none: 'Nothing to take back on this order.',
      afterHandover: 'Hand over the cylinders first.',
    },
    line: '{{count}} × {{size}}',
    line_plural: '{{count}} × {{size}}',
    finishVisit: 'Finish visit',
    visitDone: 'Visit done.',
    cancelled: 'This order was cancelled. Bring its cylinders back to the store.',
    backToTrip: 'Back to trip',
    next: 'Next: {{step}}',
    sending: 'Sending…',
    closed: 'This trip is closed.',
    missing: {
      title: 'This step is no longer on your trip.',
      body: 'The office may have changed the trip.',
    },
  },

  /** "Could not deliver" (POST /orders/:id/fail): plain words, no money. */
  fail: {
    open: 'Could not deliver',
    title: "Couldn't deliver to {{name}}?",
    body: 'The cylinders stay on your van. Bring them back to the store today.',
    note: 'What happened?',
    confirm: 'Mark could not deliver',
    cancel: 'Go back',
    done: 'Marked could not deliver.',
    notStarted: "This order hasn't started. Call the office.",
    /** One word per `DeliveryFailureReason` (API_CONTRACT §1.5). */
    reason: {
      CUSTOMER_NOT_HOME: 'Customer not home',
      CUSTOMER_REFUSED: 'Customer refused',
      WRONG_ADDRESS: 'Wrong address',
      NOT_REACHABLE: 'Not reachable',
      VAN_PROBLEM: 'Van problem',
      OTHER: 'Other',
    },
  },

  /** Refill runs (Inc 1 typed counts; replaced by scans in Inc 3). No money anywhere. */
  refills: {
    empty: {
      title: 'No refill runs right now.',
      body: 'The office will assign one when needed.',
    },
    openRuns: 'To do',
    finishedRuns: 'Finished',
    run: '{{count}} × {{size}}',
    run_plural: '{{count}} × {{size}}',
    forShop: 'For {{shop}}',
    pickupAt: 'Pick up at {{store}}',
    fillAt: 'Fill at {{station}}',
    theStation: 'the station',
    theStore: 'the store',
    picked: 'Empties picked up',
    pickedHelp: 'Up to {{count}} cylinder',
    pickedHelp_plural: 'Up to {{count}} cylinders',
    markPicked: 'Picked up {{count}} empty',
    markPicked_plural: 'Picked up {{count}} empties',
    atStation: "I'm at {{station}}",
    filled: 'Cylinders filled',
    filledHelp: 'Out of {{count}} picked up',
    filledHelp_plural: 'Out of {{count}} picked up',
    markFilled: 'Mark {{count}} filled',
    markFilled_plural: 'Mark {{count}} filled',
    markReturned: 'Brought back to the store',
    returnedNote: 'Back at the store. The office will mark this refill done.',
    filledOf: 'Filled {{filled}} of {{count}}',
    filledOf_plural: 'Filled {{filled}} of {{count}}',
    /** The driver's words for each `RefillStage` (API_CONTRACT §1.4). */
    stage: {
      NEEDS_DRIVER: 'Waiting for a driver',
      DRIVER_ASSIGNED: 'Pick up empties',
      PICKING_UP: 'Picking up empties',
      PICKED_UP: 'Go to the station',
      AT_STATION: 'At the station',
      COMING_BACK: 'Bring them back',
      BACK_AT_STORE: 'Back at the store',
      DONE: 'Done',
      CANCELLED: 'Cancelled',
    },
  },

  /** The read-only profile (no CNIC, no ids). */
  profile: {
    name: 'Name',
    phone: 'Mobile number',
    licence: 'Licence number',
    van: 'Van',
    note: 'To change these, call the office.',
  },

  /** Help: the office's numbers and the app version. */
  help: {
    title: 'Need help?',
    body: 'Call the office about your trips, your van or your account.',
    hours: 'Office hours: {{hours}}',
    noPhone: "The office's number isn't in the app yet.",
    whatsApp: 'WhatsApp the office',
    version: 'App version {{version}}',
    versionUpdate: 'App version {{version}} · update {{id}}',
  },
} as const;
