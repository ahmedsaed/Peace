import { File, Paths } from 'expo-file-system';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { buildInfo } from '../lib/build-info';
import {
  appendStall,
  jobsDuring,
  lateness,
  parseStalls,
  pruneSpans,
  STALL_MS,
  TICK_MS,
  type JobSpan,
  type Stall,
} from '../lib/stalls';
import { formatVersion } from '../lib/version';

/**
 * The stall recorder's moving parts: the watcher, the job spans, and the log
 * on disk. The decisions are in `lib/stalls.ts`.
 *
 * The log is a FILE in the documents directory, not a table or a setting. It
 * describes this phone and this install, so it must not travel in a backup and
 * arrive on another device describing freezes that never happened there; and
 * it is diagnostics, not data, so it does not belong in the ledger's schema.
 * Nothing is ever sent anywhere — About shows it, and Copy is the only way out.
 */

const BUILD = formatVersion(buildInfo);

/**
 * A gap longer than this is the app having been SUSPENDED, not stuck: Android
 * stops JS timers in the background, and an AppState event can arrive after
 * the first late tick. No real freeze of this length has gone unnoticed.
 */
const SUSPENDED_MS = 2 * 60_000;

let spans: JobSpan[] = [];
/** Whether the watcher is running. Before it is, a slow sync job reports itself. */
let watching = false;

function logFile(): File {
  return new File(Paths.document, 'stalls.json');
}

export function readStalls(): Stall[] {
  try {
    const file = logFile();
    return file.exists ? parseStalls(file.textSync()) : [];
  } catch (e) {
    console.warn('[stalls] could not read the log', e);
    return [];
  }
}

function record(stall: Stall): void {
  // Also to the console, so `adb logcat | grep stalls` sees it live.
  console.warn(`[stalls] ${stall.ms}ms: ${stall.jobs.join(', ') || 'nothing tracked'}`);
  try {
    const file = logFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(appendStall(readStalls(), stall)));
  } catch (e) {
    console.warn('[stalls] could not write the log', e);
  }
}

export function clearStalls(): void {
  try {
    const file = logFile();
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('[stalls] could not clear the log', e);
  }
}

function begin(name: string): JobSpan {
  const span: JobSpan = { name, start: Date.now(), end: null };
  spans = [...pruneSpans(spans, span.start), span];
  return span;
}

/**
 * Run `work` under a name, so a stall that overlaps it names it.
 *
 * Name the PHASES of anything long (`backup:zip`, `backup:seal`), not just the
 * whole: "the backup froze the app" is where the investigation starts, and
 * the phase is where it ends.
 */
export async function track<T>(name: string, work: () => Promise<T>): Promise<T> {
  const span = begin(name);
  try {
    return await work();
  } finally {
    span.end = Date.now();
  }
}

/**
 * `track` for synchronous work.
 *
 * The one kind that can stall the app before the watcher exists — migrations
 * and seeding run while the first screen is still gated — so until it does, a
 * slow one writes itself down.
 */
export function trackSync<T>(name: string, work: () => T): T {
  const span = begin(name);
  try {
    return work();
  } finally {
    span.end = Date.now();
    const ms = span.end - span.start;
    // Foreground only: the backup also runs from a headless background task,
    // where a slow step freezes nothing anybody is looking at.
    if (!watching && ms >= STALL_MS && AppState.currentState === 'active') record({ at: span.end, ms, jobs: [name], build: BUILD });
  }
}

/**
 * Renders nothing; ticks while the app is in the foreground.
 *
 * Mount it FIRST among the launch-time jobs: sibling effects run in order, and
 * a watcher that starts after the backup has already taken the thread cannot
 * see the freeze it is here for.
 */
export function StallWatch(): null {
  useEffect(() => {
    watching = true;
    let previous: number | null = AppState.currentState === 'active' ? Date.now() : null;

    const timer = setInterval(() => {
      const now = Date.now();
      if (AppState.currentState !== 'active') {
        previous = null;
        return;
      }
      const late = previous === null ? null : lateness(previous, now);
      if (late !== null && late < SUSPENDED_MS) {
        record({ at: now, ms: late, jobs: jobsDuring(spans, now - late, now), build: BUILD });
      }
      previous = now;
    }, TICK_MS);

    const subscription = AppState.addEventListener('change', (next) => {
      // The clock restarts on return: time spent in the background is not a stall.
      previous = next === 'active' ? Date.now() : null;
    });

    return () => {
      watching = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  return null;
}
