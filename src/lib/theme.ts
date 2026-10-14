import { SYSTEM_PAIR, THEMES, TOKENS } from '../constants/themes';

/**
 * Which theme is showing, decided in one pure place.
 *
 * The setting stores a theme's id or `system`, and being a plain string it
 * stores anything at all — a backup from a newer build may name a theme this
 * one has never heard of. That reads as Ledger, the theme the app had before
 * there was a choice, never as a crash or a blank screen.
 */

export type ThemeId = keyof typeof THEMES;
export type ThemeSetting = ThemeId | 'system';
export type Token = (typeof TOKENS)[number];
export type ThemeColors = Record<Token, string>;

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export function isThemeId(value: string): value is ThemeId {
  return Object.prototype.hasOwnProperty.call(THEMES, value);
}

/** The theme to draw with, given the setting and what the phone is set to. */
export function resolveTheme(setting: string, phone: 'light' | 'dark' | null | undefined): ThemeId {
  if (setting === 'system') return (phone === 'light' ? SYSTEM_PAIR.light : SYSTEM_PAIR.dark) as ThemeId;
  return isThemeId(setting) ? setting : 'ledger';
}

export function themeColors(id: ThemeId): ThemeColors {
  return THEMES[id].colors as ThemeColors;
}

export function themeLabel(id: ThemeId): string {
  return THEMES[id].label;
}

/** "Paper", or "Match phone · Paper now" — what Settings says the choice is. */
export function describeTheme(setting: string, phone: 'light' | 'dark' | null | undefined): string {
  const showing = THEMES[resolveTheme(setting, phone)].label;
  return setting === 'system' ? `Match phone · ${showing} now` : showing;
}
