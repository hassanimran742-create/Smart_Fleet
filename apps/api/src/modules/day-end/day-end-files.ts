import { Injectable } from '@nestjs/common';
import type { Prisma, StoredFile, StoredFilePurpose } from '@prisma/client';
import * as path from 'path';
import { FilesService } from '../files/files.service';
import { XLSX_MIME_TYPE } from './day-end-workbook';

/**
 * [Inc 3] Where the day-end workbooks are kept (API_CONTRACT §10.2): the sheet the server made
 * (`DAY_END_SHEET`, its id chosen first so the sheet carries it in "About") and the shop's filled copy
 * (`DAY_END_UPLOAD`). Both live in the files module's private bucket with a `stored_files` row whose
 * uploader is the shop and whose `distributor_id` is set, so `GET /files/:id/url` gives the shop its own
 * files and the office both (G09-11), and anyone else 404 FILE_NOT_FOUND.
 *
 * The files module owns `stored_files` and the bucket (§5.1): its picture upload refuses day-end purposes,
 * so the workbooks go through `FilesService.storeGenerated(input, tx)` (the object is put, then the row is
 * written on the day's transaction) and `FilesService.discardObject(key)` (the object of a row that never
 * committed). The tests' `jest.spyOn(app.get(FilesService).s3, 'send')` stubs apply to both.
 */

export interface DayEndFileInput {
  /** The id, chosen first (the sheet carries it). */
  id: string;
  bytes: Buffer;
  purpose: Extract<StoredFilePurpose, 'DAY_END_SHEET' | 'DAY_END_UPLOAD'>;
  /** The shop's user (the sheet is made for it; the upload is its own). */
  uploadedByUserId: string;
  distributorId: string;
  originalName?: string | null;
}

/** A display name kept for the office: no folders, no control characters, at most 200 characters. */
export function safeFileName(name: string | null | undefined): string | null {
  if (!name) return null;
  // eslint-disable-next-line no-control-regex
  const base = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base ? base.slice(0, 200) : null;
}

@Injectable()
export class DayEndFiles {
  constructor(private readonly files: FilesService) {}

  /**
   * Puts the bytes in the bucket, then writes the `stored_files` row on `tx`, so the row commits with the
   * day's change or not at all. Storage being down is 503 SERVICE_UNAVAILABLE.
   */
  store(tx: Prisma.TransactionClient, input: DayEndFileInput): Promise<StoredFile> {
    return this.files.storeGenerated(
      {
        id: input.id,
        bytes: input.bytes,
        mimeType: XLSX_MIME_TYPE,
        extension: 'xlsx',
        purpose: input.purpose,
        uploadedByUserId: input.uploadedByUserId,
        distributorId: input.distributorId,
        originalName: safeFileName(input.originalName),
      },
      tx,
    );
  }

  /** Best effort: removes an object whose row didn't commit (the transaction failed after the put). */
  discard(storageKey: string): Promise<void> {
    return this.files.discardObject(storageKey);
  }
}
