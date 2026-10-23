import { z } from 'zod';
import { STORED_FILE_PURPOSES } from './internal/codes';

/**
 * The `purpose` field of `POST /files/upload` (multipart). Absent means the role's default: TOPUP_PROOF
 * for a distributor, OTHER for others. The service allows EXPENSE_RECEIPT for the office only.
 */
export const fileUploadSchema = z.object({
  purpose: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(STORED_FILE_PURPOSES).optional(),
  ),
});
export type FileUploadInput = z.infer<typeof fileUploadSchema>;
