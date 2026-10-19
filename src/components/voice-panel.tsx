/**
 * The notes field, listening.
 *
 * Same move as the camera: the field the words would have been typed into
 * BECOMES the microphone, in the same place and at the same width, so nothing
 * else on the record screen shifts. One big button stops and reads; the ✕
 * throws the clip away. The timer is always visible because an open mic is a
 * thing a person should never have to wonder about.
 *
 * Purely presentational — the recorder lives in the screen (`useVoiceRecorder`)
 * so the screen decides what a finished clip is for.
 */

import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { VoiceWave } from '@/components/voice-wave';
import { clipClock, MAX_CLIP_MS } from '@/lib/voice';
import type { VoicePhase, VoiceProblem } from '@/state/voice';
import { useTheme } from '@/state/theme';

export function VoicePanel({
  phase,
  reading,
  elapsedMs,
  level,
  problem,
  onDone,
  onCancel,
  onRetry,
}: {
  phase: VoicePhase;
  /** The clip is with Gemini. */
  reading: boolean;
  elapsedMs: number;
  level: number | null;
  problem: VoiceProblem | null;
  onDone: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const palette = useTheme();
  const frame = 'flex-1 items-center justify-center rounded-lg bg-surface px-4 py-3';

  if (problem) {
    return (
      <View className={`${frame} gap-3`} testID="voice-panel-problem">
        <Text className="text-center text-sm leading-5 text-ink" testID="voice-problem">
          {problem.message}
        </Text>
        <View className="flex-row gap-3">
          <PanelButton
            label={problem.openSettings ? 'Open settings' : 'Try again'}
            onPress={problem.openSettings ? () => void Linking.openSettings() : onRetry}
            testID="voice-retry"
            primary
          />
          <PanelButton label="Close" onPress={onCancel} testID="voice-close" />
        </View>
      </View>
    );
  }

  // 'idle' here is the moment between the mic stopping and the clip being
  // sent: already on its way, so it reads as reading.
  if (reading || phase !== 'recording') {
    const opening = !reading && phase === 'starting';
    return (
      <View className={`${frame} gap-3`} testID={opening ? 'voice-starting' : 'voice-reading'}>
        {opening ? <ActivityIndicator color={palette.accent} /> : <VoiceWave />}
        <Text className="text-sm text-muted">{opening ? 'Opening the microphone…' : 'Reading what you said…'}</Text>
      </View>
    );
  }

  // The halo grows with the voice, so it is obvious the mic is hearing
  // something before the clip is ever sent. Geometry, not money: nothing here
  // needs masking.
  const halo = 1 + 0.45 * (level ?? 0);

  return (
    <View className={frame} testID="voice-panel">
      <Pressable
        onPress={onCancel}
        hitSlop={10}
        className="absolute right-2 top-2 h-9 w-9 items-center justify-center rounded-full active:bg-raised"
        accessibilityRole="button"
        accessibilityLabel="Stop listening and discard"
        testID="voice-cancel">
        <Icon name="close" size={18} color={palette.muted} />
      </Pressable>

      <View className="items-center justify-center" style={{ height: 96, width: 96 }}>
        <View
          className="absolute h-16 w-16 rounded-full bg-accent opacity-25"
          style={{ transform: [{ scale: halo }] }}
        />
        <Pressable
          onPress={onDone}
          className="h-16 w-16 items-center justify-center rounded-full bg-accent active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel="Done speaking. Fill in the record"
          testID="voice-done">
          <Icon name="check" size={26} color={palette['accent-ink']} />
        </Pressable>
      </View>

      <Text className="mt-1 text-sm font-medium text-ink" testID="voice-clock" accessibilityLiveRegion="none">
        <Text className="text-expense">● </Text>
        {clipClock(elapsedMs)}
        <Text className="text-muted"> / {clipClock(MAX_CLIP_MS)}</Text>
      </Text>
      <Text className="mt-1 text-center text-xs leading-4 text-muted">
        Say it your way.
      </Text>
    </View>
  );
}

function PanelButton({
  label,
  onPress,
  testID,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      className={`rounded-full px-4 py-2 active:opacity-80 ${primary ? 'bg-accent' : 'bg-raised'}`}>
      <Text className={`text-sm font-semibold ${primary ? 'text-accent-ink' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );
}
