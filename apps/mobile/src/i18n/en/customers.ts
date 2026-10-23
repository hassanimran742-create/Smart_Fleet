/**
 * `customers.*` copy: Add customer and its delivery cost panel (UX_MOBILE §4 S8), the delivery-address
 * picker of New order (S9 "Change address") and the map. Owned by the mobile-distributor lane.
 *
 * Say "customer", never "client" (UX_MOBILE §0).
 */
export const customers = {
  /** S8 Add customer. */
  add: {
    title: 'Add customer',
    step1: 'Customer details',
    step2: 'Delivery location',
    name: 'Name',
    nameRequired: "Write the customer's name.",
    mobile: 'Mobile',
    area: 'Area',
    areaPlaceholder: 'e.g. Model Town',
    notes: 'Notes',
    next: 'Next',
    back: 'Back',
    phoneExists: '{{name}} already has this number.',
    useExisting: 'Use {{name}}',
    save: 'Save customer',
    saving: 'Saving…',
    saved: 'Customer saved',
  },

  /** The delivery spot: search, "Use my location", the map pin and the house / street line. */
  location: {
    search: 'Search',
    searchPlaceholder: 'Area or street, e.g. Model Town',
    searching: 'Searching…',
    noResults: 'No places found. Try another name, or drop the pin on the map.',
    searchFailed: "Search isn't working right now. Drop the pin on the map instead.",
    useMyLocation: 'Use my location',
    locating: 'Finding your location…',
    locationDenied: 'Allow location for this app in your phone settings, or search instead.',
    locationFailed: "Couldn't find your location. Search or drop the pin instead.",
    mapHint: 'Tap the map to drop the pin where deliveries go. Drag the pin to move it.',
    mapA11y: 'Map. Tap to drop the delivery pin.',
    pin: 'Delivery spot',
    house: 'House / street',
    housePlaceholder: 'e.g. House 14, Street 5',
    houseRequired: 'Write the house or street.',
    noPin: 'Drop the pin to see the delivery cost.',
  },

  /** The live cost panel (S8): `GET /pricing/quote?lat&lng`. */
  cost: {
    checking: 'Checking delivery area…',
    priced: 'Zone {{zone}} · Delivery cost {{base}} per order',
    perSize: '+ {{amount}} per {{size}} cylinder',
    outside: 'This location is outside our delivery area. Move the pin or call the office.',
    priceNotSet:
      "No delivery price is set for zone {{zoneName}} yet. You can't add this customer until the office sets it.",
    priceNotSetAddress:
      "No delivery price is set for zone {{zoneName}} yet. You can't deliver here until the office sets it.",
  },

  /** S9 "Change address": the customer's saved addresses, or a new pin. */
  address: {
    title: 'Delivery address',
    saved: 'Saved addresses',
    none: 'No saved addresses yet.',
    zone: 'Zone {{zone}}',
    addNew: 'Add a new address',
    newTitle: 'New address',
    save: 'Save address',
    saving: 'Saving…',
    savedToast: 'Address saved',
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
