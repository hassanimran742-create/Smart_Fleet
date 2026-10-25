/**
 * REVIEW23 holder-scans-02 and holder-scans-04: the driver app's next step follows the trip's own van list.
 *
 * `GET /trips/:id` sends the van's counts (`van.total`, every cylinder on it) and `van.cylinders`, the
 * cylinders from the trip's point of view: the list "Finish trip" refuses on (TRIP_VAN_NOT_EMPTY) and the
 * server's COMPLETE follows (API_CONTRACT §9.13). A refill's cylinder, another open run's delivery on the
 * same van, or a cylinder marked lost on the van counts in `total` but isn't the trip's. The app used to
 * read `total`, so after the last visit it sent the driver to "Unload at store" (and outlined "Finish
 * trip") for a cylinder that wasn't his trip's to unload. It now reads the list, and falls back to the total
 * only against a server that doesn't send it. Today's van row keeps the van's own counts.
 *
 * The phone has no UI test runner: the rules run as plain logic (tripModel.ts), and the screens are read
 * as source.
 */
import * as fs from 'fs';
import * as path from 'path';

const MOBILE_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'mobile', 'src');
const DRIVER = path.join(MOBILE_SRC, 'screens', 'driver');

/* eslint-disable @typescript-eslint/no-var-requires */
const model = require(path.join(DRIVER, 'tripModel.ts')) as typeof import('../../../../mobile/src/screens/driver/tripModel');
/* eslint-enable @typescript-eslint/no-var-requires */

type TripDetail = import('../../../../mobile/src/screens/driver/tripModel').TripDetail;
type VanOnTrip = import('../../../../mobile/src/screens/driver/tripModel').VanOnTrip;

const LOST_ON_VAN = { shortCode: 'AG-C0003', sizeLabel: '11.8 kg', state: 'LOST', came: 'SPARE' } as const;

/** A trip whose load and visits are all done, with `van` as the server sent it. */
function finishedVisits(van: VanOnTrip | null): TripDetail {
  const stop = (id: string, seq: number, type: 'STORE_PICKUP' | 'DELIVERY') => ({ id, seq, type, status: 'DONE', orderId: type === 'DELIVERY' ? 'order-1' : null });
  return {
    id: 'trip-1',
    status: 'IN_PROGRESS',
    stops: [stop('stop-load', 0, 'STORE_PICKUP'), stop('stop-sana', 1, 'DELIVERY')],
    orders: [],
    van,
    allowedActions: [],
  } as unknown as TripDetail;
}

describe('REV23 holder-scans-02 / holder-scans-04 the driver app reads the trip\'s own van list', () => {
  it('REV23 holder-scans-04 a refill cylinder on the van (total 1, the trip\'s list empty) leaves Finish trip next, not Unload', () => {
    const trip = finishedVisits({ full: 0, empty: 1, partFilled: 0, total: 1, cylinders: [] });
    expect(model.tripVanLeftOf(trip)).toBe(0);
    expect(model.nextStep(trip)).toEqual({ kind: 'FINISH' });
    expect(model.unloadStepState(trip)).toBe('DONE');
  });

  it('REV23 holder-scans-02 another open run\'s delivery on the same van isn\'t this run\'s to unload', () => {
    // AG-C0002 is on LEA-101 for Usman's run: in the counts, not in this run's list.
    const trip = finishedVisits({ full: 1, empty: 0, partFilled: 0, total: 1, cylinders: [] });
    expect(model.nextStep(trip).kind).toBe('FINISH');
  });

  it('REV23 holder-scans-02 the trip\'s own leftovers still send the driver to Unload', () => {
    const trip = finishedVisits({ full: 0, empty: 1, partFilled: 0, total: 2, cylinders: [{ ...LOST_ON_VAN, state: 'EMPTY', came: 'TAKEN_BACK' }] });
    expect(model.tripVanLeftOf(trip)).toBe(1);
    expect(model.nextStep(trip)).toEqual({ kind: 'UNLOAD' });
    expect(model.unloadStepState(trip)).toBe('NEXT');
  });

  it('REV23 holder-scans-04 against a server without van.cylinders the app falls back to the van\'s total', () => {
    const older = finishedVisits({ full: 0, empty: 1, partFilled: 0, total: 1 });
    expect(model.tripVanLeftOf(older)).toBe(1);
    expect(model.nextStep(older)).toEqual({ kind: 'UNLOAD' });
    expect(model.tripVanLeftOf(finishedVisits(null))).toBe(0);
  });

  it('REV23 holder-scans-04 Unload\'s Finish trip and the Trip screen\'s Unload row use the trip\'s list; Today\'s van row keeps the van\'s counts', () => {
    const unload = fs.readFileSync(path.join(DRIVER, 'UnloadScreen.tsx'), 'utf8');
    const tripScreen = fs.readFileSync(path.join(DRIVER, 'TripScreen.tsx'), 'utf8');
    const vanRow = fs.readFileSync(path.join(DRIVER, 'VanRow.tsx'), 'utf8');
    // The footer's variant ("Finish trip" filled at 0, outlined while the trip has cylinders to unload).
    expect(unload).toMatch(/const left = data \? tripVanLeftOf\(data\) : 0;/);
    expect(unload).toMatch(/variant=\{left === 0 \? 'primary' : 'secondary'\}/);
    expect(tripScreen).toMatch(/const onVan = tripVanLeftOf\(trip\);/);
    // Neither screen reads the van's total for the trip's step any more.
    expect(`${unload}\n${tripScreen}`).not.toMatch(/van\??\.total/);
    // Today's van row: the van's own counts (GET /driver/home), everything on it.
    expect(vanRow).toMatch(/vanCountsLine\(home\.van, t\)/);
  });
});
