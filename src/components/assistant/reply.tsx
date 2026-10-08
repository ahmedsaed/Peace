import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Figure } from '@/assistant/figures';
import { maskStrayFigures } from '@/assistant/figures';
import { plainText } from '@/assistant/markdown';
import { RichText } from '@/components/assistant/rich-text';
import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { AMOUNT_MASK } from '@/lib/money';
import { useAmountsHidden, useMoney } from '@/state/money';

/**
 * One of Penny's replies: selectable text, and a Copy for the whole of it.
 *
 * Selecting covers "quote a line"; Copy covers "send this answer to someone",
 * where dragging handles across bullets and figures on a phone is a chore.
 *
 * The copy is made from what the SCREEN shows: figures through `useMoney`, so
 * with amounts hidden the clipboard gets the mask — a copy is a way off the
 * screen, and hiding amounts must not have one.
 */
export function Reply({ text, figures }: { text: string; figures: Record<string, Figure> }) {
  const money = useMoney();
  const hidden = useAmountsHidden();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const plain = plainText(
      text,
      (ref, abs) => {
        const figure = figures[ref];
        if (!figure) return '—';
        return money(abs ? Math.abs(figure.minor) : figure.minor, figure.currency);
      },
      (prose) => (hidden ? maskStrayFigures(prose, AMOUNT_MASK) : prose)
    );
    try {
      await Clipboard.setStringAsync(plain);
      setCopied(true);
    } catch (error) {
      console.warn('[assistant] copying a reply failed', error);
    }
  };

  return (
    <View className="my-1.5" testID="assistant-reply">
      <RichText text={text} figures={figures} />
      <Pressable
        onPress={() => void copy()}
        hitSlop={8}
        testID="assistant-reply-copy"
        accessibilityRole="button"
        accessibilityLabel={copied ? 'Copied' : 'Copy this reply'}
        className="mt-1 flex-row items-center gap-1.5 self-start rounded-md px-1.5 py-1 active:bg-surface">
        <Icon name="copy" size={14} color={copied ? palette.income : palette.muted} />
        <Text className={`text-[11px] ${copied ? 'text-income' : 'text-muted'}`}>{copied ? 'Copied' : 'Copy'}</Text>
      </Pressable>
    </View>
  );
}
