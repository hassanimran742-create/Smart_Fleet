/**
 * FND-034: formatPkDateTime prints a fixed UTC+5 date and time (ADR-21; CUSTOMER_PAGE §6 Dates), for the
 * Inc 2 customer page and the apps. The same answers under two process time zones, with Intl stubbed to
 * throw, so the page never depends on the server's or the phone's ICU data.
 *
 * A process reads its time zone when it starts (Jest's sandbox has its own copy of `process.env`), so each
 * zone runs in its own Node process with TZ set, calling the built shared-utils.
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { formatPkDateTime } from '@smartfleet/shared-utils';

const CASES: Array<[string, string]> = [
  ['2026-10-21T11:12:00Z', 'Wed 21 Oct, 4:12 pm'],
  // Midnight belongs to the new day.
  ['2026-10-21T19:00:00Z', 'Thu 22 Oct, 12:00 am'],
  ['2026-10-22T07:00:00Z', 'Thu 22 Oct, 12:00 pm'],
  // A day without a leading zero, in the new year in Karachi.
  ['2026-12-31T21:30:00Z', 'Fri 1 Jan, 2:30 am'],
];

const SHARED_UTILS = path.resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'shared-utils', 'dist', 'index.js');

/** Runs formatPkDateTime in a new Node process with TZ=`zone` and Intl replaced by a stub that throws. */
function inProcess(zone: string): { offset: number; texts: string[]; intlCalls: number } {
  const script = `
    const { formatPkDateTime } = require(${JSON.stringify(SHARED_UTILS)});
    let intlCalls = 0;
    globalThis.Intl = new Proxy({}, { get() { intlCalls += 1; throw new Error('Intl is not available'); } });
    const texts = ${JSON.stringify(CASES.map(([iso]) => iso))}.map((iso) => formatPkDateTime(iso));
    process.stdout.write(JSON.stringify({ offset: new Date('2026-10-21T11:12:00Z').getTimezoneOffset(), texts, intlCalls }));`;
  const run = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`node failed under TZ=${zone}: ${run.stderr}`);
  return JSON.parse(run.stdout) as { offset: number; texts: string[]; intlCalls: number };
}

describe('FND-034 formatPkDateTime prints a fixed UTC+5 date and time', () => {
  it.each([
    ['UTC', 0],
    ['Asia/Dubai', -240],
  ])('FND-034 gives the documented text under TZ=%s, with no Intl call', (zone, offset) => {
    const result = inProcess(zone);
    // The process really ran in that zone (Dubai is UTC+4).
    expect(result.offset).toBe(offset);
    expect(result.texts).toEqual(CASES.map(([, text]) => text));
    expect(result.intlCalls).toBe(0);
  });

  it('FND-034 the results are the same under both process time zones, and match the source', () => {
    expect(inProcess('UTC').texts).toEqual(inProcess('Asia/Dubai').texts);
    // The built package is the source the apps import.
    expect(CASES.map(([iso]) => formatPkDateTime(iso))).toEqual(CASES.map(([, text]) => text));
  });
});
