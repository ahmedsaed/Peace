import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { GeminiKeyCard } from '@/components/gemini-key';
import { Section, SectionLink, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';
import { useGeminiKeyStore } from '@/state/gemini-key';
import { useSettingsStore } from '@/state/settings';
import { bankAccess, describeBank } from '@/state/setup';


/**
 * Settings › AI — the key, and the three features that run on it.
 *
 * ONE PAGE OWNS THE KEY. Receipts, bank messages and Penny all need it, and when
 * bank messages had a page of its own its "waiting for a key" pointed at a
 * card on a different screen. The key comes first, and each feature below it
 * is a row that says whether it is running — "Needs the key above" when it
 * cannot, which is the honest answer to why nothing is happening.
 */
export default function AiSettings() {
  const router = useRouter();
  const hasKey = useGeminiKeyStore((state) => state.hasKey);
  const penny = useSettingsStore((state) => state.settings.assistantEnabled);
  const senders = useSettingsStore((state) => state.settings.bankSenders);

  // Notification access changes on a system screen and on the bank page.
  const [access, setAccess] = useState(bankAccess);
  useFocusEffect(useCallback(() => setAccess(bankAccess()), []));

  const keyless = hasKey === false;
  const needs = 'Needs the key above';

  return (
    <SettingsPage
      title="AI"
      {...SECTIONS.ai}
      intro="Reading receipts, reading bank messages and Penny all run on your own Google Gemini key. Only Google sees what is sent, and only for the features you turn on."
      testID="settings-ai">
      <GeminiKeyCard />

      <Section title="Runs on this key">
        <SectionLink
          emblem="camera"
          color={SECTIONS.ai.color}
          title="Receipts"
          summary={keyless ? needs : 'Read when you photograph one on a record'}
          onPress={() => router.push('/settings/ai/receipts')}
          testID="settings-ai-receipts"
        />
        <SectionLink
          {...SECTIONS.bank}
          title="Bank messages"
          summary={keyless && describeBank(access, senders) !== 'Off' ? `${needs} — messages wait unread` : describeBank(access, senders)}
          onPress={() => router.push('/settings/ai/bank')}
          testID="settings-ai-bank"
        />
        <SectionLink
          emblem="sparkle"
          color={SECTIONS.ai.color}
          title="Penny, the assistant"
          summary={!penny ? 'Off' : keyless ? `On — ${needs.toLowerCase()}` : 'On'}
          onPress={() => router.push('/settings/ai/penny')}
          testID="settings-ai-penny"
          last
        />
      </Section>
    </SettingsPage>
  );
}
