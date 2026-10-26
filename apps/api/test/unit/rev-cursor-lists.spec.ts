/**
 * Regression tests for review findings contract-compat-03 and robustness-ops-06 on paging cursors
 * (API_CONTRACT §1.3): a cursor is tied to the list (path and tab) that made it, and a cursor holding
 * a date Postgres can't store is refused like any other bad cursor (400 on `cursor`), never a 500.
 */
import { RequestContext, listKeyOf } from '../../src/common/context/request-context';
import { AppError } from '../../src/common/errors/app-error';
import { decodeCursor, encodeCursor, toPage } from '../../src/common/pagination/cursor';

const inList = <T>(url: string, tab: unknown, fn: () => T): T =>
  RequestContext.run({ requestId: 'rev-cursor-test', listKey: listKeyOf(url, tab) }, fn);

function refusal(fn: () => unknown): unknown {
  try {
    fn();
    return 'accepted';
  } catch (error) {
    return error instanceof AppError ? { code: error.code, fields: (error.details as { fields?: unknown }).fields } : String(error);
  }
}

const ON_CURSOR = { code: 'VALIDATION_FAILED', fields: [{ path: 'cursor', code: 'INVALID_VALUE', message: expect.any(String) }] };
const KEY = ['2026-10-21T10:00:00.000Z', '0f8fad5b-d9cb-469f-a165-70867728950e'] as const;

describe('REV contract-compat-03 cursors belong to the list that made them', () => {
  it('REV contract-compat-03 the list key is the path and the tab, whatever the spelling', () => {
    expect(listKeyOf('/api/v1/Orders/?tab=Active&limit=1', 'Active')).toBe('/api/v1/orders?tab=active');
    expect(listKeyOf('/api/v1/wallet/statement?cursor=abc&kind=TOPUP_ADDED', undefined)).toBe('/api/v1/wallet/statement');
    expect(listKeyOf('/api/v1/orders/board', ['a', 'b'])).toBe('/api/v1/orders/board');
    expect(listKeyOf('/api/v1/orders/board', '  ')).toBe('/api/v1/orders/board');
  });

  it('REV contract-compat-03 a cursor is read back by its own list only: another path or tab is 400 on cursor', () => {
    const cursor = inList('/api/v1/orders?tab=active', 'active', () => encodeCursor(KEY));
    expect(inList('/api/v1/orders?tab=active&limit=30', 'active', () => decodeCursor(cursor, 2))).toEqual([...KEY]);
    expect(inList('/api/v1/orders?tab=done', 'done', () => refusal(() => decodeCursor(cursor, 2)))).toEqual(ON_CURSOR);
    expect(inList('/api/v1/wallet/statement', undefined, () => refusal(() => decodeCursor(cursor, 2)))).toEqual(ON_CURSOR);
    expect(inList('/api/v1/admin/topups?tab=active', 'active', () => refusal(() => decodeCursor(cursor, 2)))).toEqual(ON_CURSOR);
    expect(refusal(() => decodeCursor(cursor, 2))).toEqual(ON_CURSOR);
  });

  it('REV contract-compat-03 toPage tags its next cursor with the request\'s list', () => {
    const page = inList('/api/v1/audit-logs', undefined, () => toPage([{ id: 'a' }, { id: 'b' }], 1, (row) => [row.id]));
    expect(inList('/api/v1/audit-logs', undefined, () => decodeCursor(page.nextCursor, 1))).toEqual(['a']);
    expect(inList('/api/v1/expenses', undefined, () => refusal(() => decodeCursor(page.nextCursor, 1)))).toEqual(ON_CURSOR);
  });

  it('REV contract-compat-03 an untagged cursor from before the change is refused once (400), not paged from', () => {
    const old = Buffer.from(JSON.stringify(KEY)).toString('base64url');
    expect(inList('/api/v1/wallet/statement', undefined, () => refusal(() => decodeCursor(old, 2)))).toEqual(ON_CURSOR);
  });
});

describe('REV robustness-ops-06 a cursor date Postgres cannot hold', () => {
  it('REV robustness-ops-06 year 0 and six-digit years are refused on cursor, ordinary dates pass', () => {
    const tagged = (key: readonly (string | number)[]) => inList('/api/v1/orders?tab=done', 'done', () => encodeCursor(key));
    const read = (cursor: string) => inList('/api/v1/orders?tab=done', 'done', () => refusal(() => decodeCursor(cursor, 2)));
    expect(read(tagged(['-271821-04-20T00:00:00.000Z', KEY[1]]))).toEqual(ON_CURSOR);
    expect(read(tagged(['+275760-09-13T00:00:00.000Z', KEY[1]]))).toEqual(ON_CURSOR);
    expect(read(tagged(['0000-01-01T00:00:00.000Z', KEY[1]]))).toEqual(ON_CURSOR);
    expect(read(tagged([Number.NaN, KEY[1]]))).toEqual(ON_CURSOR);
    expect(read(tagged(['0001-01-01T00:00:00.000Z', KEY[1]]))).toBe('accepted');
    expect(read(tagged([...KEY]))).toBe('accepted');
  });
});
