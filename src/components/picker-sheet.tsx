import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

export type PickerOption = {
  id: string;
  label: string;
  icon?: string | null;
  color?: string | null;
  /** Rendered indented — a sub-category under its parent. */
  indented?: boolean;
  /** Extra detail on the right, e.g. an account's currency. */
  detail?: string;
};

/**
 * Bottom sheet for choosing an account or a category.
 *
 * A plain `Modal` rather than a sheet library: the list is short, the
 * interaction is one tap, and a native modal costs no extra dependency and no
 * native rebuild.
 */
export function PickerSheet({
  visible,
  title,
  options,
  selectedId,
  onSelect,
  onClose,
  testID,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  testID?: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the scrim dismisses — expected of a sheet, and it keeps the
          user from feeling trapped in a picker they opened by accident. */}
      <Pressable className="flex-1 bg-black/60" onPress={onClose} accessibilityRole="button" />

      <View className="max-h-[70%] rounded-t-2xl bg-ground pb-6" testID={testID}>
        <View className="flex-row items-center justify-between border-b border-line px-5 py-4">
          <Text className="text-base font-semibold text-ink">{title}</Text>
          <Pressable onPress={onClose} hitSlop={16} testID="picker-close">
            <Text className="text-sm text-muted">Close</Text>
          </Pressable>
        </View>

        <ScrollView>
          {options.map((option) => {
            const selected = option.id === selectedId;
            return (
              <Pressable
                key={option.id}
                onPress={() => onSelect(option.id)}
                testID={`picker-option-${option.id}`}
                className={`flex-row items-center gap-3 px-5 py-3 active:bg-surface ${
                  option.indented ? 'pl-12' : ''
                } ${selected ? 'bg-surface' : ''}`}>
                <View
                  className={`items-center justify-center rounded-full ${
                    option.indented ? 'h-7 w-7' : 'h-9 w-9'
                  }`}
                  style={{ backgroundColor: option.color ?? '#6B5B4A' }}>
                  <Icon
                    name={option.icon ?? 'dots'}
                    size={option.indented ? 13 : 17}
                    color="#FFFFFF"
                  />
                </View>

                <Text
                  className={`flex-1 ${
                    option.indented ? 'text-sm text-muted' : 'text-base text-ink'
                  } ${selected ? 'font-semibold' : ''}`}>
                  {option.label}
                </Text>

                {option.detail ? (
                  <Text className="text-xs text-muted">{option.detail}</Text>
                ) : null}
                {selected ? <Text className="text-base text-accent">✓</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
