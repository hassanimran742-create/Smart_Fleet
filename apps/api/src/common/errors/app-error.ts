import { HttpException } from '@nestjs/common';
import { ERROR_HTTP, type ErrorCode, type ErrorDetails, type FieldError } from '@smartfleet/shared-types';
import { errorMessage } from './messages';

/**
 * The `details` an {@link AppError} carries: the documented keys of its code (shared-types
 * `ErrorDetailsMap`, plus `currentStatus` on any code) and `fields` when a body failed validation
 * on a promoted code such as `AMOUNT_NOT_WHOLE_RUPEES`. Keys ending in `Paisa` hold digit strings.
 */
export type AppErrorDetails<C extends ErrorCode = ErrorCode> = ErrorDetails<C> & { fields?: FieldError[] };

export interface AppErrorOptions {
  /** The underlying error, kept for the logs and Sentry only; it never reaches a response. */
  cause?: unknown;
}

/** Codes whose English needs parameters must be given their details; the others may omit them. */
type AppErrorArgs<C extends ErrorCode> = {} extends ErrorDetails<C>
  ? [details?: AppErrorDetails<C>, options?: AppErrorOptions]
  : [details: AppErrorDetails<C>, options?: AppErrorOptions];

/**
 * The one way services report a failure (API_CONTRACT §2.2): `throw new AppError(code, details?)`.
 * The global filter renders it as the §2.1 envelope with status `ERROR_HTTP[code]`, the English
 * `ERROR_MESSAGE_EN[code]` filled from `details`, and the request id.
 *
 *   throw new AppError('WALLET_INSUFFICIENT_BALANCE', { requiredPaisa: '33000', balancePaisa: '12000', shortByPaisa: '21000' });
 *   throw new AppError('NOT_FOUND');
 */
export class AppError<C extends ErrorCode = ErrorCode> extends HttpException {
  readonly code: C;
  readonly details: AppErrorDetails<C>;

  constructor(code: C, ...args: AppErrorArgs<C>) {
    const [details, options] = args;
    const safeDetails = (details ?? {}) as AppErrorDetails<C>;
    const status = ERROR_HTTP[code];
    const message = errorMessage(code, safeDetails as Record<string, unknown>);
    super({ statusCode: status, code, message, details: safeDetails, error: code }, status, {
      cause: options?.cause,
    });
    this.name = 'AppError';
    this.code = code;
    this.details = safeDetails;
  }

  /** True when `error` is an AppError, optionally with one of `codes`. */
  static is<K extends ErrorCode>(error: unknown, ...codes: K[]): error is AppError<K> {
    return error instanceof AppError && (codes.length === 0 || (codes as ErrorCode[]).includes(error.code));
  }
}
