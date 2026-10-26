/**
 * Which model does which job, as settings store it.
 *
 * One string per job, `provider:model` — "gemini:gemini-flash-latest",
 * "openrouter:qwen/qwen3-vl:free". Split on the FIRST colon: a provider id
 * never has one and an OpenRouter model id often does. Empty means nobody has
 * chosen, which is a state of its own ("Choose a model"), never a default —
 * a model somebody did not pick could be expensive, or bad at the job.
 */

import { isProviderId, type ModelRef } from './providers';

/** The jobs a model is chosen for, each its own setting. */
export const MODEL_SETTINGS = [
  'receiptsModel',
  'bankModel',
  'voiceModel',
  'voiceReadModel',
  'pennyModel',
  'pennyFilesModel',
] as const;

export type ModelSetting = (typeof MODEL_SETTINGS)[number];

export function parseModelRef(stored: string): ModelRef | null {
  const at = stored.indexOf(':');
  if (at <= 0) return null;
  const provider = stored.slice(0, at);
  const model = stored.slice(at + 1).trim();
  if (!isProviderId(provider) || model === '') return null;
  return { provider, model };
}

export function formatModelRef(ref: ModelRef | null): string {
  return ref ? `${ref.provider}:${ref.model}` : '';
}

export function sameModel(a: ModelRef | null, b: ModelRef | null): boolean {
  return a !== null && b !== null && a.provider === b.provider && a.model === b.model;
}

/**
 * What an install from before providers was using, job by job.
 *
 * Before this, everything ran on Gemini: `geminiModel` read receipts, bank
 * messages and voice, `assistantModel` was Penny. Somebody upgrading must find
 * every feature exactly where they left it, so a job with NO ROW is filled
 * from those (`state/settings.ts`). A fresh install writes every job empty
 * first (`db/provider.tsx`) and so never gets here. Gemini hears, so voice
 * needs no second model; Gemini sees, so Penny's files go to Penny's model.
 */
export function legacyModelChoices(geminiModel: string, assistantModel: string): Record<ModelSetting, string> {
  const reading = formatModelRef({ provider: 'gemini', model: geminiModel || 'gemini-flash-latest' });
  const penny = formatModelRef({ provider: 'gemini', model: assistantModel || 'gemini-flash-latest' });
  return {
    receiptsModel: reading,
    bankModel: reading,
    voiceModel: reading,
    voiceReadModel: '',
    pennyModel: penny,
    pennyFilesModel: penny,
  };
}
