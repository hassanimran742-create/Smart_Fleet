import { DAY_END_ROW_ERROR_EN } from '@smartfleet/shared-types';

/**
 * [Inc 3] `dayEnd.*` copy: the shop app's Day-end (S19) and Check and send (S20) (UX_MOBILE §8.3;
 * Inc 2/3 spec §4.6–§4.7). Owned by the mobile-distributor lane. The stage chip is the foundation's
 * `stages.dayEnd.*`; refusals are `errors.<CODE>`. Day-end never moves money.
 *
 * The sheet is saved into a folder the shop picks (Android's folder screen opens at Documents: Android 11
 * and later refuse Download itself) and picked from that folder for the upload: the 0.1.0 app has no file
 * picker or share sheet (no new native module), so `saved` and `pick.*` stand in for the spec's "Open in
 * your sheet app" share sheet and DocumentPicker.
 */
export const dayEnd = {
  title: 'Day-end',

  /** The three step rows (not tappable). */
  step: {
    download: 'Download sheet',
    fill: "Fill in only what's different",
    fillHelp: 'Where it is, its state, and why.',
    upload: 'Upload the sheet',
  },
  btn: {
    download: 'Download sheet',
    downloadAgain: 'Download again',
    /** The one line under "Download again" (rule 2): a new sheet makes the filled copy unusable (ux-07). */
    downloadAgainHelp: "Your filled sheet can't be sent after this.",
    downloading: 'Downloading…',
    upload: 'Upload filled sheet',
    uploadAgain: 'Upload again',
    checking: 'Checking your sheet…',
    /** On an earlier day that waits for the shop: today's sheet, so it is never out of reach (ux-01). */
    today: "Today's sheet",
  },
  /** Under "Upload the sheet" after an upload (the count and time are data). */
  lastUpload: '{{count}} difference · {{time}}',
  lastUpload_plural: '{{count}} differences · {{time}}',
  /** The line under the steps while the office checks the day (no footer then). */
  waiting: 'The office is checking it.',
  /** The red card while the day is sent back (or reopened). */
  note: {
    SENT_BACK: 'Office note: “{{note}}”',
    REOPENED: 'Office reopened this day: “{{note}}”',
    fix: 'Fix it and upload again.',
  },

  /** The toast once the sheet is saved on the phone: "Sheet saved in Documents". */
  saved: 'Sheet saved in {{folder}}',
  savedNoFolder: 'Sheet saved',
  /** Picking the filled sheet from the folder it was saved in. */
  pick: {
    title: 'Pick your sheet',
    otherFolder: 'Other folder',
    empty: 'No sheets in this folder.',
  },

  /** S20 Check and send. */
  preview: {
    title: 'Check and send',
    /** The word beside the big count: "1 difference". */
    differenceWord: 'difference',
    differenceWord_plural: 'differences',
    checked: '{{count}} cylinder checked',
    checked_plural: '{{count}} cylinders checked',
    /** A difference's title: "AG-C0020 · 11.8 kg". */
    line: '{{shortCode}} · {{size}}',
    /** The shop's "Why different", in quotes. */
    note: '“{{note}}”',
    /** What the app says, and what the shop's count says (the part that differs in bold). */
    app: 'App: {{where}} · {{state}}',
    appNoState: 'App: {{where}}',
    appNone: 'App: not on the list',
    you: 'You: <place>{{where}}</place> · <state>{{state}}</state>',
    youNoState: 'You: <place>{{where}}</place>',
    skipped: 'Will be skipped',
    send: 'Send for approval · {{count}} difference',
    send_plural: 'Send for approval · {{count}} differences',
    sendClean: 'Send for approval',
    clean: 'Your count matches the app.',
  },
  /** The kinds of difference, as filter chips (only with 2 or more kinds). */
  filter: {
    ALL: 'All',
    PLACE: 'Place',
    STATE: 'State',
    NEW: 'New',
  },
  /** Where a cylinder is, as the sheet words it. */
  place: {
    STORE: 'In my store',
    VAN: "On driver's van",
    CUSTOMER: 'With customer',
    NOT_FOUND: 'Missing',
  },
  /** The app's place with its van or customer: "On driver's van · LEA-101". */
  placeVan: "On driver's van · {{plate}}",
  placeCustomer: 'With customer · {{name}}',
  state: {
    FULL: 'Full',
    EMPTY: 'Empty',
    PART_FILLED: 'Part-filled',
    FAULTY: 'Damaged',
    LOST: 'Missing',
  },
  /** What approval will do with a difference (the fix chip). */
  fix: {
    MOVE_TO_STORE: 'Move to your store',
    SET_STATE: 'Set to {{state}}',
    MARK_LOST: 'Mark as lost',
    REGISTER: 'Add as new cylinder',
    NOTE_ONLY: 'Office will check',
  },

  /** "Send day-end for Thu 22 Oct?" (rule 7: no undo once approved). */
  send: {
    title: 'Send day-end for {{date}}?',
    body: 'Once the office approves, this day is closed.',
    confirm: 'Send for approval',
    cancel: 'Not yet',
    sending: 'Sending…',
    done: 'Sent to the office',
  },

  /** Row-error mode (422 `DAY_SHEET_ROW_ERRORS`): nothing was saved. The codes' English is shared-types'. */
  rowError: {
    ...DAY_END_ROW_ERROR_EN,
    row: 'Row {{row}} · {{sheet}}: {{problem}}',
    more: 'and {{count}} more row',
    more_plural: 'and {{count}} more rows',
    reupload: 'Upload fixed sheet',
  },
  sheetName: {
    CYLINDERS: 'Cylinders',
    EXTRA: 'Extra cylinders',
  },
} as const;
