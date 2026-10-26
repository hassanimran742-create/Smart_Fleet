import type { UUID } from './common.types';

/**
 * Mirrors Prisma `StoredFilePurpose`. The default purpose follows the role: a DISTRIBUTOR's upload is
 * TOPUP_PROOF, others are OTHER. EXPENSE_RECEIPT is office only. DAY_END_* arrive in Inc 3.
 */
export const StoredFilePurpose = {
  TOPUP_PROOF: 'TOPUP_PROOF',
  EXPENSE_RECEIPT: 'EXPENSE_RECEIPT',
  DAY_END_SHEET: 'DAY_END_SHEET',
  DAY_END_UPLOAD: 'DAY_END_UPLOAD',
  OTHER: 'OTHER',
} as const;
export type StoredFilePurpose = (typeof StoredFilePurpose)[keyof typeof StoredFilePurpose];

/** Pictures accepted by `POST /files/upload`, checked by magic bytes on the server. */
export const UPLOAD_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type UploadImageMimeType = (typeof UPLOAD_IMAGE_MIME_TYPES)[number];

/** The upload size limit (`FILE_TOO_LARGE` carries `{ maxMb }`). */
export const UPLOAD_MAX_MB = 5;

/** `POST /files/upload`. `url` is signed for 1 hour; installed apps still read it. */
export interface FileUploadResult {
  fileId: UUID;
  key: string;
  url: string;
  mimeType: string;
  size: number;
}

/** `GET /files/:id/url`: a fresh signed URL, valid for 1 hour. */
export interface FileUrlResult {
  url: string;
}
