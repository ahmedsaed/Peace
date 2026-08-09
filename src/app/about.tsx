import Constants from 'expo-constants';
import { Image, ScrollView, Text, View } from 'react-native';

import { StackHeader } from '@/components/screen';

/**
 * The one drawer destination that is real rather than a placeholder — it has
 * nothing to wait for. It exists so the version number has a home, which is the
 * first thing worth knowing when a sideloaded APK misbehaves.
 */
const FACTS: { label: string; value: string }[] = [
  { label: 'Version', value: Constants.expoConfig?.version ?? '—' },
  { label: 'Package', value: 'com.ahmed.peace' },
  { label: 'Data', value: 'One SQLite file on this device' },
  { label: 'Network', value: 'None. Nothing is uploaded.' },
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
          <Text className="text-2xl font-semibold tracking-tight text-accent">Peace</Text>
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
              <Text className="flex-1 text-right text-sm text-ink" testID={`about-${fact.label.toLowerCase()}`}>
                {fact.value}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
