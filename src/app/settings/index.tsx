import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { GeminiKeyRows } from '@/components/gemini-key';
import { StackHeader } from '@/components/screen';
import { Section, SectionLink, Toggle } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { db } from '@/db/client';
import { getAccount } from '@/db/repo/accounts';
import { currencyName } from '@/lib/currencies';
import { describeCadence } from '@/lib/drive-backup';
import { formatTimeLabel } from '@/lib/period';
import { onDay } from '@/lib/reminder';
import { setupProgress } from '@/lib/setup';
import { runBankCatchUp } from '@/state/bank';
import { useGeminiKeyStore } from '@/state/gemini-key';
import { useSettingsStore } from '@/state/settings';
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
 * anything anywhere, so its master switch and its key sit in plain view under a
 * caption that says where things go; the three features that run on it are
 * rows beneath, each with a page of its own. Every other row says what its
 * section is set to NOW, read from the same state its page shows.
 */
export default function SettingsIndex() {
  const router = useRouter();
  const s = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const hasKey = useGeminiKeyStore((state) => state.hasKey);
  const facts = useSetupFacts();

  // Notification access is granted outside this app, and the default account
  // can be renamed elsewhere — both are re-read when the page comes back.
  const [access, setAccess] = useState(bankAccess);
  const [accountName, setAccountName] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      setAccess(bankAccess());
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

  // What each AI feature says it is doing. With AI off, all three say so —
  // their own settings are kept, and come back when it is turned on.
  const ai = s.aiEnabled;
  const keyless = hasKey === false;
  const feature = (running: string) => (!ai ? 'AI is off' : keyless ? 'Needs the key above' : running);
  const bankState = describeBank(access, s.bankSenders);

  const toggleAi = (next: boolean) => {
    update('aiEnabled', next);
    // Bank messages captured while AI was off are waiting to be read; turning
    // it back on reads them now rather than at the next foreground.
    if (next) {
      void runBankCatchUp({
        senders: s.bankSenders,
        homeCurrency: s.homeCurrency,
        geminiModel: s.geminiModel,
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
            title="Money"
            summary={`${currencyName(s.homeCurrency)} · ${s.homeCurrency}`}
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
          caption="Sent to Google Gemini with your own key — only for what you turn on. Switched off, nothing is sent."
          testID="gemini-card">
          <Toggle
            label="Use AI"
            hint={
              ai
                ? 'Reading receipts, reading bank messages and Penny can run.'
                : 'Paused. Your key and choices are kept; bank messages wait unread.'
            }
            value={ai}
            onChange={toggleAi}
            testID="setting-ai-enabled"
          />
          {ai ? <GeminiKeyRows /> : null}
          <SectionLink
            emblem="camera"
            color={SECTIONS.ai.color}
            title="Receipts"
            summary={!s.receiptsEnabled && ai ? 'Off' : feature('Read when you photograph one on a record')}
            onPress={go('/settings/ai/receipts')}
            testID="settings-ai-receipts"
            dim={!ai}
          />
          <SectionLink
            {...SECTIONS.bank}
            title="Bank messages"
            summary={!ai ? 'AI is off' : bankState === 'Off' ? 'Off' : feature(bankState)}
            onPress={go('/settings/ai/bank')}
            testID="settings-ai-bank"
            dim={!ai}
          />
          <SectionLink
            emblem="sparkle"
            color={SECTIONS.ai.color}
            title="Penny, the assistant"
            summary={!ai ? 'AI is off' : !s.assistantEnabled ? 'Off' : feature('On')}
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
