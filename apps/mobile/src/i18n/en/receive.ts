/**
 * [Inc 2] `receive.*` copy: the shop app's Receive from driver list (UX_MOBILE §7.3 S13; Inc 2/3 spec
 * §2.2). Owned by the mobile-distributor lane. The scan screen's words (the hint, "AG-C0011 · 11.8 kg
 * received", "Already in your store", "All 2 received", "Type number", the size lines) are the
 * ScanPanel's `scan.*` keys (driver lane), so both apps scan in the same words. The Home row's words are
 * `home.tiles.receive*`.
 */
export const receive = {
  title: 'Receive from driver',
  /** A van coming back: "Kashif · LEA-101" (data); also the scan screen's header. */
  row: '{{driver}} · {{plate}}',
  progress: '{{done}} of {{total}} received',
  /** The chip on a van that brings back cylinders from a refill. */
  refill: 'Refill',
  /** The chip on a van whose cylinders are all in, until the next poll drops the van. */
  allDone: 'All received',
  empty: 'Nothing coming back right now.',
} as const;
