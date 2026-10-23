/**
 * Inc 2 scan-lane tests that need a change in a file this lane doesn't own. They are written in full
 * against the documented contract and run once the change has landed:
 *
 *   SF_READY_LANES=drivers-vehicle-guard npx jest -c test/jest-e2e.json test/inc2/scan
 *   SF_READY_LANES=all npm run test:e2e        # the gate, once every request is applied
 *
 * Until then they show as skipped, never as passed (the same rule as helpers/waiting.ts for Inc 1).
 */

/** The changes these tests wait on (named in the scan lane's requests). */
export type ScanLaneWait = 'drivers-vehicle-guard';

function ready(lane: ScanLaneWait): boolean {
  const lanes = new Set(
    (process.env.SF_READY_LANES ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  return lanes.has('all') || lanes.has(lane);
}

/** `it` once `lane` is ready, `it.skip` before; the name says what it waits on. */
export function itWhenReady(lane: ScanLaneWait, name: string, fn: jest.ProvidesCallback, timeout?: number): void {
  (ready(lane) ? it : it.skip)(`${name} [waits on ${lane}]`, fn, timeout);
}
