import { z } from 'zod';
import { optionalTextSchema, optionalUuidSchema, textSchema } from './common.schema';
import { TICKET_STATUSES } from './internal/codes';

/** `POST /support` `{ subject, body, subjectType?, subjectId?, priority? }` (switched off: `features.support`). */
export const createTicketSchema = z.object({
  subject: textSchema(1, 120),
  body: textSchema(1, 2000),
  subjectType: optionalTextSchema(40).transform((value) => value ?? 'GENERAL'),
  subjectId: optionalUuidSchema,
  priority: z.number().int().min(1).max(5).optional(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/** `GET /support?status=`. */
export const ticketsQuerySchema = z.object({ status: z.enum(TICKET_STATUSES).optional() });
export type TicketsQuery = z.infer<typeof ticketsQuerySchema>;

/** `PATCH /support/:id/status` (office) `{ status }`. */
export const ticketStatusSchema = z.object({ status: z.enum(TICKET_STATUSES) });
export type TicketStatusInput = z.infer<typeof ticketStatusSchema>;
