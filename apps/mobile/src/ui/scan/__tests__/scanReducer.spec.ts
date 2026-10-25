/**
 * DRV-035 (AUTO-UNIT): the driver app's scan loop (scanReducer.ts) and its feedback (useScanFeedback.ts),
 * with a fake clock and a mocked send. The phone has no test runner of its own, so this file runs under
 * the API's jest (node, ts-jest), the way the other app-logic cases do: it imports nothing native, and
 * React Native's Vibration is mocked.
 */
import { Vibration } from 'react-native';
import {
  HELD_GAP_MS,
  REARM_AFTER_REFUSAL_MS,
  REARM_AFTER_SUCCESS_MS,
  SAME_CODE_IGNORE_MS,
  SCAN_BUZZ,
  createScanLoop,
  feedbackFor,
  initialScanLoopState,
  scanReducer,
  type PendingScan,
  type ScanLoop,
} from '../scanReducer';
import { playScanFeedback } from '../useScanFeedback';

jest.mock('react-native', () => ({
  Vibration: { vibrate: jest.fn() },
  Platform: { OS: 'android' },
  AccessibilityInfo: { announceForAccessibility: jest.fn() },
}));

interface Reply {
  done: number;
}

interface Deferred {
  resolve: (reply: Reply) => void;
  reject: (error: unknown) => void;
}

interface Sent {
  scan: PendingScan;
  answer: Deferred;
}

/** A refusal and a no-answer as the API client rejects them (`code`, and `retryable` for no answer). */
const offline = { code: 'NETWORK_OFFLINE', retryable: true };
const notFull = { code: 'SCAN_NOT_FULL', retryable: false };

