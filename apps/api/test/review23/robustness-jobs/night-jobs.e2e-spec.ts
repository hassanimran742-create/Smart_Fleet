/**
 * Review 23 (robustness, jobs and operations): the nightly jobs run twice and over several nights.
 *
 * 1. VAN_NOT_EMPTY (API_CONTRACT §9.9): a new raise "only updates its context". AlertsService.raiseOn
 *    updates `context` and `updatedAt` only, so the alert's `title` and `body` keep the first raise's
 *    count and reason. The website's Alerts screen (apps/admin-web/src/legacy/AlertsScreen.tsx:179-180)
 *    shows `title` and `body`, so after the 03:00 check the office reads a count the van no longer has.
 * 2. WALLET_CHECK_MISMATCH (API_CONTRACT §8.5): "At most one unresolved alert per distributor". The job
 *    reads the unresolved alerts, then raises without a lock or a dedupe key, so two runs at once (two API
 *    instances while a Railway deploy overlaps 03:30, or an engineer's manual run during the cron) raise
 *    two CRITICAL alerts for one wallet (the van check takes an advisory lock for exactly this).
 */
import type { INestApplication } from '@nestjs/common';
import { AlertType, TripStatus } from '@prisma/client';
import { createTestApp } from '../../helpers/app';
import { createTrip, describeDb, getTestPrisma, placeOnVanFromEarlierRun } from '../../helpers';
import { AlertsService } from '../../../src/modules/alerts/alerts.service';
import { VanCheckJob } from '../../../src/modules/custody/van-check.job';
import { WalletCheckJob } from '../../../src/modules/wallet/wallet-check.job';
import { buildWorld, type World } from '../../inc2/scan/support/world';

describeDb('review23 robustness: the nightly jobs over two nights and two instances', () => {
  let app: INestApplication;
  let w: World;

  beforeAll(async () => {
    app = await createTestApp();
    w = await buildWorld(app);
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it('the 03:00 van check refreshes VAN_NOT_EMPTY, but the title and body the website shows keep the old count', async () => {
    const db = getTestPrisma();
    // Night 1: two cylinders left on Kashif's van from an earlier (finished) run.
    const earlier = await createTrip({ driver: w.std.DR1, distributor: w.std.DA, status: TripStatus.COMPLETED });
    for (const n of [1, 2]) {
      await placeOnVanFromEarlierRun({ cylinder: w.ag(n), vehicleId: w.std.DR1.vehicleId as string, earlierTripId: earlier.id, actor: w.std.DR1 });
    }
    const job = app.get(VanCheckJob);
    expect((await job.run()).vans).toBe(1);
    // Next day the shop receives one of them; the van still holds one at the next 03:00.
    expect((await w.receive(1)).status).toBe(201);
    expect((await job.run()).vans).toBe(1);

    const alerts = await db.alert.findMany({ where: { alertType: AlertType.VAN_NOT_EMPTY } });
    expect(alerts).toHaveLength(1);
    expect((alerts[0].context as { count: number }).count).toBe(1);
    const shown = await w.as(w.std.SA1).get('/alerts?status=OPEN');
    const van = (shown.body as Array<{ alertType: string; title: string; body: string }>).find((a) => a.alertType === 'VAN_NOT_EMPTY');
    // eslint-disable-next-line no-console
    console.log(`[van alert] context.count=${(alerts[0].context as { count: number }).count} title="${van?.title}" body="${van?.body}"`);
    expect(van?.title).toContain('(1)');
  });

  it('two wallet checks at once raise one WALLET_CHECK_MISMATCH for one broken wallet', async () => {
    const db = getTestPrisma();
    await db.$executeRaw`UPDATE distributors SET advance_balance_paisa = advance_balance_paisa + 100 WHERE id = ${w.std.DB.id}::uuid`;
    const job = app.get(WalletCheckJob);
    // Two runs whose checks of the unresolved alerts both happen before either raise lands (two instances
    // at 03:30; on RDS each step is a network round trip). The first raise waits until the second run has
    // read the alerts and raises too: nothing (no lock, no key) keeps the second one out.
    const alerts = app.get(AlertsService);
    const raise = alerts.raise.bind(alerts);
    let release: () => void = () => undefined;
    const secondRunRaising = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const spy = jest.spyOn(alerts, 'raise').mockImplementation(async (input, tx) => {
      calls += 1;
      if (calls === 1) await Promise.race([secondRunRaising, new Promise((resolve) => setTimeout(resolve, 5_000))]);
      else release();
      return raise(input, tx);
    });
    const runs = await Promise.all([job.run(), job.run()]);
    spy.mockRestore();
    expect(runs.map((run) => run.mismatches)).toEqual([1, 1]);
    const raised = await db.alert.count({ where: { alertType: AlertType.WALLET_CHECK_MISMATCH, resourceId: w.std.DB.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } } });
    // Put the wallet back so the suite-wide wallet check stays clean.
    await db.$executeRaw`UPDATE distributors SET advance_balance_paisa = advance_balance_paisa - 100 WHERE id = ${w.std.DB.id}::uuid`;
    // eslint-disable-next-line no-console
    console.log(`[wallet check] unresolved WALLET_CHECK_MISMATCH alerts for one wallet after two runs at once: ${raised}`);
    expect(raised).toBe(1);
  });
});
