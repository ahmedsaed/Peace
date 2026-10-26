/**
 * Server-Sent Events, fed in arbitrary pieces.
 *
 * A network read can end anywhere — mid-line, mid-word, between the `\r` and
 * the `\n` — so text is buffered until a blank line closes an event, and only
 * then are its `data:` lines joined and handed back. Every provider streams
 * this way; only what is inside the `data:` differs.
 */
export class SseParser {
  private buffer = '';
  /** A `\r` that ended the last piece — it may be half of a `\r\n`. */
  private held = '';

  push(text: string): string[] {
    let raw = this.held + text;
    this.held = '';
    // Normalising "\r" to "\n" here and its partner "\n" in the next piece
    // would make one line break into two — a blank line, which ENDS an event
    // early and splits its JSON in half.
    if (raw.endsWith('\r')) {
      this.held = '\r';
      raw = raw.slice(0, -1);
    }
    this.buffer += raw.replace(/\r\n?/g, '\n');
    const events: string[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''));
      if (data.length > 0) events.push(data.join('\n'));
    }
    return events;
  }
}

/** One event's JSON, or null — logged — when it is not JSON. */
export function parseEvent(data: string, tag: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    // One mangled event must not be mistaken for a network failure — but it
    // is worth knowing about, so it is logged and handed on as nothing.
    console.warn(`[${tag}] a streamed event was not JSON`, data.slice(0, 200));
    return null;
  }
}
