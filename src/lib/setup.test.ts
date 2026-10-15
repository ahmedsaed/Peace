import { isSetupStep, markDone, SETUP_STEPS, setupProgress, stepDone, type SetupFacts } from './setup';

const nothing: SetupFacts = {
  done: [],
  remindersOn: false,
  hasKey: false,
  bankReady: false,
  driveConnected: false,
};

describe('setup progress', () => {
  it('starts with every step remaining', () => {
    expect(setupProgress(nothing)).toEqual({
      done: 1,
      total: 8,
      remaining: SETUP_STEPS.filter((s) => s !== 'theme'),
    });
  });

  it('counts a feature switched on elsewhere as set up', () => {
    const facts = { ...nothing, remindersOn: true, hasKey: true, bankReady: true, driveConnected: true };
    expect(setupProgress(facts).remaining).toEqual(['currency', 'accounts', 'keypad']);
  });

  // The app always has a theme, so the Records card never offers this step.
  it('never counts the theme as left to do', () => {
    expect(stepDone('theme', nothing)).toBe(true);
    expect(setupProgress(nothing).remaining).not.toContain('theme');
  });

  it('needs the steps with no state of their own to be finished on purpose', () => {
    expect(stepDone('currency', nothing)).toBe(false);
    expect(stepDone('currency', { ...nothing, done: ['currency'] })).toBe(true);
  });

  it('counts a step finished on purpose even when its feature is off', () => {
    // "Keep copies myself" is a backup decision with no Drive connection.
    expect(stepDone('backup', { ...nothing, done: ['backup'] })).toBe(true);
  });

  it('is complete when every step is done', () => {
    expect(setupProgress({ ...nothing, done: [...SETUP_STEPS] })).toEqual({
      done: 8,
      total: 8,
      remaining: [],
    });
  });
});

describe('markDone', () => {
  it('keeps step order and drops repeats', () => {
    expect(markDone(['keypad', 'currency'], 'accounts')).toEqual(['currency', 'accounts', 'keypad']);
    expect(markDone(['currency'], 'currency')).toEqual(['currency']);
  });

  it('forgets names that are no longer steps', () => {
    expect(markDone(['retired-step'], 'ai')).toEqual(['ai']);
  });
});

describe('isSetupStep', () => {
  it('accepts only known steps', () => {
    expect(isSetupStep('bank')).toBe(true);
    expect(isSetupStep('welcome')).toBe(false);
    expect(isSetupStep(undefined)).toBe(false);
  });
});
