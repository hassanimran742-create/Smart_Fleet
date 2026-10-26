/**
 * The read loop of the scan panel (UX_MOBILE §7.1; driver spec R-SP), as plain logic with no React and
 * no React Native, so it runs with a fake clock anywhere (TEST_CASES DRV-035):
 * - a read is trimmed; the same QR label is ignored for 2.5 seconds, and for as long as it is held in
 *   front of the camera (seen again within 0.8 s); so is a label already waiting or being sent; a "Not
 *   saved" label read again is resent with its first scan id;
 * - one request is in flight at a time; a read that comes meanwhile waits its turn;
 * - every read gets its own scan id, kept for every resend of it, so the server records it once;
 * - a read that got no answer goes to the "Not saved" list (the counter doesn't move); one Retry resends
 *   the whole list, in order, each with its first scan id;
 * - a refusal shows with its code (the counter doesn't move);
 * - the camera re-arms 600 ms after an answer and 1.2 seconds after a refusal or no answer. A typed
 *   number is a deliberate tap, so it is never held back by the re-arm or the 2.5 seconds.
 *
 * `scanReducer` is the pure state change; `createScanLoop` runs it, sends each read and feeds the answers
 * back. ScanPanel wraps one loop per step screen.
 */

/** How a cylinder number reached the phone: a QR read, or typed by hand. */
export type ScanEntryMethod = 'QR' | 'TYPED';

/** The state the driver taps for a take-back (API_CONTRACT §9.3 `returnState`). */
export type ScanReturnState = 'EMPTY' | 'PART_FILLED' | 'FULL';

/** The same QR label is ignored for this long after it was read. */
export const SAME_CODE_IGNORE_MS = 2_500;
/**
 * The camera reports a label in view several times a second. The label just taken, seen again within
 * this gap, is still being held there: ignored however long it stays, so only moving it away and back
 * reads it again.
 */
export const HELD_GAP_MS = 800;
/** After an answer (recorded or already recorded), camera reads wait this long. */
export const REARM_AFTER_SUCCESS_MS = 600;
/** After a refusal, or no answer, camera reads wait this long. */
export const REARM_AFTER_REFUSAL_MS = 1_200;
/** At most this many reads wait behind the one in flight; more are dropped (the label is read again). */
export const MAX_WAITING = 10;

/** One read on its way to the server. */
export interface PendingScan {
  /** A new id per read, kept for every resend of that read. */
  scanId: string;
  /** The label's value, trimmed (or the typed number). */
  code: string;
  entryMethod: ScanEntryMethod;
  /** The tapped state, for a take-back: the one shown when the read was made. */
  returnState?: ScanReturnState;
  lat?: number;
  lng?: number;
  /** When it was read (ms). */
  at: number;
}

/** What the server said about a read: the strip shows the last of these. */
export type ScanSettled<R> =
  | { kind: 'recorded' | 'already'; scan: PendingScan; reply: R; at: number }
  | { kind: 'refused'; scan: PendingScan; error: unknown; code: string; at: number };

/** The last thing that happened, for the buzz and the screen reader (once per `seq`). */
export type ScanLoopEventKind = 'none' | 'recorded' | 'already' | 'refused' | 'notSaved';

export interface ScanLoopState<R> {
  /** The read being sent; null when none is. */
  inFlight: PendingScan | null;
  /** Reads waiting for their turn, oldest first. */
  waiting: readonly PendingScan[];
  /** Reads that got no answer, oldest first: "Not saved: 2". */
  unsaved: readonly PendingScan[];
  /** Scan ids of the "Not saved" reads being resent by Retry, in order. */
  retrying: readonly string[];
  /** The last accepted read, for the 2.5-second rule. */
  lastRead: { code: string; at: number } | null;
  /** Camera reads before this moment are ignored (the re-arm). */
  armedAt: number;
  /** The server's last answer; null before the first. */
  last: ScanSettled<R> | null;
  /** Counts the answers and the failures, so feedback runs once for each. */
  seq: number;
  event: ScanLoopEventKind;
}

export type ScanLoopEvent<R> =
  /** `held`: the same label was in view a moment ago (the controller tracks every sighting). */
  | { type: 'read'; scan: PendingScan; held?: boolean }
  | { type: 'start' }
  | { type: 'answered'; scanId: string; outcome: 'recorded' | 'already'; reply: R; at: number }
  | { type: 'refused'; scanId: string; error: unknown; code: string; at: number }
  | { type: 'notSent'; scanId: string; at: number }
  | { type: 'retry' };

export function initialScanLoopState<R>(): ScanLoopState<R> {
  return {
    inFlight: null,
    waiting: [],
    unsaved: [],
    retrying: [],
    lastRead: null,
    armedAt: 0,
    last: null,
    seq: 0,
    event: 'none',
  };
}

/** True when the code is already waiting or being sent: a second read of it adds nothing. */
function isQueued<R>(state: ScanLoopState<R>, code: string): boolean {
  return state.inFlight?.code === code || state.waiting.some((scan) => scan.code === code);
}

