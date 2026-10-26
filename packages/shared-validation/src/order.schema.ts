import { z } from 'zod';
import {
  isoDateTimeSchema,
  latSchema,
  lngSchema,
  optionalPaisaSchema,
  optionalTextSchema,
  pageQuerySchema,
  requireBothCoordinates,
  requireNoteFor,
  textSchema,
  uuidSchema,
} from './common.schema';
import {
  DELIVERY_FAILURE_REASONS,
  ORDER_BOARD_TABS,
  ORDER_CANCEL_REASONS,
  ORDER_LIST_TABS,
  ORDER_STATUSES,
} from './internal/codes';

export const geoPointSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
});
export type GeoPointInput = z.infer<typeof geoPointSchema>;

/** At most this many lines per order, one per size (API_CONTRACT §7.6). */
export const ORDER_MAX_LINES = 6;
/**
 * At most this many cylinders on one line (the setting's own maximum). The only cap on the order's
 * total is `orders.maxCylindersPerOrder`, checked by the service (`ORDER_TOO_MANY_CYLINDERS`).
 */
export const ORDER_LINE_MAX_COUNT = 100;

/** One size on an order: `fullCount` 1–100 delivered, `expectedReturnCount` 0–100 to take back. */
export const orderLineSchema = z.object({
  cylinderTypeId: uuidSchema,
  fullCount: z.number().int().min(1, 'ORDER_LINES_INVALID').max(ORDER_LINE_MAX_COUNT),
  expectedReturnCount: z.number().int().min(0).max(ORDER_LINE_MAX_COUNT),
});
export type OrderLineInput = z.infer<typeof orderLineSchema>;

const orderLinesSchema = z
  .array(orderLineSchema)
  .min(1, 'ORDER_LINES_INVALID')
  .max(ORDER_MAX_LINES, 'ORDER_LINES_INVALID')
  .superRefine((lines, ctx) => {
    const seen = new Set<string>();
    lines.forEach((line, index) => {
      if (seen.has(line.cylinderTypeId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'cylinderTypeId'], message: 'ORDER_LINES_INVALID' });
      }
      seen.add(line.cylinderTypeId);
    });
  });

/**
 * `POST /orders` and `POST /orders/quote` (distributor). The delivery spot is a saved `addressId` or a
 * new `deliveryLocation` pin, exactly one of them; the installed app's body (pin, label, lines) is valid.
 * `quotedTotalPaisa` is the cost the person saw: a different quote answers `PRICING_QUOTE_CHANGED`.
 * The total cylinder cap (`ORDER_TOO_MANY_CYLINDERS`) is a setting, checked by the service.
 */
export const createOrderSchema = z
  .object({
    clientId: uuidSchema,
    addressId: uuidSchema.optional(),
    deliveryLocation: geoPointSchema.optional(),
    deliveryLabel: textSchema(1, 255),
    lines: orderLinesSchema,
    quotedTotalPaisa: optionalPaisaSchema(),
    scheduledWindowStart: isoDateTimeSchema.optional(),
    scheduledWindowEnd: isoDateTimeSchema.optional(),
    note: optionalTextSchema(200),
  })
  .superRefine((order, ctx) => {
    if ((order.addressId === undefined) === (order.deliveryLocation === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['deliveryLocation'], message: 'INVALID_LOCATION' });
    }
    if (
      order.scheduledWindowStart !== undefined &&
      order.scheduledWindowEnd !== undefined &&
      Date.parse(order.scheduledWindowEnd) < Date.parse(order.scheduledWindowStart)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledWindowEnd'], message: 'END_BEFORE_START' });
    }
  });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** `POST /orders/quote` takes the same body as create. */
export const quoteOrderSchema = createOrderSchema;
export type QuoteOrderInput = CreateOrderInput;

/**
 * `POST /orders/:id/cancel` by the owning distributor. `OTHER` needs a note (3–300).
 * `confirmRefundPaisa` is the refund the person saw; a different one answers `ORDER_CANCEL_TERMS_CHANGED`.
 */
export const cancelOrderSchema = z
  .object({
    reasonCode: z.enum(ORDER_CANCEL_REASONS),
    note: optionalTextSchema(300, 3),
    confirmRefundPaisa: optionalPaisaSchema(),
  })
  .superRefine(requireNoteFor(['OTHER'], 3));
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

/** `POST /orders/:id/cancel` by the office: a note (5–300) is always required. */
export const officeCancelOrderSchema = z.object({
  reasonCode: z.enum(ORDER_CANCEL_REASONS),
  note: textSchema(5, 300),
  confirmRefundPaisa: optionalPaisaSchema(),
});
export type OfficeCancelOrderInput = z.infer<typeof officeCancelOrderSchema>;

/** `POST /orders/:id/fail` by the trip's driver. `OTHER` needs a note; a position needs both coordinates. */
export const failOrderSchema = z
  .object({
    reasonCode: z.enum(DELIVERY_FAILURE_REASONS),
    note: optionalTextSchema(300, 3),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
  })
  .superRefine((body, ctx) => {
    requireNoteFor(['OTHER'], 3)(body, ctx);
    requireBothCoordinates(body, ctx);
  });
export type FailOrderInput = z.infer<typeof failOrderSchema>;

/** `POST /orders/:id/fail` by the office: a note (5–300) is always required. */
export const officeFailOrderSchema = z
  .object({
    reasonCode: z.enum(DELIVERY_FAILURE_REASONS),
    note: textSchema(5, 300),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
  })
  .superRefine(requireBothCoordinates);
export type OfficeFailOrderInput = z.infer<typeof officeFailOrderSchema>;

/** `POST /orders/:id/assign-driver` (office). A legacy `originStoreId` is dropped: trips start at the home store. */
export const assignDriverSchema = z.object({
  driverId: uuidSchema,
  reason: optionalTextSchema(300),
});
export type AssignDriverInput = z.infer<typeof assignDriverSchema>;

/** `POST /orders/:id/manual-delivery` (office, the forgotten-IN path) `{ reason (10–300) }`. */
export const manualDeliverySchema = z.object({
  reason: textSchema(10, 300),
});
export type ManualDeliveryInput = z.infer<typeof manualDeliverySchema>;

/** A legacy status change to CANCELLED or FAILED may carry either kind of reason code. */
const STATUS_CHANGE_REASONS = [...ORDER_CANCEL_REASONS, ...DELIVERY_FAILURE_REASONS] as const;

/** `PATCH /orders/:id/status` (legacy, installed apps): the service applies the from-state rules. */
export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  reason: optionalTextSchema(500),
  reasonCode: z.enum(STATUS_CHANGE_REASONS).optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

/** `GET /orders?tab=active|done&cursor&limit` (distributor). Without `tab` the API returns a bare array. */
export const ordersQuerySchema = pageQuerySchema.extend({
  tab: z.enum(ORDER_LIST_TABS).optional(),
});
export type OrdersQuery = z.infer<typeof ordersQuerySchema>;

/** `GET /orders/board` (office). */
export const orderBoardQuerySchema = pageQuerySchema.extend({
  tab: z.enum(ORDER_BOARD_TABS).default('needs-driver'),
  q: optionalTextSchema(100),
  distributorId: uuidSchema.optional(),
});
export type OrderBoardQuery = z.infer<typeof orderBoardQuerySchema>;

/** `POST /dispatch/manual` (office) `{ orderId }`: one dispatcher run for one order, through assign-driver. */
export const manualDispatchSchema = z.object({ orderId: uuidSchema });
export type ManualDispatchInput = z.infer<typeof manualDispatchSchema>;
