import { splitFigures } from './figures';

/**
 * The little markdown the model is allowed: paragraphs, "- " bullets, numbered
 * lines and **bold**. Parsed once here so the chat bubble and the PDF render
 * the same structure — two hand-written parsers would disagree about the edge
 * cases, and the disagreement would show up as a report that reads differently
 * from the message that described it.
 *
 * Cite tokens are split out as their own inlines, so a renderer can draw each
 * one through `useMoney` (or `formatMinor`, for a file) and never sees one as
 * text it might print raw.
 */

export type Inline =
  | { kind: 'text'; text: string; bold: boolean }
  | { kind: 'figure'; ref: string; bold: boolean; abs: boolean };

export type Block = { kind: 'paragraph' | 'bullet' | 'heading'; inlines: Inline[]; marker?: string };

function inlines(text: string): Inline[] {
  const out: Inline[] = [];
  // Bold first, then figures inside each run, so "**{{t1f1}}**" is a bold figure.
  const runs = text.split(/(\*\*[^*]+\*\*)/g).filter((run) => run !== '');
  for (const run of runs) {
    const bold = run.startsWith('**') && run.endsWith('**') && run.length > 4;
    // Single-asterisk italics are dropped rather than shown as punctuation —
    // and BEFORE the figures are split out: "*(or {{t1f2}} without travel)*"
    // wraps a figure, so once split the two asterisks sit in different text
    // pieces and neither piece sees a pair.
    const body = (bold ? run.slice(2, -2) : run).replace(
      /(^|\s)\*(\S[^*]*?\S|\S)\*(?=\s|$|[.,;:!?)])/g,
      '$1$2'
    );
    for (const segment of splitFigures(body)) {
      if (segment.kind === 'figure') out.push({ kind: 'figure', ref: segment.ref, bold, abs: segment.abs });
      else out.push({ kind: 'text', text: segment.text, bold });
    }
  }
  return out;
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', inlines: inlines(paragraph.join('\n')) });
    paragraph = [];
  };

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    // A blank line, or a horizontal rule ("---", "***", "___") — which a
    // chat bubble has no use for and showed as literal dashes: both are
    // simply the end of a paragraph.
    if (line.trim() === '' || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ kind: 'bullet', inlines: inlines(bullet[1]), marker: '•' });
    } else if (numbered) {
      flush();
      blocks.push({ kind: 'bullet', inlines: inlines(numbered[2]), marker: `${numbered[1]}.` });
    } else if (heading) {
      flush();
      blocks.push({ kind: 'heading', inlines: inlines(heading[1]) });
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

