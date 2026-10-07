import { router } from 'expo-router';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';

import { RecordRow } from '@/components/record-row';
import type { RecordRow as Row } from '@/db/repo/records';

/**
 * The records behind something the assistant showed — a bar, a slice, a list.
 *
 * A sheet rather than a pushed screen, so looking inside a bar and coming back
 * leaves the conversation exactly where it was. Tapping a row opens the
 * ordinary record screen: editing happens where editing already works, never
 * in a second, lesser editor here.
 */
export function RecordsSheet({
  visible,
  title,
  subtitle,
  rows,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  rows: Row[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" />
      <View
        className="max-h-[75%] rounded-t-2xl border-t border-line bg-ground pb-6"
        style={{
          elevation: 16,
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        }}
        testID="assistant-records-sheet">
        <View className="flex-row items-center justify-between border-b border-line px-5 py-4">
          <View className="flex-1 pr-3">
            <Text className="text-base font-semibold text-ink" numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text className="text-xs text-muted" numberOfLines={1} testID="assistant-records-subtitle">
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={onClose} hitSlop={16} testID="assistant-records-close">
            <Text className="text-sm text-muted">Close</Text>
          </Pressable>
        </View>

        {rows.length === 0 ? (
          <Text className="px-5 py-8 text-center text-sm text-muted" testID="assistant-records-empty">
            No records here.
          </Text>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.id}
            renderItem={({ item }) => (
              <RecordRow
                row={item}
                onPress={() => {
                  onClose();
                  router.push({ pathname: '/record', params: { id: item.id } });
                }}
              />
            )}
          />
        )}
      </View>
    </Modal>
  );
}
