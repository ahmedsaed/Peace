/**
 * Between the app's Gemini-shaped turns and OpenAI's Chat Completions messages.
 *
 * Pure, and tested without a network, because every rule here is one a real
 * provider enforces with a 400 in exactly the conversations that matter:
 *
 * - A tool call needs an ID, and its answer must name it. Gemini's calls often
 *   have none, so a conversation started there gets ids made up IN ORDER, and
 *   each answer takes the next one — Gemini answers a batch in the order it
 *   asked, which is the one thing that makes the pairing unambiguous.
 * - Answers are separate `tool` messages, one per call, straight after the
 *   assistant message that asked; any prose in the same Gemini turn follows.
 * - Reasoning a provider asked to have back goes back ONLY to that provider.
 */

import { AiError } from '../error';
import type { Content, FunctionDeclaration, Part, Schema } from '../content';
import type { Flavor } from './flavors';

type TextPart = { type: 'text'; text: string };
type MessagePart =
  | TextPart
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }
  | { type: 'document_url'; document_url: string }
  | { type: 'input_audio'; input_audio: { data: string; format: string } | string };

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | MessagePart[] }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
      reasoning_content?: string;
      reasoning?: string;
      reasoning_details?: unknown[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Gemini's OpenAPI subset as JSON Schema.
 *
 * `nullable` becomes a type union. STRICT mode (structured output) also wants
 * every property listed in `required` and no others allowed — so an optional
 * field becomes a required one that may be null, which is what the readers
 * already treat a missing field as.
 */
export function toJsonSchema(schema: Schema, strict: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out.type = schema.nullable ? [schema.type, 'null'] : schema.type;
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.nullable ? [...schema.enum, null] : [...schema.enum];
  if (schema.items) out.items = toJsonSchema(schema.items, strict);
  if (schema.properties) {
    const properties: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(schema.properties)) {
      const optional = !schema.required?.includes(name);
      // Strict mode has no optional fields, so an optional one may be null.
      properties[name] = toJsonSchema(strict && optional ? { ...child, nullable: true } : child, strict);
    }
    out.properties = properties;
    if (strict) {
      out.required = Object.keys(schema.properties);
      out.additionalProperties = false;
    } else if (schema.required?.length) {
      out.required = [...schema.required];
    }
  }
  return out;
}

export function toTools(declarations: FunctionDeclaration[]): unknown[] {
  return declarations.map((d) => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description,
      parameters: d.parameters ? toJsonSchema(d.parameters, false) : { type: 'object', properties: {} },
    },
  }));
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const AUDIO_FORMATS: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
};

/** One file, written the way this provider reads one — or refused in words. */
function filePart(inline: { mimeType: string; data: string }, flavor: Flavor): MessagePart {
  const { mimeType, data } = inline;
  const url = `data:${mimeType};base64,${data}`;
  if (mimeType.startsWith('image/')) return { type: 'image_url', image_url: { url } };
  if (mimeType === 'application/pdf') {
    if (flavor.pdf === 'file') return { type: 'file', file: { filename: 'document.pdf', file_data: url } };
    if (flavor.pdf === 'document_url') return { type: 'document_url', document_url: url };
    throw new AiError(`${flavor.name} cannot read PDFs. Choose another model, or attach a photo of it.`);
  }
  if (mimeType.startsWith('audio/')) {
    const format = AUDIO_FORMATS[mimeType] ?? mimeType.slice('audio/'.length);
    return {
      type: 'input_audio',
      input_audio: flavor.audio === 'string' ? data : { data, format },
    };
  }
  throw new AiError(`${flavor.name} cannot read a ${mimeType} file.`);
}

/** A user turn's text and files as one message's content. */
export function userContent(parts: Part[], flavor: Flavor): string | MessagePart[] {
  const out: MessagePart[] = [];
  for (const part of parts) {
    if (part.inlineData) out.push(filePart(part.inlineData, flavor));
    else if (typeof part.text === 'string' && !part.thought) out.push({ type: 'text', text: part.text });
  }
  // Plain text as a plain string: every provider reads that, where a few
  // older models refuse a content ARRAY that carries nothing but text.
  if (out.every((p) => p.type === 'text')) return out.map((p) => (p as TextPart).text).join('\n\n');
  return out;
}

/**
 * The whole conversation as messages.
 *
 * Gemini's thought parts and signatures never travel — they mean nothing to
 * anybody else. A turn's own provider's reasoning does, when that provider is
 * the one being asked.
 */
export function toMessages(system: string, contents: Content[], flavor: Flavor): Message[] {
  const messages: Message[] = [{ role: 'system', content: system }];
  // Ids handed to calls that had none, waiting for their answers, in order.
  let unanswered: string[] = [];

  contents.forEach((content, turn) => {
    if (content.role === 'model') {
      const calls: ToolCall[] = [];
      unanswered = [];
      let text = '';
      content.parts.forEach((part, i) => {
        if (part.functionCall) {
          const id = part.functionCall.id || `call_${turn}_${i}`;
          if (!part.functionCall.id) unanswered.push(id);
          calls.push({
            id,
            type: 'function',
            function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) },
          });
        } else if (typeof part.text === 'string' && !part.thought) {
          text += part.text;
        }
      });
      const message: Extract<Message, { role: 'assistant' }> = { role: 'assistant', content: text || null };
      if (calls.length > 0) message.tool_calls = calls;
      const native = content.native;
      if (native && native.provider === flavor.provider) {
        if (native.reasoning && flavor.reasoningField) message[flavor.reasoningField] = native.reasoning;
        if (native.reasoningDetails) message.reasoning_details = native.reasoningDetails;
      }
      messages.push(message);
      return;
    }

    const answers = content.parts.filter((p) => p.functionResponse);
    for (const part of answers) {
      const response = part.functionResponse!;
      const id = response.id || unanswered.shift() || `call_${turn}_orphan`;
      messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(response.response) });
    }
    const rest = content.parts.filter((p) => !p.functionResponse);
    if (rest.length > 0) messages.push({ role: 'user', content: userContent(rest, flavor) });
  });

  return messages;
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

