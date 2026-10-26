/**
 * `problems`: Customer problems (`/problems`, UX_ADMIN §3.3, Inc 2/3 spec §3.1) and the customer's answer
 * chip that the Orders board, the order drawer and this page share (UX_ADMIN §3.1). Owned by the office
 * UI lane.
 *
 * Keep `as const` and the export name: i18n/index.ts imports it by name, and `t('problems:…')` is
 * type-checked. The website says "problem", never "case" (rulebook §5.3). A problem is a record only:
 * nothing here offers a refund, a charge or a correction (ADR-15).
 */
export const problems = {
  title: 'Customer problems',
  caption: 'Customer problems, oldest first',
  loadFailed: "Couldn't load the customer problems",
  columns: {
    waiting: 'Waiting',
    order: 'Order',
    customer: 'Customer',
    answer: 'Answer',
    note: "Customer's note",
  },
  /** The row's one action; it opens the dialog, so it ends with "…". */
  action: 'Mark as sorted…',
  /** Read out on each row's button, so every button names its order. */
  actionFor: 'Mark {{no}} as sorted…',
  /** The order number opens the order drawer. */
  openOrder: 'Open order {{no}}',
  quoted: '“{{note}}”',
  noNote: '—',
  sort: {
    title: 'Mark {{no}} as sorted?',
    note: 'What did you do?',
    confirm: 'Mark as sorted',
    toast: 'Problem on {{no}} marked as sorted.',
  },
  empty: {
    title: 'No customer problems',
  },
} as const;
