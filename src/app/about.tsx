import { useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

import { StackHeader } from '@/components/screen';
import { UpdateRow } from '@/components/update-row';
import { WhatsNewSheet } from '@/components/whats-new';
import { Wordmark } from '@/components/wordmark';
import { buildInfo, packageName, selfUpdates } from '@/lib/build-info';
import { formatCommit, formatVersion } from '@/lib/version';
import { recentNotes } from '@/lib/whats-new';
import { useTheme } from '@/state/theme';

/**
 * The one drawer destination that is real rather than a placeholder — it has
 * nothing to wait for. It exists so the build identity has a home, which is the
 * first thing worth knowing when a sideloaded APK misbehaves.
 */
const FACTS: { label: string; value: string; testID: string }[] = [
  { label: 'Version', value: formatVersion(buildInfo), testID: 'about-version' },
  { label: 'Commit', value: formatCommit(buildInfo), testID: 'about-commit' },
  { label: 'Package', value: packageName, testID: 'about-package' },
  { label: 'Made by', value: 'Merope', testID: 'about-maker' },
  { label: 'Data', value: 'One SQLite file on this device', testID: 'about-data' },
  // NOT "None", which stopped being true some time ago and is now contradicted
  // by the button directly beneath it. Rates, this update check, the Drive
  // backup and the receipt reader all reach out — every one of them only
  // because it was switched on or asked for, which is the promise worth making
  // and the one that is actually kept.
  {
    label: 'Network',
    value: 'Only what you switch on. No telemetry.',
    testID: 'about-network',
  },
];

const LINKS: { label: string; value: string; url: string; testID: string }[] = [
  { label: 'Website', value: 'peace.merope.dev', url: 'https://peace.merope.dev', testID: 'about-website' },
  {
    label: 'Privacy policy',
    value: 'What leaves this phone',
    url: 'https://peace.merope.dev/privacy/',
    testID: 'about-privacy',
  },
  {
    label: 'Source code',
    value: 'GitHub · GPL-3.0',
    url: 'https://github.com/ahmedsaed/Peace',
    testID: 'about-source',
  },
];

export default function AboutScreen() {
  const palette = useTheme();
  const [notes, setNotes] = useState(false);
  const recent = recentNotes(buildInfo.version);
  return (
    <View className="flex-1 bg-ground" testID="about-screen">
      <StackHeader title="About" />

      <ScrollView contentContainerClassName="px-5 pb-10 pt-6">
        <View className="items-center gap-3 pb-8">
          <Image
            source={require('../../assets/images/logo-mark.png')}
            style={{ width: 88, height: 88 }}
            resizeMode="contain"
          />
          <Wordmark size={38} />
          <Text className="text-center text-sm leading-5 text-muted">
            An expense tracker that keeps its mouth shut. Everything you log stays on this phone.
          </Text>
        </View>

        <View className="overflow-hidden rounded-xl bg-surface">
          {FACTS.map((fact, i) => (
            <View
              key={fact.label}
              className={`flex-row items-center justify-between px-4 py-3.5 ${
                i > 0 ? 'border-t border-line' : ''
              }`}>
              <Text className="text-sm text-muted">{fact.label}</Text>
              <Text className="flex-1 text-right text-sm text-ink" testID={fact.testID}>
                {fact.value}
              </Text>
            </View>
          ))}
        </View>

        {/* The release notes again, for whoever dismissed them too quickly. */}
        {recent.length > 0 ? (
          <Pressable
            onPress={() => setNotes(true)}
            testID="about-whats-new"
            accessibilityRole="button"
            className="mt-4 flex-row items-center gap-3 rounded-xl bg-surface px-4 py-3.5 active:bg-raised">
            <Text className="flex-1 text-sm text-ink">What&apos;s new</Text>
            <Icon name="chevron" size={12} color={palette.muted} />
          </Pressable>
        ) : null}

        {/* Where Peace lives outside the app. Opened in the browser, never
            fetched — this screen still sends nothing until a row is tapped. */}
        <View className="mt-4 overflow-hidden rounded-xl bg-surface">
          {LINKS.map((link, i) => (
            <Pressable
              key={link.label}
              onPress={() => void Linking.openURL(link.url)}
              testID={link.testID}
              accessibilityRole="link"
              accessibilityLabel={`${link.label}, ${link.value}`}
              className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-raised ${
                i > 0 ? 'border-t border-line' : ''
              }`}>
              <Text className="text-sm text-muted">{link.label}</Text>
              <Text className="flex-1 text-right text-sm text-accent" numberOfLines={1}>
                {link.value}
              </Text>
              <Icon name="chevron" size={12} color={palette.muted} />
            </Pressable>
          ))}
        </View>

        {/* The one thing on this screen that does something on its own. The drawer tells
            you about a newer build without being asked and says nothing the
            rest of the time — which is right, and leaves no way to tell "you
            are up to date" from "the check is broken". */}
        {selfUpdates ? <UpdateRow /> : null}
      </ScrollView>
      <WhatsNewSheet entries={recent} visible={notes} onClose={() => setNotes(false)} />
    </View>
  );
}
