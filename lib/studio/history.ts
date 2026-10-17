/**
 * Undo/redo history for the editor draft. Changes made in quick succession (typing) are merged into
 * one step so a single undo removes a burst of keystrokes rather than one character.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Time of the last change, used to merge bursts. */
  at: number;
}

export const HISTORY_LIMIT = 100;
export const MERGE_WINDOW_MS = 800;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], at: 0 };
}

/**
 * Records a change. Typing bursts (merge = true) within MERGE_WINDOW_MS share one undo step. A discrete
 * action (merge = false, e.g. applying Mock AI suggestions) always gets its own step and is never merged
 * with the typing before or after it.
 */
export function pushHistory<T>(h: History<T>, next: T, now: number, merge = true): History<T> {
  if (Object.is(next, h.present)) return h;
  const burst = merge && h.past.length > 0 && h.at > 0 && now - h.at < MERGE_WINDOW_MS;
  const past = burst ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], at: merge ? now : 0 };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], at: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest, at: 0 };
}

/** Replace the present without an undo step (e.g. after a save assigns the project id). */
export function replacePresent<T>(h: History<T>, present: T): History<T> {
  return { ...h, present };
}