/** The next read to send: the Retry run first, then the waiting reads. */
export function nextToSend<R>(state: ScanLoopState<R>): { scan: PendingScan; fromRetry: boolean } | null {
  for (const id of state.retrying) {
    const scan = state.unsaved.find((candidate) => candidate.scanId === id);
    if (scan) return { scan, fromRetry: true };
  }
  const waiting = state.waiting[0];
  return waiting ? { scan: waiting, fromRetry: false } : null;
}

/** The read loop's pure state change. An event that doesn't apply returns the same state object. */
export function scanReducer<R>(state: ScanLoopState<R>, event: ScanLoopEvent<R>): ScanLoopState<R> {
  switch (event.type) {
    case 'read': {
      const code = event.scan.code.trim();
      if (!code) return state;
      const camera = event.scan.entryMethod === 'QR';
      if (camera && event.held) return state;
      if (camera && event.scan.at < state.armedAt) return state;
      if (camera && state.lastRead && state.lastRead.code === code && event.scan.at - state.lastRead.at < SAME_CODE_IGNORE_MS) {
        return state;
      }
      if (isQueued(state, code)) return state;
      // A label that wasn't saved, read again: it is resent with its first scan id, never as a new move.
      const unsaved = state.unsaved.find((scan) => scan.code === code);
      if (unsaved) {
        if (state.retrying.includes(unsaved.scanId)) return state;
        return { ...state, lastRead: { code, at: event.scan.at }, retrying: [unsaved.scanId, ...state.retrying] };
      }
      if (state.waiting.length >= MAX_WAITING) return state;
      return {
        ...state,
        lastRead: { code, at: event.scan.at },
        waiting: [...state.waiting, { ...event.scan, code }],
      };
    }
    case 'start': {
      if (state.inFlight) return state;
      const next = nextToSend(state);
      if (!next) {
        // A Retry run whose reads have all gone (answered meanwhile) is over.
        return state.retrying.length ? { ...state, retrying: [] } : state;
      }
      if (next.fromRetry) {
        // The read stays on the "Not saved" list until the server answers it.
        return { ...state, inFlight: next.scan, retrying: state.retrying.filter((id) => id !== next.scan.scanId) };
      }
      return { ...state, inFlight: next.scan, waiting: state.waiting.slice(1) };
    }
    case 'answered': {
      const scan = state.inFlight;
      if (!scan || scan.scanId !== event.scanId) return state;
      return {
        ...state,
        inFlight: null,
        unsaved: state.unsaved.filter((candidate) => candidate.scanId !== scan.scanId),
        retrying: state.retrying.filter((id) => id !== scan.scanId),
        armedAt: Math.max(state.armedAt, event.at + REARM_AFTER_SUCCESS_MS),
        last: { kind: event.outcome, scan, reply: event.reply, at: event.at },
        seq: state.seq + 1,
        event: event.outcome,
      };
    }
    case 'refused': {
      const scan = state.inFlight;
      if (!scan || scan.scanId !== event.scanId) return state;
      return {
        ...state,
        inFlight: null,
        unsaved: state.unsaved.filter((candidate) => candidate.scanId !== scan.scanId),
        retrying: state.retrying.filter((id) => id !== scan.scanId),
        armedAt: Math.max(state.armedAt, event.at + REARM_AFTER_REFUSAL_MS),
        last: { kind: 'refused', scan, error: event.error, code: event.code, at: event.at },
        seq: state.seq + 1,
        event: 'refused',
      };
    }
    case 'notSent': {
      const scan = state.inFlight;
      if (!scan || scan.scanId !== event.scanId) return state;
      const listed = state.unsaved.some((candidate) => candidate.scanId === scan.scanId);
      return {
        ...state,
        inFlight: null,
        unsaved: listed ? state.unsaved : [...state.unsaved, scan],
        // No answer again: the Retry run stops; the list stays for the next Retry.
        retrying: [],
        armedAt: Math.max(state.armedAt, event.at + REARM_AFTER_REFUSAL_MS),
        seq: state.seq + 1,
        event: 'notSaved',
      };
    }
    case 'retry': {
      if (state.unsaved.length === 0 || state.retrying.length > 0) return state;
      const sending = state.inFlight?.scanId;
      return { ...state, retrying: state.unsaved.map((scan) => scan.scanId).filter((id) => id !== sending) };
    }
  }
}

/** How a failed send reads: no answer (keep it to send again), or a refusal with its code. */
export type ScanFailure = { kind: 'notSent' } | { kind: 'refused'; code: string };

export interface ScanLoopOptions<R> {
  /** Sends one read. Resolves with the server's answer; rejects with the error. */
  send: (scan: PendingScan) => Promise<R>;
  /** A new move, or one the server already had. */
  outcomeOf: (reply: R) => 'recorded' | 'already';
  failureOf: (error: unknown) => ScanFailure;
  newScanId: () => string;
  /** The clock (ms); `Date.now` by default. */
  now?: () => number;
}

