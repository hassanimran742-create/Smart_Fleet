/**
 * `activity`: the Activity log page and one plain sentence per audit action (website spec W40, UX_ADMIN
 * §2.9). Owned by the
 * admin-web-money lane. Keep `as const` and the export name: i18n/index.ts imports it by name.
 *
 * Sentences live at `activity:<action>` (`topup.approve` is `{ topup: { approve } }`). Both
 * `activitySentence(row)` in src/ui (the per-record `<ActivityList />`) and the Activity page render them
 * with the row's own params: its scalar `diff` fields, then `diff.after`'s (which win), with `*Paisa`
 * keys formatted as money without the suffix (`creditedPaisa` gives `{{credited}}`), plus `reason`. The
 * diff keys each template expects are noted beside it; they are what the API writes today.
 *
 * - Codes become words through i18next nesting, `$t(activity:parts.…{{code}})`, so the shared
 *   `<ActivityList />` needs no code for them.
 * - The Activity page adds what a row doesn't carry and asks for a context variant: `_log` adds the
 *   distributor's name, `setting.update_values` the setting's label and values, `wallet.check_clean` /
 *   `_mismatch` the result (features/activity/sentences.ts).
 * - Counted sentences have `_one` and `_other` forms (G16-04); the API's diff carries `count`.
 * - An action with no sentence here shows as its code in words.
 */
