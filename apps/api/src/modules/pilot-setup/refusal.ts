import { ERROR_MESSAGE_EN, type ErrorCode } from '@smartfleet/shared-types';
import { VALIDATION_MESSAGE_EN, isValidationCode, type ValidationCode } from '@smartfleet/shared-validation';
import { AppError } from '../../common/errors/app-error';
import { errorMessage, validationMessage } from '../../common/errors/messages';

/** A place in the setup file: `['zones', 2, 'shape']`, printed `zones[2].shape`. */
export type JsonPath = ReadonlyArray<string | number>;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `['zones', 2, 'shape']` → `zones[2].shape`; a key that isn't a plain name is quoted: `settings["topup.account"]`. */
export function formatPath(path: JsonPath): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else if (IDENTIFIER.test(part)) out += out ? `.${part}` : part;
    else out += `[${JSON.stringify(part)}]`;
  }
  return out || '(the file)';
}

/** One field problem inside a refusal (a VALIDATION_FAILED body's first field). */
export interface RefusalField {
  code: ValidationCode;
  message: string;
}

/**
 * Why a pilot CLI run was refused (API_CONTRACT §10.3): the first bad entry of the file by its JSON path,
 * with the catalogue error code and its English text. Nothing is written when one is raised.
 */
export class PilotRefusal extends Error {
  constructor(
    readonly path: JsonPath,
    readonly code: ErrorCode,
    readonly english: string,
    readonly extra: { label?: string; field?: RefusalField; detail?: string } = {},
  ) {
    super(`${formatPath(path)}: ${code}: ${english}`);
    this.name = 'PilotRefusal';
  }

  /** A refusal with the catalogue text of `code`, filled from `details`. */
  static of(
    path: JsonPath,
    code: ErrorCode,
    extra: { label?: string; field?: RefusalField; detail?: string; details?: Record<string, unknown> } = {},
  ): PilotRefusal {
    const { details, ...rest } = extra;
    return new PilotRefusal(path, code, errorMessage(code, details ?? null), rest);
  }

  /** VALIDATION_FAILED with one field code ("Some details need fixing." plus the field's English). */
  static field(
    path: JsonPath,
    fieldCode: ValidationCode,
    extra: { label?: string; detail?: string; params?: Record<string, unknown> } = {},
  ): PilotRefusal {
    return new PilotRefusal(path, 'VALIDATION_FAILED', ERROR_MESSAGE_EN.VALIDATION_FAILED, {
      label: extra.label,
      detail: extra.detail,
      field: { code: fieldCode, message: validationMessage(fieldCode, extra.params ?? null) },
    });
  }

  /**
   * Any error thrown while an entry was checked or written, as a refusal naming that entry. A service's
   * AppError keeps its code and English; anything else is INTERNAL_ERROR with the error's own text as the
   * detail (the terminal only: it is a CLI for ops, never a response).
   */
  static from(error: unknown, path: JsonPath, label?: string): PilotRefusal {
    if (error instanceof PilotRefusal) return error;
    if (error instanceof AppError) {
      const fields = (error.details as { fields?: Array<{ code?: unknown; message?: unknown }> }).fields;
      const first = Array.isArray(fields) ? fields[0] : undefined;
      const field: RefusalField | undefined =
        first && isValidationCode(first.code)
          ? { code: first.code, message: typeof first.message === 'string' ? first.message : VALIDATION_MESSAGE_EN[first.code] }
          : undefined;
      return new PilotRefusal(path, error.code, error.message, { label, field });
    }
    const message = error instanceof Error ? error.message : String(error);
    return new PilotRefusal(path, 'INTERNAL_ERROR', ERROR_MESSAGE_EN.INTERNAL_ERROR, { label, detail: message.split('\n').slice(-3).join(' ').trim() });
  }

  /** The same refusal at `path` (a check that didn't know which entry it ran for). */
  at(path: JsonPath, label?: string): PilotRefusal {
    return new PilotRefusal(path, this.code, this.english, { ...this.extra, label: this.extra.label ?? label });
  }

  /** The lines the CLI prints. */
  lines(): string[] {
    const label = this.extra.label ? ` (${this.extra.label})` : '';
    const out = [`Refused at ${formatPath(this.path)}${label}: ${this.code}: ${this.english}`];
    if (this.extra.field) out.push(`  ${this.extra.field.code}: ${this.extra.field.message}`);
    if (this.extra.detail) out.push(`  ${this.extra.detail}`);
    return out;
  }
}
