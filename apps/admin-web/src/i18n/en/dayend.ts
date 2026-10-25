/**
 * `dayend`: the office's Day-end list and review (`/day-end`, `/day-end/$dayEndId`; UX_ADMIN §4.3, Inc 2/3
 * spec §4.9–§4.10). Owned by the office UI lane.
 *
 * Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('dayend:…')` is
 * type-checked. Day-end never moves money and never refuses a scan (ADR-17). Approve, send back and
 * reopen each ask first (rulebook rule 7); counted strings have `_one` and `_other` forms, so a day with
 * one fix never reads "1 fixes".
 */
export const dayend = {
  title: 'Day-end',
  tabsLabel: 'Day-end lists',
  caption: 'Day-end sheets',
  loadFailed: "Couldn't load the day-ends",
  tabs: {
    toApprove: 'To approve',
    open: 'Open',
    approved: 'Approved',
  },
  columns: {
    day: 'Day',
    distributor: 'Distributor',
    status: 'Status',
    differences: 'Differences',
    uploaded: 'Uploaded',
  },
  /** "8:40 am · Ali Raza". */
  uploaded: '{{time}} · {{name}}',
  noUpload: '—',
  actions: {
    review: 'Review',
    /** Read out on each row's button. */
    reviewFor: 'Review {{distributor}} · {{day}}',
  },
  empty: {
    toApprove: 'No day-end to approve.',
    open: 'No open days.',
    approved: 'No approved days yet.',
  },
  // The day-end chip is the kit's `status:dayEnd.*` (rulebook §4.2).
  review: {
    title: '{{distributor}} · {{day}}',
    meta: 'Version {{version}} · uploaded {{time}}',
    approve_one: 'Approve and lock · {{count}} fix',
    approve_other: 'Approve and lock · {{count}} fixes',
    approveNone: 'Approve and lock',
    sendBack: 'Send back…',
    reopen: 'Reopen…',
    stats: {
      inStore: 'In store',
      onVans: 'On vans',
      withCustomers: 'With customers',
      differences: 'Differences',
    },
    info: 'Nothing changes until you approve.',
    download: 'Download:',
    files: {
      upload: 'Uploaded sheet',
      app: "App's sheet",
    },
    loadFailed: "Couldn't load this day-end",
    caption: 'Differences between the app and the sheet',
    noDifferences: 'No differences.',
    columns: {
      cylinder: 'Cylinder',
      app: 'App says',
      sheet: 'Sheet says',
      fix: 'Fix',
      note: 'Note',
      lastScan: 'Last scan',
    },
    /** "AG-C0020 · 11.8 kg". */
    cylinder: '{{no}} · {{size}}',
    diff: {
      PLACE_DIFFERS: 'In a different place',
      STATE_DIFFERS: 'State differs',
      PLACE_AND_STATE_DIFFER: 'Place and state differ',
      UNKNOWN_CYLINDER: 'Number not in the app',
    },
    place: {
      STORE: 'In store',
      VAN: 'On a van',
      CUSTOMER: 'With customer',
      NOT_FOUND: 'Missing',
    },
    state: {
      FULL: 'Full',
      EMPTY: 'Empty',
      PART_FILLED: 'Part-filled',
      FAULTY: 'Damaged',
      LOST: 'Lost',
    },
    /** What the app or the sheet says: "In store · Full", "On a van · Full · LEA-101". */
    says: {
      placeState: '{{place}} · {{state}}',
      placeStateWhere: '{{place}} · {{state}} · {{where}}',
      placeWhere: '{{place}} · {{where}}',
    },
    notInApp: '—',
    fix: {
      MOVE_TO_STORE: 'Move to {{store}}',
      MOVE_TO_STORE_STATE: 'Move to {{store}} and set to {{state}}',
      SET_STATE: 'Set to {{state}}',
      MARK_LOST: 'Mark as lost',
      REGISTER: 'Add to {{store}} as new cylinder',
      NOTE_ONLY: 'Check by hand',
    },
    /** The home store, until the distributor's page has loaded. */
    theStore: 'the store',
    skipped: 'Skipped · moved since sheet',
    filter: {
      label: 'Kind of difference',
      all: 'All',
      place: 'Place',
      state: 'State',
      newNumber: 'New number',
    },
    approveDialog: {
      title: 'Approve and lock {{day}}?',
      body_one: '{{count}} fix. Later changes need a reopen.',
      body_other: '{{count}} fixes. Later changes need a reopen.',
      bodyNone: 'Later changes need a reopen.',
      confirm: 'Approve and lock',
      toast: '{{day}} approved · day closed',
    },
    sendBackDialog: {
      title: 'Send back to {{distributor}}?',
      field: 'What should they fix?',
      confirm: 'Send back',
      toast: 'Sent back to {{distributor}}',
    },
    reopenDialog: {
      title: 'Reopen {{day}}?',
      body: '{{distributor}} can upload again. Fixes made stay.',
      field: 'Why reopen?',
      confirm: 'Reopen day',
      toast: 'Day reopened',
    },
    versionChanged: '{{distributor}} uploaded a new version at {{time}}.',
    loadNew: 'Load new version',
    registered_one: '{{count}} new cylinder added. Print its label in Cylinders & labels.',
    registered_other: '{{count}} new cylinders added. Print their labels in Cylinders & labels.',
  },
} as const;