export const activity = {
  page: {
    title: 'Activity log',
    subtitle: 'Who changed what, and why.',
    loadFailed: "Couldn't load the activity log",
  },

  /** The filter names are read out only; the chips and the "Anyone" box speak for themselves. */
  filters: {
    what: 'What',
    who: 'Who',
    date: 'Date',
    anything: 'Everything',
    anyone: 'Anyone',
    anyDate: 'Any date',
    office: 'Office',
    distributors: 'Distributors',
    drivers: 'Drivers',
    shopUser: '{{name}} · {{shop}}',
  },

  /** The "What" filter (`?what=`). */
  areas: {
    money: 'Money',
    orders: 'Orders',
    expenses: 'Expenses',
    settings: 'Settings',
    people: 'People',
  },

  table: {
    caption: 'Activity, newest first',
    when: 'When',
    who: 'Who',
    what: 'What happened',
    why: 'Why',
  },

  empty: {
    title: 'Nothing has been recorded yet',
    filteredTitle: 'Nothing matches these filters',
  },

  more: {
    lookFurther: 'Look further back',
    scanning: 'Looking further back…',
  },

  // ---- Sentences, by action -------------------------------------------------------------------

  topup: {
    /** diff { shortCode, amountPaisa, payerChannel? } */
    request: 'Sent top-up request {{shortCode}} for {{amount}}',
    /** diff { shortCode, amountPaisa, creditedPaisa, bankReference, amountDiffered } */
    approve: 'Approved top-up {{shortCode}}: {{credited}} (bank ref {{bankReference}})',
    approve_log: 'Approved top-up {{shortCode}}: {{credited}} for {{distributor}} (bank ref {{bankReference}})',
    /** diff { shortCode, amountPaisa, reasonCode, note? } */
    reject: 'Rejected top-up {{shortCode}} ($t(activity:reasons.topup.reject.{{reasonCode}}))',
  },

  wallet: {
    /** diff { direction, amountPaisa, reasonCode, related…? }, after { balancePaisa } */
    correction: '$t(activity:parts.correction.{{direction}}): $t(activity:reasons.wallet.correction.{{reasonCode}})',
    correction_log:
      '$t(activity:parts.correctionFor.{{direction}}): $t(activity:reasons.wallet.correction.{{reasonCode}})',
    /** The inc1a migration's opening entry: diff { ledgerEntryId, amountPaisa } */
    opening_entry: 'Recorded the opening balance: {{amount}}',
    /** The nightly job: diff { checked, mismatches, distributorIds }; the page picks the variant. */
    check: 'Nightly wallet check',
    check_clean_one: 'Nightly wallet check: {{count}} wallet checked, it matches its history',
    check_clean_other: 'Nightly wallet check: {{count}} wallets checked, all match',
    check_mismatch_one: "Nightly wallet check: {{count}} of {{checked}} wallets doesn't match its history",
    check_mismatch_other: "Nightly wallet check: {{count}} of {{checked}} wallets don't match their history",
  },

  price: {
    /** diff { distributor, zone }, after { basePaisa, sizes, note } */
    set: "Set {{distributor}}'s price in {{zone}}: base {{base}}",
    /** diff { distributor, zone } */
    remove: "Removed {{distributor}}'s price in {{zone}}",
  },

  zone: {
    /** diff { zone } */
    create: 'Added zone {{zone}}',
    update: 'Changed zone {{zone}}',
    archive: 'Archived zone {{zone}}',
    reactivate: 'Reactivated zone {{zone}}',
  },

  order: {
    /** diff { no, totalPaisa, zone } */
    create: 'Placed {{no}} · {{total}} taken from the wallet',
    /** diff { no, driver } */
    assign: 'Assigned {{no}} to {{driver}}',
    /** diff { no, from, to } */
    reassign: 'Moved {{no}} from {{from}} to {{to}}',
    /** diff { no, reasonCode, refunded, refundPaisa, startedRule } */
    cancel: 'Cancelled {{no}} · $t(activity:parts.cancelRefund.{{refunded}})',
    /** diff { no, reasonCode } */
    fail: 'Marked {{no}} not delivered',
    /** diff { no } */
    manual_delivery: 'Recorded delivery of {{no}} by office',
  },

  trip: {
    /** diff { orderIds, count, driver } */
    abort: "Stopped {{driver}}'s trip",
    abort_one: "Stopped {{driver}}'s trip: {{count}} order needs a driver again",
    abort_other: "Stopped {{driver}}'s trip: {{count}} orders need a driver again",
  },

  refill: {
    /** diff { distributor, count, size } (+ driver for assign) */
    create: '{{distributor}} asked for a refill: {{count}} × {{size}}',
    assign: "Assigned {{distributor}}'s refill ({{count}} × {{size}}) to {{driver}}",
    complete: "Marked {{distributor}}'s refill ({{count}} × {{size}}) complete",
    cancel: '{{distributor}} cancelled a refill ({{count}} × {{size}})',
  },

  expense: {
    /** after { amountPaisa, typeName, … } */
    create: 'Added {{typeName}} expense {{amount}}',
    /** diff { typeName, amountPaisa } (the expense as it now reads); before/after hold the changed fields */
    update: 'Edited {{typeName}} expense {{amount}}',
    /** diff { expenseDate, amountPaisa, typeName } */
    void: 'Removed {{typeName}} expense {{amount}}',
  },

  expense_type: {
    /** after { name } */
    create: 'Added expense type {{name}}',
    rename: 'Renamed an expense type to {{name}}',
    archive: 'Archived expense type {{name}}',
    restore: 'Restored expense type {{name}}',
  },

  setting: {
    /** diff { key, from, to }: the page adds the label and the values in words. */
    update: 'Changed a setting',
    update_values: 'Changed {{setting}} from {{from}} to {{to}}',
    update_named: 'Changed {{setting}}',
  },

  distributor: {
    /** diff { distributor, code } */
    create: 'Added distributor {{distributor}} ({{code}})',
    /** diff { distributor } */
    update: "Edited {{distributor}}'s contact details",
    store_update: "Edited {{distributor}}'s store",
    /** diff { distributor, from, to } */
    code_change: "Changed {{distributor}}'s distributor code from {{from}} to {{to}}",
    /** diff { from, distributor }: from PENDING activates, from SUSPENDED reactivates */
    activate: '$t(activity:parts.activate.{{from}})',
    suspend: 'Suspended {{distributor}}',
  },

  driver: {
    /** after { name, … } */
    create: 'Added driver {{name}}',
    /** diff { name } (after.name wins when the name changed) */
    update: 'Edited driver {{name}}',
    /** diff { name } */
    archive: 'Archived driver {{name}}',
    /** diff { name } */
    reactivate: 'Reactivated driver {{name}}',
  },

  user: {
    /** diff { name }, after { status } */
    status_change: "Set {{name}}'s account to $t(activity:parts.userStatus.{{status}})",
    /** diff { name }, after { role } */
    role_change: "Changed {{name}}'s role to $t(activity:parts.role.{{role}})",
    /** diff { name, role } */
    password_reset: 'New app password for {{name}} ($t(activity:parts.loginOf.{{role}}))',
    /** after { name } */
    create_office: 'Added office user {{name}}',
  },

  client: {
    phone_needs_fix: "Flagged a customer's phone number to fix",
    update: "Edited a customer's details",
  },

  cylinders: {
    /** diff { count, state, distributor } */
    bulk_register: "Added new cylinders to {{distributor}}'s store",
    bulk_register_one: "Added {{count}} new cylinder to {{distributor}}'s store",
    bulk_register_other: "Added {{count}} new cylinders to {{distributor}}'s store",
  },

  // Inc 2 (G07-22): the diff keys are those the Inc 2 lane writes; `answer` is a ConfirmationResponse.
  custody: {
    typed_entry: 'Typed a cylinder number instead of scanning',
    manual_event: 'Moved a cylinder in an office delivery',
  },
  // The order's number: the row's `no` when the API writes one, else the customer's link label ("link:AG-0001");
  // the page then asks for the `_order` variant (features/activity/sentences.ts).
  confirmation: {
    /** diff { response } */
    answer: 'Customer answered “$t(activity:parts.answer.{{response}})”',
    answer_order: 'Customer answered “$t(activity:parts.answer.{{response}})” for {{no}}',
    /** diff { tokenVersion, send } */
    new_link: 'Made a new customer link',
    new_link_order: 'Made a new customer link for {{no}}',
  },
  case: {
    /** diff { orderId }, the note as the reason */
    resolve: 'Marked a customer problem as sorted',
    resolve_order: 'Marked the problem on {{no}} as sorted',
  },

  // Inc 3
  day: {
    submit: 'Sent a day-end sheet for approval',
    approve: 'Approved a day-end sheet and locked the day',
    send_back: 'Sent a day-end sheet back',
    reopen: 'Reopened a locked day',
  },
  pilot: {
    setup: 'Loaded the starting data',
    reset: 'Reset the test data',
  },

  // ---- Words the sentences nest -----------------------------------------------------------------

  parts: {
    cancelRefund: { true: '{{refund}} returned', false: 'no refund' },
    activate: {
      PENDING: 'Activated {{distributor}}',
      SUSPENDED: 'Reactivated {{distributor}}',
      ACTIVE: 'Activated {{distributor}}',
    },
    correction: { ADD: 'Added {{amount}} as a correction', TAKE: 'Took {{amount}} as a correction' },
    correctionFor: { ADD: 'Added {{amount}} for {{distributor}}', TAKE: 'Took {{amount}} from {{distributor}}' },
    userStatus: { PENDING: 'not active yet', ACTIVE: 'active', SUSPENDED: 'suspended' },
    role: {
      SUPER_ADMIN: 'super admin',
      ADMIN: 'admin',
      DISPATCHER: 'dispatcher',
      STORE_KEEPER: 'store keeper',
      DISTRIBUTOR: 'distributor',
      DRIVER: 'driver',
      CLIENT: 'customer',
    },
    loginOf: {
      DISTRIBUTOR: 'distributor',
      DRIVER: 'driver',
    },
    answer: { YES: 'All received', PARTLY: 'Partly received', NO: 'Not received', OTHER: 'Other problem' },
  },

  /**
   * Reason codes in words, by action (`reasons.<action>.<CODE>`). The sentences nest them, and the Why
   * column uses them when a row's reason is only its code (a shop cancel without a note, for example).
   */
  reasons: {
    topup: {
      reject: {
        NOT_IN_BANK: 'Money not found in the bank',
        AMOUNT_DIFFERENT: "Amount doesn't match",
        NAME_DIFFERENT: "Name on the account doesn't match",
        DUPLICATE: 'Duplicate request',
        OTHER: 'Other',
      },
    },
    wallet: {
      correction: {
        WRONG_TOPUP_APPROVAL: 'Top-up approved by mistake',
        SYSTEM_ERROR: 'System error',
        BANK_REVERSAL: 'Bank reversed a top-up',
        OPENING_BALANCE: 'Opening balance',
        OTHER: 'Other',
      },
    },
    order: {
      cancel: {
        CUSTOMER_CANCELLED: 'Customer cancelled',
        WRONG_ORDER: 'Wrong order',
        DUPLICATE: 'Duplicate order',
        OUT_OF_STOCK: 'Out of stock at the store',
        OTHER: 'Other',
      },
      fail: {
        CUSTOMER_NOT_HOME: 'Customer not home',
        CUSTOMER_REFUSED: 'Customer refused',
        WRONG_ADDRESS: 'Wrong address',
        NOT_REACHABLE: "Couldn't reach the customer",
        VAN_PROBLEM: 'Van problem',
        OTHER: 'Other',
      },
    },
  },
} as const;
