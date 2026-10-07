import { GeminiError, postGenerate } from '../lib/gemini';

/**
 * One step of the conversation: history and tools in, the model's turn out.
 *
 * The model's `Content` is returned EXACTLY as received and is stored and
 * replayed that way. Gemini attaches a `thoughtSignature` to function-call
 * parts and refuses a later request whose history has lost it, so rebuilding
 * parts from what the screen displays would work in testing (short chats,
 * older models) and fail later in exactly the conversations that matter.
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
};

export type Content = { role: 'user' | 'model'; parts: Part[] };

/** The OpenAPI subset Gemini accepts for parameters. */
export type Schema = {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  enum?: string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  nullable?: boolean;
};

export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters?: Schema;
};

/**
 * Long, because one step can be a model reasoning over several tool results —
 * and still finite, because a captive portal must not leave the screen
 * thinking forever.
 */
export const CHAT_TIMEOUT_MS = 90_000;

export function buildChatRequest(
  system: string,
  contents: Content[],
  tools: FunctionDeclaration[]
): unknown {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    tools: [{ functionDeclarations: tools }],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: {
      // Low rather than zero: this writes prose, and zero makes it repeat
      // itself. Figures do not depend on it — they come from tools.
      temperature: 0.3,
    },
  };
}

/**
 * Dig the model's turn out of the envelope. Every disappointing reply here
 * arrives as HTTP 200, so each is named rather than left as "unexpected".
 */
export function extractTurn(body: unknown): Content {
  if (typeof body !== 'object' || body === null) {
    throw new GeminiError('Gemini returned something unexpected.');
  }
  const envelope = body as Record<string, unknown>;

  const feedback = envelope.promptFeedback as Record<string, unknown> | undefined;
  if (feedback?.blockReason) {
    throw new GeminiError(`Gemini refused to answer that (${String(feedback.blockReason)}).`);
  }

  const candidates = envelope.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new GeminiError('Gemini returned no answer.');
  }
  const first = candidates[0] as Record<string, unknown>;
  const finish = first.finishReason;

  // A garbled tool call is the model fumbling, not the request being wrong —
  // asking again usually works, so it is transient.
  if (finish === 'MALFORMED_FUNCTION_CALL' || finish === 'UNEXPECTED_TOOL_CALL') {
    throw new GeminiError('Gemini fumbled a step. Try asking again.', true);
  }
  // A truncated turn could be a function call missing its arguments, which
  // must not be executed.
  if (finish === 'MAX_TOKENS') {
    throw new GeminiError('Gemini ran out of room before finishing. Try a narrower question.');
  }
  if (typeof finish === 'string' && finish !== 'STOP' && finish !== 'FINISH_REASON_UNSPECIFIED') {
    throw new GeminiError(`Gemini stopped without answering (${finish}).`);
  }

  const content = first.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new GeminiError('Gemini returned an empty answer. Try asking again.', true);
  }

  return { role: 'model', parts: parts as Part[] };
}

export async function chatStep(
  apiKey: string,
  model: string,
  request: { system: string; contents: Content[]; tools: FunctionDeclaration[] },
  {
    fetchImpl = fetch,
    timeoutMs = CHAT_TIMEOUT_MS,
    signal,
  }: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<Content> {
  const body = await postGenerate(
    apiKey,
    model,
    buildChatRequest(request.system, request.contents, request.tools),
    { timeoutMs, fetchImpl, label: 'assistant turn', meanwhile: 'Try again in a minute.', signal }
  );
  return extractTurn(body);
}

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