export type ReplyMessage = {
  content?: unknown;
  tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[];
  reasoning_content?: unknown;
  reasoning?: unknown;
  reasoning_details?: unknown;
};

/** Refuse what an unfinished or refused reply would otherwise pass off as an answer. */
export function checkFinish(finish: unknown, flavor: Flavor, what: 'turn' | 'reading'): void {
  if (finish === 'length') {
    throw new AiError(
      what === 'turn'
        ? `${flavor.name} ran out of room before finishing. Try a narrower question.`
        : `${flavor.name} stopped early and the reading is incomplete.`
    );
  }
  if (finish === 'content_filter') throw new AiError(`${flavor.name} refused to answer that.`);
}

/**
 * The provider's message as the app's turn.
 *
 * A call whose arguments are not JSON is the model fumbling, not the request
 * being wrong — asking again usually works, so it is transient. It must never
 * be executed half-read.
 */
export function turnFromMessage(message: ReplyMessage | undefined, finish: unknown, flavor: Flavor): Content {
  checkFinish(finish, flavor, 'turn');
  if (!message) throw new AiError(`${flavor.name} returned no answer.`);

  const parts: Part[] = [];
  const text = typeof message.content === 'string' ? message.content : '';
  if (text !== '') parts.push({ text });
  for (const call of message.tool_calls ?? []) {
    const name = call.function?.name;
    if (typeof name !== 'string' || name === '') throw new AiError(`${flavor.name} fumbled a step. Try asking again.`, true);
    const raw = call.function?.arguments;
    let args: Record<string, unknown> = {};
    if (typeof raw === 'string' && raw.trim() !== '') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
        else throw new Error('not an object');
      } catch {
        throw new AiError(`${flavor.name} fumbled a step. Try asking again.`, true);
      }
    }
    parts.push({ functionCall: { name, args, ...(typeof call.id === 'string' && call.id ? { id: call.id } : {}) } });
  }
  if (parts.length === 0) throw new AiError(`${flavor.name} returned an empty answer. Try asking again.`, true);

  const content: Content = { role: 'model', parts, native: { provider: flavor.provider } };
  const reasoning = flavor.reasoningField ? message[flavor.reasoningField] : undefined;
  if (typeof reasoning === 'string' && reasoning !== '') content.native!.reasoning = reasoning;
  if (Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0) {
    content.native!.reasoningDetails = message.reasoning_details;
  }
  return content;
}

/**
 * A streamed reply, folded together as it arrives.
 *
 * Prose arrives in fragments and is joined; a tool call arrives as an id and
 * a name and then its ARGUMENTS IN PIECES, keyed by `index`, and is only
 * whole — and only parsed — once the stream has ended.
 */
export class StreamFold {
  private text = '';
  private reasoning = '';
  private details: unknown[] = [];
  private calls: { id: string; name: string; args: string }[] = [];
  finish: unknown = null;

  constructor(private readonly flavor: Flavor) {}

  /** Folds one event in; returns the visible prose so far. */
  push(event: unknown): string {
    const choice = (event as { choices?: unknown[] } | null)?.choices?.[0] as
      | { delta?: Record<string, unknown>; finish_reason?: unknown }
      | undefined;
    if (!choice) return this.text;
    if (choice.finish_reason) this.finish = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string') this.text += delta.content;
    const field = this.flavor.reasoningField;
    if (field && typeof delta[field] === 'string') this.reasoning += delta[field] as string;
    if (Array.isArray(delta.reasoning_details)) this.details.push(...delta.reasoning_details);
    for (const raw of (delta.tool_calls as unknown[] | undefined) ?? []) {
      const call = raw as { index?: number; id?: string; function?: { name?: string; arguments?: string } };
      const at = typeof call.index === 'number' ? call.index : this.calls.length;
      const slot = (this.calls[at] ??= { id: '', name: '', args: '' });
      if (call.id) slot.id = call.id;
      if (call.function?.name) slot.name += call.function.name;
      if (call.function?.arguments) slot.args += call.function.arguments;
    }
    return this.text;
  }

  /** The finished turn, checked exactly as an unstreamed one is. */
  turn(): Content {
    const message: ReplyMessage = {
      content: this.text,
      tool_calls: this.calls.filter(Boolean).map((c) => ({ id: c.id, function: { name: c.name, arguments: c.args } })),
      ...(this.flavor.reasoningField ? { [this.flavor.reasoningField]: this.reasoning } : {}),
      ...(this.details.length > 0 ? { reasoning_details: this.details } : {}),
    };
    return turnFromMessage(message, this.finish ?? 'stop', this.flavor);
  }
}

/**
 * The JSON inside a structured reply.
 *
 * With a strict schema this is one `JSON.parse`. A provider with only
 * `json_object` mode can still wrap it in a code fence now and then, which is
 * cheap to forgive and costly to fail a receipt over.
 */
export function parseJsonReply(text: unknown, flavor: Flavor): unknown {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new AiError(`${flavor.name} returned an empty reading.`);
  }
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    console.warn(`[${flavor.provider}] structured output was not valid JSON`, text.slice(0, 200));
    throw new AiError(`${flavor.name} returned a reading that could not be read.`);
  }
}
