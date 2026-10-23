/**
 * Tests that need another Inc 1 lane's part (their case ids are listed under "casesWaiting" in the
 * foundation follow-up report). They are written in full now, against the documented contract, and
 * run once the lanes they wait on have landed:
 *
 *   SF_READY_LANES=all npm run test:e2e            # the gate, after the 8 lanes have merged
 *   SF_READY_LANES=api-orders,api-money npx jest …  # a lane checking the cases it unblocks
 *
 * Until then they show as skipped, never as passed. When every lane is merged and they are green, the
 * gate may replace `itAfter(...)` with plain `it(...)`. The Increment 1 gate did so for all of Inc 1's
 * waiting tests; the helper stays for the Inc 2 and Inc 3 lanes.
 */

/** The Inc 1 lanes (inc1_lanes.json). */
export type Lane =
  | 'api-money'
  | 'api-orders'
  | 'api-security'
  | 'expenses'
  | 'mobile-distributor'
  | 'mobile-driver'
  | 'admin-web-money'
  | 'admin-web-ops';

function readyLanes(): Set<string> {
  return new Set(
    (process.env.SF_READY_LANES ?? '')
      .split(',')
      .map((lane) => lane.trim())
      .filter(Boolean),
  );
}

/** True when every lane named is marked ready in SF_READY_LANES (or it says `all`). */
export function lanesReady(lanes: readonly Lane[]): boolean {
  const ready = readyLanes();
  return ready.has('all') || lanes.every((lane) => ready.has(lane));
}

/**
 * `it` once `lanes` are ready, `it.skip` before. The test name should start with its case id; the
 * waiting lanes are appended so a skipped run says what it waits on.
 */
export function itAfter(lanes: Lane | readonly Lane[], name: string, fn: jest.ProvidesCallback, timeout?: number): void {
  const list: readonly Lane[] = typeof lanes === 'string' ? [lanes] : lanes;
  const run = lanesReady(list) ? it : it.skip;
  run(`${name} [waits on ${list.join(', ')}]`, fn, timeout);
}
