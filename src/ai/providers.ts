/**
 * The AI providers Peace can talk to, and what each needs to be reached.
 *
 * Two WIRE FORMATS cover all of them: Gemini's own, and the OpenAI Chat
 * Completions format that OpenAI, DeepSeek, Mistral and OpenRouter all speak.
 * So adding a provider that speaks the second is mostly a row here — a base
 * URL, a key page, a name — and its own reading of error bodies.
 *
 * The id is STORED (in settings, in a backup) — never rename one.
 */

export type ProviderId = 'gemini' | 'openai' | 'deepseek' | 'mistral' | 'openrouter';

export type Wire = 'gemini' | 'openai';

export type ProviderInfo = {
  id: ProviderId;
  /** What the person sees. */
  name: string;
  wire: Wire;
  /** Where to make a key. */
  keyPage: string;
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: { id: 'gemini', name: 'Gemini', wire: 'gemini', keyPage: 'https://aistudio.google.com/apikey' },
  openai: { id: 'openai', name: 'OpenAI', wire: 'openai', keyPage: 'https://platform.openai.com/api-keys' },
  deepseek: { id: 'deepseek', name: 'DeepSeek', wire: 'openai', keyPage: 'https://platform.deepseek.com/api_keys' },
  mistral: { id: 'mistral', name: 'Mistral', wire: 'openai', keyPage: 'https://console.mistral.ai/api-keys' },
  openrouter: { id: 'openrouter', name: 'OpenRouter', wire: 'openai', keyPage: 'https://openrouter.ai/settings/keys' },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

/** Which model does a job: what a setting stores. No key — that is a secret. */
export type ModelRef = { provider: ProviderId; model: string };

/** Everything one request needs: who, with what key, which model. */
export type Endpoint = { provider: ProviderId; apiKey: string; model: string };

/**
 * What a model can take in and do — as far as anybody has SAID. Undefined is
 * "not declared", which is different from false: the checks run on selection
 * answer what no listing does.
 */
export type Abilities = {
  images?: boolean;
  pdf?: boolean;
  audio?: boolean;
  tools?: boolean;
  json?: boolean;
};

/** A model a key can call, as the picker lists it. */
export type ModelInfo = {
  /** What the request names. */
  id: string;
  label: string;
  description: string;
  /** What the provider's own listing declares about it, when it declares anything. */
  abilities?: Abilities;
  /** A speech-to-text model: it writes words down and does nothing else. */
  transcription?: boolean;
};
