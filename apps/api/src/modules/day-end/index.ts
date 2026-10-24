/**
 * [Inc 3] Day-end: what other modules, the gate and the tests import.
 *
 * - `DayEndModule`: register it in AppModule (the gate).
 * - `DayEndClock`: the instant the current business date is read from (e2e suites pin it).
 * - `dayEndTodayCard(db, settings)`: `AdminSummaryDto.dayEnd` for the Today page (read-only, for the admin
 *   summary's owner; `DayEndOfficeService.todayCard()` is the same).
 * - The sheet layout and row rules, for tools and tests: buildDaySheetWorkbook, readUploadedRows,
 *   applyRowRules, inspectZip.
 */
export { DayEndModule } from './day-end.module';
export { DayEndClock } from './day-end-clock';
export { DayEndService } from './day-end.service';
export { DayEndOfficeService } from './day-end-office.service';
export { DAY_RESOURCE_TYPE } from './day-end-core';
export { dayEndTodayCard } from './day-end-today';
export { buildDaySheetWorkbook, loadDayWorkbook, readAbout, readUploadedRows, XLSX_MIME_TYPE } from './day-end-workbook';
export { applyRowRules, matchSize } from './day-end-rows';
export { hasZipSignature, inspectZip } from './day-end-zip';
