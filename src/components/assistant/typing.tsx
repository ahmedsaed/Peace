import { useEffect, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import palette from '@/constants/palette';

/**
 * Penny's coin — the one sign that Penny is working.
 *
 * A coin rather than three dots, because Penny is named for one and the dots
 * are every chat app's. It FADES rather than spins: a slow breath beside text
 * that is being read is calm, and a spinning thing pulls the eye off the words.
 *
 * Drawn here rather than in the icon map: the icons are one-colour paths, and a
 * coin needs its rim and its shine to read as a coin at 14px instead of a dot.
 *
 * The native driver, so it keeps breathing while JavaScript is busy rendering
 * a chart that just arrived.
 */
export function Coin({ size = 14 }: { size?: number }) {
  // State, not a ref: created once, and readable during render without the
  // compiler objecting — an Animated.Value is never replaced, only driven.
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    breathe.start();
    return () => breathe.stop();
  }, [opacity]);

  return (
    <Animated.View style={{ width: size, height: size, opacity }} testID="penny-coin">
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={11} fill={palette.accent} />
        {/* The rim: a ring a shade darker, which is what makes it a coin. */}
        <Circle cx={12} cy={12} r={8} fill="none" stroke={palette['accent-ink']} strokeOpacity={0.35} strokeWidth={2} />
        {/* A glint, top left, so it reads as metal rather than a button. */}
        <Path d="M7.5 9.5a5 5 0 0 1 3-3" stroke="#FFFFFF" strokeOpacity={0.7} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

/** The coin beside what Penny is doing — "Adding up", "Drawing a chart". */
export function TypingIndicator({ label, testID }: { label: string; testID?: string }) {
  return (
    <View className="flex-row items-center gap-2.5" testID={testID} accessibilityLabel={label}>
      <Coin />
      <Text className="flex-1 text-xs text-muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
