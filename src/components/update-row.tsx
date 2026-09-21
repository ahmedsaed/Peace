import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { buildInfo } from '@/lib/build-info';
import {
  describeUpdate,
  fetchLatestRelease,
  updateAvailable,
  type Release,
} from '@/lib/update-check';
import { useSettingsStore } from '@/state/settings';

const REPO = 'ahmedsaed/Peace';

/**
 * Asking, rather than waiting to be told.
 *
 * The drawer already shows a dot when a newer build exists, and it is silent
 * the rest of the time — which is correct and also indistinguishable from
 * broken. Nothing anywhere said whether the check had ever run, so "am I up to
 * date?" and "is this feature working?" had the same answer: nothing. That is
 * the failure this app is least allowed to have, and it is the same rule the
 * bank queue follows — count what is waiting and name what is blocking it.
 *
 * SO THIS ONE SPEAKS. Every outcome is said out loud: the newest release when
 * there is one, "you are on the newest" when there is not, "ahead of it" for
 * the case that is actually normal here, and the real reason when the fetch
 * fails. It is on About rather than in the drawer because the drawer's job is
 * to stay quiet.
 */
type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; release: Release }
  | { kind: 'failed'; reason: string };

export function UpdateRow() {
  const update = useSettingsStore((state) => state.update);
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function check() {
    setState({ kind: 'checking' });
    try {
      const release = await fetchLatestRelease({ repo: REPO });
      // Stored as well as shown, so the drawer's dot agrees with this screen
      // rather than waiting up to a day to catch up with it.
      update('latestBuildSeen', release.buildNumber);
      update('latestVersionSeen', release.version);
      update('latestReleaseUrl', release.url);
      update('lastUpdateCheckAt', Date.now());
      setState({ kind: 'result', release });
    } catch (error) {
      // Friendly line for the user, the real error for whoever has to fix it —
      // the same split every network failure in this app follows.
      console.warn('[update] manual check failed', error);
      setState({
        kind: 'failed',
        reason: error instanceof Error ? error.message : 'Could not reach GitHub.',
      });
    }
  }

  const newer =
    state.kind === 'result' && updateAvailable(buildInfo.buildNumber, state.release);

  return (
    <View className="mt-4 overflow-hidden rounded-xl bg-surface">
      <Pressable
        onPress={() => void check()}
        disabled={state.kind === 'checking'}
        accessibilityRole="button"
        accessibilityLabel="Check for updates"
        testID="check-updates"
        className="flex-row items-center justify-between px-4 py-3.5 active:bg-raised">
        <View className="flex-1 pr-3">
          <Text className="text-sm text-ink">Check for updates</Text>
          <Text className="pt-0.5 text-xs leading-4 text-muted" testID="check-updates-state">
            {describe(state)}
          </Text>
        </View>
        {state.kind === 'checking' ? null : (
          <Icon name="refresh" size={16} color={palette.muted} />
        )}
      </Pressable>

      {/* Only when there is somewhere worth going. A link that opens the
          Releases page to show you the build you already have is a button that
          wastes a tap. */}
      {state.kind === 'result' && newer ? (
        <Pressable
          onPress={() => void Linking.openURL(state.release.url)}
          accessibilityRole="link"
          testID="open-release"
          className="flex-row items-center gap-2 border-t border-line px-4 py-3 active:bg-raised">
          <View className="h-1.5 w-1.5 rounded-full bg-accent" />
          <Text className="flex-1 text-sm text-accent">
            Open release {state.release.version}
          </Text>
          <Icon name="chevron" size={12} color={palette.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The transient states; the settled one is `describeUpdate`, which is pure. */
function describe(state: State): string {
  switch (state.kind) {
    case 'idle':
      return describeUpdate(buildInfo, null);
    case 'checking':
      return 'Asking GitHub…';
    case 'failed':
      return `Could not check: ${state.reason}`;
    case 'result':
      return describeUpdate(buildInfo, state.release);
  }
}
