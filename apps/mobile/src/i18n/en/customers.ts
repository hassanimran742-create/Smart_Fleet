/**
 * `customers.*` copy: the Customers list (shop spec §K), Add customer and its delivery cost line
 * (UX_MOBILE §4 S8; §L, §M), the address picker sheet (§Q), New address (§R) and the map.
 * Owned by the mobile-distributor lane.
 *
 * Say "customer", never "client", and no zone names on any shop screen (UX_MOBILE §0; shop spec §3.5).
 */
export const customers = {
  /** S8b Customers, and New order step 1 (they share one list). */
  list: {
    title: 'Customers',
    search: 'Search name, mobile or area',
    searchA11y: 'Search customers',
    recent: 'Recent',
    all: 'All customers',
    /** The call button on a row (screen readers). */
    call: 'Call {{name}}',
    add: 'Add customer',
    empty: 'No customers yet.',
    noMatch: 'No customer matches “{{query}}”.',
  },

  /** A row that can't take an order, opened in place. */
  block: {
    noPrice: 'No delivery price here yet.',
    outside: 'Outside our delivery area.',
    noAddress: 'No delivery address yet.',
    changeAddress: 'Change address',
    addAddress: 'Add address',
  },

  /** S8 Add customer. */
  add: {
    title: 'Add customer',
    step1: 'Customer details',
    step2: 'Delivery location',
    name: 'Name',
    nameRequired: "Write the customer's name.",
    mobile: 'Mobile number',
    area: 'Area',
    notes: 'Notes',
    next: 'Next',
    phoneExists: '{{name}} already has this number.',
    useExisting: 'Use {{name}}',
    save: 'Save customer',
    saving: 'Saving…',
    saved: 'Customer saved',
  },

  /**
   * [Inc 2] S15b Edit customer (`PATCH /clients/:id`): Add customer step 1 in edit mode, reached from
   * the customer answer card's "Fix number". The field labels are `add.name`, `add.mobile` and `add.notes`.
   */
  edit: {
    title: 'Edit customer',
    /** AddMore's label when the customer has no note yet ("+ Add note"). */
    addNote: 'Add note',
    /** The caption under the read-only address: addresses are add-only in the pilot. */
    addressNote: 'New address? Use New order.',
    save: 'Save customer',
    saving: 'Saving…',
    saved: 'Customer saved',
  },

  /** The delivery spot: search, "Use my location", the map pin, and House and street. */
  location: {
    searchPlaceholder: 'Search area or street',
    searching: 'Searching…',
    noResults: 'No places found. Tap the map instead.',
    searchFailed: "Search isn't working. Tap the map instead.",
    useMyLocation: 'Use my location',
    locating: 'Finding your location…',
    locationDenied: 'Allow location in phone settings, or search.',
    locationFailed: "Couldn't find you. Search or tap the map.",
    mapHint: 'Tap the map to drop the pin.',
    mapA11y: 'Map. Tap to drop the delivery pin.',
    pin: 'Delivery spot',
    house: 'House and street',
    houseRequired: 'Write the house or street.',
  },

  /** The one line under the map (S8): `GET /pricing/quote?lat&lng`. */
  cost: {
    checking: 'Checking delivery area…',
    priced: 'Delivery cost {{base}} per order',
    perSize: '+ {{amount}} per {{size}} cylinder',
    /** Several sizes that all add the same amount. */
    perCylinder: '+ {{amount}} per cylinder',
    perSizeRange: '+ {{min}} to {{max}} per cylinder',
    outside: 'Outside our delivery area. Move the pin.',
    priceNotSet: 'No delivery price here yet.',
    error: "Couldn't check this spot.",
  },

  /** The address picker sheet (§Q) and New address (§R). */
  address: {
    title: 'Deliver to',
    addNew: 'New address',
    newTitle: 'New address',
    save: 'Save address',
    saving: 'Saving…',
    savedToast: 'Address saved',
    /** Read after the address that is chosen now. */
    current: 'Chosen',
  },

  /** The stand-in map (components/MapStub.tsx) for a build without the map. */
  map: {
    unavailable: 'Map preview unavailable',
    unavailableBody: 'Use the search above to set the delivery spot. The map comes back in a later app update.',
    selected: '{{label}} · {{lat}}, {{lng}}',
    selectedDefault: 'Selected spot',
  },
} as const;
