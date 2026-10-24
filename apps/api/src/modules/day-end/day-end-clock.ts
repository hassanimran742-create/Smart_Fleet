import { Injectable } from '@nestjs/common';

/**
 * [Inc 3] The instant the day-end routes read the **current business date** from (API_CONTRACT §10.2:
 * a `:date` later than it is 404 `DAY_NOT_FOUND`). It is the wall clock; e2e suites pin it to the cases'
 * times ("Clock 2026-10-21 20:00 Asia/Karachi") with `jest.spyOn(app.get(DayEndClock), 'now')`.
 *
 * Only the business date follows it. Every time the module stores (`sheet_snapshot_at`, `uploaded_at`,
 * `submitted_at`, `approved_at`, `sent_back_at`, `reopened_at`, `skipped_moved_at`) is the real time,
 * because it is compared with the cylinders' own move times (`movedSinceSheet`, the approval's skip rule),
 * which the custody module writes with the real clock.
 */
@Injectable()
export class DayEndClock {
  now(): Date {
    return new Date();
  }
}
