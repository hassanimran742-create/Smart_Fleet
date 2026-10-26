/**
 * The last tab and filters used on each list page, for this browser tab only (UX_ADMIN §1.4): the menu
 * link reopens them. Kept in sessionStorage, so a new browser tab starts from the defaults.
 */
const STORAGE_KEY = 'smartfleet.admin.listSearch';

function readAll(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

/** Remembers the search string ("?tab=all&q=0142", or "" for the defaults) of a list page's path. */
export function rememberListSearch(path: string, search: string): void {
  try {
    const all = readAll();
    if ((all[path] ?? '') === search) return;
    if (search) all[path] = search;
    else delete all[path];
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: the menu links open the defaults.
  }
}

/** The search string last used on a list page's path, or "". */
export function rememberedListSearch(path: string): string {
  const search = readAll()[path] ?? '';
  return search.startsWith('?') ? search : '';
}
