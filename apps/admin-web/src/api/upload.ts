import {
  UPLOAD_IMAGE_MIME_TYPES,
  UPLOAD_MAX_MB,
  type FileUploadResult,
  type FileUrlResult,
  type StoredFilePurpose,
} from '@smartfleet/shared-types';
import { api } from './client';
import { ApiError } from './errors';

/** Uploads can be 5 MB on a slow line, so they get longer than the usual 20 seconds. */
const UPLOAD_TIMEOUT_MS = 90_000;

/**
 * Refuses a file the server would refuse (JPEG, PNG or WebP, at most 5 MB; API_CONTRACT §7.10) before
 * sending it, with the same error codes. The server still checks the real bytes.
 */
export function checkUploadable(file: File): void {
  if (!(UPLOAD_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new ApiError('FILE_TYPE_NOT_ALLOWED', null, {}, null, null);
  }
  if (file.size > UPLOAD_MAX_MB * 1024 * 1024) {
    throw new ApiError('FILE_TOO_LARGE', null, { maxMb: UPLOAD_MAX_MB }, null, null);
  }
}

/**
 * `POST /files/upload` (multipart `file`, field `purpose`). Without a purpose the server picks one from
 * the role; the office sends `EXPENSE_RECEIPT` for receipts. Returns `{ fileId, key, url, mimeType, size }`;
 * `url` is signed for 1 hour, so store `fileId` and fetch a fresh URL with {@link fetchFileUrl}.
 */
export async function uploadFile(file: File, purpose?: StoredFilePurpose): Promise<FileUploadResult> {
  checkUploadable(file);
  const form = new FormData();
  // The purpose goes first, so the server can read it before the file arrives.
  if (purpose) form.append('purpose', purpose);
  form.append('file', file);
  const { data } = await api.post<FileUploadResult>('/files/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: UPLOAD_TIMEOUT_MS,
  });
  return data;
}

/** `GET /files/:id/url`: a fresh signed URL (1 hour) for a stored file, for the uploader or the office. */
export async function fetchFileUrl(fileId: string): Promise<string> {
  const { data } = await api.get<FileUrlResult>(`/files/${encodeURIComponent(fileId)}/url`);
  return data.url;
}
