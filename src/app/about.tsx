import { Image, ScrollView, Text, View } from 'react-native';

import { StackHeader } from '@/components/screen';
import { UpdateRow } from '@/components/update-row';
import { Wordmark } from '@/components/wordmark';
import { buildInfo } from '@/lib/build-info';
import { formatCommit, formatVersion } from '@/lib/version';

/**
 * The one drawer destination that is real rather than a placeholder — it has
 * nothing to wait for. It exists so the build identity has a home, which is the
 * first thing worth knowing when a sideloaded APK misbehaves.
 */
const FACTS: { label: string; value: string; testID: string }[] = [
  { label: 'Version', value: formatVersion(buildInfo), testID: 'about-version' },
  { label: 'Commit', value: formatCommit(buildInfo), testID: 'about-commit' },
  { label: 'Package', value: 'com.ahmed.peace', testID: 'about-package' },
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

export default function AboutScreen() {
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

        {/* The one thing on this screen that does something. The drawer tells
            you about a newer build without being asked and says nothing the
            rest of the time — which is right, and leaves no way to tell "you
            are up to date" from "the check is broken". */}
        <UpdateRow />
      </ScrollView>
    </View>
  );
}
