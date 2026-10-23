import type { PipeTransform } from '@nestjs/common';
import { parseRequest } from '@smartfleet/shared-validation';
import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { toFieldErrors } from '../../common/pipes/zod-body.pipe';

/**
 * The body pipe of `POST` and `PATCH /zones` (API_CONTRACT §7.2). A shape that isn't a non-empty
 * MultiPolygon is `ZONE_INVALID_SHAPE` (400), the same answer as a shape the database finds invalid,
 * so an empty or broken `polygonGeoJson` never reads as a generic form error. A missing shape on
 * create, and every other field problem, stays `VALIDATION_FAILED` with `details.fields`.
 */
export class ZoneBody<S extends z.ZodTypeAny> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = parseRequest(this.schema, value);
    if (result.success) return result.data;
    const shapeOnly =
      result.fields.length > 0 &&
      result.fields.every(
        (field) => field.path.startsWith('polygonGeoJson') && !(field.path === 'polygonGeoJson' && field.code === 'REQUIRED'),
      );
    if (shapeOnly) throw new AppError('ZONE_INVALID_SHAPE');
    throw new AppError(result.errorCode, { fields: toFieldErrors(result.fields) });
  }
}
