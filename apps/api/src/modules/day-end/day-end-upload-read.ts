import { Logger } from '@nestjs/common';
import { DAY_SHEET_LIMITS } from '@smartfleet/shared-types';
import { AppError } from '../../common/errors/app-error';
import { inspectDayUpload } from './day-end-sheet-shape';
import { loadDayWorkbook, readAbout, readUploadedRows, type UploadedDaySheet } from './day-end-workbook';

/**
 * [Inc 3] How the upload reads a day-end file (API_CONTRACT §10.2 check 3, §10.5): the ZIP and shape check
 * first (no spreadsheet code runs on a file beyond the sheet's shape), then exceljs, one file at a time in
 * this process (ADR-23: the pilot runs one API instance). The workbook is let go before the next file is
 * read: what leaves here is the About values and the rows, a few KB.
 */

/** What the upload's checks 3 to 7 read from a file: null where the sheet is missing. */
export interface DayUploadContent {
  about: Record<string, string> | null;
  rows: UploadedDaySheet | null;
}

/**
 * At most one day-end file read at a time. Another upload waits for its turn, at most `maxWaitMs`, and only
 * `maxWaiting` may wait; any other is answered at once with 503 SERVICE_UNAVAILABLE ("The service is busy.
 * Please try again in a minute.", §2.2: retryable). A real sheet takes about 50 ms, so two shops sending at
 * the same moment just queue.
 */
export class DayEndReadGate {
  private busy = false;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly options: { maxWaiting: number; maxWaitMs: number } = { maxWaiting: 2, maxWaitMs: 15_000 }) {}

  /** True while a file is being read. */
  get reading(): boolean {
    return this.busy;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.enter();
    try {
      return await work();
    } finally {
      this.leave();
    }
  }

  private enter(): Promise<void> {
    if (!this.busy) {
      this.busy = true;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.options.maxWaiting) return Promise.reject(new AppError('SERVICE_UNAVAILABLE'));
    return new Promise<void>((resolve, reject) => {
      const turn = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(turn);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new AppError('SERVICE_UNAVAILABLE'));
      }, this.options.maxWaitMs);
      this.waiting.push(turn);
    });
  }

  /** Hands the slot to the next waiting upload (it stays busy), or frees it. */
  private leave(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.busy = false;
  }
}

/** The process's one gate. */
export const dayEndReadGate = new DayEndReadGate();

const logger = new Logger('DayEndUpload');

/** Lets waiting I/O (other users' requests) run before the next synchronous step of a read. */
function yieldToOthers(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Reads an upload's About values and rows, or throws 422 DAY_SHEET_UNREADABLE (not a ZIP, beyond the sheet's
 * shape, or not a workbook exceljs can read) or 503 SERVICE_UNAVAILABLE (another file is being read and the
 * wait ran out).
 */
export async function readDayUpload(bytes: Buffer, gate: DayEndReadGate = dayEndReadGate): Promise<DayUploadContent> {
  return gate.run(async () => {
    // The check and the read are synchronous stretches of up to a few hundred ms: other requests go first.
    await yieldToOthers();
    const check = inspectDayUpload(bytes);
    if (!check.ok) {
      logger.log(`Day-end upload refused before reading: ${check.why}`);
      throw new AppError('DAY_SHEET_UNREADABLE');
    }
    await yieldToOthers();
    const workbook = await loadDayWorkbook(bytes, { maxRows: DAY_SHEET_LIMITS.maxRowsPerSheet });
    if (!workbook) throw new AppError('DAY_SHEET_UNREADABLE');
    await yieldToOthers();
    return { about: readAbout(workbook), rows: readUploadedRows(workbook) };
  });
}
