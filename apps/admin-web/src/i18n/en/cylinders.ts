/**
 * `cylinders`: Find cylinder (UX_ADMIN §3.5, website spec "Forward rules"): the search box at the top of
 * the menu and the page `/cylinders/find/$number`, with the holder now and the history in plain words.
 * Owned by the office UI lane.
 *
 * Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('cylinders:…')` is
 * type-checked. The page says "with …", never "holder" (rulebook §5.3), and uses the website's four
 * action words: Loaded · Delivered · Taken back · Unloaded. No "Handed", "Scanned into" or "pilot".
 */
export const cylinders = {
  find: {
    /** The search box's placeholder and its name for screen readers. */
    placeholder: 'Find cylinder',
  },
  page: {
    title: '{{no}} · {{size}}',
    loadFailed: "Couldn't load this cylinder",
    notFound: 'No cylinder {{no}}',
    notFoundHint: 'Type the full number, like AG-C0042.',
  },
  /** A cylinder's state; Damaged is FAULTY (the day-end sheet's word). */
  state: {
    FULL: 'Full',
    EMPTY: 'Empty',
    PART_FILLED: 'Part-filled',
    FAULTY: 'Damaged',
    LOST: 'Lost',
  },
  /** Where it is now: "With Sana · AG-0142 · since 10:58 am". */
  holder: {
    CLIENT: 'With {{name}} · since {{since}}',
    CLIENT_ORDER: 'With {{name}} · {{order}} · since {{since}}',
    VEHICLE: 'On van {{name}} · since {{since}}',
    STORE: 'In {{name}} · since {{since}}',
    CLIENT_NOW: 'With {{name}}',
    VEHICLE_NOW: 'On van {{name}}',
    STORE_NOW: 'In {{name}}',
  },
  responsible: 'Responsible driver: {{name}}',
  responsibleHint: 'Last loaded it onto a van',
  responsibleNone: 'Responsible driver: none',
  historyTitle: 'History',
  historyEmpty: 'Nothing yet.',
  /** One line per move, oldest first; each line also shows when and who. */
  history: {
    REGISTERED: 'Added to {{store}} as a new cylinder',
    REGISTERED_STATE: 'Added to {{store}} as a new cylinder · {{state}}',
    SCAN_OUT: 'Loaded onto van {{plate}} at {{store}}',
    SCAN_OUT_REFILL: 'Picked up for refill {{refill}} · van {{plate}}',
    DELIVERED: 'Delivered to {{customer}} · {{order}}',
    DELIVERED_NO_ORDER: 'Delivered to {{customer}}',
    PICKED_UP_EMPTY: 'Taken back from {{customer}} · {{state}}',
    PICKED_UP_EMPTY_NO_STATE: 'Taken back from {{customer}}',
    FILLED_AT: 'Filled at {{station}} · refill {{refill}}',
    FILLED_AT_NO_REFILL: 'Filled at {{station}}',
    /** A fill whose station the server couldn't name. */
    FILLED: 'Filled at the station · refill {{refill}}',
    FILLED_NO_REFILL: 'Filled at the station',
    SCAN_IN: 'Unloaded at {{store}}',
    SCAN_IN_REFILL: 'Back from refill {{refill}} at {{store}}',
    SCAN_IN_REFILL_FULL: 'Back from refill {{refill}} at {{store}} · now full',
    ADJUSTED_DAY: 'Fixed at day-end {{day}} · approved by {{name}}',
    ADJUSTED: 'Fixed at day-end · approved by {{name}}',
    OLDER: 'Older entry',
    /** How the move was recorded, after the line. */
    /** A cylinder added by an approved day-end sheet. */
    fromDayEnd: '{{line}} · from the day-end sheet',
    typed: '{{line}} · number typed',
    manual: '{{line}} · by the office: {{reason}}',
    manualNoReason: '{{line}} · by the office',
  },
  /** A place the server couldn't name. */
  unknownPlace: '—',
} as const;
