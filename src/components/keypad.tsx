import { Pressable, Text, View } from 'react-native';

import type { Op } from '@/lib/calculator';

export type KeyPress =
  | { kind: 'digit'; value: string }
  | { kind: 'dot' }
  | { kind: 'op'; value: Op }
  | { kind: 'equals' };

/**
 * Operators occupy the left column and digits a 3x4 block to their right —
 * the reference app's layout, and the reason it is fast one-handed: the thumb
 * never crosses the keypad to reach `+`.
 */
const ROWS: { op: Op; digits: string[] }[] = [
  { op: '+', digits: ['7', '8', '9'] },
  { op: '-', digits: ['4', '5', '6'] },
  { op: '*', digits: ['1', '2', '3'] },
  { op: '/', digits: ['0', '.', '='] },
];

const OP_LABEL: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/**
 * testIDs must be regex-safe. Maestro matches ids as REGULAR EXPRESSIONS, so an
 * id of "key-op-+" reads as "key-op" followed by one or more hyphens — which
 * silently matches the minus key instead. That bug shipped a passing E2E test
 * that saved 120 - 35 while claiming to test 120 + 35.
 */
const OP_TESTID: Record<Op, string> = {
  '+': 'plus',
  '-': 'minus',
  '*': 'times',
  '/': 'divide',
};

function Key({
  label,
  onPress,
  variant = 'digit',
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'digit' | 'op';
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`m-1 flex-1 items-center justify-center rounded-lg py-3.5 active:opacity-60 ${
        variant === 'op' ? 'bg-raised' : 'bg-surface'
      }`}>
      <Text
        className={`text-xl ${variant === 'op' ? 'font-semibold text-accent' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Keypad({ onKey }: { onKey: (press: KeyPress) => void }) {
  return (
    <View testID="keypad">
      {ROWS.map(({ op, digits }) => (
        <View key={op} className="flex-row">
          <Key
            label={OP_LABEL[op]}
            variant="op"
            testID={`key-op-${OP_TESTID[op]}`}
            onPress={() => onKey({ kind: 'op', value: op })}
          />
          {digits.map((d) => {
            if (d === '.') {
              return <Key key={d} label="." testID="key-dot" onPress={() => onKey({ kind: 'dot' })} />;
            }
            if (d === '=') {
              return (
                <Key
                  key={d}
                  label="="
                  variant="op"
                  testID="key-equals"
                  onPress={() => onKey({ kind: 'equals' })}
                />
              );
            }
            return (
              <Key
                key={d}
                label={d}
                testID={`key-${d}`}
                onPress={() => onKey({ kind: 'digit', value: d })}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}
