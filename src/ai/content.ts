/**
 * The shapes every AI request is built from, whichever provider answers it.
 *
 * GEMINI'S SHAPES, ON PURPOSE. Penny's conversation is stored as Gemini
 * `Content` and has been since the first row was written, and a schema here is
 * Gemini's OpenAPI subset. Rather than migrate every stored conversation into a
 * third format of our own, these stay the app's internal language and each
 * other provider's adapter translates at the moment a request is built — the
 * same direction the screen already reads them in.
 */

export type FunctionCall = { name: string; args?: Record<string, unknown>; id?: string };
export type FunctionResponse = { name: string; id?: string; response: Record<string, unknown> };

export type Part = {
  text?: string;
  /** A model's reasoning summary. Kept for replay, never shown. */
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: FunctionCall;
  functionResponse?: FunctionResponse;
  /** A file's bytes, base64 — a receipt photo, a PDF, a voice clip. */
  inlineData?: { mimeType: string; data: string };
};

/**
 * What a provider other than Gemini needs replayed that has no place in a Gemini
 * part — DeepSeek's `reasoning_content`, OpenRouter's `reasoning_details`. Kept
 * on the turn it came with, sent back only to the provider that wrote it, and
 * stripped before Gemini sees the turn (it rejects fields it does not know).
 * Its presence is also how a turn is known to be foreign to Gemini.
 */
export type NativeTurn = {
  provider: string;
  reasoning?: string;
  reasoningDetails?: unknown[];
};

export type Content = { role: 'user' | 'model'; parts: Part[]; native?: NativeTurn };

/** The OpenAPI subset Gemini accepts for parameters and structured output. */
export type Schema = {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  items?: Schema;
  nullable?: boolean;
};

export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters?: Schema;
};

/** One step of a conversation: what is sent. */
export type ChatRequest = { system: string; contents: Content[]; tools: FunctionDeclaration[] };

/** The calls in a model turn, in order. */
export function callsOf(content: Content): FunctionCall[] {
  return content.parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []));
}

/** The visible prose of a model turn — thoughts excluded. */
export function textOf(content: Content): string {
  return content.parts
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('')
    .trim();
}
