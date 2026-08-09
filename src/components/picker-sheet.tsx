import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

export type PickerOption = {
  id: string;
  label: string;
  icon?: string | null;
  color?: string | null;
  /** Rendered indented — a sub-category under its parent. */
  indented?: boolean;
  /** Extra detail on the right, e.g. an account's balance. */
  detail?: string;
  /** Colours the detail. A negative balance in the muted grey reads as fine. */
  detailTone?: 'neutral' | 'negative';
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
      {/* Tapping above the sheet dismisses it — expected of a sheet, and it
          keeps the user from feeling trapped in a picker they opened by
          accident. Deliberately NOT dimmed: `animationType="slide"` moves the
          sheet but cross-fades nothing, so a scrim appears as an abrupt dark
          slab over the screen the instant the sheet starts moving. The sheet's
          own border and elevation separate it well enough on a dark theme. */}
      <Pressable
        className="flex-1"
        onPress={onClose}
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
                  <Text
                    className={`text-xs tabular-nums ${
                      option.detailTone === 'negative' ? 'text-expense' : 'text-muted'
                    }`}>
                    {option.detail}
                  </Text>
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
