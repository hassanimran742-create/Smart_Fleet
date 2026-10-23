/** Joins class names, skipping falsy ones: `cx('sf-btn', loading && 'is-loading')`. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}
