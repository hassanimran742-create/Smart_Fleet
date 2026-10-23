/**
 * Status words (foundation namespace; UX_MOBILE §3.4, §8.1, §8.3; UX_PRINCIPLES §4.2). The server
 * sends stable values and the phone maps them here; `ui/statusTables.ts` adds the tone and icon. A
 * value missing here shows the neutral `stages.unknown` chip. A chip has 1–3 words.
 */
export const stages = {
  /** `OrderStage` (deriveOrderStage). */
  order: {
    NEEDS_DRIVER: 'Waiting for driver',
    DRIVER_ASSIGNED: 'Driver assigned',
    LOADING: 'Loading',
    ON_THE_WAY: 'On the way',
    DELIVERED: 'Delivered',
    NOT_DELIVERED: 'Not delivered',
    CANCELLED: 'Cancelled',
  },

  /** `OrderFeeStatus`, as a chip. `{{fee}}` is the order's delivery cost. */
  fee: {
    DEDUCTED: '{{fee}} paid',
    REVERSED: '{{fee}} returned',
    NONE: 'No delivery cost',
  },

  /**
   * @deprecated `OrderFeeStatus`, long form. The order detail no longer shows it (shop spec §T):
   * delete once OrderDetailScreen stops reading it.
   */
  feeLong: {
    DEDUCTED: 'Paid from your wallet',
    REVERSED: 'Returned to your wallet',
    NONE: 'No delivery cost',
  },

  /** `PaymentDto.stage`. The NOT_ADDED reason comes from `topup.reason.<TopupRejectReason>`. */
  topup: {
    BEING_CHECKED: 'Being checked',
    ADDED: 'Added',
    NOT_ADDED: 'Not added',
  },

  /**
   * Driver step chips. An order that FAILED is NOT_DELIVERED; a stop or order CANCELLED is CANCELLED.
   * SKIPPED is the old single state for both: kept only until the driver screens stop sending it.
   */
  step: {
    TO_DO: 'To do',
    NEXT: 'Next',
    IN_PROGRESS: 'In progress',
    DONE: 'Done',
    NOT_DELIVERED: 'Not delivered',
    CANCELLED: 'Cancelled',
    /** @deprecated Use NOT_DELIVERED or CANCELLED. */
    SKIPPED: 'Skipped',
  },

  /** Customer answer [Inc 2]: a separate chip, never the order stage. */
  answer: {
    YES: 'Customer: all received',
    PARTLY: 'Customer: partly received',
    NO: 'Customer: not received',
    OTHER: 'Customer sent a note',
    PENDING: 'Waiting for customer',
    EXPIRED: 'No answer',
  },

  /** `RefillStage` (deriveRefillStage, API_CONTRACT §1.4), sent as `stage` on every refill from Inc 1. */
  refill: {
    NEEDS_DRIVER: 'Waiting for driver',
    DRIVER_ASSIGNED: 'Driver assigned',
    PICKING_UP: 'Picking up empties',
    PICKED_UP: 'Empties picked up',
    AT_STATION: 'At the station',
    COMING_BACK: 'Coming back',
    BACK_AT_STORE: 'Back at store',
    DONE: 'Done',
    CANCELLED: 'Cancelled',
  },

  /** Day-end status [Inc 3]. */
  dayEnd: {
    NOT_STARTED: 'Not sent',
    READY: 'Ready to send',
    WAITING_FOR_APPROVAL: 'Waiting for office',
    APPROVED: 'Approved · day closed',
    SENT_BACK: 'Sent back',
  },

  unknown: 'Updating…',
} as const;
