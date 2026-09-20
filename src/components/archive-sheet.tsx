import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

export type ArchiveItem = {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  /** A sub-category under the parent it was put away with. */
  indented?: boolean;
  /** What it is, or what is in it — the balance, the kind, the record count. */
  detail?: string;
  /**
   * Records that must move before this can be deleted. 0 means it can go now.
   *
   * Counted by the caller through `checkDeletion`, so the number here and the
   * list the search page shows come from the same query.
   */
  blocking?: number;
  /** What deleting it costs, said before the second tap rather than after. */
  cost?: string;
  /** A regex-safe key for testIDs — ids carry colons, names carry spaces. */
  testKey: string;
};

/**
 * What has been put away, with both ways out of it.
 *
 * Restoring and deleting are opposite in every way that matters — one is a
 * flag and the other is forever — so they are NOT two taps on the same
 * control. Tapping the row restores, which is the safe one and therefore the
 * big target; deleting is its own button and takes a second tap that names
 * what is about to go.
 *
 * A row that CANNOT be deleted does not offer a dead button. It carries the
 * count standing in the way, and tapping that is a question rather than an
 * action: the caller sends it to the search page, filtered to exactly those
 * records. "You cannot delete this" with no way to see what is holding it is
 * the kind of dead end that teaches people to stop pressing things.
 */
export function ArchiveSheet({
  visible,
  title,
  hint,
  items,
  onRestore,
  onResolve,
  onDelete,
  onClose,
  testID,
}: {
  visible: boolean;
  title: string;
  hint: string;
  items: ArchiveItem[];
  onRestore: (id: string) => void;
  /** Tapped the count: show me what is in the way. */
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  testID?: string;
}) {
  /** The row whose delete has been asked for but not yet confirmed. */
  const [armed, setArmed] = useState<string | null>(null);

  /**
   * Every way out of this sheet disarms it first.
   *
   * A Modal keeps its children mounted while hidden, so an armed row would
   * still be armed the next time the sheet opened — a confirmation left
   * waiting behind a screen, over whatever name has taken that row since.
   * Doing it in the handlers rather than watching `visible` keeps it to the
   * four things that can actually close this.
   */
  const leaving = (act: () => void) => () => {
    setArmed(null);
    act();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tap above to dismiss, and no scrim — `animationType="slide"` moves the
          sheet but cross-fades nothing, so a dim layer arrives as an abrupt
          slab the instant it starts moving. Same as every other sheet here. */}
      <Pressable
        className="flex-1"
        onPress={leaving(onClose)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      />

      <View
        className="max-h-[70%] rounded-t-2xl border-t border-line bg-ground pb-6"
        style={{
          elevation: 16,
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        }}
        testID={testID}>
        <View className="flex-row items-center justify-between border-b border-line px-5 py-4">
          <View className="flex-1 pr-3">
            <Text className="text-base font-semibold text-ink">{title}</Text>
            <Text className="pt-0.5 text-xs text-muted">{hint}</Text>
          </View>
          <Pressable onPress={leaving(onClose)} hitSlop={16} testID="archive-close">
            <Text className="text-sm text-muted">Close</Text>
          </Pressable>
        </View>

        <ScrollView>
          {items.map((item) =>
            armed === item.id ? (
              <View
                key={item.id}
                className="gap-2 border-b border-line bg-surface px-5 py-3"
                testID={`archive-confirm-row-${item.testKey}`}>
                <Text className="text-sm text-ink">Delete {item.name} for good?</Text>
                {item.cost ? <Text className="text-xs text-muted">{item.cost}</Text> : null}
                <View className="flex-row gap-2 pt-1">
                  <Pressable
                    onPress={() => setArmed(null)}
                    testID={`archive-cancel-${item.testKey}`}
                    accessibilityRole="button"
                    className="rounded-lg bg-raised px-4 py-2 active:opacity-70">
                    <Text className="text-sm text-ink">Keep it</Text>
                  </Pressable>
                  <Pressable
                    onPress={leaving(() => onDelete(item.id))}
                    testID={`archive-confirm-${item.testKey}`}
                    accessibilityRole="button"
                    className="rounded-lg border border-expense/40 px-4 py-2 active:opacity-70">
                    <Text className="text-sm font-medium text-expense">Delete</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View
                key={item.id}
                className="flex-row items-center border-b border-line"
                testID={`archive-row-${item.testKey}`}>
                <Pressable
                  onPress={leaving(() => onRestore(item.id))}
                  accessibilityRole="button"
                  accessibilityLabel={`Bring back ${item.name}`}
                  testID={`archive-restore-${item.testKey}`}
                  className={`flex-1 flex-row items-center gap-3 py-3 pl-5 pr-2 active:bg-surface ${
                    item.indented ? 'pl-12' : ''
                  }`}>
                  <View
                    className={`items-center justify-center rounded-full ${
                      item.indented ? 'h-7 w-7' : 'h-9 w-9'
                    }`}
                    style={{ backgroundColor: item.color ?? '#6B5B4A' }}>
                    <Icon
                      name={item.icon ?? 'dots'}
                      size={item.indented ? 13 : 17}
                      color="#FFFFFF"
                    />
                  </View>

                  <View className="flex-1">
                    <Text
                      className={item.indented ? 'text-sm text-muted' : 'text-base text-ink'}
                      numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.detail ? (
                      <Text className="text-xs text-muted" numberOfLines={1}>
                        {item.detail}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>

                {item.blocking && item.blocking > 0 ? (
                  <Pressable
                    onPress={leaving(() => onResolve(item.id))}
                    accessibilityRole="button"
                    accessibilityLabel={`Show the ${item.blocking} records using ${item.name}`}
                    testID={`archive-move-${item.testKey}`}
                    className="mr-3 rounded-lg bg-raised px-3 py-2 active:opacity-70">
                    <Text className="text-xs text-muted">
                      {item.blocking} record{item.blocking === 1 ? '' : 's'}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => setArmed(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${item.name}`}
                    testID={`archive-delete-${item.testKey}`}
                    className="mr-3 rounded-lg border border-expense/40 px-3 py-2 active:opacity-70">
                    <Text className="text-xs font-medium text-expense">Delete</Text>
                  </Pressable>
                )}
              </View>
            )
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
