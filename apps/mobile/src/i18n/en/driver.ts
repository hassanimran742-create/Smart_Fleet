/**
 * `driver.*` copy: the driver app's screens (driver spec D4–D16; UX_MOBILE §0, §5). Owned by the
 * mobile-driver lane.
 *
 * Driver words (UX_PRINCIPLES §5.2): say "trip", never "job" or "run", and name the four actions Load,
 * Deliver, Take back and Unload. Keys follow `area.screen.element`. Every string that shows a count has
 * a `_plural` form (i18next v3: `key` is the count of 1, `key_plural` every other count), with the
 * count passed as `count`. Keep `as const`, so a wrong {{param}} fails the typecheck. Error codes are
 * never reworded here: refusals show `errors.<CODE>`.
 */
export const driver = {
  /** Header titles (navigation/DriverStack.tsx); the menu's screens use their menu label. */
  nav: {
    /** Today's header, with the business date: "Today · Thu 22 Oct". */
    homeDate: 'Today · {{date}}',
    trip: 'Trip',
    refill: 'Refill',
  },

  /** The side menu (navigation/menus/driverMenu.ts), beside the shared `common.menu.*` labels. */
  menu: {
    refills: 'Refills',
  },

  /** A cylinder size from its weight, e.g. "11.8 kg". */
  size: '{{kg}} kg',

  /** Live location and the duty row (hooks/useLiveLocation.ts, Today). One line, only when something is wrong. */
  location: {
    paused: 'Location paused',
    onDuty: 'On duty',
    offDuty: 'Off duty',
    noPermission: 'Location blocked. Allow it in settings.',
    unavailable: 'Phone location is off. Turn it on.',
    openSettings: 'Open settings',
  },

  /** Today (D4): the duty row, the van, the open trips and the one next action. */
  home: {
    empty: {
      title: 'Nothing to do.',
      body: 'New trips appear by themselves.',
    },
    tripTo: 'Deliver to {{name}}',
    tripCustomers: 'Deliver to {{count}} customer',
    tripCustomers_plural: 'Deliver to {{count}} customers',
    tripDetail: '{{count}} cylinder · load at {{store}}',
    tripDetail_plural: '{{count}} cylinders · load at {{store}}',
    doneToday: 'Done today: {{count}}',
    doneToday_plural: 'Done today: {{count}}',
    continueTrip: 'Continue trip',
  },

  /**
   * The van (components/VehicleLoad.tsx): Today's van row and My van. Counts join with " · " and hide
   * their zeros ("3 full · 1 empty"); each part is a whole phrase.
   */
  van: {
    /** Read by screen readers before the plate. */
    plate: 'Van {{plate}}',
    none: 'No van yet.',
    fullCount: '{{count}} full',
    fullCount_plural: '{{count}} full',
    emptyCount: '{{count}} empty',
    emptyCount_plural: '{{count}} empty',
    noCylinders: 'No cylinders',
    /** The word beside My van's big number. */
    total: 'cylinder',
    total_plural: 'cylinders',
    /** The word beside the Unload step's big number. */
    onVan: 'on the van',
    nothing: 'Nothing on the van.',
  },

  /** The trip (D6): its steps in order, start and finish. */
  trip: {
    loadAt: 'Load at {{store}}',
    deliverTo: 'Deliver to {{name}}',
    unloadAt: 'Unload at {{store}}',
    cylinders: '{{count}} cylinder',
    cylinders_plural: '{{count}} cylinders',
    cylindersBack: '{{count}} cylinder · take back {{back}}',
    cylindersBack_plural: '{{count}} cylinders · take back {{back}}',
    onVan: '{{count}} on the van',
    onVan_plural: '{{count}} on the van',
    goLoad: 'Load at store',
    goUnload: 'Unload at store',
    start: 'Start trip',
    starting: 'Starting…',
    finish: 'Finish trip',
    finishing: 'Finishing…',
    finishSheet: {
      title: 'Finish this trip?',
      body: "Unload at {{store}} first. You can't scan for this trip after.",
      confirm: 'Finish trip',
      cancel: 'Not yet',
    },
    /**
     * Finishing with cylinders still on the van, when the office allows it (the server answers
     * TRIP_VAN_NOT_EMPTY with `leftoversAllowed`). The picked reason's English words are what is
     * sent, whatever the app language.
     */
    leftovers: {
      title: 'Finish with {{count}} on the van?',
      title_plural: 'Finish with {{count}} on the van?',
      body: 'The office will see this. Unload them on your next trip.',
      reason: {
        STORE_CLOSED: 'Store closed',
        NO_ONE: 'No one to scan',
        OTHER: 'Other',
      },
      note: 'What happened?',
      confirm: 'Finish trip',
    },
    /** The toast after finishing, and the trip's state card. */
    finished: 'Trip done',
    aborted: 'The office stopped this trip.',
    backHome: 'Back to home',
  },

  /** One step of the trip at a time, with its camera (screens/driver/DeliverySteps, Unload). */
  steps: {
    load: {
      done: 'Done loading',
      finished: 'Loading done',
    },
    drive: {
      map: 'Maps',
      /** What screen readers hear for "Maps". */
      mapA11y: 'Open in maps',
      arrive: "I've arrived",
    },
    /** On the way to the customer and at the customer (DECIDED: the customer's name on the button). */
    callCustomer: 'Call {{name}}',
    deliver: {
      all: 'All delivered',
      /** The strip over the take-back phase. */
      marked: 'All delivered',
      sheet: {
        title: 'All delivered?',
        body: 'Only if the customer has every cylinder.',
        confirm: 'Yes, all delivered',
        cancel: 'Not yet',
      },
    },
    /**
     * "Done loading" or "All delivered" pressed before the screen's count is reached (DECIDED): the
     * sheet asks once, and nothing blocks (the Inc 1 server allows it).
     */
    early: {
      title: 'Only {{done}} of {{total}} scanned. Continue?',
      keep: 'Keep scanning',
    },
    takeBack: {
      title: 'Take back from {{name}}',
      count: 'Take back {{count}}',
      count_plural: 'Take back {{count}}',
    },
    line: '{{count}} × {{size}}',
    line_plural: '{{count}} × {{size}}',
    finishVisit: 'Finish visit',
    visitDone: 'Visit done',
    /** Under "Not delivered" and "Cancelled", and the body of "Could not deliver". */
    bringBack: 'Bring the cylinders back to the store.',
    backToTrip: 'Back to trip',
    sending: 'Sending…',
    closed: 'This trip is closed.',
    missing: {
      title: 'This step is no longer on your trip.',
    },
  },

  /** "Could not deliver" (POST /orders/:id/fail): plain words, no money. */
  fail: {
    open: 'Could not deliver',
    title: "Couldn't deliver to {{name}}?",
    note: 'What happened?',
    confirm: 'Mark not delivered',
    cancel: 'Go back',
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

  /** Refills (D13 list, D14 one refill; Inc 1 counts by stepper, Inc 3 by scans). No money anywhere. */
  refills: {
    empty: {
      title: 'No refills now.',
      body: 'New ones appear by themselves.',
    },
    runTitle: '{{count}} × {{size}} · {{shop}}',
    runTitle_plural: '{{count}} × {{size}} · {{shop}}',
    doneToday: 'Done today: {{count}}',
    doneToday_plural: 'Done today: {{count}}',
    theStation: 'the station',
    theStore: 'the store',
    /** The title of each step of a refill. */
    step: {
      pickUp: 'Pick up empties at {{store}}',
      goStation: 'Go to {{station}}',
      fill: 'Fill at {{station}}',
      bringBack: 'Bring them back to {{store}}',
      back: 'Back at {{store}}',
    },
    picked: 'Empties picked up',
    pickedHelp: 'Up to {{count}}',
    pickedHelp_plural: 'Up to {{count}}',
    markPicked: 'Picked up {{count}} empty',
    markPicked_plural: 'Picked up {{count}} empties',
    filled: 'Cylinders filled',
    filledHelp: 'Out of {{count}} picked up',
    filledHelp_plural: 'Out of {{count}} picked up',
    markFilled: 'Mark {{count}} filled',
    markFilled_plural: 'Mark {{count}} filled',
    filledOf: 'Filled {{filled}} of {{count}}',
    filledOf_plural: 'Filled {{filled}} of {{count}}',
    markReturned: 'Brought back',
    returnedNote: 'The office will finish this refill.',
    back: 'Back to refills',
    /** The driver's next job for each `RefillStage` (API_CONTRACT §1.4); tones from ui/statusTables. */
    stage: {
      NEEDS_DRIVER: 'Waiting for driver',
      DRIVER_ASSIGNED: 'Pick up empties',
      PICKING_UP: 'Picking up empties',
      PICKED_UP: 'Go to the station',
      AT_STATION: 'At the station',
      COMING_BACK: 'Bring them back',
      BACK_AT_STORE: 'Back at store',
      DONE: 'Done',
      CANCELLED: 'Cancelled',
    },
  },

  /** Help, with the profile merged in (D16): the office, who you are, the app version. */
  help: {
    hours: 'Office hours {{hours}}',
    noPhone: 'Office number not loaded yet.',
    name: 'Name',
    phone: 'Mobile',
    van: 'Van',
    version: 'App version {{version}}',
    versionUpdate: 'App version {{version}} · update {{id}}',
  },
} as const;
