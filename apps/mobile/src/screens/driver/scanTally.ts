import { create } from 'zustand';

/** The steps an Inc 1 tally counts (the Unload step counts down the van instead). */
export type TallyStep = 'LOAD' | 'HANDOVER' | 'TAKE_BACK';

/**
 * The Inc 1 tally (driver spec §1.5). `POST /custody/scan` answers only "recorded" or "already
 * recorded" and sends no progress, so a step screen's "2 of 3 scanned" counts the different cylinders
 * the server confirmed on that step of that trip (recorded or already recorded). It lives in memory
 * while the app runs, is never saved and never sent, and never blocks a button: after a restart it
 * reads "0 of 3 scanned", and scanning the same cylinders again fills it back up. Inc 2 replaces it
 * with the server's progress.
 */
const useTallyStore = create<{ codes: Readonly<Record<string, readonly string[]>> }>(() => ({ codes: {} }));

/** One step of one stop of one trip. */
export function tallyKey(tripId: string, stopId: string, step: TallyStep): string {
  return `${tripId}|${stopId}|${step}`;
}

/** The step's count; 0 for no step (`null`). */
export function useScanTally(key: string | null): number {
  return useTallyStore((state) => (key ? (state.codes[key]?.length ?? 0) : 0));
}

/** Counts a cylinder the server confirmed on this step, once. */
export function addToTally(key: string, code: string): void {
  useTallyStore.setState((state) => {
    const codes = state.codes[key] ?? [];
    if (codes.includes(code)) return state;
    return { codes: { ...state.codes, [key]: [...codes, code] } };
  });
}
