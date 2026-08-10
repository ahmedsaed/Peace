import { Pressable, Text, View } from 'react-native';

import type { Op } from '@/lib/calculator';
import { byDensity, type Density } from '@/lib/layout';

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

/**
 * The keys shrink rather than scroll or wrap. Every key must stay on screen and
 * stay hittable in split-screen — a keypad you have to scroll is worse than no
 * keypad. `tight` is deliberately at the edge of the 44dp touch-target
 * guideline; going smaller would trade a layout problem for a mis-tap problem,
 * and a mis-typed amount is the more expensive of the two.
 */
const KEY_PAD: Record<Density, string> = {
  regular: 'py-3.5',
  compact: 'py-2.5',
  tight: 'py-1.5',
};
const KEY_GAP: Record<Density, string> = { regular: 'm-1', compact: 'm-0.5', tight: 'm-0.5' };
const KEY_TEXT: Record<Density, string> = {
  regular: 'text-xl',
  compact: 'text-lg',
  tight: 'text-base',
};

function Key({
  label,
  onPress,
  variant = 'digit',
  testID,
  density,
}: {
  label: string;
  onPress: () => void;
  variant?: 'digit' | 'op';
  testID: string;
  density: Density;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`flex-1 items-center justify-center rounded-lg active:opacity-60 ${byDensity(
        density,
        KEY_GAP
      )} ${byDensity(density, KEY_PAD)} ${variant === 'op' ? 'bg-raised' : 'bg-surface'}`}>
      <Text
        className={`${byDensity(density, KEY_TEXT)} ${
          variant === 'op' ? 'font-semibold text-accent' : 'text-ink'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Keypad({
  onKey,
  density = 'regular',
  equalsLabel = '=',
}: {
  onKey: (press: KeyPress) => void;
  density?: Density;
  /**
   * What the bottom-right key will do next — see src/lib/record-flow.ts. The
   * key is `=` while a sum is pending and becomes the record's "next" and
   * "save" action once there is nothing to evaluate, so it has to say which.
   */
  equalsLabel?: string;
}) {
  return (
    <View testID="keypad">
      {ROWS.map(({ op, digits }) => (
        <View key={op} className="flex-row">
          <Key
            label={OP_LABEL[op]}
            variant="op"
            density={density}
            testID={`key-op-${OP_TESTID[op]}`}
            onPress={() => onKey({ kind: 'op', value: op })}
          />
          {digits.map((d) => {
            if (d === '.') {
              return (
                <Key
                  key={d}
                  label="."
                  density={density}
                  testID="key-dot"
                  onPress={() => onKey({ kind: 'dot' })}
                />
              );
            }
            if (d === '=') {
              return (
                <Key
                  key={d}
                  label={equalsLabel}
                  variant="op"
                  density={density}
                  testID="key-equals"
                  onPress={() => onKey({ kind: 'equals' })}
                />
              );
            }
            return (
              <Key
                key={d}
                label={d}
                density={density}
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
