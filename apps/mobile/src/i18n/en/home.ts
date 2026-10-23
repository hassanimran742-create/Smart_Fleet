/**
 * `home.*` copy: the shop app's Home screen and tiles (UX_MOBILE §4 S2), its side menu, and the
 * Profile and Help screens (S12). Owned by the mobile-distributor lane.
 *
 * Keys follow `area.screen.element` and the object stays `as const`, so a missing key or a wrong
 * {{param}} fails the typecheck. Every counted string has a `_plural` form (v3 suffix, G16-04).
 */
export const home = {
  greeting: 'Salam, {{name}}',
  newOrder: 'New order',
  todayLabel: 'Today',
  today: '{{count}} active order',
  today_plural: '{{count}} active orders',
  tiles: {
    orders: 'My orders',
    ordersHelp: 'See and follow your orders',
    refills: 'Refill cylinders',
    refillsHelp: 'Send empty cylinders to be filled',
  },
  lowBalance: 'Your balance is low. New orders need enough money for the delivery cost.',
  /** [Inc 2] Open customer problems (S15), shown only while `features.confirmations` is on. */
  problems: '{{count}} customer problem',
  problems_plural: '{{count}} customer problems',
  problemsHelp: 'The office is looking into it',
  cases: {
    title: 'Customer problems',
    row: '{{shortCode}} · {{customer}}',
    since: 'since {{when}}',
    empty: 'No open customer problems.',
  },
  noStore: "Your store isn't set up yet. Call the office.",
  notActive: "This shop account isn't active. Call the office.",
  loadError: "Couldn't load your orders.",

  /** The side menu (S2 Menu): Wallet, My orders, Profile, Help and Sign out. */
  menu: {
    wallet: 'Wallet',
    walletHelp: 'Balance and history',
    orders: 'My orders',
    ordersHelp: 'Active and done',
    profile: 'Profile',
    profileHelp: 'Your shop details',
    help: 'Help',
    helpHelp: 'Call the office, how it works',
    signOut: 'Sign out',
  },

  /** S12 Profile: read-only. */
  profile: {
    title: 'Profile',
    name: 'Name',
    businessName: 'Business name',
    shopCode: 'Shop code',
    mobile: 'Mobile',
    store: 'Store',
    storeAddress: 'Store address',
    storeNotSet: 'Not set up yet',
    changeNote: 'To change these, call the office.',
  },

  /** S12 Help. The refund text follows `orders.deliveryStartedAt`, read from the app config. */
  help: {
    title: 'Help',
    contactTitle: 'Talk to the office',
    callOffice: 'Call the office',
    whatsApp: 'WhatsApp the office',
    hours: 'Office hours: {{hours}}',
    noPhone: "The office's number isn't set up in the app yet.",
    topupsTitle: 'How top-ups work',
    topupsBody:
      'Send money to the company account from Easypaisa or your bank app, then tell us in the app with Add money. The office finds the payment in the bank and adds it to your balance. Until then it shows as Being checked.',
    refundTitle: 'When you get the delivery cost back',
    refund: {
      FIRST_LOAD_SCAN:
        "The delivery cost is taken from your wallet when you place an order. You get it back only if you cancel before the driver starts loading at your store. After loading starts, it isn't returned, even if the customer refuses.",
      DRIVER_ASSIGNED:
        "The delivery cost is taken from your wallet when you place an order. You get it back only if you cancel before a driver is assigned. After that, it isn't returned, even if the customer refuses.",
      LEFT_STORE:
        "The delivery cost is taken from your wallet when you place an order. You get it back only if you cancel before the van leaves your store. After that, it isn't returned, even if the customer refuses.",
    },
    appTitle: 'This app',
    version: 'App version {{version}} · update {{id}}',
    versionNoUpdate: 'App version {{version}}',
    signOut: 'Sign out',
  },
} as const;
