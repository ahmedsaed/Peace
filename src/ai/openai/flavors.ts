import type { ProviderId } from '../providers';

/**
 * How each provider that speaks OpenAI's Chat Completions format differs from
 * the others. Same wire, different dialects: who takes a strict JSON schema,
 * how a PDF or a clip is written into a message, which endpoint proves a key,
 * and what extras a request must carry. Everything else is shared.
 */
export type Flavor = {
  provider: ProviderId;
  name: string;
  baseUrl: string;
  /**
   * `schema`: `response_format: json_schema`, strict — the reply is the fields.
   * `object`: only `json_object` — the schema goes into the prompt, and the
   * reply is checked like any other (DeepSeek refuses `json_schema` outright).
   */
  json: 'schema' | 'object';
  /** How a PDF is written into a message, or null where none can be. */
  pdf: 'file' | 'document_url' | null;
  /** How a clip is written into a message: `{data, format}`, or the bare base64. */
  audio: 'object' | 'string';
  /** Where a key is proven: a cheap authenticated GET. */
  keyCheckPath: string;
  /**
   * Whether `/models` needs the key at all. OpenRouter's is public — listing
   * succeeds with any key, so it proves nothing and `keyCheckPath` is separate.
   */
  modelsNeedKey: boolean;
  /** Merged into every request body. */
  extraBody?: Record<string, unknown>;
  /** The field a streamed or whole message carries its reasoning in. */
  reasoningField: 'reasoning_content' | 'reasoning' | null;
  /** Where to make a key, as the error sentences name it. */
  console: string;
};

export const FLAVORS: Partial<Record<ProviderId, Flavor>> = {
  openai: {
    provider: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    json: 'schema',
    pdf: 'file',
    audio: 'object',
    keyCheckPath: '/models',
    modelsNeedKey: true,
    reasoningField: null,
    console: 'platform.openai.com',
  },
  deepseek: {
    provider: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    json: 'object',
    pdf: null,
    audio: 'object',
    keyCheckPath: '/models',
    modelsNeedKey: true,
    // Thinking is on by default, and once tools are involved DeepSeek's docs
    // ask for the reasoning back on later requests. Replayed when we have it.
    reasoningField: 'reasoning_content',
    console: 'platform.deepseek.com',
  },
  mistral: {
    provider: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    json: 'schema',
    pdf: 'document_url',
    audio: 'string',
    keyCheckPath: '/models',
    modelsNeedKey: true,
    reasoningField: null,
    console: 'console.mistral.ai',
  },
  openrouter: {
    provider: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    json: 'schema',
    pdf: 'file',
    audio: 'object',
    keyCheckPath: '/key',
    modelsNeedKey: false,
    /**
     * ROUTE ONLY TO HOSTS THAT HONOUR EVERY PARAMETER. Without it OpenRouter
     * may send a request carrying `tools` or `response_format` to a host that
     * silently ignores them, and a model that passed its checks fails later on
     * whichever host it happened to land on.
     */
    extraBody: { provider: { require_parameters: true } },
    reasoningField: 'reasoning',
    console: 'openrouter.ai',
  },
};
