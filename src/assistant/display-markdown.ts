import { maskStrayFigures, splitFigures, type Figure } from './figures';
import { streamingVisible } from './gemini-chat';

/**
 * A reply as the markdown the native renderer draws.
 *
 * The renderer (`react-native-enriched-markdown`) paints a whole reply into ONE
 * native text view, which is what lets a selection run across paragraphs — but
 * it draws markdown, not our components, so everything ours is resolved into
 * the markdown here, in one pure, tested place:
 *
 *   CITED FIGURES become their formatted amounts. The formatter is the
 *   CALLER's — on screen that is `useMoney` — so with amounts hidden the text
 *   handed to the renderer already holds the mask, and nothing downstream (a
 *   selection, the native copy menu) can reach past it.
 *
 *   PROSE FIGURES the model typed instead of citing are masked when hidden,
 *   exactly as before; the token's own amount is never fed to that mask.
 *
 *   WHILE STREAMING, a half-arrived token or bold is held back
 *   (`streamingVisible`), and the coin cursor rides at the very end as an
 *   inline image the patched renderer draws and animates (see
 *   `patches/react-native-enriched-markdown+1.1.1.patch`).
 */

/** The reserved address the patched `ImageSpan` draws as Penny's coin. */
export function cursorUrl(color: string, ink: string): string {
  const hex = (c: string) => c.replace('#', '');
  return `peace://cursor?color=${hex(color)}&ink=${hex(ink)}`;
}

/**
 * Backslash-escape what markdown would read as syntax in an amount: a leading
 * "-" starts a list, "." after digits can start an ordered one, and "*" or "_"
 * would open emphasis.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]#+\-.!|>~])/g, '\\$1');
}

export function toDisplayMarkdown(
  text: string,
  figures: Record<string, Figure>,
  format: (minor: number, currency: string) => string,
  {
    hidden = false,
    mask = '••••',
    streaming = false,
    cursor,
  }: { hidden?: boolean; mask?: string; streaming?: boolean; cursor?: string } = {}
): string {
  const source = streaming ? streamingVisible(text) : text;
  let out = '';
  // Whether the text so far has an unclosed "**" — a figure inside bold must
  // not be wrapped in another pair, which would CLOSE the bold instead.
  let boldOpen = false;

  for (const segment of splitFigures(source)) {
    if (segment.kind === 'text') {
      const prose = hidden ? maskStrayFigures(segment.text, mask) : segment.text;
      out += prose;
      boldOpen = (prose.match(/\*\*/g)?.length ?? 0) % 2 === 1 ? !boldOpen : boldOpen;
      continue;
    }
    const figure = figures[segment.ref];
    // An unresolvable cite is a gap, never the raw token and never a guess.
    const amount = figure ? escapeMarkdown(format(segment.abs ? Math.abs(figure.minor) : figure.minor, figure.currency)) : '—';
    out += boldOpen ? amount : `**${amount}**`;
  }

  if (streaming && cursor && out.trim() !== '') {
    // A space first: glued to the last word, md4c could read "word![…]" oddly,
    // and the coin wants a gap anyway. A list item or heading still holds it
    // inline, because it is on the same line.
    out = `${out.trimEnd()} ![](${cursor})`;
  }
  return out;
}
