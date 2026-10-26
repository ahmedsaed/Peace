/**
 * One way in to every provider.
 *
 * Features (reading a receipt, a bank message, a voice clip; Penny's turns)
 * say WHAT they want — parts in, JSON or a turn out — and an `Endpoint` names
 * who answers. Which wire format that takes, which header the key travels in
 * and how each provider words "your key is wrong" is the adapter's business,
 * and no screen ever learns it.
 */

import type { ChatRequest, Content, Part, Schema } from './content';
import * as gemini from './gemini/chat';
import * as geminiTransport from './gemini/transport';
import { AiError } from './error';
import { FLAVORS } from './openai/flavors';
import * as openai from './openai/transport';
import { PROVIDERS, type Endpoint, type ModelInfo, type ProviderId } from './providers';

export type JsonOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** For the log line when it fails. */
  label: string;
  /** What to do meanwhile, said after a failure: "Enter the record by hand." */
  meanwhile?: string;
};

export type ChatOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type StreamOptions = ChatOptions & {
  idleMs?: number;
  /** The visible prose so far, after every piece. */
  onText?: (soFar: string) => void;
};

export type ListOptions = { timeoutMs?: number; fetchImpl?: typeof fetch };

type Adapter = {
  checkKey: (apiKey: string, options?: ListOptions) => Promise<void>;
  listModels: (apiKey: string, options?: ListOptions) => Promise<ModelInfo[]>;
  generateJson: (
    apiKey: string,
    model: string,
    parts: Part[],
    schema: Schema,
    options: Required<Pick<JsonOptions, 'timeoutMs' | 'fetchImpl' | 'label'>> & Pick<JsonOptions, 'meanwhile'>
  ) => Promise<unknown>;
  chatStep: (apiKey: string, model: string, request: ChatRequest, options?: ChatOptions) => Promise<Content>;
  chatStepStreaming: (apiKey: string, model: string, request: ChatRequest, options?: StreamOptions) => Promise<Content>;
};

const GEMINI: Adapter = {
  checkKey: geminiTransport.checkKey,
  listModels: geminiTransport.listModels,
  generateJson: geminiTransport.generateJson,
  chatStep: gemini.chatStep,
  chatStepStreaming: gemini.chatStepStreaming,
};

function openAiAdapter(provider: ProviderId): Adapter {
  const flavor = FLAVORS[provider];
  if (!flavor) throw new AiError(`${PROVIDERS[provider].name} is not supported yet.`);
  return {
    checkKey: (apiKey, options) => openai.checkKey(flavor, apiKey, options),
    listModels: (apiKey, options) => openai.listModels(flavor, apiKey, options),
    generateJson: (apiKey, model, parts, schema, options) => openai.generateJson(flavor, apiKey, model, parts, schema, options),
    chatStep: (apiKey, model, request, options) => openai.chatStep(flavor, apiKey, model, request, options),
    chatStepStreaming: (apiKey, model, request, options) =>
      openai.chatStepStreaming(flavor, apiKey, model, request, options),
  };
}

function adapterFor(provider: ProviderId): Adapter {
  return PROVIDERS[provider].wire === 'gemini' ? GEMINI : openAiAdapter(provider);
}

/** Long enough for a model to read a photograph, short enough to give up on. */
export const READ_TIMEOUT_MS = geminiTransport.READ_TIMEOUT_MS;

function requireKey(endpoint: Endpoint): void {
  if (endpoint.apiKey.trim() === '') {
    throw new AiError(`No ${PROVIDERS[endpoint.provider].name} API key is saved. Add one in Settings › AI.`);
  }
}

/** A structured-output request: one prompt in, one JSON object out. */
export async function generateJson(
  endpoint: Endpoint,
  parts: Part[],
  schema: Schema,
  { timeoutMs = READ_TIMEOUT_MS, fetchImpl = fetch, label, meanwhile }: JsonOptions
): Promise<unknown> {
  requireKey(endpoint);
  return adapterFor(endpoint.provider).generateJson(endpoint.apiKey, endpoint.model, parts, schema, {
    timeoutMs,
    fetchImpl,
    label,
    meanwhile,
  });
}

export async function chatStep(endpoint: Endpoint, request: ChatRequest, options?: ChatOptions): Promise<Content> {
  requireKey(endpoint);
  return adapterFor(endpoint.provider).chatStep(endpoint.apiKey, endpoint.model, request, options);
}

export async function chatStepStreaming(
  endpoint: Endpoint,
  request: ChatRequest,
  options?: StreamOptions
): Promise<Content> {
  requireKey(endpoint);
  return adapterFor(endpoint.provider).chatStepStreaming(endpoint.apiKey, endpoint.model, request, options);
}

/**
 * A clip written down by a speech-to-text model — the first of two requests,
 * for a provider whose chat models cannot hear. Gemini's all can, and it has
 * no such endpoint.
 */
export async function transcribeAudio(
  endpoint: Endpoint,
  clip: { base64: string; mimeType: string },
  options?: { prompt?: string; timeoutMs?: number; fetchImpl?: typeof fetch; meanwhile?: string }
): Promise<string> {
  requireKey(endpoint);
  const flavor = FLAVORS[endpoint.provider];
  if (!flavor) throw new AiError(`${PROVIDERS[endpoint.provider].name} has no transcription models.`);
  return openai.transcribeAudio(flavor, endpoint.apiKey, endpoint.model, clip, options);
}

/** Which models this key may call. */
export function listModels(provider: ProviderId, apiKey: string, options?: ListOptions): Promise<ModelInfo[]> {
  return adapterFor(provider).listModels(apiKey, options);
}

/** Prove a key works before it is kept. Throws an `AiError` worded about the key. */
export function checkKey(provider: ProviderId, apiKey: string, options?: ListOptions): Promise<void> {
  return adapterFor(provider).checkKey(apiKey, options);
}

export { AiError } from './error';
export type { Endpoint, ModelInfo, ProviderId } from './providers';