/** Lets the loop's `.then` run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(start = 100_000): { loop: ScanLoop<Reply>; sent: Sent[]; clock: { now: number } } {
  const clock = { now: start };
  let ids = 0;
  const sent: Sent[] = [];
  const loop = createScanLoop<Reply>({
    send: (scan) =>
      new Promise<Reply>((resolve, reject) => {
        sent.push({ scan, answer: { resolve, reject } });
      }),
    outcomeOf: () => 'recorded',
    failureOf: (error) => {
      const e = error as { code: string; retryable: boolean };
      return e.retryable ? { kind: 'notSent' } : { kind: 'refused', code: e.code };
    },
    newScanId: () => `scan-${++ids}`,
    now: () => clock.now,
  });
  return { loop, sent, clock };
}

describe('DRV-035 Scan reducer ignores repeat reads, keeps unsent scans and never moves the counter on a refusal', () => {
  it('DRV-035 step 1: one onScan call with the trimmed code and a new scanId; the same read 1.0 s later is ignored', async () => {
    const { loop, sent, clock } = harness();
    expect(loop.read(' AG-C0001-QR ')).toBe('scan-1');
    expect(sent).toHaveLength(1);
    expect(sent[0].scan.code).toBe('AG-C0001-QR');
    expect(sent[0].scan.scanId).toBe('scan-1');
    expect(sent[0].scan.entryMethod).toBe('QR');
    sent[0].answer.resolve({ done: 1 });
    await settle();

    clock.now += 1_000;
    expect(loop.read(' AG-C0001-QR ')).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('DRV-035 step 2: the same value 3.0 s after the first read is a second onScan call with a different scanId', async () => {
    const { loop, sent, clock } = harness();
    loop.read('AG-C0001-QR');
    sent[0].answer.resolve({ done: 1 });
    await settle();

    clock.now += 3_000;
    expect(SAME_CODE_IGNORE_MS).toBe(2_500);
    expect(loop.read('AG-C0001-QR')).toBe('scan-2');
    expect(sent).toHaveLength(2);
    expect(sent[1].scan.scanId).not.toBe(sent[0].scan.scanId);
  });

  it('DRV-035 a label held in front of the camera is sent once, however long it stays; moved away and back, it reads again', async () => {
    const { loop, sent, clock } = harness();
    loop.read('AG-C0001-QR');
    sent[0].answer.resolve({ done: 1 });
    await settle();
    // The camera reports the label in view every 200 ms for 6 seconds (DRV-017 step 4: nothing happens).
    for (let i = 0; i < 30; i += 1) {
      clock.now += 200;
      expect(loop.read('AG-C0001-QR')).toBeNull();
    }
    expect(sent).toHaveLength(1);
    // Taken out of view for a second, then shown again: a new read (the server answers "already").
    clock.now += 1_000;
    expect(HELD_GAP_MS).toBeLessThan(1_000);
    expect(loop.read('AG-C0001-QR')).toBe('scan-2');
    expect(sent).toHaveLength(2);
  });

  it('DRV-035 step 3: a new value while a request is in flight waits; only one request is in flight at a time', async () => {
    const { loop, sent, clock } = harness();
    loop.read('AG-C0001-QR');
    clock.now += 100;
    expect(loop.read('AG-C0002-QR')).toBe('scan-2');
    expect(sent).toHaveLength(1);
    expect(loop.getState().inFlight?.code).toBe('AG-C0001-QR');
    expect(loop.getState().waiting.map((scan) => scan.code)).toEqual(['AG-C0002-QR']);

    sent[0].answer.resolve({ done: 1 });
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent[1].scan.code).toBe('AG-C0002-QR');
    expect(loop.getState().waiting).toHaveLength(0);
  });

  it('DRV-035 step 4: no answer puts the read on the "Not saved" list and moves nothing; Retry sends the same scanId', async () => {
    const { loop, sent, clock } = harness();
    loop.read('AG-C0001-QR');
    sent[0].answer.reject(offline);
    await settle();

    const state = loop.getState();
    expect(state.unsaved.map((scan) => scan.scanId)).toEqual(['scan-1']);
    expect(state.event).toBe('notSaved');
    // No answer is not an answer: the strip and the counter keep what the server last said (nothing).
    expect(state.last).toBeNull();
    expect(state.inFlight).toBeNull();

    clock.now += 5_000;
    loop.retry();
    expect(sent).toHaveLength(2);
    expect(sent[1].scan.scanId).toBe(sent[0].scan.scanId);
    // While it is resent it stays on the list; the answer takes it off.
    expect(loop.getState().unsaved).toHaveLength(1);
    sent[1].answer.resolve({ done: 1 });
    await settle();
    expect(loop.getState().unsaved).toHaveLength(0);
    expect(loop.getState().last?.kind).toBe('recorded');
  });

  it('DRV-035 step 4: a "Not saved" label read again is resent with its first scanId, never as a second move', async () => {
    const { loop, sent, clock } = harness();
    loop.read('AG-C0001-QR');
    sent[0].answer.reject(offline);
    await settle();

    clock.now += 5_000;
    expect(loop.read('AG-C0001-QR')).toBe('scan-1');
    expect(sent).toHaveLength(2);
    expect(sent[1].scan.scanId).toBe('scan-1');
  });

  it('DRV-035 step 5: a refusal shows its code and moves nothing; the camera re-arms 1.2 s after it', async () => {
    const { loop, sent, clock } = harness();
    loop.read('AG-C0004-QR');
    const refusedAt = clock.now;
    sent[0].answer.reject(notFull);
    await settle();

    const state = loop.getState();
    expect(state.last?.kind).toBe('refused');
    expect(state.last && state.last.kind === 'refused' ? state.last.code : null).toBe('SCAN_NOT_FULL');
    expect(state.unsaved).toHaveLength(0);
    expect(state.event).toBe('refused');

    clock.now = refusedAt + REARM_AFTER_REFUSAL_MS - 1;
    expect(loop.read('AG-C0001-QR')).toBeNull();
    clock.now = refusedAt + REARM_AFTER_REFUSAL_MS;
    expect(loop.read('AG-C0001-QR')).not.toBeNull();
    expect(REARM_AFTER_REFUSAL_MS).toBe(1_200);
  });

  it('DRV-035 step 5: the camera re-arms 0.6 s after a success', async () => {
    const { loop, sent, clock } = harness();
    loop.read('AG-C0001-QR');
    const answeredAt = clock.now;
    sent[0].answer.resolve({ done: 1 });
    await settle();

    clock.now = answeredAt + REARM_AFTER_SUCCESS_MS - 1;
    expect(loop.read('AG-C0002-QR')).toBeNull();
    clock.now = answeredAt + REARM_AFTER_SUCCESS_MS;
    expect(loop.read('AG-C0002-QR')).not.toBeNull();
    expect(REARM_AFTER_SUCCESS_MS).toBe(600);
  });

  it('DRV-035 a typed number is a deliberate tap: never held back by the re-arm or the 2.5-second rule', async () => {
    const { loop, sent } = harness();
    loop.read('42', { entryMethod: 'TYPED' });
    sent[0].answer.reject(notFull);
    await settle();
    // Straight after the refusal, still inside the re-arm.
    expect(loop.read('42', { entryMethod: 'TYPED' })).toBe('scan-2');
    expect(sent[1].scan.entryMethod).toBe('TYPED');
  });

  it('DRV-035 a take-back read keeps the state tapped when it was read, also when it is resent', async () => {
    const { loop, sent, clock } = harness();
    loop.read('AG-C0012-QR', { returnState: 'PART_FILLED' });
    sent[0].answer.reject(offline);
    await settle();
    clock.now += 5_000;
    loop.retry();
    expect(sent[1].scan.returnState).toBe('PART_FILLED');
  });

  it('DRV-035 the reducer leaves the state untouched for an answer to a read that is not in flight', () => {
    const state = initialScanLoopState<Reply>();
    expect(scanReducer(state, { type: 'answered', scanId: 'nope', outcome: 'recorded', reply: { done: 1 }, at: 0 })).toBe(state);
    expect(scanReducer(state, { type: 'retry' })).toBe(state);
    expect(scanReducer(state, { type: 'read', scan: { scanId: 'x', code: '   ', entryMethod: 'QR', at: 0 } })).toBe(state);
  });

  it('DRV-035 useScanFeedback: a short buzz when recorded, a double one when refused, a stutter when not saved, a long one at the count, none when already recorded', () => {
    const vibrate = Vibration.vibrate as unknown as jest.Mock;
    vibrate.mockClear();
    playScanFeedback('recorded');
    playScanFeedback('refused');
    playScanFeedback('notSaved');
    playScanFeedback('complete');
    playScanFeedback('already');
    expect(vibrate.mock.calls).toEqual([
      [SCAN_BUZZ.recorded],
      [[...SCAN_BUZZ.refused]],
      [[...SCAN_BUZZ.notSaved]],
      [SCAN_BUZZ.complete],
    ]);
    expect(feedbackFor('already')).toBeNull();
    expect(SCAN_BUZZ.recorded).toBe(40);
    expect(SCAN_BUZZ.complete).toBe(200);
  });
});
