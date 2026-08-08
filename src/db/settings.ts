import { eq } from 'drizzle-orm';

import {
  decodeSetting,
  encodeSetting,
  type SettingKey,
  type Settings,
} from '../lib/settings';
import { db } from './client';
import { settings } from './schema';

export { SETTING_DEFAULTS, type SettingKey, type Settings } from '../lib/settings';

/**
 * Typed read/write over the key/value `settings` table. A missing row is never
 * a special case at the call site — it resolves to the declared default.
 */
export function getSetting<K extends SettingKey>(key: K): Settings[K] {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return decodeSetting(key, row?.value);
}

export function setSetting<K extends SettingKey>(key: K, value: Settings[K]): void {
  const encoded = encodeSetting(key, value);
  const updatedAt = new Date();
  db.insert(settings)
    .values({ key, value: encoded, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value: encoded, updatedAt } })
    .run();
}
