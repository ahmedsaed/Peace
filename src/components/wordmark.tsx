import { Text, type TextStyle } from 'react-native';

import palette from '@/constants/palette';

/**
 * The app's name, set in Pacifico.
 *
 * One component rather than a `fontFamily` sprinkled through three screens: a
 * webfont that fails to load falls back SILENTLY to the system sans, and the
 * only symptom is that the wordmark looks slightly ordinary. Keeping it in one
 * place means there is exactly one thing to check.
 *
 * Pacifico is a brush script with tall ascenders and deep descenders, so it
 * needs both a larger size than the sans it replaced (20 -> 26) and an explicit
 * line height — the default clips the loop of the P against the status bar.
 */
export const WORDMARK_FONT = 'Pacifico_400Regular';

export function Wordmark({
  size = 26,
  color = palette.accent,
  style,
  testID,
}: {
  size?: number;
  color?: string;
  style?: TextStyle;
  testID?: string;
}) {
  return (
    <Text
      testID={testID}
      // The accessible name stays plain text: a script face is decoration, and
      // a screen reader should hear the app's name, not describe a font.
      accessibilityRole="header"
      style={[
        {
          fontFamily: WORDMARK_FONT,
          fontSize: size,
          lineHeight: size * 1.45,
          color,
          // Pacifico's glyphs already lean; the default letter spacing suits it.
          includeFontPadding: false,
        },
        style,
      ]}>
      Peace
    </Text>
  );
}
