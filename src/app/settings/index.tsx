import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, useColorScheme, View } from 'react-native';

import { StackHeader } from '@/components/screen';
import { Section, SectionLink, Toggle } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { db } from '@/db/client';
import { getAccount } from '@/db/repo/accounts';
import { describeLock } from '@/lib/app-lock';
import { currencyName } from '@/lib/currencies';
import { describeCadence } from '@/lib/drive-backup';
import { formatTimeLabel, ordinal } from '@/lib/period';
import { onDay } from '@/lib/reminder';
import { setupProgress } from '@/lib/setup';
import { runBankCatchUp } from '@/state/bank';
import { describeBlock } from '@/ai/availability';
import { describeModel } from '@/components/model-picker';
import { PROVIDER_IDS, PROVIDERS } from '@/ai/providers';
import { useAi } from '@/state/ai';
import { useAiKeysStore } from '@/state/ai-keys';
import { readDeviceLock, useLockStore } from '@/state/app-lock';
import { useSettingsStore } from '@/state/settings';
import { describeTheme } from '@/lib/theme';
import { bankAccess, describeBank, useSetupFacts } from '@/state/setup';

/**
 * Settings — what Peace does every day, what it does with AI, and your data.
 *
 * ONLY SETTINGS THAT DO SOMETHING APPEAR ANYWHERE UNDER HERE. A control for a
 * preference nothing reads is a switch that silently does nothing, which is
 * worse than an empty screen and exactly how an app teaches you to stop
 * trusting it. Each row lands in the same change as the code that honours it.
 *
 * AI IS ON THIS PAGE, NOT BEHIND A ROW. It is the one part of Peace that sends
 * anything anywhere, so its master switch sits in plain view under a caption
 * that says where things go. The keys have a page of their own, and each
 * feature's page chooses its own model from whichever providers have one. Every other row says what its
 * section is set to NOW, read from the same state its page shows.
 */
