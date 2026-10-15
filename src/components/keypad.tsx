import { Pressable, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import type { Op } from "@/lib/calculator";
import { keypadRows, type KeypadCell } from "@/lib/keypad-layout";
import { byDensity, type Density } from "@/lib/layout";
import type { FlowKeyFace } from "@/lib/record-flow";
import { useSetting } from "@/state/settings";
import { useTheme } from "@/state/theme";

export type KeyPress =
  | { kind: "digit"; value: string }
  | { kind: "dot" }
  | { kind: "op"; value: Op }
  | { kind: "equals" };

/**
 * Operators occupy one edge column and digits a 3x4 block beside them — the
 * reference app's layout, and the reason it is fast one-handed: the thumb never
 * crosses the keypad to reach `+`. Which edge, and which way up the digits go,
 * are settings; the grid itself is `keypadRows` in src/lib/keypad-layout.ts.
 */
const OP_LABEL: Record<Op, string> = { "+": "+", "-": "−", "*": "×", "/": "÷" };
/** What TalkBack says. Read literally, `÷` is "division sign" and `.` is "dot". */
const OP_SPOKEN: Record<Op, string> = {
  "+": "Plus",
  "-": "Minus",
  "*": "Times",
  "/": "Divided by",
};

/**
 * testIDs must be regex-safe. Maestro matches ids as REGULAR EXPRESSIONS, so an
 * id of "key-op-+" reads as "key-op" followed by one or more hyphens — which
 * silently matches the minus key instead. That bug shipped a passing E2E test
 * that saved 120 - 35 while claiming to test 120 + 35.
 */
const OP_TESTID: Record<Op, string> = {
  "+": "plus",
  "-": "minus",
  "*": "times",
  "/": "divide",
};

/**
 * The keys shrink rather than scroll or wrap. Every key must stay on screen and
 * stay hittable in split-screen — a keypad you have to scroll is worse than no
 * keypad. `tight` is deliberately at the edge of the 44dp touch-target
 * guideline; going smaller would trade a layout problem for a mis-tap problem,
 * and a mis-typed amount is the more expensive of the two.
 */
const KEY_PAD: Record<Density, string> = {
  regular: "py-3.5",
  compact: "py-2.5",
  tight: "py-1.5",
};
const KEY_GAP: Record<Density, string> = {
  regular: "m-1",
  compact: "m-0.5",
  tight: "m-0.5",
};
const KEY_TEXT: Record<Density, string> = {
  regular: "text-xl",
  compact: "text-lg",
  tight: "text-base",
};
/** An icon face, sized to sit where the text-xl/lg/base glyph would. */
const KEY_ICON: Record<Density, number> = {
  regular: 22,
  compact: 20,
  tight: 18,
};

function Key({
  label,
  icon,
  spoken = label,
  onPress,
  variant = "digit",
  testID,
  density,
}: {
  label: string;
  /** Drawn instead of the label when set; `spoken` then says what it means. */
  icon?: string;
  /** The accessibility label, when the glyph is not the word. */
  spoken?: string;
  onPress: () => void;
  variant?: "digit" | "op";
  testID: string;
  density: Density;
}) {
  const palette = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      className={`flex-1 items-center justify-center rounded-lg active:opacity-60 ${byDensity(
        density,
        KEY_GAP,
      )} ${byDensity(density, KEY_PAD)} ${variant === "op" ? "bg-raised" : "bg-surface"}`}
    >
      {icon ? (
        <Icon
          name={icon}
          size={byDensity(density, KEY_ICON)}
          color={variant === "op" ? palette.accent : palette.ink}
        />
      ) : (
        <Text
          // Scales with the phone's font size, but only so far: twelve keys share
          // a fixed grid, and a 2x digit stops fitting its key. The amount above
          // the keypad is where a large-text reader reads what was typed.
          maxFontSizeMultiplier={1.4}
          className={`${byDensity(density, KEY_TEXT)} ${
            variant === "op" ? "font-semibold text-accent" : "text-ink"
          }`}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Keypad({
  onKey,
  density = "regular",
  equalsFace = { kind: "text", text: "=" },
  equalsSpoken = "Equals",
}: {
  onKey: (press: KeyPress) => void;
  density?: Density;
  /**
   * What the bottom-right key will do next — see src/lib/record-flow.ts. The
   * key is `=` while a sum is pending and becomes the record's "next" and
   * "save" action once there is nothing to evaluate, so it has to say which.
   */
  equalsFace?: FlowKeyFace;
  /** The same, for TalkBack — see `flowKeySpoken`. */
  equalsSpoken?: string;
}) {
  const order = useSetting("keypadDigits");
  const side = useSetting("keypadOperators");

  // testIDs name the key, never its position, so a flow typing `key-1` types a
  // one in every layout.
  const key = (cell: KeypadCell) => {
    switch (cell.kind) {
      case "op":
        return (
          <Key
            key={cell.op}
            label={OP_LABEL[cell.op]}
            spoken={OP_SPOKEN[cell.op]}
            variant="op"
            density={density}
            testID={`key-op-${OP_TESTID[cell.op]}`}
            onPress={() => onKey({ kind: "op", value: cell.op })}
          />
        );
      case "dot":
        return (
          <Key
            key="."
            label="."
            spoken="Decimal point"
            density={density}
            testID="key-dot"
            onPress={() => onKey({ kind: "dot" })}
          />
        );
      case "equals":
        return (
          <Key
            key="="
            label={equalsFace.kind === "text" ? equalsFace.text : ""}
            icon={equalsFace.kind === "icon" ? equalsFace.icon : undefined}
            spoken={equalsSpoken}
            variant="op"
            density={density}
            testID="key-equals"
            onPress={() => onKey({ kind: "equals" })}
          />
        );
      case "digit":
        return (
          <Key
            key={cell.value}
            label={cell.value}
            density={density}
            testID={`key-${cell.value}`}
            onPress={() => onKey({ kind: "digit", value: cell.value })}
          />
        );
    }
  };

  return (
    <View testID="keypad">
      {keypadRows(order, side).map((row, i) => (
        <View key={i} className="flex-row">
          {row.map(key)}
        </View>
      ))}
    </View>
  );
}
