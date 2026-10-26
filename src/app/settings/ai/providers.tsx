import { Text } from 'react-native';

import { ProviderKeyRow } from '@/components/provider-key';
import { Section, SettingsPage } from '@/components/settings-ui';
import { SECTIONS } from '@/constants/sections';

/**
 * Settings › AI › Providers & keys: one key per provider, and nothing else.
 *
 * Which model does which job is chosen on each feature's own page, from every
 * provider with a key here — a person can read receipts with one and talk to
 * Penny through another. Keeping the keys apart from those choices means
 * adding a provider never moves a feature, and removing one says which
 * features it stops.
 */
export default function ProviderSettings() {
  return (
    <SettingsPage title="Providers & keys" emblem="key" color={SECTIONS.ai.color} testID="settings-ai-providers-page">
      <Section
        caption="Your own keys, kept on this phone and never in a backup. Each is checked with its provider before it is saved."
        testID="provider-keys">
        {/* Written out rather than mapped, so each row's testID is a literal a
            flow (and `flows.test.ts`) can find. */}
        <ProviderKeyRow provider="gemini" testID="gemini-key" />
        <ProviderKeyRow provider="openai" testID="openai-key" />
        <ProviderKeyRow provider="deepseek" testID="deepseek-key" />
        <ProviderKeyRow provider="mistral" testID="mistral-key" />
        <ProviderKeyRow provider="openrouter" testID="openrouter-key" last />
      </Section>
      <Text className="px-1 text-xs leading-5 text-muted">
        Requests go straight from this phone to the provider a feature uses — never through us. Each
        provider handles them under its own terms; see the privacy policy for where each one is.
      </Text>
    </SettingsPage>
  );
}
