/**
 * [review23 holder-scans] Probe: where a move's `created_at` comes from (Prisma's own clock at the INSERT,
 * or the database's transaction start). The "moved since the sheet" rule (API_CONTRACT §10.2/§10.5) and
 * every "since" read order moves by it, so this decides whether a scan that waits on a lock can carry a
 * time older than a move that committed before it.
 */
import { Prisma } from '@prisma/client';
import { describeDb } from '../../helpers/describe-db';
import { getTestPrisma } from '../../helpers/db';
import { createStandardData } from '../../helpers/standard-data';
import { registerCylinders } from '../../helpers/runs';

describeDb('review23 holder-scans: event clock probe', () => {
  it('a move written by Prisma inside a long transaction is stamped when the INSERT runs (not at transaction start)', async () => {
    const db = getTestPrisma();
    const std = await createStandardData();
    const [cyl] = await registerCylinders({ distributor: std.DA, cylinderTypeId: std.sizes.kg11_8, count: 1 });
    const out = await db.$transaction(
      async (tx) => {
        const [{ start }] = await tx.$queryRaw<Array<{ start: Date }>>`SELECT (now() AT TIME ZONE 'UTC') AS start`;
        await tx.$executeRaw`SELECT pg_sleep(1.5)`;
        const event = await tx.cylinderEvent.create({
          data: {
            cylinderId: cyl.id,
            eventType: 'ADJUSTED',
            source: 'DAY_END_FIX',
            reason: 'probe',
            actorUserId: std.SA1.id,
            toCustodyType: 'STORE',
            toCustodyId: std.DA.homeStoreId,
          },
        });
        const [{ clock }] = await tx.$queryRaw<Array<{ clock: Date }>>`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS clock`;
        return { start, createdAt: event.createdAt, clock };
      },
      { timeout: 20_000 },
    );
    const sinceStart = out.createdAt.getTime() - out.start.getTime();
    // eslint-disable-next-line no-console
    console.log(`[probe] tx start ${out.start.toISOString()} created_at ${out.createdAt.toISOString()} clock ${out.clock.toISOString()} (created_at - start = ${sinceStart} ms)`);
    expect(sinceStart).toBeGreaterThan(1_000);
    void Prisma;
  });
});
