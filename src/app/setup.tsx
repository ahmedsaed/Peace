import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import {
  AccountsStep,
  AiStep,
  BackupStep,
  BankStep,
  CurrencyStep,
  DoneStep,
  KeypadStep,
  ReminderStep,
  WelcomeStep,
  type StepProps,
} from '@/components/setup/steps';
import { isSetupStep, SETUP_STEPS, type SetupStep } from '@/lib/setup';
import { useSettingsStore } from '@/state/settings';
import { useCompleteStep, useSetupFacts } from '@/state/setup';
import { useTheme } from '@/state/theme';

const STEPS: Record<SetupStep, (props: StepProps) => React.ReactNode> = {
  currency: CurrencyStep,
  accounts: AccountsStep,
  keypad: KeypadStep,
  reminder: ReminderStep,
  ai: AiStep,
  bank: BankStep,
  backup: BackupStep,
};

/** Welcome, the seven steps, then the summary. */
const LAST = SETUP_STEPS.length + 1;

/**
 * Setup — the welcome screens on a first launch, and any one step on its own
 * afterwards (`/setup?step=bank`).
 *
 * EVERY STEP CAN BE LEFT FOR LATER, and leaving one is never permanent: a
 * skipped step is not recorded, so the Records card goes on offering it, and
 * the step opened from there is this same screen. The bank step matters most
 * here — it is Play's prominent disclosure, and the Settings card routes to it
 * rather than having a second way to ask for notification access.
 *
 * Finishing, or skipping the lot, sets `onboardingDone`; until then the tabs
 * redirect here (`(drawer)/_layout.tsx`), so closing the app halfway through
 * resumes at the welcome rather than dropping somebody into an app they never
 * agreed to anything in.
 */
export default function SetupScreen() {
  const palette = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { step: only } = useLocalSearchParams<{ step?: string }>();
  const single = isSetupStep(only) ? only : null;

  const update = useSettingsStore((s) => s.update);
  const complete = useCompleteStep();
  const facts = useSetupFacts();
  const [index, setIndex] = useState(0);

  const finish = useCallback(() => {
    update('onboardingDone', true);
    router.replace('/');
  }, [router, update]);

  const back = useCallback(() => {
    if (single || index === 0) return false;
    setIndex((i) => i - 1);
    return true;
  }, [index, single]);

  // Android's back walks the steps backwards instead of leaving the app from
  // the middle of setup.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    return () => subscription.remove();
  }, [back]);

  if (single) {
    const Step = STEPS[single];
    const close = () => router.back();
    return (
      <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }} testID="setup-screen">
        <View className="flex-row px-2 pt-1">
          <Pressable
            onPress={close}
            hitSlop={12}
            testID="setup-close"
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="h-11 w-11 items-center justify-center rounded-full active:bg-surface">
            <Icon name="close" size={18} color={palette.muted} />
          </Pressable>
        </View>
        <Step
          onDone={() => {
            complete(single);
            close();
          }}
          onSkip={close}
        />
      </View>
    );
  }

  const next = () => setIndex((i) => Math.min(i + 1, LAST));
  const current = index >= 1 && index <= SETUP_STEPS.length ? SETUP_STEPS[index - 1] : null;
  const Step = current ? STEPS[current] : null;

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }} testID="setup-screen">
      {current ? <Progress index={index} onBack={() => back()} /> : null}

      {/* Keyed by step, so each one ARRIVES rather than its fields changing
          under the reader's thumb. */}
      <Animated.View
        key={index}
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(120)}
        className="flex-1">
        {index === 0 ? (
          <WelcomeStep
            onStart={next}
            onSkipAll={finish}
            onRestore={() => {
              // Restoring replaces the whole ledger, settings included, so
              // there is nothing left for setup to ask.
              update('onboardingDone', true);
              router.replace('/');
              router.push('/export');
            }}
          />
        ) : Step && current ? (
          <Step
            eyebrow={`Step ${index} of ${SETUP_STEPS.length}`}
            onDone={() => {
              complete(current);
              next();
            }}
            onSkip={next}
          />
        ) : (
          <DoneStep facts={facts} onFinish={finish} />
        )}
      </Animated.View>
    </View>
  );
}

/**
 * Seven segments, one per step. Filled is behind you; the one you are on is
 * half-lit, so the bar says where you are without a number to read.
 */
function Progress({ index, onBack }: { index: number; onBack: () => void }) {
  const palette = useTheme();
  return (
    <View className="flex-row items-center gap-3 px-2 pt-1" testID="setup-progress">
      <Pressable
        onPress={onBack}
        hitSlop={12}
        testID="setup-back"
        accessibilityRole="button"
        accessibilityLabel="Previous step"
        className="h-11 w-11 items-center justify-center rounded-full active:bg-surface">
        <Icon name="back" size={18} color={palette.muted} />
      </Pressable>
      <View className="flex-1 flex-row gap-1.5 pr-5">
        {SETUP_STEPS.map((step, i) => (
          <View
            key={step}
            className="h-1 flex-1 rounded-full"
            style={{
              backgroundColor: i + 1 <= index ? palette.accent : palette.line,
              opacity: i + 1 === index ? 0.55 : 1,
            }}
          />
        ))}
      </View>
    </View>
  );
}
