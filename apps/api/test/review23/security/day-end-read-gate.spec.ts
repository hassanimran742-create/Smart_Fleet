/**
 * REV23 security-02 / robustness-jobs-01: the day-end upload reads one file at a time in the process
 * (API_CONTRACT §10.5; ADR-23 runs one API instance), so a few uploads at once can't hold several workbooks
 * in memory. Another upload waits its turn (a short, bounded queue); beyond that, or past the wait, it is
 * answered 503 SERVICE_UNAVAILABLE ("try again in a minute", §2.2), never left hanging.
 */
import { ERROR_MESSAGE_EN } from '@smartfleet/shared-types';
import { AppError } from '../../../src/common/errors/app-error';
import { DayEndReadGate } from '../../../src/modules/day-end/day-end-upload-read';

/** A piece of work that runs until `finish()` is called, counting how many run at once. */
function tracker() {
  let running = 0;
  let most = 0;
  const releases: Array<() => void> = [];
  const work = (result: string) => async () => {
    running += 1;
    most = Math.max(most, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running -= 1;
    return result;
  };
  return {
    work,
    finishNext: () => releases.shift()?.(),
    get most() {
      return most;
    },
    get waitingToFinish() {
      return releases.length;
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('REV23 security-02 the day-end read gate: one file at a time', () => {
  it('REV23 security-02 a second upload waits for the first and then runs; never two at once', async () => {
    const gate = new DayEndReadGate({ maxWaiting: 2, maxWaitMs: 5_000 });
    const t = tracker();
    const first = gate.run(t.work('first'));
    const second = gate.run(t.work('second'));
    await tick();
    expect(gate.reading).toBe(true);
    expect(t.waitingToFinish).toBe(1); // only the first is running
    t.finishNext();
    await expect(first).resolves.toBe('first');
    await tick();
    expect(t.waitingToFinish).toBe(1); // now the second
    t.finishNext();
    await expect(second).resolves.toBe('second');
    expect(t.most).toBe(1);
    expect(gate.reading).toBe(false);
  });

  it('REV23 security-02 more uploads than may wait are answered 503 at once, with the catalogue words', async () => {
    const gate = new DayEndReadGate({ maxWaiting: 2, maxWaitMs: 5_000 });
    const t = tracker();
    const runs = [gate.run(t.work('a')), gate.run(t.work('b')), gate.run(t.work('c'))];
    const refused = await gate.run(t.work('d')).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(AppError);
    expect({ code: (refused as AppError).code, status: (refused as AppError).getStatus(), message: (refused as AppError).message }).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: ERROR_MESSAGE_EN.SERVICE_UNAVAILABLE,
    });
    for (let i = 0; i < 3; i++) {
      await tick();
      t.finishNext();
    }
    await expect(Promise.all(runs)).resolves.toEqual(['a', 'b', 'c']);
    expect(t.most).toBe(1);
  });

  it('REV23 security-02 a wait that runs out is answered 503 and leaves the queue; the slot then serves the next', async () => {
    const gate = new DayEndReadGate({ maxWaiting: 2, maxWaitMs: 50 });
    const t = tracker();
    const first = gate.run(t.work('first'));
    const late = gate.run(t.work('late')).catch((e: unknown) => e);
    await expect(late).resolves.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    t.finishNext();
    await expect(first).resolves.toBe('first');
    expect(gate.reading).toBe(false);
    const next = gate.run(async () => 'next');
    await expect(next).resolves.toBe('next');
  });

  it('REV23 security-02 a read that fails frees the slot', async () => {
    const gate = new DayEndReadGate({ maxWaiting: 2, maxWaitMs: 5_000 });
    await expect(gate.run(async () => Promise.reject(new AppError('DAY_SHEET_UNREADABLE')))).rejects.toMatchObject({ code: 'DAY_SHEET_UNREADABLE' });
    expect(gate.reading).toBe(false);
    await expect(gate.run(async () => 'after')).resolves.toBe('after');
  });
});
