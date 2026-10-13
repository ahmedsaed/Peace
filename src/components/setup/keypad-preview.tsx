import { Pressable, Text, View } from 'react-native';

import { keypadRows, type DigitOrder, type OperatorSide } from '@/lib/keypad-layout';

const OP_GLYPH: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/**
 * A keypad in miniature, drawn from the SAME table the record screen uses.
 *
 * "Pick by picture" only works if the picture is the real thing: built from
 * `keypadRows`, a change to the layout changes the preview with it, and the
 * choice a person makes here is the keypad they get.
 */
export function KeypadPreview({
  digits,
  operators,
  selected,
  label,
  onPress,
  testID,
}: {
  digits: DigitOrder;
  operators: OperatorSide;
  selected: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const rows = keypadRows(digits, operators);
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      className={`flex-1 rounded-2xl border-2 p-3 ${
        selected ? 'border-accent bg-surface' : 'border-line bg-ground active:bg-surface'
      }`}>
      <View className="gap-1">
        {rows.map((row, r) => (
          <View key={r} className="flex-row gap-1">
            {row.map((cell, c) => {
              const text =
                cell.kind === 'digit'
                  ? cell.value
                  : cell.kind === 'op'
                    ? OP_GLYPH[cell.op]
                    : cell.kind === 'dot'
                      ? '.'
                      : '=';
              const quiet = cell.kind === 'op' || cell.kind === 'equals';
              return (
                <View
                  key={c}
                  className={`h-7 flex-1 items-center justify-center rounded-md ${
                    quiet ? 'bg-raised' : 'bg-line'
                  }`}>
                  <Text
                    className={`text-xs font-medium ${
                      quiet && selected ? 'text-accent' : 'text-ink'
                    }`}>
                    {text}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      <Text
        className={`mt-3 text-center text-sm ${selected ? 'font-semibold text-ink' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
