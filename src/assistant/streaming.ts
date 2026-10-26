/**
 * What prose may be shown while it is still arriving.
 *
 * A cite token arrives a few characters at a time, and "{{t3f" on screen is
 * the raw machinery the token exists to hide — so an unfinished token at the
 * end is held back until it closes. An unclosed `**` is closed, or every word
 * after it would flash bold-then-plain as the stream catches up.
 */
export function streamingVisible(text: string): string {
  let out = text;
  const open = out.lastIndexOf('{');
  if (open >= 0 && out.indexOf('}}', open) < 0) {
    const start = out[open - 1] === '{' ? open - 1 : open;
    out = out.slice(0, start);
  }
  if ((out.match(/\*\*/g) ?? []).length % 2 === 1) out += '**';
  return out;
}
