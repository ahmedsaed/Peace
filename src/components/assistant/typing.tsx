import { useEffect, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';

import palette from '@/constants/palette';

/**
 * Three dots that pulse in turn, beside what the assistant is doing.
 *
 * A spinner says "busy"; this says "someone is working on your answer", which
 * is the thing to communicate during the seconds a tool round trip takes. The
 * label underneath is the honest part — "Adding up", "Drawing a chart" — and
 * the dots only say it has not stalled.
 *
 * The native driver, so the animation keeps moving while JavaScript is busy
 * rendering a chart that just arrived.
 */
export function TypingIndicator({ label, testID }: { label: string; testID?: string }) {
  // State, not a ref: created once, and readable during render without the
  // compiler objecting — an Animated.Value is never replaced, only driven.
  const [dots] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)));

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.stagger(
        160,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(dot, { toValue: 0.3, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ])
        )
      )
    );
    pulse.start();
    return () => pulse.stop();
  }, [dots]);

  return (
    <View className="flex-row items-center gap-2.5" testID={testID} accessibilityLabel={label}>
      <View className="flex-row gap-1">
        {dots.map((dot, i) => (
          <Animated.View
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: palette.accent,
              opacity: dot,
              transform: [{ scale: dot.interpolate({ inputRange: [0.3, 1], outputRange: [0.8, 1.15] }) }],
            }}
          />
        ))}
      </View>
      <Text className="flex-1 text-xs text-muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The block caret at the end of a reply that is still arriving. Blinks slowly
 * — a fast blink beside moving text reads as a fault rather than as typing.
 */
export function Caret() {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.15, duration: 450, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      ])
    );
    blink.start();
    return () => blink.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{ width: 8, height: 16, marginTop: 4, borderRadius: 1, backgroundColor: palette.accent, opacity }}
    />
  );
}
