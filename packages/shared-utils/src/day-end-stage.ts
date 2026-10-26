/** A day-end status, as Prisma and `DayCloseStatus` of shared-types spell it. */
export type DayCloseStatusLike = 'OPEN' | 'SUBMITTED' | 'APPROVED';

/** What {@link deriveDayEndStage} returns: the same values as `DayEndStage` in @smartfleet/shared-types. */
export type DerivedDayEndStage = 'NOT_STARTED' | 'READY' | 'SENT_BACK' | 'WAITING_FOR_APPROVAL' | 'APPROVED';

type Moment = string | Date | null | undefined;

/** The `day_closes` fields the stage depends on. Times may be ISO strings or Dates; null means never. */
export interface DayEndStageInput {
  status: DayCloseStatusLike;
  /** `sent_back_at`: when the office last sent the day back. */
  sentBackAt?: Moment;
  /** `reopened_at`: when the office last reopened an approved day. */
  reopenedAt?: Moment;
  /** `uploaded_at`: when the shop last uploaded its filled sheet. */
  uploadedAt?: Moment;
  /** `sheet_snapshot_at`: when the newest sheet was made (only that sheet can be uploaded). */
  sheetSnapshotAt?: Moment;
}

/**
 * The stage people see for a business day (API_CONTRACT §1.4), sent as `stage` on every day-end DTO.
 * First match wins:
 *
 * | Stage | When |
 * |---|---|
 * | APPROVED | status APPROVED |
 * | WAITING_FOR_APPROVAL | status SUBMITTED |
 * | SENT_BACK | status OPEN, with a send-back or reopen and no upload since the later one |
 * | READY | status OPEN, and the latest upload is newer than the newest sheet |
 * | NOT_STARTED | otherwise, or no day row |
 */
export function deriveDayEndStage(day: DayEndStageInput | null | undefined): DerivedDayEndStage {
  if (!day) return 'NOT_STARTED';
  if (day.status === 'APPROVED') return 'APPROVED';
  if (day.status === 'SUBMITTED') return 'WAITING_FOR_APPROVAL';
  const uploaded = time(day.uploadedAt);
  const officeNote = Math.max(time(day.sentBackAt) ?? -Infinity, time(day.reopenedAt) ?? -Infinity);
  if (officeNote > -Infinity && (uploaded === null || uploaded <= officeNote)) return 'SENT_BACK';
  const sheet = time(day.sheetSnapshotAt);
  if (uploaded !== null && sheet !== null && uploaded > sheet) return 'READY';
  return 'NOT_STARTED';
}

function time(value: Moment): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
