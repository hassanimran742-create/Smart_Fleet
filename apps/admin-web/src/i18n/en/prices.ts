/**
 * `prices`: copy for Delivery prices and the price drawer (UX_ADMIN §2.3). Owned by the admin-web-money
 * lane. Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('prices:…')` is
 * type-checked, so a missing key fails `tsc`.
 *
 * A price is a base per order plus an optional amount per full cylinder by size (ADR-08); a missing
 * price is always said in words ("Not set"), never by colour alone.
 */
export const prices = {
  page: {
    title: 'Delivery prices',
    subtitle: "What each distributor pays per order, by the customer's zone: a base per order, plus an optional amount per cylinder size.",
    loadFailed: "Couldn't load the delivery prices",
  },

  index: {
    emptyTitle: 'No distributors yet',
    emptyBody: 'Add a distributor first. Their delivery prices are set here.',
    addDistributor: 'Add distributor',
    loadFailed: "Couldn't load the distributors",
  },

  switcher: {
    label: 'Distributor',
    coverage: '{{priced}}/{{total}}',
    coverageLabel: '{{priced}} of {{total}} zones have a price',
    option: '{{name}} · {{priced}}/{{total}}',
  },

  missing_one:
    "{{count}} of {{total}} zones has no price for {{distributor}}. Customers in that zone can't be added, and orders there are blocked.",
  missing_other:
    "{{count}} of {{total}} zones have no price for {{distributor}}. Customers in those zones can't be added, and orders there are blocked.",
  showMissing: 'Show only missing',
  showArchived: 'Show archived zones',

  grid: {
    caption: "{{distributor}}'s delivery prices by zone",
    zone: 'Zone',
    base: 'Base per order',
    perCylinder: 'per cylinder',
    status: 'Status',
    changed: 'Last changed',
    action: 'Action',
    changedBy: '{{date}} by {{name}}',
    edit: 'Edit',
    set: 'Set price',
    view: 'View',
    archived: 'Archived',
    none: '—',
  },

  empty: {
    zonesTitle: 'No zones yet',
    zonesBody: 'Zones are loaded by the setup script. Ask engineering to load the agreed zone shapes.',
    missingTitle: 'Every zone has a price',
    missingBody: 'Turn off “Show only missing” to see every zone.',
  },

  drawer: {
    title: '{{distributor}} · Zone {{zone}}',
    zoneMissing: "We couldn't find this zone. It may have been removed.",
    notSet: "No price yet. Customers in this zone can't be added, and orders there are blocked.",
    lastChanged: 'Last changed {{date}} by {{name}}',
    lastChangedNoName: 'Last changed {{date}}',
    base: 'Base per order',
    baseHint: 'Charged once per order, from Rs 0 to {{max}}.',
    perCylinderTitle: 'Per cylinder (optional)',
    perCylinderHint: 'Added for each full cylinder of that size, at most {{max}}. Blank means Rs 0.',
    exampleTitle: 'Example',
    /** The live example; zero parts are left out, so a flat price reads only the base. */
    example: {
      both: 'An order of {{n}} × {{size}} costs {{base}} + {{n}} × {{per}} = {{total}}',
      baseOnly: 'An order of {{n}} × {{size}} costs {{base}}',
      sizeOnly: 'An order of {{n}} × {{size}} costs {{n}} × {{per}} = {{total}}',
      noSizes: 'An order costs {{base}}',
      /** Until the base is typed: Rs 0 is a real price, so a blank form never reads as "costs Rs 0". */
      needsBase: 'Type the base per order to see an example.',
    },
    note: 'New prices apply to orders placed from now on. Orders already placed keep their cost.',
    archived: 'This zone is archived. Its price is kept but not used, and applies again if the zone is reactivated.',
    save: 'Save price',
    saved: 'Price saved for Zone {{zone}}. New orders use it now.',
    offline: "Couldn't reach the server. Your entries are kept — try again.",
    stale: 'This price changed while you were looking.',
    reload: 'Reload',
    remove: 'Remove price…',
    removeTitle: 'Remove the price for Zone {{zone}}?',
    removeBody: 'Customers in {{zone}} will be blocked until a new price is set.',
    removeReason: 'Reason',
    removeReasonHint: 'Saved in the activity log.',
    removeConfirm: 'Remove price',
    removed: 'Price removed for Zone {{zone}}. Customers there are blocked until a new price is set.',
  },
} as const;
