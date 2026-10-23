/**
 * `today`: copy for Today (UX_ADMIN §2.1, website spec W05). Owned by the admin-web-ops lane.
 *
 * Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('today:…')` is
 * type-checked, so a missing key fails `tsc`. Counted strings have `_one` and `_other` forms
 * (i18next 23 plurals, UX_ADMIN §1.6), chosen by the `count` param.
 *
 * A card is a big count, then its label: "4" · "top-ups to check". The count is data, so the label
 * carries no number of its own.
 */
export const today = {
  title: 'Today · {{date}}',
  loadFailed: "Couldn't load today's figures",
  cards: {
    topups: {
      label_one: 'top-up to check',
      label_other: 'top-ups to check',
      oldest: 'Oldest {{wait}}',
      action: 'Check top-ups',
    },
    orders: {
      label_one: 'order needs a driver',
      label_other: 'orders need a driver',
      oldest: 'Oldest {{wait}}',
      action: 'Assign drivers',
    },
    /** Inc 2: open customer problems (`summary.problems`, absent before Inc 2). */
    problems: {
      label_one: 'customer problem',
      label_other: 'customer problems',
      oldest: 'Oldest {{wait}}',
      action: 'Check problems',
    },
    prices: {
      label_one: 'zone has no price',
      label_other: 'zones have no price',
      /** One distributor in the detail line, "Ahmed Gas 1"; the items are joined with " · ". */
      item: '{{distributor}} {{zones}}',
      action: 'Set prices',
    },
    waiting: {
      label_one: 'distributor to activate',
      label_other: 'distributors to activate',
      action: 'Finish setup',
    },
    /** After the names that fit: "+2 more". */
    more_one: '+{{count}} more',
    more_other: '+{{count}} more',
  },
  allClear: {
    title: 'All caught up.',
    /** While the figures can't refresh: the all-clear is only as new as the last good load. */
    stale: 'Nothing waiting at {{time}}.',
  },
  soFar: {
    heading: 'Today so far',
    orders: 'Orders placed',
    delivered: 'Delivered',
    costs: 'Delivery costs',
    topups: 'Top-ups approved',
    topupsCount_one: '{{count}} top-up',
    topupsCount_other: '{{count}} top-ups',
    drivers: 'Drivers on duty',
    driversValue: '{{onDuty}} of {{total}}',
  },
} as const;
