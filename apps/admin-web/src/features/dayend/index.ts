/**
 * Day-end for the office (UX_ADMIN §4.3, Inc 3). Owned by the office UI lane.
 *
 * Contract with app/router.tsx:
 * - `DayEndPage`: `/day-end` (route id '/day-end'), search `DayEndSearch` (`validateDayEndSearch`).
 * - `DayEndReviewPage`: `/day-end/$dayEndId` (route id '/day-end/$dayEndId'), a full page with a back
 *   link to Day-end.
 */
export { DayEndPage } from './DayEndPage';
export { DayEndReviewPage } from './DayEndReviewPage';
export { DAY_END_TABS, validateDayEndSearch, type DayEndSearch, type DayEndTab } from './search';
