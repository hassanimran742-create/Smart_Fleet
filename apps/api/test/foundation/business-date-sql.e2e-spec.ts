/**
 * FND-029 step 3: the parameterised SQL business date (DATA_MODEL §5.4) gives the same date as
 * `businessDate` in shared-utils for every edge instant. The zone and the cut-off are parameters,
 * never literals (G12-03).
 */
import { businessDate } from '@smartfleet/shared-utils';
import { getTestPrisma } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';

describeDb('foundation: business date in SQL', () => {
  it('FND-029 ((ts AT TIME ZONE UTC) AT TIME ZONE $tz - $cutoff::interval)::date matches businessDate', async () => {
    const db = getTestPrisma();
    const cases: [string, string][] = [
      ['2026-10-21T18:59:59Z', '03:00'],
      ['2026-10-21T19:00:00Z', '03:00'],
      ['2026-10-21T21:59:59Z', '03:00'],
      ['2026-10-21T22:00:00Z', '03:00'],
      ['2026-12-31T21:30:00Z', '03:00'],
      ['2026-12-31T22:30:00Z', '03:00'],
      ['2026-10-21T19:00:00Z', '00:00'],
    ];
    for (const [at, cutoff] of cases) {
      // Prisma DateTime columns are timestamp(3) without time zone, holding UTC: `ts` is that type,
      // whatever the session's time zone.
      const rows = await db.$queryRaw<Array<{ d: string }>>`
        WITH t AS (SELECT (${at}::timestamptz AT TIME ZONE 'UTC') AS ts)
        SELECT to_char(((ts AT TIME ZONE 'UTC') AT TIME ZONE ${'Asia/Karachi'} - ${cutoff}::interval)::date, 'YYYY-MM-DD') AS d FROM t`;
      expect({ at, cutoff, sql: rows[0].d }).toEqual({
        at,
        cutoff,
        sql: businessDate(at, { timezone: 'Asia/Karachi', cutoffLocalTime: cutoff }),
      });
    }
  });
});
