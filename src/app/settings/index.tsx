import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { StackHeader } from '@/components/screen';
import { Section, SectionLink } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { currencyName } from '@/lib/currencies';
import { describeCadence } from '@/lib/drive-backup';
import { formatTimeLabel } from '@/lib/period';
import { onDay } from '@/lib/reminder';
import { setupProgress } from '@/lib/setup';
import { useGeminiKeyStore } from '@/state/gemini-key';
import { useSettingsStore } from '@/state/settings';
import { bankAccess, useSetupFacts } from '@/state/setup';

/**
 * Settings — an index of sections, each saying what it is set to now.
 *
 * ONLY SETTINGS THAT DO SOMETHING APPEAR ANYWHERE UNDER HERE. A control for a
 * preference nothing reads is a switch that silently does nothing, which is
 * worse than an empty screen and exactly how an app teaches you to stop
 * trusting it. Each row lands in the same change as the code that honours it.
 *
 * Grouped by what the settings ARE rather than by which screen they touch:
 * how the app looks and feels every day, the things it can do for you while
 * you are not looking, and your data. The summary under each row is read from
 * the same state the section page shows, so the index cannot claim a reminder
 * is on while the page says it is off.
 */
export default function SettingsIndex() {
  const router = useRouter();
  const s = useSettingsStore((state) => state.settings);
  const hasKey = useGeminiKeyStore((state) => state.hasKey);
  const facts = useSetupFacts();

  // Notification access is granted outside this app and on the Bank page, so
  // it is re-read every time the index comes back into view.
  const [access, setAccess] = useState(bankAccess);
  useFocusEffect(useCallback(() => setAccess(bankAccess()), []));

  const keypad = `${s.keypadDigits === 'phone' ? 'Phone' : 'Calculator'} layout · operators on the ${
    s.keypadOperators === 'right' ? 'right' : 'left'
  }`;
  const reports = [
    s.carryOver ? 'Running balance' : 'Month by month',
    s.showTotal ? 'daily totals' : 'no daily totals',
  ].join(' · ');
  const reminder = s.remindersOn
    ? `Every evening at ${formatTimeLabel(onDay(new Date(), { hour: s.reminderHour, minute: s.reminderMinute }))}`
    : 'Off';
  const ai =
    hasKey === null
      ? ' '
      : hasKey
        ? `Key saved${s.assistantEnabled ? ' · Penny on' : ''}`
        : 'No key — reading and Penny are off';
  const bank =
    access.permitted && access.capturing
      ? s.bankSenders.length === 0
        ? 'Listening, but no bank named'
        : `Reading ${s.bankSenders.length === 1 ? s.bankSenders[0] : `${s.bankSenders.length} banks`}`
      : 'Off';
  const backup = s.driveAccount ? `Google Drive · ${describeCadence(s.driveCadence)}` : 'Your own copies';
  const { done, total } = setupProgress(facts);

  const go = (href: Parameters<typeof router.push>[0]) => () => router.push(href);

  return (
    <View className="flex-1 bg-ground" testID="settings-screen">
      <StackHeader title="Settings" />
      <ScrollView contentContainerClassName="gap-6 px-4 pb-12 pt-4">
        <Section title="Every day">
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
            {...SECTIONS.keypad}
            title="Keypad"
            summary={keypad}
            onPress={go('/settings/keypad')}
            testID="settings-section-keypad"
            last
          />
        </Section>

        <Section title="While you are away">
          <SectionLink
            {...SECTIONS.reminder}
            title="Reminder"
            summary={reminder}
            onPress={go('/settings/reminders')}
            testID="settings-section-reminders"
          />
          <SectionLink
            {...SECTIONS.ai}
            title="AI — receipts and Penny"
            summary={ai}
            onPress={go('/settings/ai')}
            testID="settings-section-ai"
          />
          <SectionLink
            {...SECTIONS.bank}
            title="Bank messages"
            summary={bank}
            onPress={go('/settings/bank')}
            testID="settings-section-bank"
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
