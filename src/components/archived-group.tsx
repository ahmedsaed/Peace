import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';

/**
 * What has been put away, at the foot of the list it was put away from.
 *
 * THE WAY BACK LIVES WHERE THE THING LEFT FROM. Archiving used to be a state
 * you could enter from a list and not leave from one: every list hid what was
 * archived, so the only way back was a separate Settings screen — three count
 * rows opening a modal, a second vocabulary for a thing the list already knew
 * about. A row that is here, collapsed and dimmed, is both the explanation and
 * the undo, and it needs no screen of its own.
 *
 * COLLAPSED, because the whole point of archiving something is that it stops
 * being in the way; the header alone is enough to say it exists. But the header
 * carries the SUMMARY — for accounts, the money still sitting in there — so the
 * list can account for a total that counts what the rows do not show. A figure
 * that includes money the screen never mentions is a screen disagreeing with
 * itself, and a collapsed row naming the subtotal answers that better than an
 * expanded group the user has to add up.
 */
export function ArchivedGroup({
  count,
  summary,
  hint,
  children,
  testID,
}: {
  count: number;
  /** The one figure the group is answerable for, e.g. the archived balance. */
  summary?: string;
  hint: string;
  children: React.ReactNode;
  testID: string;
}) {
  const [open, setOpen] = useState(false);

  // Nothing put away, nothing to say. The group appears the moment there is
  // something in it and disappears when the last one comes back, so its
  // presence is itself the answer to "is anything archived?".
  if (count === 0) return null;

  return (
    <View className="pt-2" testID={testID}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Archived, ${count}`}
        testID={`${testID}-toggle`}
        className="flex-row items-center gap-2 rounded-xl px-3 py-2.5 active:bg-surface">
        <Icon name="folder" size={14} color={palette.muted} />
        <Text className="text-[10px] uppercase tracking-widest text-muted">Archived</Text>
        <View className="rounded-full bg-raised px-2 py-0.5">
          <Text className="text-[11px] text-muted" testID={`${testID}-count`}>
            {count}
          </Text>
        </View>
        <View className="flex-1" />
        {summary ? (
          <Text className="text-xs text-muted" testID={`${testID}-summary`}>
            {summary}
          </Text>
        ) : null}
        {/* Rotated rather than swapped for an "up" glyph: there is no up
            chevron in the icon set, and a second glyph for one control is a
            second thing to keep in step. */}
        <View style={{ transform: [{ rotate: open ? '270deg' : '90deg' }] }}>
          <Icon name="chevron" size={12} color={palette.muted} />
        </View>
      </Pressable>

      {open ? (
        <View className="gap-3 pt-1" testID={`${testID}-items`}>
          <Text className="px-3 text-xs leading-5 text-muted">{hint}</Text>
          {children}
        </View>
      ) : null}
    </View>
  );
}
