/**
 * MIG-011: the old demo seed refuses to run and changes nothing, and seed.ts refuses production
 * (DATA_MODEL §2.5 "Seeds", API_CONTRACT §3.7, §10.3, G11-13). The scripts run as npm runs them.
 */
import { spawnSync } from 'child_process';
import { UserStatus } from '@prisma/client';
import { API_DIR, getTestPrisma } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { createUser } from '../helpers/factories';
import { createStandardData } from '../helpers/standard-data';

function npmRun(script: string, env: Record<string, string | undefined>): { code: number; output: string } {
  const run = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    cwd: API_DIR,
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 240_000,
  });
  return { code: run.status ?? 1, output: `${run.stdout?.toString() ?? ''}\n${run.stderr?.toString() ?? ''}` };
}

async function snapshot() {
  const db = getTestPrisma();
  return {
    distributors: await db.distributor.findMany({ select: { id: true, advanceBalancePaisa: true, code: true }, orderBy: { id: 'asc' } }),
    ledger: await db.ledgerEntry.count(),
    orders: await db.order.count(),
    users: await db.user.findMany({ select: { id: true, phone: true, status: true, role: true, name: true }, orderBy: { id: 'asc' } }),
    stores: await db.store.count(),
    zones: await db.zone.count(),
  };
}

describeDb('migrations: seeds', () => {
  it('MIG-011 the old demo seed refuses to run and changes nothing; seed.ts refuses production', async () => {
    await createStandardData();
    // The seeded super admin, suspended at the switch-over (ADR-02).
    await createUser({ phone: '+923000000000', name: 'LPG Super Admin', status: UserStatus.SUSPENDED });
    const before = await snapshot();

    // Steps 1–2.
    for (const env of [{}, { ALLOW_DEMO_SEED: 'true' }]) {
      const demo = npmRun('seed:demo', env);
      expect(demo.code).not.toBe(0);
      expect(demo.output).toContain('replaced by the pilot setup script (Inc 3)');
    }
    // Step 3.
    expect(await snapshot()).toEqual(before);

    // Step 4: production is refused before any write; the suspended login stays suspended.
    const seed = npmRun('seed', { APP_ENV: 'production' });
    expect(seed.code).toBe(1);
    expect(seed.output).toContain('seed.ts is for development and test servers');
    expect(await snapshot()).toEqual(before);
    const admin = await getTestPrisma().user.findUniqueOrThrow({ where: { phone: '+923000000000' } });
    expect(admin.status).toBe(UserStatus.SUSPENDED);
    // NODE_ENV=production without APP_ENV is production too.
    const nodeProd = npmRun('seed', { APP_ENV: '', NODE_ENV: 'production' });
    expect(nodeProd.code).toBe(1);
    expect(nodeProd.output).toContain('seed.ts is for development and test servers');
    expect(await snapshot()).toEqual(before);
  }, 600_000);
});
