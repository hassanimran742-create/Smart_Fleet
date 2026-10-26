/**
 * `driver.*` copy: the driver app's screens (driver spec D4–D16 and R2–R10; UX_MOBILE §0, §5, §7.2,
 * §8.2). Owned by the driver lane.
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
    /** What screen readers hear for Refills with its count badge. */
    refillsA11y: 'Refills, {{count}} open',
    refillsA11y_plural: 'Refills, {{count}} open',
  },

  /** A cylinder size from its weight, e.g. "11.8 kg". */
  size: '{{kg}} kg',

  /** A group's heading with its count: "Part-filled · 2", "Not delivered · 3". */
  groupCount: '{{group}} · {{n}}',

  /** Live location and the duty row (hooks/useLiveLocation.ts, Today). One line, only when something is wrong. */
  location: {
    paused: 'Location paused',
    onDuty: 'On duty',
    offDuty: 'Off duty',
    noPermission: 'Location blocked. Allow it in settings.',
    unavailable: 'Phone location is off. Turn it on.',
    openSettings: 'Open settings',
  },

  /** Today (D4, R2): the duty row, the van, the open trips and the one next action. */
  home: {
    /** Only with no trip and no refill (review23 ux-02). */
    empty: {
      title: 'Nothing to do.',
      body: 'New trips and refills appear by themselves.',
    },
    /** A refill on Today, under the trips: "Refill · 1 × 6 kg · Ahmed Gas" (the line is data). */
    refillRow: 'Refill · {{line}}',
    /**
     * Today's one line under the van while refills are assigned: "2 refills · 7 cylinders" ({{cylinders}} is
     * `driver.trip.cylinders`, a whole counted phrase).
     */
    refillSummary: '{{count}} refill · {{cylinders}}',
    refillSummary_plural: '{{count}} refills · {{cylinders}}',
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
   * The van: Today's van row and My van (R9). Counts join with " · " and hide their zeros ("3 full · 1
   * empty · 1 part-filled"); each part is a whole phrase.
   */
  van: {
    /** Read by screen readers before the plate. */
    plate: 'Van {{plate}}',
    none: 'No van yet.',
    fullCount: '{{count}} full',
    fullCount_plural: '{{count}} full',
    emptyCount: '{{count}} empty',
    emptyCount_plural: '{{count}} empty',
    partCount: '{{count}} part-filled',
    partCount_plural: '{{count}} part-filled',
    noCylinders: 'No cylinders',
    /** The word beside My van's big number. */
    total: 'cylinder',
    total_plural: 'cylinders',
    nothing: 'Nothing on the van.',
    /** My van's groups, by state (R9). */
    group: {
      FULL: 'Full',
      EMPTY: 'Empty',
      PART_FILLED: 'Part-filled',
    },
    /** One size in a group: "11.8 kg · 2". */
    sizeCount: '{{size}} · {{n}}',
  },

  /** The trip (D6, R3): its steps in order, start and finish. */
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
    /** A step's line once it has begun (R3). */
    loadedOf: '{{done}} of {{total}} loaded',
    deliveredOf: '{{done}} of {{total}} delivered',
    goLoad: 'Load at store',
    goUnload: 'Unload at store',
    start: 'Start trip',
    starting: 'Starting…',
    finish: 'Finish trip',
    finishing: 'Finishing…',
    finishSheet: {
      title: 'Finish this trip?',
      /** The van is empty: only the no-undo part is left to say (R3). */
      bodyEmpty: "You can't scan for this trip after.",
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

  /** The step screens (Load, the visit, Unload), each with its camera. */
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

  /** Load (R4). */
  load: {
    /** Why "Done loading" is off, above it. */
    left: '{{count}} more to load',
    left_plural: '{{count}} more to load',
    /** The way out when the store is short, last on the screen. */
    missing: 'Missing some? Call office',
  },

  /** The visit (R5): on the way, deliver, take back, done. */
  visit: {
    /** Why "Finish visit" is off while giving. */
    left: '{{count}} more to deliver',
    left_plural: '{{count}} more to deliver',
    /** Under the disabled "Could not deliver" once a cylinder is given. */
    locked: 'You already gave some. Call office.',
    allDelivered: 'All {{count}} delivered',
    allDelivered_plural: 'All {{count}} delivered',
    /** A taken-back row: "AG-C0012 · 11.8 kg". */
    item: '{{shortCode}} · {{size}}',
    noLabel: {
      open: 'No label',
      title: 'No label or other brand',
      size: 'Size',
      state: 'State',
      count: 'How many',
      save: 'Save',
      saving: 'Saving…',
      cancel: 'Go back',
      /** A row of the lists, counted by size. */
      row: 'No label · {{count}} × {{size}}',
      row_plural: 'No label · {{count}} × {{size}}',
    },
    /** Fewer taken back than expected (rule 7). The reason's code is sent, not these words. */
    short: {
      title: 'Took back {{taken}} of {{expected}}',
      reason: {
        CUSTOMER_KEPT: 'Customer kept them',
        CUSTOMER_HAD_NONE: 'Customer had none',
        OTHER: 'Other',
      },
      note: 'What happened?',
      confirm: 'Finish visit',
      cancel: 'Go back',
    },
    /** The done card's two lines, no brackets (rulebook §5.1). */
    done: {
      gave: 'Gave {{given}} · Took back {{taken}}',
      states: '{{empty}} empty · {{part}} part-filled · {{full}} full',
    },
  },

  /** Unload (R7): the shop scans each cylinder in; the driver hands them over. */
  unload: {
    hint: 'Give each cylinder to the shop to scan.',
    group: {
      NOT_DELIVERED: 'Not delivered',
      EMPTY: 'Empty',
      PART_FILLED: 'Part-filled',
      FULL: 'Full',
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

  /** Refills (D13 list; R10 one refill on scans: pick up, fill, unload). No money anywhere. */
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
    /** The title of each step of a refill (the third is `driver.trip.unloadAt`). */
    step: {
      pickUp: 'Pick up empties at {{store}}',
      fill: 'Fill at {{station}}',
    },
    run: {
      pickupDone: 'Done picking up',
      fillDone: 'Done filling',
      /** Why "Done picking up" or "Done filling" is off, above it. */
      needOne: 'Scan a cylinder first.',
      /** Step 2 while none is filled: go to the unload without a fill (UX_MOBILE §8.2). */
      noneFilled: 'Bring back unfilled',
      /** Step 3 after "Bring back unfilled", while nothing is received: the undo (no server call). */
      backToFill: 'Back to filling',
      refillDone: 'Refill done',
    },
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
    noPhone: "The office number isn't loaded yet.",
    name: 'Name',
    phone: 'Mobile',
    van: 'Van',
    version: 'App version {{version}}',
    versionUpdate: 'App version {{version}} · update {{id}}',
  },
} as const;
