import { can, type CheckName, type StoredAbilities } from './checks';
import { parseModelRef } from './model-ref';
import { PROVIDERS, type ProviderId } from './providers';

/**
 * Why one AI feature cannot run right now, or null when it can.
 *
 * In order of what the person has to do first: AI switched off overrides
 * everything; then the feature's own switch; then a model nobody chose; then a
 * model whose provider has no key; then a model the checks found cannot do
 * what this feature needs. Each is a different sentence because each is fixed
 * in a different place.
 */
export type JobBlock =
  | { kind: 'ai-off' }
  | { kind: 'off' }
  | { kind: 'no-model' }
  | { kind: 'no-key'; provider: ProviderId }
  | { kind: 'cannot'; model: string; need: CheckName };

export type Keys = Partial<Record<ProviderId, boolean>>;
export type AbilityBook = Record<string, StoredAbilities>;

/** One model a job uses, and what it must be able to do. */
export type Requirement = { stored: string; needs: readonly CheckName[] };

export function jobBlock(
  requirements: readonly Requirement[],
  keys: Keys,
  abilities: AbilityBook,
  { aiEnabled, featureOn }: { aiEnabled: boolean; featureOn: boolean }
): JobBlock | null {
  if (!aiEnabled) return { kind: 'ai-off' };
  if (!featureOn) return { kind: 'off' };
  for (const { stored, needs } of requirements) {
    const ref = parseModelRef(stored);
    if (ref === null) return { kind: 'no-model' };
    if (!keys[ref.provider]) return { kind: 'no-key', provider: ref.provider };
    for (const need of needs) {
      // Only a NO blocks. Unknown lets it run: a request the model cannot
      // serve fails in words of its own, and a check that could not be asked
      // must never read as the model lacking something.
      if (can(abilities[stored], need) === false) return { kind: 'cannot', model: ref.model, need };
    }
  }
  return null;
}

/**
 * Voice's requirements depend on what listens. A model that hears does the
 * whole job; a transcription model only writes the words down, and a second
 * model reads them into a record.
 */
export function voiceRequirements(listen: string, read: string, abilities: AbilityBook): Requirement[] {
  if (abilities[listen]?.transcription) return [{ stored: listen, needs: [] }, { stored: read, needs: ['json'] }];
  return [{ stored: listen, needs: ['json', 'audio'] }];
}

const CANNOT: Record<CheckName, string> = {
  json: 'cannot give structured replies',
  tools: 'cannot use tools',
  images: 'cannot see images',
  audio: 'cannot hear audio',
};

/** The block, as the summary line under a feature's row in Settings. */
export function describeBlock(block: JobBlock): string {
  switch (block.kind) {
    case 'ai-off':
      return 'AI is off';
    case 'off':
      return 'Off';
    case 'no-model':
      return 'Choose a model';
    case 'no-key':
      return `No ${PROVIDERS[block.provider].name} key`;
    case 'cannot':
      return `${block.model} ${CANNOT[block.need]}`;
  }
}
