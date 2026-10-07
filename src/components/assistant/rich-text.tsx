import { Text, View } from 'react-native';

import type { Figure } from '@/assistant/figures';
import { maskStrayFigures } from '@/assistant/figures';
import { parseBlocks, type Inline } from '@/assistant/markdown';
import { AMOUNT_MASK } from '@/lib/money';
import { useAmountsHidden, useMoney } from '@/state/money';

/**
 * A reply, with its figures drawn the way every other amount in the app is.
 *
 * Each cite token becomes `money(minor, currency)` — so hiding amounts hides
 * these too, with no special case. Prose the model wrote is masked as well
 * when amounts are hidden, for the figure it TYPED instead of citing: the
 * prompt forbids it, and this is what keeps "forbidden" from meaning "usually
 * absent". It fails closed on anything shaped like money.
 */
export function RichText({
  text,
  figures,
  testID,
}: {
  text: string;
  figures: Record<string, Figure>;
  testID?: string;
}) {
  const money = useMoney();
  const hidden = useAmountsHidden();

  const render = (inline: Inline, i: number) => {
    if (inline.kind === 'figure') {
      const figure = figures[inline.ref];
      return (
        <Text key={i} className="font-semibold text-ink" testID={figure ? `figure-${inline.ref}` : undefined}>
          {/* A ref that resolves to nothing is shown as a gap, never as the raw
              token and never as a guess. */}
          {figure ? money(figure.minor, figure.currency) : '—'}
        </Text>
      );
    }
    const text = hidden ? maskStrayFigures(inline.text, AMOUNT_MASK) : inline.text;
    return (
      <Text key={i} className={inline.bold ? 'font-semibold' : undefined}>
        {text}
      </Text>
    );
  };

  return (
    <View className="gap-1.5" testID={testID}>
      {parseBlocks(text).map((block, i) =>
        block.kind === 'bullet' ? (
          <View key={i} className="flex-row gap-2 pl-1">
            <Text className="text-[15px] leading-[22px] text-muted">{block.marker}</Text>
            <Text className="flex-1 text-[15px] leading-[22px] text-ink">{block.inlines.map(render)}</Text>
          </View>
        ) : (
          <Text
            key={i}
            className={`text-[15px] leading-[22px] text-ink ${block.kind === 'heading' ? 'font-semibold' : ''}`}>
            {block.inlines.map(render)}
          </Text>
        )
      )}
    </View>
  );
}
