/**
 * Each area of the app's colour and emblem, shared by the setup steps and the
 * Settings sections that configure the same things.
 *
 * One map, so "Keypad" is the same indigo circle in setup and in Settings and a
 * person recognises the place they have been before. The colours come from
 * the CATEGORY palette (docs/design-system.md): colour in this app is data,
 * and these are the app's own categories of setting.
 */
export const SECTIONS = {
  money: { emblem: 'cash', color: '#C99A2E' },
  accounts: { emblem: 'wallet', color: '#2E7D46' },
  reports: { emblem: 'analysis', color: '#C2622C' },
  keypad: { emblem: 'keypad', color: '#3B4E9E' },
  reminder: { emblem: 'bell', color: '#6B4CA8' },
  ai: { emblem: 'sparkle', color: '#2F8A78' },
  bank: { emblem: 'bank', color: '#2F6FA8' },
  backup: { emblem: 'cloud', color: '#6E8B3D' },
  setup: { emblem: 'check', color: '#6B5B4A' },
} as const;
