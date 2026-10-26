/**
 * A voice being worked on: five bars rising and falling in a wave.
 *
 * Shown while a clip is with the model, in place of a generic spinner — the
 * person has just spoken, and bars that move like speech say "your words are
 * being read" where a ring says only "wait". Native-driven, so a busy JS
 * thread cannot freeze it mid-wave.
 */

import { useEffect, useMemo } from 'react';
import { Animated, Easing, View } from 'react-native';

import { useTheme } from '@/state/theme';

const BARS = 5;

export function VoiceWave({ size = 'large', testID }: { size?: 'large' | 'small'; testID?: string }) {
  const palette = useTheme();
  const height = size === 'large' ? 36 : 18;
  const width = size === 'large' ? 5 : 3;
  const gap = size === 'large' ? 5 : 2;

  const levels = useMemo(() => Array.from({ length: BARS }, () => new Animated.Value(0)), []);

  useEffect(() => {
    // Each bar runs the same up-and-down, started a beat after its neighbour,
    // so the peak travels across them like a waveform.
    const loops = levels.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 110),
          Animated.timing(value, {
            toValue: 1,
            duration: 380,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 380,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.delay((BARS - 1 - index) * 110),
        ])
      )
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [levels]);

  return (
    <View
      className="flex-row items-center"
      style={{ height, gap }}
      accessibilityRole="progressbar"
      accessibilityLabel="Reading what you said"
      testID={testID}>
      {levels.map((value, index) => (
        <Animated.View
          key={index}
          style={{
            width,
            height,
            borderRadius: width / 2,
            backgroundColor: palette.accent,
            transform: [{ scaleY: value.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }],
          }}
        />
      ))}
    </View>
  );
}
