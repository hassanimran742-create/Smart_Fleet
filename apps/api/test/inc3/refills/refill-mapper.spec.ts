/**
 * [Inc 3] The refill DTO's derived parts (API_CONTRACT §1.4, §1.6, §10.1): counts from the picked lines (a
 * refill with none keeps its legacy columns), the Inc 3 stage, the buttons each caller is offered, the
 * refill number, and which recorded moves are refill scans. No database.
 */
import { CylinderEventType } from '@prisma/client';
import { refillPhaseOfEvent } from '../../../src/modules/filling-orders/refill-scans.service';
import { refillActions, refillCountsOf, refillProgressOf, refillShortCode } from '../../../src/modules/filling-orders/refill.mapper';

const SHOP = { role: 'DISTRIBUTOR', distributorId: 'd-1' };
const OTHER_SHOP = { role: 'DISTRIBUTOR', distributorId: 'd-2' };
const OFFICE = { role: 'SUPER_ADMIN' };
const DRIVER = { role: 'DRIVER', driverId: 'dr-1' };
const OTHER_DRIVER = { role: 'DRIVER', driverId: 'dr-2' };

const line = (status: 'PICKED_UP' | 'FILLED' | 'RETURNED', filled = status === 'FILLED') => ({ status, filledAt: filled ? new Date('2026-10-24T05:00:00Z') : null });

function refill(status: string, lines: ReturnType<typeof line>[] = [], requestedCount = 2) {
  return { status, requestedCount, pickedUpEmptyCount: null, filledCount: null, cylinders: lines, distributorId: 'd-1', assignedDriverId: 'dr-1' };
}

function actions(status: string, lines: ReturnType<typeof line>[], caller: { role: string; distributorId?: string; driverId?: string }, requested = 2) {
  const row = refill(status, lines, requested);
  return refillActions(row, refillCountsOf(row), lines.filter((l) => l.status === 'PICKED_UP').length, caller);
}

describe('inc3 refills: the derived parts of a refill', () => {
  it('REF-017 counts come from the picked lines: filled of picked, received back', () => {
    expect(refillCountsOf(refill('AT_STATION', [line('FILLED'), line('PICKED_UP')]))).toEqual({ requested: 2, picked: 2, filled: 1, received: 0 });
    expect(refillCountsOf(refill('COMPLETED', [line('RETURNED', true), line('RETURNED', false)], 3))).toEqual({ requested: 3, picked: 2, filled: 1, received: 2 });
    // An Inc 1 refill (no lines) keeps its legacy counts.
    expect(refillCountsOf({ status: 'COMPLETED', requestedCount: 3, pickedUpEmptyCount: 3, filledCount: 2, cylinders: [] })).toEqual({ requested: 3, picked: 3, filled: 2, received: 3 });
    expect(refillProgressOf(refill('ASSIGNED', [line('PICKED_UP')]))).toEqual({ type: 'REFILL', status: 'ASSIGNED', requested: 2, picked: 1, filled: 0, received: 0 });
  });

  it('REF-023 the owner is offered Cancel only before the first pickup, and the office never', () => {
    expect(actions('PENDING', [], SHOP)).toEqual(['CANCEL']);
    expect(actions('ASSIGNED', [], SHOP)).toEqual(['CANCEL']);
    expect(actions('ASSIGNED', [line('PICKED_UP')], SHOP)).toEqual([]);
    expect(actions('PENDING', [], OTHER_SHOP)).toEqual([]);
    expect(actions('CANCELLED', [], SHOP)).toEqual([]);
    expect(actions('PENDING', [], OFFICE)).toEqual(['ASSIGN']);
    for (const status of ['ASSIGNED', 'EMPTIES_PICKED', 'AT_STATION', 'FILLED', 'COMPLETED', 'CANCELLED']) expect(actions(status, [], OFFICE)).toEqual([]);
  });

  it('REF-017 the assigned driver is offered the step the refill is at, and nobody else', () => {
    expect(actions('ASSIGNED', [], DRIVER)).toEqual(['PICKUP']);
    expect(actions('ASSIGNED', [line('PICKED_UP')], DRIVER)).toEqual(['PICKUP', 'LEAVE_STORE']);
    expect(actions('ASSIGNED', [line('PICKED_UP'), line('PICKED_UP')], DRIVER)).toEqual(['LEAVE_STORE']);
    expect(actions('EMPTIES_PICKED', [line('PICKED_UP'), line('PICKED_UP')], DRIVER)).toEqual(['FILL']);
    expect(actions('AT_STATION', [line('FILLED'), line('PICKED_UP')], DRIVER)).toEqual(['FILL', 'LEAVE_STATION']);
    expect(actions('AT_STATION', [line('FILLED'), line('FILLED')], DRIVER)).toEqual(['LEAVE_STATION']);
    expect(actions('FILLED', [line('FILLED'), line('PICKED_UP')], DRIVER)).toEqual([]);
    expect(actions('COMPLETED', [line('RETURNED')], DRIVER)).toEqual([]);
    expect(actions('ASSIGNED', [], OTHER_DRIVER)).toEqual([]);
  });

  it('REF-013 the refill number reads AG-R007, padded to 3 digits and printed in full when longer', () => {
    expect(refillShortCode('AG', 7)).toBe('AG-R007');
    expect(refillShortCode('BG', 1)).toBe('BG-R001');
    expect(refillShortCode('AG', 1234)).toBe('AG-R1234');
    expect(refillShortCode('AG', null)).toBeNull();
  });

  it('REF-021 only a refill move is a refill scan: a pickup (SCAN_OUT with the refill, no trip) or a fill', () => {
    expect(refillPhaseOfEvent({ eventType: CylinderEventType.SCAN_OUT, fillingOrderId: 'r-1', tripId: null })).toBe('PICKUP');
    expect(refillPhaseOfEvent({ eventType: CylinderEventType.FILLED, fillingOrderId: 'r-1', tripId: null })).toBe('FILL');
    expect(refillPhaseOfEvent({ eventType: CylinderEventType.SCAN_OUT, fillingOrderId: null, tripId: 't-1' })).toBeNull();
    expect(refillPhaseOfEvent({ eventType: CylinderEventType.SCAN_IN, fillingOrderId: 'r-1', tripId: null })).toBeNull();
  });
});
