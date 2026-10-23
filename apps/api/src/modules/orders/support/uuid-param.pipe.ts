import type { PipeTransform } from '@nestjs/common';
import { uuidSchema } from '@smartfleet/shared-validation';
import { AppError } from '../../../common/errors/app-error';

/** The not-found codes a path id can answer with (API_CONTRACT §3.2). */
export type PathNotFoundCode = 'NOT_FOUND' | 'CLIENT_NOT_FOUND' | 'CLIENT_ADDRESS_NOT_FOUND';

/**
 * A path id must be a UUID. Anything else answers the resource's own 404, exactly as an unknown id or
 * another owner's record does (API_CONTRACT §3.2, G11-01), instead of reaching the database:
 *
 *   byId(@Param('id', new UuidParam()) id: string)
 *   addresses(@Param('id', new UuidParam('CLIENT_NOT_FOUND')) id: string)
 */
export class UuidParam implements PipeTransform<unknown, string> {
  constructor(private readonly code: PathNotFoundCode = 'NOT_FOUND') {}

  transform(value: unknown): string {
    const parsed = uuidSchema.safeParse(value);
    if (!parsed.success) throw new AppError(this.code);
    return parsed.data.toLowerCase();
  }
}
