import type { PipeTransform } from '@nestjs/common';
import type { FieldError } from '@smartfleet/shared-types';
import { parseRequest, type FieldIssue } from '@smartfleet/shared-validation';
import type { z } from 'zod';
import { AppError } from '../errors/app-error';
import { validationMessage } from '../errors/messages';

/** Field issues from shared-validation, with their English filled in for `details.fields`. */
export function toFieldErrors(issues: readonly FieldIssue[], pathPrefix = ''): FieldError[] {
  return issues.map((issue) => {
    const path = pathPrefix && issue.path ? `${pathPrefix}.${issue.path}` : pathPrefix || issue.path;
    return {
      path,
      code: issue.code,
      message: validationMessage(issue.code, issue.params),
      ...(issue.params ? { params: issue.params } : {}),
    };
  });
}

/**
 * Validates a request part with a shared zod schema (API_CONTRACT §2.2):
 *
 *   create(@Body(new ZodBody(createOrderSchema)) body: CreateOrderInput) { … }
 *   list(@Query(new ZodQuery(ordersQuerySchema)) query: OrdersQuery) { … }
 *
 * The handler gets the schema's output (trimmed text, canonical paisa strings, defaults). A failure
 * answers VALIDATION_FAILED, or the one promoted code when every problem is it (for example
 * AMOUNT_NOT_WHOLE_RUPEES, or SCAN_EVENT_NOT_ALLOWED with 403), with `details.fields:
 * [{ path, code, message, params? }]`. The global class-validator pipe skips these parameters,
 * because their declared type is not a class.
 */
export class ZodBody<S extends z.ZodTypeAny> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = parseRequest(this.schema, value);
    if (result.success) return result.data;
    throw new AppError(result.errorCode, { fields: toFieldErrors(result.fields) });
  }
}

/** The same pipe for query strings (`@Query(new ZodQuery(schema))`); schemas coerce text there. */
export class ZodQuery<S extends z.ZodTypeAny> extends ZodBody<S> {}
