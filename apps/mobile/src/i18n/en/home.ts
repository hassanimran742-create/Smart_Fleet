/**
 * `home.*` copy: the shop app's Home screen and tiles (UX_MOBILE §4 S2; shop spec §D), its side menu
 * (§E), and the Profile and Help screens (S12; §V, §W). Owned by the mobile-distributor lane.
 *
 * Keys follow `area.screen.element` and the object stays `as const`, so a missing key or a wrong
 * {{param}} fails the typecheck. Every counted string has a `_plural` form (v3 suffix, G16-04).
 */
export const home = {
  greeting: 'Salam, {{name}}',
  newOrder: 'New order',
  /** The chip beside the balance (§D): the rule it stands for shows on Check and place. */
  lowBalance: 'Low balance',

  /** A new shop's first steps (§D item 3), shown while it has no customers and no orders. */
  getStarted: {
    title: 'Get started',
    addMoney: 'Add money',
    addCustomer: 'Add a customer',
    newOrder: 'Place an order',
    /** Read after "Add money" once money is in or being checked. */
    done: 'Done',
  },

  tiles: {
    orders: 'My orders',
    /** What screen readers hear for the My orders tile with its count badge. */
    ordersA11y: 'My orders, {{count}} active',
    ordersA11y_plural: 'My orders, {{count}} active',
    customers: 'Customers',
    history: 'History',
    refills: 'Refills',
    /** [Inc 2] The Receive status row (S13; Inc 2/3 spec §2.1), while `features.scanFlow` is on. */
    receive: 'Receive from driver',
    /** The row's grey line, in bold brand text: the cylinders still on the vans. */
    receiveComing: '{{count}} coming back',
    receiveComing_plural: '{{count}} coming back',
    receiveNone: 'Nothing coming back',
    /** [Inc 3] The Day-end status row (S19), while `features.dayEnd` is on. */
    dayEnd: 'Day-end sheet',
    dayEndHelp: "Send today's count",
  },

  activeTitle: 'Active orders',
  moreOrders: '+{{count}} more',
  moreOrders_plural: '+{{count}} more',

  /** [Inc 2] Open customer problems (S15), the red Home row, only while `features.confirmations` is on. */
  problems: '{{count}} customer problem',
  problems_plural: '{{count}} customer problems',
  problemsHelp: 'The office will look into it',
  /** S15 Customer problems: who (the row), then the order and the note (the grey line). */
  cases: {
    title: 'Customer problems',
    row: '{{customer}}',
    sub: '{{shortCode}} · “{{comment}}”',
    empty: 'No customer problems.',
  },

  noStore: "Your store isn't set up yet.",
  notActive: "Your shop account isn't active.",

  /** The side menu (§E): Profile, Help and Sign out. Wallet and My orders are Home tiles. */
  menu: {
    profile: 'Profile',
    help: 'Help',
    signOut: 'Sign out',
  },

  /** S12 Profile, read-only (§V): icon rows; the labels are screen-reader prefixes only. */
  profile: {
    title: 'Profile',
    name: 'Name',
    businessName: 'Business name',
    mobile: 'Mobile',
    store: 'Store',
    storeAddress: 'Store address',
    storeNotSet: 'Not set up yet',
    changeNote: 'Only the office can change these.',
    /** A row as screen readers hear it: "Business name, Ahmed Gas". */
    rowA11y: '{{label}}, {{value}}',
  },

  /** S12 Help (§W). The refund line reuses `orders.new.refundRule.*`. */
  help: {
    title: 'Help',
    refundTitle: 'Delivery cost',
    topupsTitle: 'Top-ups',
    topupsBody: 'Being checked until the office adds it.',
    hours: 'Office hours {{hours}}',
    version: 'App version {{version}} · update {{id}}',
    versionNoUpdate: 'App version {{version}}',
    noPhone: "The office number isn't loaded yet.",
  },
} as const;
