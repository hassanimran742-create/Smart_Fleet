/**
 * `today`: copy for Today (UX_ADMIN §2.1). Owned by the admin-web-ops lane.
 *
 * Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('today:…')` is
 * type-checked, so a missing key fails `tsc`. Counted strings have `_one` and `_other` forms
 * (i18next 23 plurals, UX_ADMIN §1.6), chosen by the `count` param.
 */
export const today = {
  title: 'Today · {{date}}',
  titleNoDate: 'Today',
  loadFailed: "Couldn't load today's figures",
  needsYou: {
    heading: 'Needs you',
  },
  cards: {
    topups: {
      title_one: '{{count}} top-up to check',
      title_other: '{{count}} top-ups to check',
      oldest: 'Oldest waiting {{wait}}',
      action: 'Check top-ups',
    },
    orders: {
      title_one: '{{count}} order needs a driver',
      title_other: '{{count}} orders need a driver',
      oldest: 'Oldest placed {{ago}}',
      action: 'Assign drivers',
    },
    problems: {
      title_one: '{{count}} customer problem',
      title_other: '{{count}} customer problems',
      oldest: 'Oldest reported {{wait}} ago',
      action: 'Open problems',
    },
    prices: {
      title_one: '{{distributor}}: {{count}} zone has no delivery price',
      title_other: '{{distributor}}: {{count}} zones have no delivery price',
      body: "Customers there can't be added and orders are blocked.",
      action: 'Set prices',
    },
    notStarted: {
      title: "{{name}} hasn't started yet",
      body: 'Finish the checklist and activate.',
      action: 'Open',
    },
  },
  allClear: {
    title: 'All caught up',
    body: 'New top-ups and orders show up here by themselves.',
    bodyWithProblems: 'New top-ups, orders and customer problems show up here by themselves.',
  },
  soFar: {
    heading: 'Today so far',
    orders: 'Orders placed',
    delivered: 'Delivered',
    ordersValue: 'Orders placed {{placed}} · Delivered {{delivered}}',
    costs: 'Delivery costs taken',
    costsHint: 'Costs taken today, minus costs returned on cancels.',
    topups: 'Top-ups approved',
    topupsCount_one: '{{count}} top-up',
    topupsCount_other: '{{count}} top-ups',
    drivers: 'Drivers on duty',
    driversValue: '{{onDuty}} of {{total}}',
  },
} as const;
