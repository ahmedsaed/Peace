import { useMemo } from 'react';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';

import { cursorUrl, toDisplayMarkdown } from '@/assistant/display-markdown';
import type { Figure } from '@/assistant/figures';
import palette from '@/constants/palette';
import { AMOUNT_MASK } from '@/lib/money';
import { useAmountsHidden, useMoney } from '@/state/money';

/**
 * One of Penny's replies, as native rich text.
 *
 * WHY THIS RENDERER. A reply is markdown — paragraphs, bullets, headings,
 * rules — and it has to be selectable ACROSS all of it. React Native confines a
 * selection to one text view, so a renderer that draws a view per paragraph
 * stops every selection at the paragraph's edge. `react-native-enriched-markdown`
 * paints the whole document into ONE native text view with spans (in its
 * default `commonmark` flavour), the way native chat apps do: real list
 * indents, headings, rules, and a selection that runs end to end.
 *
 * The coin cursor is an inline image at the end of a streaming reply, drawn
 * and animated by our patch to the renderer — see `toDisplayMarkdown`.
 */

const STYLE: MarkdownStyle = {
  paragraph: { fontSize: 15, lineHeight: 22, color: palette.ink, marginTop: 0, marginBottom: 8 },
  h1: { fontSize: 19, lineHeight: 26, fontWeight: '700', color: palette.ink, marginTop: 4, marginBottom: 6 },
  h2: { fontSize: 17, lineHeight: 24, fontWeight: '700', color: palette.ink, marginTop: 4, marginBottom: 6 },
  h3: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: palette.ink, marginTop: 4, marginBottom: 4 },
  h4: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: palette.ink },
  h5: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: palette.ink },
  h6: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: palette.muted },
  strong: { fontWeight: 'bold', color: palette.ink },
  em: { fontStyle: 'italic', color: palette.ink },
  list: {
    fontSize: 15,
    lineHeight: 22,
    color: palette.ink,
    bulletColor: palette.muted,
    markerColor: palette.muted,
    gapWidth: 8,
    marginLeft: 6,
    itemSpacing: 2,
    marginBottom: 8,
  },
  blockquote: {
    fontSize: 15,
    lineHeight: 22,
    color: palette.muted,
    borderColor: palette.line,
    borderWidth: 3,
    gapWidth: 10,
    marginBottom: 8,
  },
  code: { color: palette.ink, backgroundColor: palette.raised, borderColor: palette.line, fontSize: 13 },
  codeBlock: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.ink,
    backgroundColor: palette.surface,
    borderColor: palette.line,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
  },
  link: { color: palette.accent, underline: false },
  thematicBreak: { color: palette.line, height: 1, marginTop: 6, marginBottom: 12 },
  // The coin cursor's size — it is an inline image as far as layout goes.
  inlineImage: { size: 14 },
};

const CURSOR = cursorUrl(palette.accent, palette['accent-ink']);

export function MarkdownReply({
  text,
  figures,
  streaming = false,
  testID,
}: {
  text: string;
  figures: Record<string, Figure>;
  streaming?: boolean;
  testID?: string;
}) {
  const money = useMoney();
  const hidden = useAmountsHidden();
  const markdown = useMemo(
    () => toDisplayMarkdown(text, figures, money, { hidden, mask: AMOUNT_MASK, streaming, cursor: CURSOR }),
    [text, figures, money, hidden, streaming]
  );

  return (
    <EnrichedMarkdownText
      markdown={markdown}
      markdownStyle={STYLE}
      // ONE text view for the whole reply, so a selection spans all of it.
      flavor="commonmark"
      selectable
      selectionColor={`${palette.accent}55`}
      selectionHandleColor={palette.accent}
      // "Copy as Markdown" would hand over backslash-escaped amounts; the
      // ordinary Copy already carries what the screen shows, mask included.
      selectionMenuConfig={{ copyAsMarkdown: { enabled: false }, copyImageUrl: { enabled: false } }}
      // The last paragraph's bottom margin would sit under the bubble.
      allowTrailingMargin={false}
      testID={testID}
    />
  );
}