export interface ReadInput {
  entryMethod?: ScanEntryMethod;
  returnState?: ScanReturnState;
  lat?: number;
  lng?: number;
}

export interface ScanLoop<R> {
  /** Feeds a read. Returns the scan id when the read was taken, null when it was ignored. */
  read: (code: string, input?: ReadInput) => string | null;
  /** Resends every "Not saved" read, one at a time, each with its first scan id. */
  retry: () => void;
  getState: () => ScanLoopState<R>;
  subscribe: (listener: () => void) => () => void;
  /** Stops feeding answers in (the screen has gone). A read still in flight is left to finish. */
  dispose: () => void;
  /** Starts again after `dispose` (a screen mounted again with the same loop). */
  resume: () => void;
}

/** Runs the read loop: one request at a time, the answers fed back into `scanReducer`. */
export function createScanLoop<R>(options: ScanLoopOptions<R>): ScanLoop<R> {
  const now = options.now ?? Date.now;
  let state = initialScanLoopState<R>();
  let disposed = false;
  const listeners = new Set<() => void>();
  // The label taken last, while it stays in view (seen again within HELD_GAP_MS). Kept out of the state,
  // so a label held in front of the camera doesn't re-render the screen on every frame.
  let holding: { code: string; at: number } | null = null;

  const dispatch = (event: ScanLoopEvent<R>) => {
    const next = scanReducer(state, event);
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const pump = () => {
    if (disposed || state.inFlight) return;
    dispatch({ type: 'start' });
    const scan = state.inFlight as PendingScan | null;
    if (!scan) return;
    let sending: Promise<R>;
    try {
      sending = Promise.resolve(options.send(scan));
    } catch (thrown) {
      sending = Promise.reject(thrown);
    }
    sending.then(
      (reply) => {
        if (disposed) return;
        dispatch({ type: 'answered', scanId: scan.scanId, outcome: options.outcomeOf(reply), reply, at: now() });
        pump();
      },
      (error: unknown) => {
        if (disposed) return;
        const failure = options.failureOf(error);
        if (failure.kind === 'notSent') dispatch({ type: 'notSent', scanId: scan.scanId, at: now() });
        else dispatch({ type: 'refused', scanId: scan.scanId, error, code: failure.code, at: now() });
        pump();
      },
    );
  };

  return {
    read(code, input = {}) {
      if (disposed) return null;
      const scan: PendingScan = {
        scanId: '',
        code,
        entryMethod: input.entryMethod ?? 'QR',
        returnState: input.returnState,
        lat: input.lat,
        lng: input.lng,
        at: now(),
      };
      const trimmed = code.trim();
      const camera = scan.entryMethod === 'QR';
      let held = false;
      if (camera && holding) {
        if (holding.code === trimmed && scan.at - holding.at < HELD_GAP_MS) {
          held = true;
          holding = { code: trimmed, at: scan.at };
        } else {
          // Out of view for a moment, or another label in front of the camera: the hold is over.
          holding = null;
        }
      }
      // The camera reports a label many times a second: most reads are ignored, and only a read that is
      // taken gets an id.
      if (scanReducer(state, { type: 'read', scan, held }) === state) return null;
      const scanId = options.newScanId();
      dispatch({ type: 'read', scan: { ...scan, scanId }, held });
      // The read waits as a new scan, or resends the unsaved read of the same label (its first id).
      const taken = state.waiting.some((candidate) => candidate.scanId === scanId)
        ? scanId
        : (state.unsaved.find((candidate) => candidate.code === trimmed)?.scanId ?? null);
      if (camera && taken) holding = { code: trimmed, at: scan.at };
      pump();
      return taken;
    },
    retry() {
      if (disposed) return;
      dispatch({ type: 'retry' });
      pump();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
    },
    resume() {
      if (!disposed) return;
      disposed = false;
      pump();
    },
  };
}

// ---- Feedback (rulebook §9.2) -----------------------------------------------------------------

/**
 * The buzz of each outcome (rulebook §9.2): a short one for a recorded scan, nothing for one already
 * recorded, a double buzz for a refusal, a stutter for no answer, and a long one when a step's count is
 * reached. Sounds wait for the 0.2.0 APK (UX_MOBILE §7.0).
 */
export const SCAN_BUZZ = {
  recorded: 40,
  refused: [0, 100, 80, 100],
  notSaved: [0, 60, 60, 60, 60, 60],
  complete: 200,
} as const;

export type ScanFeedbackKind = ScanLoopEventKind | 'complete';

/** The vibration for an outcome: a length or a pattern in ms, or null for none. */
export function feedbackFor(kind: ScanFeedbackKind): number | readonly number[] | null {
  switch (kind) {
    case 'recorded':
      return SCAN_BUZZ.recorded;
    case 'refused':
      return SCAN_BUZZ.refused;
    case 'notSaved':
      return SCAN_BUZZ.notSaved;
    case 'complete':
      return SCAN_BUZZ.complete;
    default:
      return null;
  }
}
