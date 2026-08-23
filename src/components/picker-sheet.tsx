import { useCallback, useEffect, useRef } from 'react';
import { Modal, Pressable, ScrollView, Text, View, type LayoutRectangle } from 'react-native';

import { Icon } from '@/components/icon';
import { centerScrollOffset } from '@/lib/layout';

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
 *
 * OPENS ON THE CURRENT SELECTION. A category list runs to 33 entries and the
 * sheet shows about seven, so opening at the top means the thing you already
 * chose is usually off screen — and the tick confirming it is the one piece of
 * information the sheet exists to give you.
 *
 * Every row reports its position rather than only the selected one, because the
 * selection can change between two opens without anything about the layout
 * changing, and an `onLayout` only fires when the layout moves. Measuring all of
 * them means the scroll is computed from where the selected row IS, not from
 * where a row happened to be the last time one moved.
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
  const scroller = useRef<ScrollView>(null);
  const rows = useRef(new Map<string, LayoutRectangle>());
  const viewport = useRef(0);
  const content = useRef(0);
  /** One scroll per opening. Later layout passes must not yank the list back. */
  const centred = useRef(false);

  const centreOnSelection = useCallback(() => {
    if (centred.current || !selectedId) return;

    const row = rows.current.get(selectedId);
    if (!row) return;

    const offset = centerScrollOffset(row, viewport.current, content.current);
    // A zero offset is the answer for a short list and for a selection already
    // at the top, so it still counts as done — otherwise every subsequent
    // layout pass would try again.
    centred.current = true;

    // Deferred a frame: scrolling from inside the layout pass that produced
    // these measurements gets overwritten by that same pass on Android.
    requestAnimationFrame(() => {
      scroller.current?.scrollTo({ y: offset, animated: false });
    });
  }, [selectedId]);

  // A Modal keeps this component mounted while hidden, so the refs survive a
  // close. Arm the next opening, then try immediately: if the sheet's content
  // stayed mounted no `onLayout` will fire again and this is the only chance.
  useEffect(() => {
    if (!visible) return;
    centred.current = false;
    centreOnSelection();
  }, [visible, centreOnSelection]);

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

        <ScrollView
          ref={scroller}
          onLayout={(event) => {
            viewport.current = event.nativeEvent.layout.height;
            centreOnSelection();
          }}
          onContentSizeChange={(_width, height) => {
            content.current = height;
            centreOnSelection();
          }}>
          {options.map((option) => {
            const selected = option.id === selectedId;
            return (
              <Pressable
                key={option.id}
                onPress={() => onSelect(option.id)}
                onLayout={(event) => {
                  rows.current.set(option.id, event.nativeEvent.layout);
                  if (selected) centreOnSelection();
                }}
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
