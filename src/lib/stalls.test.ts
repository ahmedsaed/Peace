import {
  appendStall,
  jobsDuring,
  lateness,
  MAX_STALLS,
  parseStalls,
  pruneSpans,
  stallReport,
  STALL_MS,
  TICK_MS,
  type Stall,
} from './stalls';

const stall = (at: number, ms = 1_000, jobs: string[] = []): Stall => ({
  at,
  ms,
  jobs,
  build: '1.0.0 (build 1)',
});

describe('lateness', () => {
  it('is nothing for a tick that came on time', () => {
    expect(lateness(1_000, 1_000 + TICK_MS)).toBeNull();
  });

  it('is nothing for a tick that was a little late', () => {
    expect(lateness(1_000, 1_000 + TICK_MS + STALL_MS - 1)).toBeNull();
  });

  /** Lateness, not the gap: the tick was never due before TICK_MS. */
  it('counts only the time past when the tick was due', () => {
    expect(lateness(1_000, 1_000 + TICK_MS + 3_000)).toBe(3_000);
  });
});

describe('jobsDuring', () => {
  /**
   * The ordinary case, and the reason spans outlive their jobs: the job blocks
   * the thread, the late tick can only fire once it lets go, and by then the
   * job has finished.
   */
  it('names a job that finished before the late tick landed', () => {
    const spans = [{ name: 'backup:zip', start: 1_000, end: 4_000 }];
    expect(jobsDuring(spans, 900, 4_010)).toEqual(['backup:zip']);
  });

  it('names a job still running', () => {
    expect(jobsDuring([{ name: 'drive-backup', start: 1_000, end: null }], 2_000, 5_000)).toEqual([
      'drive-backup',
    ]);
  });

  it('leaves out jobs entirely before or after the stall', () => {
    const spans = [
      { name: 'before', start: 0, end: 500 },
      { name: 'after', start: 6_000, end: 7_000 },
      { name: 'during', start: 1_500, end: 2_000 },
    ];
    expect(jobsDuring(spans, 1_000, 5_000)).toEqual(['during']);
  });

  it('lists overlapping jobs in the order they started, each once', () => {
    const spans = [
      { name: 'backup:zip', start: 2_000, end: 3_000 },
      { name: 'drive-backup', start: 1_000, end: null },
      { name: 'backup:zip', start: 3_500, end: 3_600 },
    ];
    expect(jobsDuring(spans, 1_500, 4_000)).toEqual(['drive-backup', 'backup:zip']);
  });
});

describe('pruneSpans', () => {
  it('keeps running jobs however old, and drops long-finished ones', () => {
    const now = 10 * 60_000;
    const out = pruneSpans(
      [
        { name: 'running', start: 0, end: null },
        { name: 'old', start: 0, end: 1_000 },
        { name: 'recent', start: now - 2_000, end: now - 1_000 },
      ],
      now
    );
    expect(out.map((s) => s.name)).toEqual(['running', 'recent']);
  });
});

describe('appendStall', () => {
  it('puts the newest first and keeps a bounded log', () => {
    let log: Stall[] = [];
    for (let i = 0; i < MAX_STALLS + 5; i++) log = appendStall(log, stall(i));
    expect(log).toHaveLength(MAX_STALLS);
    expect(log[0].at).toBe(MAX_STALLS + 4);
  });
});

describe('parseStalls', () => {
  it('round-trips what was written', () => {
    const log = [stall(2, 800, ['backup:zip']), stall(1)];
    expect(parseStalls(JSON.stringify(log))).toEqual(log);
  });

  /** Written by some earlier build; About must not crash over it. */
  it('drops what it does not recognise rather than throwing', () => {
    expect(parseStalls(null)).toEqual([]);
    expect(parseStalls('not json')).toEqual([]);
    expect(parseStalls('{"at":1}')).toEqual([]);
    expect(parseStalls(JSON.stringify([stall(1), { at: 'yesterday' }, null]))).toEqual([
      stall(1),
    ]);
  });
});

describe('stallReport', () => {
  it('writes one line per stall with when, how long and what', () => {
    expect(
      stallReport([stall(Date.UTC(2026, 9, 17, 9, 30), 3_240, ['drive-backup', 'backup:zip'])])
    ).toBe('2026-10-17T09:30:00.000Z  3.2s  drive-backup, backup:zip  [1.0.0 (build 1)]');
    expect(stallReport([stall(0, 600)])).toContain('nothing tracked');
  });
});
