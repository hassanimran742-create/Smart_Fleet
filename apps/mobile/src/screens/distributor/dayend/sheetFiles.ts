import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ApiError } from '../../../api/errors';
import { XLSX_MIME_TYPE } from '../shared/api';

/**
 * [Inc 3] The day-end sheet on the phone, with no new native module (UX_PRINCIPLES "The phone binary").
 * The spec's way (UX_MOBILE §7.0, §8.3) needs `expo-document-picker` and `expo-sharing` from the 0.2.0
 * APK. Until then this uses what the 0.1.0 APK already has: `expo-file-system` (a dependency of `expo`,
 * so it is in the binary, as `expo-keep-awake` is for the ScanPanel) and Android's folder access
 * (Storage Access Framework):
 *
 * - **Download:** the shop picks a folder once (Android's own folder screen, opened at Documents;
 *   Android 11 and later refuse Download itself); the sheet is saved there under its own name,
 *   replacing an older copy, and opens from that folder in the shop's sheet app.
 * - **Upload:** the sheets (.xlsx) in that folder are listed to pick from, with "Other folder" for a
 *   sheet saved elsewhere (from WhatsApp, say). The picked file is sent straight from its folder.
 *
 * The module is loaded lazily and guarded: on a build without it, or off Android, every call fails with
 * the catalogue's FEATURE_DISABLED ("This isn't available yet.").
 */

type FileSystemModule = typeof import('expo-file-system');

/** Where the folder chosen last is kept (a content:// tree address; not a secret, but small). */
const FOLDER_KEY = 'dayEnd.folder';
/** The folder Android's screen opens at the first time. */
const START_FOLDER = 'Documents';

function unavailable(): ApiError {
  return new ApiError({ status: null, code: 'FEATURE_DISABLED', retryable: false });
}

function loadFileSystem(): FileSystemModule | null {
  if (Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('expo-file-system') as FileSystemModule;
    return fs.StorageAccessFramework ? fs : null;
  } catch {
    return null;
  }
}

function fileSystem(): FileSystemModule {
  const fs = loadFileSystem();
  if (!fs) throw unavailable();
  return fs;
}

/** True when this phone can save and pick sheets. */
export function sheetFilesAvailable(): boolean {
  return loadFileSystem() !== null;
}

function decode(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

/**
 * The last part of a folder's or file's path, from its content:// address: ".../tree/primary%3ADocuments"
 * is "Documents", ".../document/primary%3ADocuments%2Fday-end-AG-2026-10-22.xlsx" is the file's name.
 */
export function lastPathPart(uri: string): string {
  const text = decode(uri);
  const marker = text.lastIndexOf('/document/') >= 0 ? '/document/' : '/tree/';
  const tail = text.slice(text.lastIndexOf(marker) + marker.length) || text;
  const path = tail.slice(tail.indexOf(':') + 1);
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

async function savedFolder(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(FOLDER_KEY);
  } catch {
    return null;
  }
}

async function rememberFolder(uri: string | null): Promise<void> {
  try {
    if (uri) await SecureStore.setItemAsync(FOLDER_KEY, uri);
    else await SecureStore.deleteItemAsync(FOLDER_KEY);
  } catch {
    // Not kept: the next time asks for the folder again.
  }
}

/** Opens Android's folder screen. Null when the person backs out. */
export async function chooseFolder(): Promise<string | null> {
  const saf = fileSystem().StorageAccessFramework;
  const result = await saf.requestDirectoryPermissionsAsync(saf.getUriForDirectoryInRoot(START_FOLDER));
  if (!result.granted) return null;
  await rememberFolder(result.directoryUri);
  return result.directoryUri;
}

/** The folder chosen last, or a new choice. */
export async function folderToUse(): Promise<string | null> {
  return (await savedFolder()) ?? (await chooseFolder());
}

/** A sheet file in the folder. */
export interface SheetFile {
  uri: string;
  name: string;
}

async function filesIn(folder: string): Promise<SheetFile[]> {
  const uris = await fileSystem().StorageAccessFramework.readDirectoryAsync(folder);
  return uris.map((uri) => ({ uri, name: lastPathPart(uri) }));
}

/**
 * Saves the sheet (base64) into `folder` as `fileName`, replacing a copy of the same name, so the folder
 * never holds an old copy under the right name ("Only the newest sheet can be uploaded"). A folder that
 * can't be written any more (removed, or the permission taken back) is chosen again once. Returns the
 * folder's name ("Documents"), or null when the person backed out of choosing one.
 */
export async function saveSheet(folder: string, fileName: string, base64: string): Promise<string | null> {
  const fs = fileSystem();
  const saf = fs.StorageAccessFramework;
  const write = async (dir: string) => {
    const existing = (await filesIn(dir)).filter((file) => file.name === fileName);
    for (const file of existing) await saf.deleteAsync(file.uri, { idempotent: true }).catch(() => undefined);
    const baseName = fileName.replace(/\.xlsx$/i, '');
    const target = await saf.createFileAsync(dir, baseName, XLSX_MIME_TYPE);
    await saf.writeAsStringAsync(target, base64, { encoding: fs.EncodingType.Base64 });
  };

  let dir: string | null = folder;
  try {
    await write(dir);
  } catch {
    await rememberFolder(null);
    dir = await chooseFolder();
    if (!dir) return null;
    await write(dir);
  }
  return lastPathPart(dir);
}

/**
 * The sheets (.xlsx) in the folder, the one for `date` first, then newest name first. `folder` null
 * means the one chosen last (or a new choice). Null when the person backed out of choosing a folder.
 */
export async function listSheets(date: string, folder: string | null = null): Promise<{ folder: string; files: SheetFile[] } | null> {
  let dir = folder ?? (await folderToUse());
  if (!dir) return null;
  let files: SheetFile[];
  try {
    files = await filesIn(dir);
  } catch {
    // The folder went away, or its permission did: choose again.
    await rememberFolder(null);
    dir = await chooseFolder();
    if (!dir) return null;
    files = await filesIn(dir);
  }
  const sheets = files
    .filter((file) => /\.xlsx$/i.test(file.name))
    .sort((a, b) => {
      const today = Number(b.name.includes(date)) - Number(a.name.includes(date));
      return today !== 0 ? today : b.name.localeCompare(a.name);
    });
  return { folder: dir, files: sheets };
}
