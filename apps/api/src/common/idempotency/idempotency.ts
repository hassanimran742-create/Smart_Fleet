import {
  createParamDecorator,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import { AppError } from '../errors/app-error';
import { validationMessage } from '../errors/messages';
import { headerValue, REQUEST_HEADER, RESPONSE_HEADER } from '../http/headers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Options of {@link IdempotencyKey}. */
export interface IdempotencyKeyOptions {
  /**
   * Refuse a request without the header: 400 VALIDATION_FAILED with
   * `details.fields: [{ path: 'Idempotency-Key', code: 'REQUIRED' }]`, before the handler runs. For
   * routes with no installed callers, such as wallet corrections (API_CONTRACT §4.2).
   */
  required?: boolean;
}

/**
 * Reads the `Idempotency-Key` header (API_CONTRACT §4.2): undefined when absent, else the value
 * lower-cased. A value that isn't a UUID is 400 VALIDATION_FAILED on the header (`INVALID_ID`); with
 * `required`, so is a missing one (`REQUIRED`).
 */
export function readIdempotencyKey(
  header: string | string[] | undefined,
  options: IdempotencyKeyOptions = {},
): string | undefined {
  const raw = headerValue(header)?.trim();
  if (!raw) {
    if (!options.required) return undefined;
    throw new AppError('VALIDATION_FAILED', {
      fields: [{ path: 'Idempotency-Key', code: 'REQUIRED', message: validationMessage('REQUIRED') }],
    });
  }
  if (!UUID.test(raw)) {
    throw new AppError('VALIDATION_FAILED', {
      fields: [{ path: 'Idempotency-Key', code: 'INVALID_ID', message: validationMessage('INVALID_ID') }],
    });
  }
  return raw.toLowerCase();
}

/**
 * The `Idempotency-Key` header (API_CONTRACT §4.2), stored as `client_request_id`. It is optional
 * (installed builds don't send it; state guards still stop double effects) but must be a UUID when
 * sent, else 400 VALIDATION_FAILED on the header. The value is lower-cased. Pass `{ required: true }`
 * where the key is mandatory, so every such route answers the same 400 when it is missing.
 *
 *   create(@IdempotencyKey() key: string | undefined, …)
 *   correct(@IdempotencyKey({ required: true }) key: string, …)
 */
export const IdempotencyKey: (options?: IdempotencyKeyOptions) => ParameterDecorator = createParamDecorator(
  (options: IdempotencyKeyOptions | undefined, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return readIdempotencyKey(req.headers[REQUEST_HEADER.idempotencyKey], options ?? {});
  },
);

/** How a repeated request was answered. */
export type IdempotentOutcome = 'replay' | 'already-applied';

/**
 * A response for a request that was already handled. The global {@link IdempotencyInterceptor}
 * sends `body` with 200 and the matching header:
 * - `replay`: a create retried with the same Idempotency-Key (`Idempotent-Replay: true`);
 * - `already-applied`: a finished action repeated, such as a double tap on Deliver or Approve
 *   (`X-Already-Applied: true`).
 */
export class IdempotentResponse<T> {
  constructor(
    readonly body: T,
    readonly outcome: IdempotentOutcome,
  ) {}
}

/** The original resource of a retried create: 200 with `Idempotent-Replay: true`. */
export function replayed<T>(body: T): IdempotentResponse<T> {
  return new IdempotentResponse(body, 'replay');
}

/** The resource of an action already in its target state: 200 with `X-Already-Applied: true`. */
export function alreadyApplied<T>(body: T): IdempotentResponse<T> {
  return new IdempotentResponse(body, 'already-applied');
}

function comparable(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(value, (_key, inner: unknown) => (typeof inner === 'bigint' ? inner.toString() : inner));
}

/**
 * For a create retried with a known Idempotency-Key: the stored resource's key fields must match the
 * new request, else 409 IDEMPOTENCY_CONFLICT (API_CONTRACT §4.2). Numbers, BigInts and digit strings
 * compare by value ("345000" equals 345000n); null and absent are equal.
 *
 *   assertSameRequest(existing, { clientId: body.clientId, quotedTotalPaisa: body.quotedTotalPaisa }, ['clientId', 'quotedTotalPaisa']);
 */
export function assertSameRequest<K extends string>(
  stored: Partial<Record<K, unknown>>,
  incoming: Partial<Record<K, unknown>>,
  keys: readonly K[],
): void {
  for (const key of keys) {
    if (comparable(stored[key]) !== comparable(incoming[key])) throw new AppError('IDEMPOTENCY_CONFLICT');
  }
}

/** Global: unwraps {@link IdempotentResponse} into status 200 plus its header. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    return next.handle().pipe(
      map((result: unknown) => {
        if (!(result instanceof IdempotentResponse)) return result;
        const res = context.switchToHttp().getResponse<Response>();
        res.status(200);
        res.setHeader(
          result.outcome === 'replay' ? RESPONSE_HEADER.idempotentReplay : RESPONSE_HEADER.alreadyApplied,
          'true',
        );
        return result.body;
      }),
    );
  }
}
