import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { vars } from 'nativewind';
import { useEffect, useMemo } from 'react';
import { Appearance, useColorScheme, View } from 'react-native';

import { persistNightMode } from '../../modules/night-mode/src/NightModeModule';
import { cssVariables, THEMES } from '../constants/themes';
import { resolveTheme, themeColors, type ThemeColors, type ThemeId } from '../lib/theme';
import { useSetting } from './settings';

/**
 * The active theme, for the places that need a colour as a VALUE.
 *
 * Class names need nothing from here: `bg-surface` reads a CSS variable that
 * `ThemeRoot` sets. This is for the rest — an SVG fill, a navigator's
 * `tabBarActiveTintColor`, an icon's `color` prop. It is a hook rather than a
 * module-level object for the same reason `usePeriodLabel` is: the React
 * Compiler memoises a component on its props, and a colour read from a module
 * is invisible to it — the screen would keep the old theme's colour until
 * something unrelated made it render again.
 */
export function useThemeId(): ThemeId {
  const setting = useSetting('theme');
  const phone = useColorScheme();
  return resolveTheme(setting, phone === 'unspecified' ? null : phone);
}

export function useTheme(): ThemeColors {
  return themeColors(useThemeId());
}

/**
 * A `Switch`'s colours. One place, because the obvious pair — an `ink` thumb
 * on a `line` track — is right in a dark theme and a dark blob on a pale
 * hairline in a light one, and it used to be written out at six call sites.
 */
export function useSwitchColors() {
  const id = useThemeId();
  const { dark, colors } = THEMES[id];
  return {
    trackColor: { false: dark ? colors.line : colors.muted, true: colors.accent },
    thumbColor: dark ? colors.ink : colors.surface,
  };
}

/**
 * Paints everything beneath it in the active theme.
 *
 * Five things follow the theme, and only the first is ours to draw:
 *
 * 1. The CSS variables every colour class reads. Set on ONE view at the root;
 *    NativeWind hands them down through context, so a `Modal` — its own native
 *    window — still inherits them, where a native style would not.
 * 2. The status bar's icons: light on a dark theme, dark on a light one.
 * 3. Android's own night mode, via `Appearance.setColorScheme`. Alerts, the
 *    date picker and the share sheet are drawn by the system, not by us, and
 *    left alone they follow the PHONE — a white "Delete this record?" box over
 *    a Ledger screen. Forced to match, they follow the theme. In "Match phone"
 *    the override is lifted, which is also what lets `useColorScheme` report
 *    the phone's real setting rather than the one we forced.
 *    The same choice is PERSISTED with Android (`persistNightMode`), because
 *    the splash is drawn before any JavaScript runs and the override above dies
 *    with the process. That makes the next cold start dark or light to match —
 *    Ledger's or Paper's ground, set in `app.config.js`; the system can pick
 *    between two resource folders and nothing finer.
 * 4. The root view's background, which shows for a frame behind a screen
 *    transition or a keyboard animating in.
 */
export function ThemeRoot({ children }: { children: React.ReactNode }) {
  const setting = useSetting('theme');
  const id = useThemeId();
  const theme = THEMES[id];
  const style = useMemo(() => vars(cssVariables(theme.colors)), [theme]);

  useEffect(() => {
    const scheme = setting === 'system' ? 'unspecified' : theme.dark ? 'dark' : 'light';
    Appearance.setColorScheme(scheme);
    persistNightMode(scheme);
  }, [setting, theme]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.ground).catch((e) => {
      console.warn('[theme] could not set the root background', e);
    });
  }, [theme]);

  return (
    <View style={[{ flex: 1 }, style]}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      {children}
    </View>
  );
}
