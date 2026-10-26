/**
 * A failure talking to an AI provider.
 *
 * `transient` is the whole reason this is not a plain Error. "The model is busy"
 * and "your key is wrong" both stop a reading, and treating them the same is how
 * a message that would have worked thirty seconds later gets parked forever with
 * an error beside it. One is worth retrying and the other never will be.
 *
 * The MESSAGE is for the screen and is already worded by the adapter that
 * caught it, naming the provider — every adapter reads its own error bodies,
 * because no two providers say "your key is wrong" the same way.
 */
export class AiError extends Error {
  readonly transient: boolean;
  /** How long the provider asked us to wait before trying again, when it said. */
  readonly retryAfterMs: number | null;

  constructor(message: string, transient = false, retryAfterMs: number | null = null) {
    super(message);
    this.transient = transient;
    this.retryAfterMs = retryAfterMs;
  }
}
