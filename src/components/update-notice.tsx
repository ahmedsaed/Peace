/**
 * A newer build exists. That is the entire feature.
 *
 * SUBTLE ON PURPOSE, and silent when there is nothing to say. It renders
 * nothing at all unless a strictly newer build is on the Releases page, so the
 * drawer looks exactly as it does now on every ordinary day.
 *
 * Nothing here is load-bearing, in the same sense as the rate fetch: offline,
 * rate-limited, or GitHub down all end the same way — the version line, alone,
 * unchanged. There is no error state, because an expense tracker that opens
 * differently because github.com is slow has broken its own premise.
 */

import { useEffect } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { buildInfo } from '@/lib/build-info';
import { fetchLatestRelease, updateAvailable } from '@/lib/update-check';
import { formatVersion } from '@/lib/version';
import { useSettingsStore } from '@/state/settings';

const REPO = 'ahmedsaed/Peace';
/**
 * Once a day. The answer changes at most once a merge, and this is a courtesy
 * rather than a feature anyone is waiting on.
 */
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export function UpdateNotice() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);

  const latest =
    settings.latestBuildSeen > 0
      ? {
          version: settings.latestVersionSeen,
          buildNumber: settings.latestBuildSeen,
          url: settings.latestReleaseUrl,
        }
      : null;
  const available = updateAvailable(buildInfo.buildNumber, latest);

  useEffect(() => {
    const due = Date.now() - settings.lastUpdateCheckAt > CHECK_EVERY_MS;
    // A dev build reports no build number and would ask forever about a
    // release it can never be behind.
    if (!due || buildInfo.buildNumber <= 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const release = await fetchLatestRelease({ repo: REPO });
        if (cancelled) return;
        update('latestBuildSeen', release.buildNumber);
        update('latestVersionSeen', release.version);
        update('latestReleaseUrl', release.url);
      } catch (error) {
        // Friendly silence for the user, the real reason for whoever has to fix
        // it — the same split every network failure in this app follows.
        console.warn('[update] could not read the latest release', error);
      } finally {
        // STAMPED EVEN ON FAILURE. Without this a machine that is offline
        // retries on every single drawer open, which is the one behaviour a
        // courtesy check must not have.
        if (!cancelled) update('lastUpdateCheckAt', Date.now());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settings.lastUpdateCheckAt, update]);

  if (!available || !latest) {
    return (
      <Text className="px-5 pb-3 text-xs text-muted opacity-60" testID="drawer-version">
        {formatVersion(buildInfo)}
      </Text>
    );
  }

  return (
    <Pressable
      onPress={() => void Linking.openURL(latest.url)}
      testID="update-notice"
      accessibilityRole="link"
      accessibilityLabel={`Version ${latest.version} is available. Open the releases page.`}
      className="px-5 pb-3 active:opacity-70">
      <Text className="text-xs text-muted opacity-60" testID="drawer-version">
        {formatVersion(buildInfo)}
      </Text>
      <View className="mt-0.5 flex-row items-center gap-1.5">
        {/* A dot, not a badge or a card. The whole claim is "there is a newer
            one" — anything larger asks to be dealt with, and this can wait. */}
        <View className="h-1.5 w-1.5 rounded-full bg-accent" />
        <Text className="text-xs text-accent">
          {latest.version} (build {latest.buildNumber}) available
        </Text>
      </View>
    </Pressable>
  );
}
