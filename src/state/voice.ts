import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { VoiceClip } from '../lib/gemini';
import { MAX_CLIP_MS, MIN_CLIP_MS } from '../lib/voice';

/**
 * The microphone, for the record screen and Penny's composer alike.
 *
 * THE MIC IS OPEN ONLY WHILE IT IS SHOWN. It starts on a tap, never on opening
 * a screen; it stops at a minute; and it is CANCELLED — not finished — the
 * moment the app leaves the foreground or the screen goes away. Android shows
 * its green mic dot for exactly as long as this is listening, and a dot
 * staying lit after somebody has moved on is the one thing this feature must
 * never do. Cancelling rather than sending is deliberate: a clip cut off by a
 * phone call is not a sentence anyone meant to send.
 *
 * THE AUDIO IS NEVER KEPT. The file is read once, handed over, and deleted —
 * whatever happened to the request it went into. Nothing about a recording
 * reaches the ledger, the backups or Penny's history; only what the model
 * heard does, as text, after the person has seen it.
 */

/**
 * 16kHz mono AAC at 32kbps: about 4KB a second, so a full minute is ~240KB —
 * far inside Gemini's inline limit — and still more than speech needs. The
 * `voice_recognition` source is the one Android tunes for exactly this.
 */
const VOICE_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.m4a',
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac', audioSource: 'voice_recognition' },
};

const MIME_TYPE = 'audio/m4a';

/** Why listening stopped without a clip, as a sentence for the screen. */
export type VoiceProblem = {
  message: string;
  /** Android will not ask again: the only way back is its own settings. */
  openSettings?: boolean;
};

export type VoicePhase = 'idle' | 'starting' | 'recording';

export function useVoiceRecorder({
  onClip,
  onProblem,
  onInterrupted,
}: {
  onClip: (clip: VoiceClip) => void;
  onProblem: (problem: VoiceProblem) => void;
  /** The app left the foreground mid-recording and the clip was thrown away. */
  onInterrupted: () => void;
}) {
  const recorder = useAudioRecorder(VOICE_OPTIONS);
  const state = useAudioRecorderState(recorder, 100);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  // Read through refs so a finish fired by the timer or AppState reaches the
  // CURRENT handlers, not the ones from the render that started recording.
  const phaseRef = useRef<VoicePhase>('idle');
  const handlers = useRef({ onClip, onProblem, onInterrupted });
  useEffect(() => {
    handlers.current = { onClip, onProblem, onInterrupted };
  }, [onClip, onProblem, onInterrupted]);

  const move = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /** Stop the mic and throw the clip away. Safe to call in any phase. */
  const cancel = useCallback(async () => {
    if (phaseRef.current === 'idle') return;
    move('idle');
    try {
      await recorder.stop();
    } catch {
      // Already stopped, or never started — either way the mic is off.
    }
    discard(recorder.uri);
  }, [recorder, move]);

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    move('starting');
    try {
      /**
       * CHECK BEFORE ASKING. A request opens Android's permission activity
       * even when the answer is already yes — invisibly, for a frame — and
       * that PAUSES this one, which reads as leaving the app. Asking only when
       * the answer is unknown keeps the common case from ever pausing.
       */
      const known = await getRecordingPermissionsAsync();
      const permission = known.granted ? known : await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        move('idle');
        handlers.current.onProblem(
          permission.canAskAgain
            ? { message: 'Peace needs the microphone to hear you.' }
            : {
                message: 'The microphone is off for Peace. Allow it in Android settings to speak a record.',
                openSettings: true,
              }
        );
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      // A cancel while Android was asking — or the app left meanwhile: do not
      // open the mic after all.
      if ((phaseRef.current as VoicePhase) !== 'starting') return;
      if (AppState.currentState !== 'active') {
        move('idle');
        handlers.current.onInterrupted();
        return;
      }
      // The native side stops itself at the limit too, so a JS thread that is
      // busy at the wrong moment cannot leave the mic open past it.
      recorder.record({ forDuration: MAX_CLIP_MS / 1000 });
      move('recording');
    } catch (e) {
      console.warn('[voice] could not start recording', e);
      move('idle');
      handlers.current.onProblem({ message: 'Could not start the microphone.' });
    }
  }, [recorder, move]);

  /** Stop, and hand the clip over — or say why there is none. */
  const finish = useCallback(async () => {
    if (phaseRef.current !== 'recording') return;
    const heard = recorder.getStatus().durationMillis;
    move('idle');
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
      if (!uri || heard < MIN_CLIP_MS) {
        handlers.current.onProblem({ message: 'That was too short to hear. Tap the mic and speak.' });
        return;
      }
      const base64 = await new File(uri).base64();
      handlers.current.onClip({ base64, mimeType: MIME_TYPE });
    } catch (e) {
      console.warn('[voice] could not finish recording', e);
      handlers.current.onProblem({ message: 'Could not save what was recorded.' });
    } finally {
      discard(uri ?? recorder.uri);
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
  }, [recorder, move]);

  // The minute is up: send what was said rather than throwing it away.
  useEffect(() => {
    if (phase === 'recording' && state.durationMillis >= MAX_CLIP_MS - 100) void finish();
  }, [phase, state.durationMillis, finish]);

  // Leaving the app, or this screen, closes the mic.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      // Only a RECORDING is interrupted. While starting, Android's own
      // permission prompt pauses the app — that is the prompt, not leaving —
      // and `start` checks the app is in front before it opens the mic.
      if (next === 'active' || phaseRef.current !== 'recording') return;
      void cancel();
      handlers.current.onInterrupted();
    });
    return () => {
      sub.remove();
      void cancel();
    };
  }, [cancel]);

  return {
    phase,
    elapsedMs: phase === 'recording' ? state.durationMillis : 0,
    /** 0–1, from the metering in dBFS; null where the platform gives none. */
    level: phase === 'recording' && state.metering != null ? levelOf(state.metering) : null,
    start,
    finish,
    cancel,
  };
}

/** -50dB and below is silence, 0dB is shouting; speech sits in between. */
function levelOf(db: number): number {
  return Math.min(1, Math.max(0, (db + 50) / 50));
}

function discard(uri: string | null) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('[voice] could not delete a recording', e);
  }
}
