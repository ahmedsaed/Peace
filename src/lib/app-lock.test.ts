import { decodeSetting, SETTING_DEFAULTS } from './settings';
import { describeLock, deviceLockFromLevel, lockActive, lockAfterSeconds, lockDue } from './app-lock';

const T = 1_800_000_000_000;

describe('lockDue', () => {
  it('asks nothing on a return with no departure', () => {
    expect(lockDue({ awayAt: null, now: T, after: 'now' })).toBe(false);
  });

  it('locks on any return when set to immediately', () => {
    expect(lockDue({ awayAt: T, now: T, after: 'now' })).toBe(true);
    expect(lockDue({ awayAt: T, now: T + 1, after: 'now' })).toBe(true);
  });

  it('waits out the grace period, and the period itself is enough', () => {
    expect(lockDue({ awayAt: T, now: T + 59_999, after: '1min' })).toBe(false);
    expect(lockDue({ awayAt: T, now: T + 60_000, after: '1min' })).toBe(true);
    expect(lockDue({ awayAt: T, now: T + 299_999, after: '5min' })).toBe(false);
    expect(lockDue({ awayAt: T, now: T + 900_000, after: '15min' })).toBe(true);
  });

  it('treats an unknown choice as immediately, the safe reading', () => {
    expect(lockAfterSeconds('junk' as never)).toBe(0);
  });
});

describe('the device lock', () => {
  it('reads Android security levels', () => {
    expect(deviceLockFromLevel(0)).toBe('none');
    expect(deviceLockFromLevel(1)).toBe('secret');
    expect(deviceLockFromLevel(2)).toBe('biometric');
    expect(deviceLockFromLevel(3)).toBe('biometric');
  });

  // A backup restored onto a phone with no screen lock arrives with the lock
  // on. Nothing could ever unlock it, so it must not lock at all.
  it('fails open when the phone has nothing to check', () => {
    expect(lockActive(true, 'none')).toBe(false);
    expect(lockActive(true, 'secret')).toBe(true);
    expect(lockActive(false, 'biometric')).toBe(false);
  });
});

describe('describeLock', () => {
  it('says what the lock does now', () => {
    expect(describeLock(false, 'biometric', '1min')).toBe('Off');
    expect(describeLock(true, 'none', '1min')).toBe('Paused — this phone has no screen lock');
    expect(describeLock(true, 'biometric', 'now')).toBe('Fingerprint or screen lock · every time');
    expect(describeLock(true, 'secret', '5min')).toBe('Screen lock · after 5 min away');
  });
});

describe('the settings', () => {
  // Off for everybody who already has the app, and for every old backup.
  it('is off when no row exists', () => {
    expect(SETTING_DEFAULTS.lockEnabled).toBe(false);
    expect(decodeSetting('lockEnabled', null)).toBe(false);
  });

  // String settings pass through the codec unchecked, so a value from a newer
  // build reaches lockDue as it is — and is read as "immediately", never "never".
  it('reads a grace period it does not know as immediately', () => {
    expect(lockDue({ awayAt: T, now: T, after: decodeSetting('lockAfter', 'forever') })).toBe(true);
  });
});
