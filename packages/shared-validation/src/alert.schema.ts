import { z } from 'zod';
import { optionalTextSchema, optionalUuidSchema, paisaSchema, textSchema } from './common.schema';
import { ALERT_RULE_KINDS, ALERT_SEVERITIES, ALERT_STATUSES } from './internal/codes';

/**
 * Balances can't go negative (ADR-06), so a "credit over" rule can never fire: it can't be created or
 * set active (VALIDATION_FAILED, field code NOT_ALLOWED), and the evaluator skips old ones (inc1a
 * backfill 12 switched them off). API_CONTRACT §7.2.
 */
export const RETIRED_ALERT_RULE_KIND = 'DISTRIBUTOR_CREDIT_OVER' satisfies (typeof ALERT_RULE_KINDS)[number];

/** `GET /alerts` query (office): `status` and `severity` filters. */
export const alertsQuerySchema = z.object({
  status: z.enum(ALERT_STATUSES).optional(),
  severity: z.enum(ALERT_SEVERITIES).optional(),
});
export type AlertsQuery = z.infer<typeof alertsQuerySchema>;

/** The rule's threshold: paisa for a balance rule, a cylinder count for a stock rule. */
const thresholdSchema = paisaSchema();

/** `POST /alert-rules` (office). */
export const createAlertRuleSchema = z.object({
  name: textSchema(1, 120),
  ruleKind: z.enum(ALERT_RULE_KINDS).refine((kind) => kind !== RETIRED_ALERT_RULE_KIND, 'NOT_ALLOWED'),
  threshold: thresholdSchema,
  resourceId: optionalUuidSchema,
  cylinderTypeId: optionalUuidSchema,
  severity: z.enum(ALERT_SEVERITIES).optional(),
  notes: optionalTextSchema(300),
});
export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;

/** `PATCH /alert-rules/:id` (office): any of these; the service refuses to set a credit-over rule active. */
export const updateAlertRuleSchema = z.object({
  name: textSchema(1, 120).optional(),
  threshold: thresholdSchema.optional(),
  severity: z.enum(ALERT_SEVERITIES).optional(),
  isActive: z.boolean().optional(),
  notes: optionalTextSchema(300),
});
export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
