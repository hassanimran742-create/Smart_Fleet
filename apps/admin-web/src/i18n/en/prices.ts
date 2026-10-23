/**
 * `prices`: copy for Delivery prices and the price drawer (website spec W15–W17, UX_ADMIN §2.3). Owned by
 * the admin-web-money lane. Keep `as const` and the export name: i18n/index.ts imports it by name, and
 * `t('prices:…')` is type-checked, so a missing key fails `tsc`.
 *
 * A price is a base per order plus an optional amount per full cylinder by size (ADR-08); a missing
 * price is always said in words ("Not set", "1 missing"), never by colour alone.
 */
export const prices = {
  page: {
    title: 'Delivery prices',
    subtitle: 'What a distributor pays per order, by customer zone.',
    loadFailedFor: "Couldn't load {{distributor}}'s prices",
  },

  index: {
    emptyTitle: 'No distributors yet.',
    addDistributor: 'Add distributor',
    loadFailed: "Couldn't load delivery prices",
  },

  /** The distributor picker: chips up to 6 distributors, a search box beyond that. */
  switcher: {
    label: 'Distributor',
    missing_one: '{{count}} missing',
    missing_other: '{{count}} missing',
    complete: 'All set',
    /** The search box's rows: "Ahmed Gas · 1 missing". */
    option: '{{name}} · {{state}}',
  },

  missing_one: '{{count}} zone has no price. Customers there are blocked.',
  missing_other: '{{count}} zones have no price. Customers there are blocked.',

  filters: {
    label: 'Zones',
    all: 'All zones',
    missing_one: 'Missing ({{count}})',
    missing_other: 'Missing ({{count}})',
  },
  showArchived: 'Show archived',

  grid: {
    caption: "{{distributor}}'s delivery prices by zone",
    zone: 'Zone',
    base: 'Base per order',
    perCylinder: 'Per cylinder',
    /** "11.8 kg Rs 40", joined with " · ". */
    sizeAmount: '{{size}} {{amount}}',
    status: 'Status',
    action: 'Action',
    edit: 'Edit',
    set: 'Set price',
    view: 'View',
    archived: 'Archived',
    none: '—',
  },

  empty: {
    zonesTitle: 'No zones yet. Ask the tech team.',
    missingTitle: 'Every zone has a price.',
    showAll: 'Show all zones',
  },

  drawer: {
    title: '{{distributor}} · Zone {{zone}}',
    subtitleChanged: '{{city}} · changed {{date}} by {{name}}',
    subtitleChangedNoName: '{{city}} · changed {{date}}',
    zoneMissing: "We couldn't find this zone. It may have been removed.",
    copyFrom: 'Copy from…',
    /** "North · Rs 250 + per cylinder", "South · Rs 400". */
    copyOption: '{{zone}} · {{summary}}',
    copyWithSizes: '{{base}} + per cylinder',
    base: 'Base per order',
    baseMissing: 'Type the base per order.',
    addSizes: 'Add per-cylinder amounts',
    perCylinderTitle: 'Per cylinder',
    perCylinderHint: 'Blank means Rs 0.',
    exampleTitle: 'Example',
    /** The example, shown once the base is an amount; zero parts are left out. */
    example: {
      both: '{{n}} × {{size}}: {{base}} + {{n}} × {{per}} = {{total}}',
      baseOnly: 'Every order: {{base}}',
      sizeOnly: '{{n}} × {{size}}: {{n}} × {{per}} = {{total}}',
    },
    note: "New orders use this price. Placed orders don't change.",
    archived: 'This zone is archived. Its price is kept but not used.',
    save: 'Save price',
    saved: 'Price saved for Zone {{zone}}.',
    offline: "Couldn't reach the server. Your entries are kept — try again.",
    stale: 'This price changed while you were looking.',
    reload: 'Reload',
    remove: 'Remove price…',
    removeTitle: 'Remove the price for Zone {{zone}}?',
    removeBody: 'Customers in {{zone}} will be blocked until a new price is set.',
    removeReason: 'Why?',
    removeConfirm: 'Remove price',
    removed: 'Price removed for Zone {{zone}}.',
  },
} as const;
