/**
 * `refills`: the office's Refills page and drawer (`/refills`, `/refills/$refillId`; UX_ADMIN §4.1, Inc 2/3
 * spec §4.8), rebuilt in Inc 3 with the Orders pattern. Owned by the office UI lane.
 *
 * Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('refills:…')` is
 * type-checked. Refills carry no money (ADR-16): no cost, fee or price words here. The office only
 * assigns a driver; only the distributor cancels, before the first pickup, and the shop's receive scans
 * finish a refill (there is no "Mark complete" from Inc 3).
 */
export const refills = {
  title: 'Refills',
  tabsLabel: 'Refill lists',
  caption: 'Refills',
  loadFailed: "Couldn't load the refills",
  tabs: {
    needsDriver: 'Needs a driver',
    inProgress: 'In progress',
    done: 'Done',
    cancelled: 'Cancelled',
  },
  search: 'Refill number or distributor',
  columns: {
    refill: 'Refill',
    status: 'Status',
    distributor: 'Distributor',
    driver: 'Driver',
    requested: 'Requested',
    station: 'Station',
  },
  /** "2 × 11.8 kg", muted under the refill number. */
  cylinders: '{{count}} × {{size}}',
  driverVan: '{{driver}} · {{plate}}',
  /** Nothing to show: no driver yet, no number, no station. */
  none: '—',
  assign: 'Assign driver',
  // The status chip is the kit's (`status:refillStage.*`, `status:refillProgress.*` with its counts).
  empty: {
    needsDriver: 'No refills need a driver',
    inProgress: 'No refills in progress',
    done: 'No refills done yet',
    cancelled: 'No cancelled refills',
    search: {
      title: 'No refills match “{{q}}”',
      tab: 'Only {{tab}} was searched.',
    },
  },
  drawer: {
    title: 'Refill {{no}}',
    titleNoNumber: 'Refill',
    subtitle: '{{distributor}} · {{cylinders}} · {{station}}',
    subtitleNoStation: '{{distributor}} · {{cylinders}}',
    loadFailed: "Couldn't load this refill",
    notFound: "We couldn't find this refill. The link may be old.",
    timelineTitle: 'Timeline',
    showCylinders: 'Show cylinders',
    noCylinders: 'No cylinders picked up yet.',
    onlyOwner: 'Only {{distributor}} can cancel, before pickup.',
  },
  /** The drawer's timeline, with counts (UX_ADMIN §4.1). */
  timeline: {
    requested: 'Requested',
    assigned: 'Driver assigned',
    picked: 'Picked up {{done}} of {{total}}',
    filled: 'Filled {{done}} of {{total}}',
    back: 'Back at store {{done}} of {{total}}',
    done: 'Done',
    cancelled: 'Cancelled',
    reason: 'Reason: {{reason}}',
  },
  /** One picked cylinder in "Show cylinders". */
  line: {
    PICKED_UP: 'Picked up',
    FILLED: 'Filled',
    RETURNED: 'Back at store',
    /** Back at the store without a fill. */
    RETURNED_UNFILLED: 'Back at store · not filled',
    /** The step and its time: "Filled · 21 Oct, 10:42 am". */
    at: '{{step}} · {{time}}',
  },
  assignDialog: {
    title: 'Assign a driver to {{no}}',
    titleNoNumber: 'Assign a driver to the refill',
    summary: '{{distributor}} · {{cylinders}} · {{station}}',
    summaryNoStation: '{{distributor}} · {{cylinders}}',
    pickupAt: 'Picks up at: {{store}}',
    toast: '{{no}} assigned to {{driver}}',
    toastNoNumber: 'Refill assigned to {{driver}}',
  },
} as const;
