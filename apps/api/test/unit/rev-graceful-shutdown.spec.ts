/**
 * Regression test for review finding robustness-ops-05 (graceful shutdown). A deploy's SIGTERM runs
 * `app.close()`: Nest calls every `onModuleDestroy` first, then closes the HTTP server and waits for its
 * open requests, then calls every `onApplicationShutdown`. So a client that a request in flight still
 * needs must close in `onApplicationShutdown`: the rate limiter's Redis client here (PrismaService's
 * `$disconnect` follows the same rule; test/review/robustness-ops/graceful-shutdown.e2e-spec.ts runs an
 * order through a shutdown). And docker must wait longer than a locking transaction may take before it
 * kills the container.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { RateLimitService } from '../../src/common/rate-limit/rate-limit.service';
import { LOCKING_TX } from '../../src/modules/orders/support/tx';
import { PrismaService } from '../../src/prisma/prisma.service';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');

describe('REV robustness-ops-05 graceful shutdown', () => {
  it('REV robustness-ops-05 the rate limiter keeps its Redis client until the HTTP server has drained', async () => {
    // Nothing closes before the server stops taking and finishing requests.
    expect('onModuleDestroy' in RateLimitService.prototype).toBe(false);
    const service = new RateLimitService(new ConfigService({}));
    const disconnect = jest.fn();
    const internals = service as unknown as { client: { disconnect: () => void } | null };
    internals.client = { disconnect };
    await service.onApplicationShutdown();
    expect({ disconnects: disconnect.mock.calls.length, client: internals.client }).toEqual({ disconnects: 1, client: null });
  });

  it('REV robustness-ops-05 the database client disconnects only after the HTTP server has drained', async () => {
    // Disconnecting in onModuleDestroy answered an order waiting on its distributor-row lock with 503.
    expect(Object.prototype.hasOwnProperty.call(PrismaService.prototype, 'onModuleDestroy')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(PrismaService.prototype, 'onApplicationShutdown')).toBe(true);
    const disconnect = jest.fn().mockResolvedValue(undefined);
    await PrismaService.prototype.onApplicationShutdown.call({ $disconnect: disconnect });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('REV robustness-ops-05 docker lets a request in flight finish a locking transaction before it kills the API', () => {
    const compose = fs.readFileSync(path.join(REPO, 'infrastructure', 'aws', 'docker-compose.aws.yml'), 'utf8');
    // The longest a locking transaction may take: waiting for a connection, then its own timeout.
    const longestTxSeconds = (LOCKING_TX.maxWait + LOCKING_TX.timeout) / 1000;
    for (const service of ['api-prod', 'api-staging']) {
      const block = compose.split(new RegExp(`^  ${service}:`, 'm'))[1]?.split(/^ {2}[a-z][a-z-]*:/m)[0] ?? '';
      const grace = /^\s+stop_grace_period: (\d+)s\r?$/m.exec(block);
      expect({ service, graceSeconds: grace ? Number(grace[1]) >= longestTxSeconds : 'missing' }).toEqual({ service, graceSeconds: true });
    }
  });
});
