import { AiError } from '../error';
import { textOf, type ChatRequest, type Content, type FunctionDeclaration, type Part } from '../content';
import { postGenerate, postStream } from './transport';

/**
 * One step of the conversation: history and tools in, the model's turn out.
 *
 * The model's `Content` is returned EXACTLY as received and is stored and
 * replayed that way. Gemini attaches a `thoughtSignature` to function-call
 * parts and refuses a later request whose history has lost it, so rebuilding
 * parts from what the screen displays would work in testing (short chats,
 * older models) and fail later in exactly the conversations that matter.
 */

/**
 * Long, because one step can be a model reasoning over several tool results —
 * and still finite, because a captive portal must not leave the screen
 * thinking forever.
 */
export const CHAT_TIMEOUT_MS = 90_000;

/**
 * Gemini's own placeholder for a function call it did not generate — Google
 * documents it for exactly this: history carried over from another model,
 * which never had a signature to give. A last resort that may cost some
 * quality, which is acceptable for the rare conversation that changed
 * provider partway.
 */
export const FOREIGN_SIGNATURE = 'skip_thought_signature_validator';

/**
 * The conversation as Gemini will take it.
 *
 * A turn another provider wrote carries `native`, which Gemini rejects as an
 * unknown field, so it is stripped. Its calls have no `thoughtSignature`, which
 * a thinking Gemini model demands on the first call of each step, so they get
 * the documented placeholder. Their ids are the other provider's, and are
 * dropped along with the answers' — Gemini pairs a batch by order.
 */
export function forGemini(contents: Content[]): Content[] {
  const foreignIds = new Set<string>();
  return contents.map((content) => {
    if (content.role === 'model') {
      if (!content.native) return content;
      let signed = false;
      const parts = content.parts.map((part) => {
        if (!part.functionCall) return part;
        if (part.functionCall.id) foreignIds.add(part.functionCall.id);
        const { id: _foreign, ...call } = part.functionCall;
        const out: Part = { ...part, functionCall: call };
        if (!signed && !out.thoughtSignature) out.thoughtSignature = FOREIGN_SIGNATURE;
        signed = true;
        return out;
      });
      return { role: 'model', parts };
    }
    if (foreignIds.size === 0) return content;
    return {
      ...content,
      parts: content.parts.map((part) => {
        const response = part.functionResponse;
        if (!response?.id || !foreignIds.has(response.id)) return part;
        const { id: _foreign, ...rest } = response;
        return { ...part, functionResponse: rest };
      }),
    };
  });
}

export function buildChatRequest(
  system: string,
  contents: Content[],
  tools: FunctionDeclaration[]
): unknown {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: forGemini(contents),
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
    throw new AiError('Gemini returned something unexpected.');
  }
  const envelope = body as Record<string, unknown>;

  const feedback = envelope.promptFeedback as Record<string, unknown> | undefined;
  if (feedback?.blockReason) {
    throw new AiError(`Gemini refused to answer that (${String(feedback.blockReason)}).`);
  }

  const candidates = envelope.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new AiError('Gemini returned no answer.');
  }
  const first = candidates[0] as Record<string, unknown>;
  const finish = first.finishReason;

  // A garbled tool call is the model fumbling, not the request being wrong —
  // asking again usually works, so it is transient.
  if (finish === 'MALFORMED_FUNCTION_CALL' || finish === 'UNEXPECTED_TOOL_CALL') {
    throw new AiError('Gemini fumbled a step. Try asking again.', true);
  }
  // A truncated turn could be a function call missing its arguments, which
  // must not be executed.
  if (finish === 'MAX_TOKENS') {
    throw new AiError('Gemini ran out of room before finishing. Try a narrower question.');
  }
  if (typeof finish === 'string' && finish !== 'STOP' && finish !== 'FINISH_REASON_UNSPECIFIED') {
    throw new AiError(`Gemini stopped without answering (${finish}).`);
  }

  const content = first.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new AiError('Gemini returned an empty answer. Try asking again.', true);
  }

  return { role: 'model', parts: parts as Part[] };
}

export async function chatStep(
  apiKey: string,
  model: string,
  request: ChatRequest,
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

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * Fold one streamed piece of a turn into what has arrived so far.
 *
 * Text comes in fragments and is JOINED, so the stored turn has one text part
 * per run of prose rather than forty — but a part carrying a
 * `thoughtSignature` is never folded away: the signature can arrive on a
 * final, EMPTY text part, and dropping it fails the next request in exactly
 * the multi-step turns that matter. A function call always arrives whole and
 * is kept as its own part, in order.
 */
export function mergeParts(into: Part[], incoming: Part[]): Part[] {
  const out = into.slice();
  for (const part of incoming) {
    const last = out[out.length - 1];
    const joinable =
      last !== undefined &&
      typeof last.text === 'string' &&
      typeof part.text === 'string' &&
      !last.functionCall &&
      !part.functionCall &&
      !!last.thought === !!part.thought &&
      !last.thoughtSignature;
    if (joinable) {
      out[out.length - 1] = {
        ...last,
        text: last.text! + part.text!,
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      };
    } else {
      out.push({ ...part });
    }
  }
  return out;
}

/** What one streamed event says: its parts, and whether it ended the turn and how. */
export function readStreamEvent(event: unknown): { parts: Part[]; finish: string | null } {
  if (typeof event !== 'object' || event === null) return { parts: [], finish: null };
  const envelope = event as Record<string, unknown>;
  const feedback = envelope.promptFeedback as Record<string, unknown> | undefined;
  if (feedback?.blockReason) {
    throw new AiError(`Gemini refused to answer that (${String(feedback.blockReason)}).`);
  }
  const first = (Array.isArray(envelope.candidates) ? envelope.candidates[0] : undefined) as
    | Record<string, unknown>
    | undefined;
  const parts = ((first?.content as Record<string, unknown> | undefined)?.parts ?? []) as Part[];
  const finish = typeof first?.finishReason === 'string' ? first.finishReason : null;
  return { parts: Array.isArray(parts) ? parts : [], finish };
}

/**
 * One step, streamed. `onText` receives the visible prose SO FAR after every
 * piece; the resolved turn is the same `Content` `chatStep` would have
 * returned, checked by the same rules once the stream ends — a stream that
 * stops on MAX_TOKENS is as unusable as a reply that did.
 */
export async function chatStepStreaming(
  apiKey: string,
  model: string,
  request: ChatRequest,
  {
    fetchImpl = fetch,
    idleMs = 45_000,
    signal,
    onText,
  }: {
    fetchImpl?: typeof fetch;
    idleMs?: number;
    signal?: AbortSignal;
    onText?: (soFar: string) => void;
  } = {}
): Promise<Content> {
  let parts: Part[] = [];
  let finish: string | null = null;
  let shown = '';

  await postStream(apiKey, model, buildChatRequest(request.system, request.contents, request.tools), {
    idleMs,
    fetchImpl,
    label: 'assistant turn (streamed)',
    meanwhile: 'Try again in a minute.',
    signal,
    onEvent: (event) => {
      const piece = readStreamEvent(event);
      if (piece.finish) finish = piece.finish;
      if (piece.parts.length === 0) return;
      parts = mergeParts(parts, piece.parts);
      const text = textOf({ role: 'model', parts });
      if (text !== shown) {
        shown = text;
        onText?.(text);
      }
    },
  });

  // The assembled turn goes through the SAME checks as an unstreamed one.
  return extractTurn({ candidates: [{ content: { role: 'model', parts }, finishReason: finish ?? 'STOP' }] });
}