export default function SettingsIndex() {
  const router = useRouter();
  const s = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const keys = useAiKeysStore((state) => state.keys);
  const lockDevice = useLockStore((state) => state.device);
  const facts = useSetupFacts();
  const phone = useColorScheme();

  // Notification access is granted outside this app, and the default account
  // can be renamed elsewhere — both are re-read when the page comes back.
  const [access, setAccess] = useState(bankAccess);
  const [accountName, setAccountName] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      setAccess(bankAccess());
      void readDeviceLock();
      setAccountName(s.defaultAccountId ? (getAccount(db, s.defaultAccountId)?.name ?? null) : null);
    }, [s.defaultAccountId])
  );

  const recording = `${s.keypadDigits === 'phone' ? 'Phone' : 'Calculator'} keypad · starts on ${
    accountName ?? 'the first account'
  }`;
  const reports = [
    s.carryOver ? 'Running balance' : 'Month by month',
    s.showTotal ? 'daily totals' : 'no daily totals',
  ].join(' · ');
  const reminder = s.remindersOn
    ? `Every evening at ${formatTimeLabel(onDay(new Date(), { hour: s.reminderHour, minute: s.reminderMinute }))}`
    : 'Off';
  const backup = s.driveAccount ? `Google Drive · ${describeCadence(s.driveCadence)}` : 'Your own copies';
  const { done, total } = setupProgress(facts);

  // What each AI feature says it is doing, from the one place that decides
  // whether it can run. Their own settings are kept whatever this says.
  const aiState = useAi();
  const ai = aiState.ready;
  const keyless = aiState.hasKey === false;
  const keyed = keys ? PROVIDER_IDS.filter((id) => keys[id]).map((id) => PROVIDERS[id].name) : [];
  // The model a feature uses when it can run; why not, when it cannot.
  const summary = (feature: 'receipts' | 'voice' | 'bank' | 'penny', stored: string, running: string) => {
    const block = aiState.why[feature];
    if (keyless) return 'Needs a key';
    return block ? describeBlock(block) : `${running} · ${describeModel(stored)}`;
  };
  const bankState = describeBank(access, s.bankSenders);

  const toggleAi = (next: boolean) => {
    update('aiEnabled', next);
    // Bank messages captured while AI was off are waiting to be read; turning
    // it back on reads them now rather than at the next foreground.
    if (next) {
      void runBankCatchUp({
        senders: s.bankSenders,
        homeCurrency: s.homeCurrency,
        bankModel: s.bankModel,
        guidance: s.bankGuidance,
        aiEnabled: true,
      });
    }
  };

  const go = (href: Parameters<typeof router.push>[0]) => () => router.push(href);

  return (
    <View className="flex-1 bg-ground" testID="settings-screen">
      <StackHeader title="Settings" />
      <ScrollView contentContainerClassName="gap-6 px-4 pb-12 pt-4" keyboardShouldPersistTaps="handled">
        <Section title="Using Peace">
          <SectionLink
            {...SECTIONS.keypad}
            title="Recording"
            summary={recording}
            onPress={go('/settings/recording')}
            testID="settings-section-recording"
          />
          <SectionLink
            {...SECTIONS.money}
            title="Money & months"
            summary={`${currencyName(s.homeCurrency)} · ${s.homeCurrency}${
              s.monthStartDay === 1 ? '' : ` · months start on the ${ordinal(s.monthStartDay)}`
            }`}
            onPress={go('/settings/money')}
            testID="settings-section-money"
          />
          <SectionLink
            {...SECTIONS.reports}
            title="Records & reports"
            summary={reports}
            onPress={go('/settings/reports')}
            testID="settings-section-reports"
          />
          <SectionLink
            {...SECTIONS.appearance}
            title="Appearance"
            summary={describeTheme(s.theme, phone === 'unspecified' ? null : phone)}
            onPress={go('/settings/appearance')}
            testID="settings-section-appearance"
          />
          <SectionLink
            {...SECTIONS.reminder}
            title="Reminder"
            summary={reminder}
            onPress={go('/settings/reminders')}
            testID="settings-section-reminders"
            last
          />
        </Section>

        <Section
          title="AI"
          caption="Sent to the provider you choose for each feature, with your own key — only for what you turn on. Switched off, nothing is sent."
          testID="gemini-card">
          <Toggle
            label="Use AI"
            hint={
              keyless
                ? 'Add a key in Providers & keys, then switch this on.'
                : s.aiEnabled
                  ? 'Reading receipts, voice, reading bank messages and Penny can run.'
                  : 'Paused. Your key and choices are kept; bank messages wait unread.'
            }
            // Muted without a key: there is nothing for it to turn on.
            value={s.aiEnabled && !keyless}
            disabled={keyless}
            onChange={toggleAi}
            testID="setting-ai-enabled"
          />
          <SectionLink
            emblem="key"
            color={SECTIONS.ai.color}
            title="Providers & keys"
            summary={keyed.length > 0 ? keyed.join(', ') : 'No keys yet'}
            onPress={go('/settings/ai/providers')}
            testID="settings-ai-providers"
          />
          <SectionLink
            emblem="camera"
            color={SECTIONS.ai.color}
            title="Receipts & invoices"
            summary={summary('receipts', s.receiptsModel, 'On')}
            onPress={go('/settings/ai/receipts')}
            testID="settings-ai-receipts"
            dim={!ai}
          />
          <SectionLink
            emblem="mic"
            color={SECTIONS.ai.color}
            title="Voice"
            summary={summary('voice', s.voiceModel, 'On')}
            onPress={go('/settings/ai/voice')}
            testID="settings-ai-voice"
            dim={!ai}
          />
          <SectionLink
            {...SECTIONS.bank}
            title="Bank messages"
            summary={aiState.why.bank || keyless ? summary('bank', s.bankModel, '') : bankState}
            onPress={go('/settings/ai/bank')}
            testID="settings-ai-bank"
            dim={!ai}
          />
          <SectionLink
            emblem="sparkle"
            color={SECTIONS.ai.color}
            title="Penny, the assistant"
            summary={summary('penny', s.pennyModel, 'On')}
            onPress={go('/settings/ai/penny')}
            testID="settings-ai-penny"
            dim={!ai}
            last
          />
        </Section>

        <Section title="Your data">
          <SectionLink
            {...SECTIONS.backup}
            title="Backup & export"
            summary={backup}
            onPress={go('/export')}
            testID="settings-section-backup"
          />
          <SectionLink
            {...SECTIONS.lock}
            title="App lock"
            summary={describeLock(s.lockEnabled, lockDevice ?? 'secret', s.lockAfter)}
            onPress={go('/settings/lock')}
            testID="settings-section-lock"
          />
          <SectionLink
            {...SECTIONS.setup}
            title="Setup"
            summary={done === total ? 'All done — walk through it again' : `${done} of ${total} done`}
            onPress={go('/setup')}
            testID="setting-run-setup"
            last
          />
        </Section>
      </ScrollView>
    </View>
  );
}
