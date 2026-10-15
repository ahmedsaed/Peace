import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CONTENT_MAX_WIDTH } from '@/lib/layout';

/**
 * The body of every bottom sheet: the rounded, bordered panel a `Modal`
 * slides up from the foot of the screen.
 *
 * It exists because a `Modal` here is drawn EDGE TO EDGE, so its foot sits
 * underneath the system navigation bar. With gesture navigation that bar is a
 * thin strip and nothing seemed wrong; with the three-button bar it is 48dp of
 * Back / Home / Recents laid over the sheet's last row — the bottom option of a
 * picker, "Remove limit", "Repeat this" — and a tap on it lands on the nav bar
 * instead. Every sheet padded itself by hand with a fixed `pb-8`, which is why
 * all of them had the bug at once; the inset is added here, in one place.
 *
 * `lift` is the keyboard height for sheets with an input. It is a MARGIN on top
 * of the inset, not instead of it: Android's keyboard height leaves out the nav
 * bar, which stays beneath the keyboard.
 */
export function SheetPanel({
  className = '',
  pad = 32,
  lift = 0,
  style,
  testID,
  children,
}: {
  className?: string;
  /** Bottom padding ABOVE the navigation bar, in dp. */
  pad?: number;
  lift?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className={`rounded-t-2xl border-t border-line bg-ground ${className}`}
      // Centred and capped like the screens behind it (CONTENT_MAX_WIDTH): a
      // sheet is its own window, so the root layout's column does not reach it.
      style={[
        {
          elevation: 16,
          paddingBottom: pad + insets.bottom,
          marginBottom: lift,
          width: '100%',
          maxWidth: CONTENT_MAX_WIDTH,
          alignSelf: 'center',
        },
        style,
      ]}
      testID={testID}>
      {children}
    </View>
  );
}
