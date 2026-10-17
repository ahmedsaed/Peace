/**
 * Noticing when the JavaScript thread stops answering, and what was running.
 *
 * Every tap, every scroll handler and every render goes through ONE thread. A
 * synchronous step that takes three seconds — packing a backup, hashing a
 * passphrase — is three seconds in which the screen still draws but nothing on
 * it responds, which is exactly what a person describes as "the app froze".
 * Android cannot see it: its own UI thread is fine, so there is no ANR, no
 * crash and nothing in Play's vitals. The only way to catch one is from the
 * inside.
 *
 * A timer that should fire every `TICK_MS` and fires seconds late IS the
 * measurement: the lateness is how long the thread was busy. On its own that
 * says when, not why — so long-running work wraps itself in `track`, and a
 * stall is written down with every job whose span overlapped it. The job does
 * not have to still be running when the late tick lands, which is the common
 * case: the thread is blocked BY the job, and the tick only fires once it lets go.
 *
 * Pure: no timers, no files, no React. `state/stalls.ts` owns those.
 */

/** How often the watcher expects to be called. */
export const TICK_MS = 250;

/** Lateness worth writing down: about where a tap starts to feel ignored. */
export const STALL_MS = 500;

/** How many stalls are kept. Old ones are of no use once the cause is known. */
export const MAX_STALLS = 30;

/** How long a finished job's span is kept for matching against a late tick. */
const SPAN_MEMORY_MS = 5 * 60_000;

export type Stall = {
  /** When the thread came back, epoch ms. */
  at: number;
  /** How long it was gone. */
  ms: number;
  /** Every tracked job that was running at some point during the stall. */
  jobs: string[];
  /** `1.33.0 (412)`: a log that outlives an update must say which build froze. */
  build: string;
};

export type JobSpan = { name: string; start: number; end: number | null };

/**
 * How long the thread was away, if long enough to count.
 *
 * `previous` is the last tick's time. The tick was due `TICK_MS` after it; any
 * time past that is time the thread spent elsewhere.
 */
export function lateness(previous: number, now: number): number | null {
  const late = now - previous - TICK_MS;
  return late >= STALL_MS ? late : null;
}

/**
 * Names of the jobs that overlap [from, to], in the order they started.
 *
 * A job still running counts as running until `to`. Phases of one job are
 * separate names (`backup:zip`), so the answer says WHICH step held the thread.
 */
export function jobsDuring(spans: JobSpan[], from: number, to: number): string[] {
  const names: string[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const end = span.end ?? to;
    if (span.start <= to && end >= from && !names.includes(span.name)) names.push(span.name);
  }
  return names;
}

/** Spans worth keeping: still running, or finished recently enough to match. */
export function pruneSpans(spans: JobSpan[], now: number): JobSpan[] {
  return spans.filter((s) => s.end === null || now - s.end <= SPAN_MEMORY_MS);
}

/** Newest first, capped. */
export function appendStall(log: Stall[], stall: Stall): Stall[] {
  return [stall, ...log].slice(0, MAX_STALLS);
}

/**
 * Read a stored log, trusting nothing about it.
 *
 * It is a file a previous build wrote. A shape this build does not recognise
 * is discarded rather than allowed to crash the screen that shows it.
 */
export function parseStalls(text: string | null): Stall[] {
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (s): s is Stall =>
          typeof s === 'object' &&
          s !== null &&
          typeof s.at === 'number' &&
          typeof s.ms === 'number' &&
          Array.isArray(s.jobs) &&
          s.jobs.every((j: unknown) => typeof j === 'string') &&
          typeof s.build === 'string'
      )
      .slice(0, MAX_STALLS);
  } catch {
    return [];
  }
}

/** One line per stall, for pasting into a bug report. */
export function stallReport(log: Stall[]): string {
  return log
    .map(
      (s) =>
        `${new Date(s.at).toISOString()}  ${(s.ms / 1000).toFixed(1)}s  ${
          s.jobs.length > 0 ? s.jobs.join(', ') : 'nothing tracked'
        }  [${s.build}]`
    )
    .join('\n');
}
