import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { DaySheetRowError } from '@smartfleet/shared-types';
import { toApiError } from '../../../api/errors';
import { qk } from '../../../api/keys';
import { PickerSheet, useToast, type PickerItem } from '../../../ui';
import { fetchDaySheet, uploadDaySheet } from '../shared/api';
import { shopKeys } from '../shared/keys';
import type { DayUpload } from './dayEndModel';
import { chooseFolder, folderToUse, listSheets, saveSheet, type SheetFile } from './sheetFiles';

/** Lets the picker slide away before Android's folder screen opens over the app. */
const SHEET_CLOSE_MS = 200;
const OTHER_FOLDER = '__other-folder__';
const NO_SHEETS = '__no-sheets__';

/**
 * [Inc 3] "Download sheet" (S19): the folder first (Android's screen the first time), then a new sheet
 * from the server, saved there; the toast "Sheet saved in Documents". The day refreshes either way,
 * since a download makes the day's newest sheet.
 */
export function useSheetDownload(date: string): { download: () => void; busy: boolean; error: unknown } {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = useRef(false);

  const download = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setError(null);
    void (async () => {
      try {
        const folder = await folderToUse();
        if (!folder) return;
        setBusy(true);
        const sheet = await fetchDaySheet(date);
        const saved = await saveSheet(folder, sheet.fileName, sheet.base64);
        if (saved === null) return;
        toast.show({ message: saved ? t('dayEnd.saved', { folder: saved }) : t('dayEnd.savedNoFolder'), tone: 'success' });
      } catch (thrown) {
        setError(toApiError(thrown));
      } finally {
        running.current = false;
        setBusy(false);
        void queryClient.invalidateQueries({ queryKey: qk.dayEnd(date) });
      }
    })();
  }, [date, queryClient, t, toast]);

  return { download, busy, error };
}

export interface SheetUpload {
  /** Lists the sheets in the folder to pick from (the folder screen first if none was chosen yet). */
  start: () => void;
  /** Sends the picked file again, after it got no answer; null when there is nothing to resend. */
  retry: (() => void) | null;
  uploading: boolean;
  /** A whole-file refusal or no answer (row errors go to Check and send instead). */
  error: unknown;
  /** The picker sheet; render it once on the screen. */
  picker: ReactNode;
}

function rowErrorsOf(details: Record<string, unknown>): { rows: DaySheetRowError[]; total: number } {
  const rows = Array.isArray(details.rows) ? (details.rows as DaySheetRowError[]) : [];
  const total = typeof details.total === 'number' ? details.total : rows.length;
  return { rows, total };
}

/**
 * [Inc 3] "Upload filled sheet" (S19) and "Upload fixed sheet" (S20): pick the sheet from the folder
 * (or "Other folder"), then `POST /day-end/:date/upload` with "Checking your sheet…" on the button. The
 * answer, differences or row errors, is kept for Check and send (`onDone`); a refusal of the whole file
 * stays on the screen. With no answer the picked file is kept, and Try again sends it again.
 */
export function useSheetUpload(date: string, onDone: (upload: DayUpload) => void): SheetUpload {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<SheetFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [lastFile, setLastFile] = useState<SheetFile | null>(null);
  const busy = useRef(false);

  const upload = useCallback(
    async (file: SheetFile) => {
      if (busy.current) return;
      busy.current = true;
      setUploading(true);
      setError(null);
      setLastFile(file);
      try {
        const result = await uploadDaySheet(date, file);
        setLastFile(null);
        const done: DayUpload = { kind: 'result', result, at: Date.now() };
        queryClient.setQueryData(shopKeys.dayEndUpload(date), done);
        onDone(done);
      } catch (thrown) {
        const failure = toApiError(thrown);
        if (failure.code === 'DAY_SHEET_ROW_ERRORS') {
          setLastFile(null);
          const done: DayUpload = { kind: 'rowErrors', ...rowErrorsOf(failure.details), at: Date.now() };
          queryClient.setQueryData(shopKeys.dayEndUpload(date), done);
          onDone(done);
        } else {
          setError(failure);
          // Only an upload that got no answer is sent again as it was; a refused file needs another one.
          if (!failure.retryable) setLastFile(null);
        }
      } finally {
        busy.current = false;
        setUploading(false);
        void queryClient.invalidateQueries({ queryKey: qk.dayEnd(date) });
      }
    },
    [date, onDone, queryClient],
  );

  // One folder screen or listing at a time: Android refuses a second folder request while one is open.
  const listing = useRef(false);
  const showFolder = useCallback(
    async (folder: string | null) => {
      if (listing.current) return;
      listing.current = true;
      setError(null);
      try {
        const listed = await listSheets(date, folder);
        if (!listed) return;
        setFiles(listed.files);
        setOpen(true);
      } catch (thrown) {
        setError(toApiError(thrown));
      } finally {
        listing.current = false;
      }
    },
    [date],
  );

  const start = useCallback(() => {
    if (busy.current) return;
    void showFolder(null);
  }, [showFolder]);

  const items: PickerItem<string>[] = [
    ...(files.length === 0
      ? [{ key: NO_SHEETS, value: NO_SHEETS, title: t('dayEnd.pick.empty'), disabled: true }]
      : files.map((file) => ({ key: file.uri, value: file.uri, title: file.name, leadingIcon: 'sheet' as const }))),
    {
      key: OTHER_FOLDER,
      value: OTHER_FOLDER,
      title: t('dayEnd.pick.otherFolder'),
      leadingIcon: 'search',
      tone: 'action',
      dividerBefore: files.length > 0,
    },
  ];

  const picker = (
    <PickerSheet<string>
      visible={open}
      title={t('dayEnd.pick.title')}
      items={items}
      search="auto"
      onPick={(value) => {
        if (value === OTHER_FOLDER) {
          setTimeout(() => {
            void (async () => {
              if (listing.current) return;
              listing.current = true;
              let folder: string | null = null;
              try {
                folder = await chooseFolder();
              } catch (thrown) {
                setError(toApiError(thrown));
              } finally {
                listing.current = false;
              }
              if (folder) await showFolder(folder);
            })();
          }, SHEET_CLOSE_MS);
          return undefined;
        }
        const file = files.find((candidate) => candidate.uri === value);
        if (file) void upload(file);
        return undefined;
      }}
      onClose={() => setOpen(false)}
      testID="dayEnd.picker"
    />
  );

  const retry = lastFile ? () => void upload(lastFile) : null;
  return { start, retry, uploading, error, picker };
}
