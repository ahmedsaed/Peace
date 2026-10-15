import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { SheetPanel } from '@/components/sheet-panel';
import { buildInfo } from '@/lib/build-info';
import { notesSince, type WhatsNewEntry } from '@/lib/whats-new';
import { useSettingsStore } from '@/state/settings';

/**
 * The release notes for what changed since this install last looked — once,
 * on the first launch after an update (`lib/whats-new.ts` decides what).
 *
 * Decided ONCE, on mount: the list is what was new when the app opened, and
 * dismissing it records the running version, so it is not offered again. Never
 * over setup — a ledger still being set up has nothing to compare against, and
 * a first launch has already recorded the running version anyway.
 */
export function WhatsNewOnLaunch() {
  const seen = useSettingsStore((s) => s.settings.whatsNewSeen);
  const onboardingDone = useSettingsStore((s) => s.settings.onboardingDone);
  const update = useSettingsStore((s) => s.update);
  const [entries] = useState(() => notesSince(seen, buildInfo.version));
  const [open, setOpen] = useState(onboardingDone && entries.length > 0);

  // A release with nothing to say still counts as seen: an install that never
  // recorded a version must not later be handed the history it skipped.
  useEffect(() => {
    if (entries.length === 0 && seen !== buildInfo.version) update('whatsNewSeen', buildInfo.version);
    // Once, with the values the app opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    setOpen(false);
    update('whatsNewSeen', buildInfo.version);
  };

  return <WhatsNewSheet entries={entries} visible={open} onClose={close} />;
}

/** A list of release notes in a bottom sheet. Also opened from About. */
export function WhatsNewSheet({
  entries,
  visible,
  onClose,
}: {
  entries: WhatsNewEntry[];
  visible: boolean;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  // Several releases at once are headed by their versions; one needs no heading.
  const several = entries.length > 1;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss" />
      <SheetPanel testID="whats-new-sheet">
        <View className="border-b border-line px-5 py-4">
          <Text className="text-lg font-semibold text-ink" accessibilityRole="header">
            What&apos;s new
          </Text>
          <Text className="text-xs text-muted">Peace {buildInfo.version}</Text>
        </View>

        <ScrollView style={{ maxHeight: height * 0.55 }} contentContainerClassName="px-5 pt-4">
          {entries.map((entry, i) => (
            <View key={entry.version} className="mb-4" testID={`whats-new-entry-${i}`}>
              {several ? (
                <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                  {entry.version}
                </Text>
              ) : null}
              {entry.notes.map((note) => (
                <View key={note} className="mb-2 flex-row gap-3">
                  <View className="mt-2 h-1.5 w-1.5 rounded-full bg-accent" />
                  <Text className="flex-1 text-[15px] leading-[22px] text-ink">{note}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>

        <View className="px-5 pt-2">
          <Pressable
            onPress={onClose}
            testID="whats-new-done"
            accessibilityRole="button"
            className="h-12 items-center justify-center rounded-2xl bg-accent active:opacity-80">
            <Text className="text-base font-semibold text-accent-ink">Got it</Text>
          </Pressable>
        </View>
      </SheetPanel>
    </Modal>
  );
}
