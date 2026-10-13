// Check store/listing.md against Play Console's length limits.
//
//   node scripts/check-listing.mjs
//
// Play counts characters, not bytes, and rejects the whole save over one field
// that runs long — by which point the text has been pasted into three boxes.
import { readFileSync } from 'node:fs';

const LIMITS = { 'App name': 30, 'Short description': 80, 'Full description': 4000 };
const text = readFileSync(new URL('../store/listing.md', import.meta.url), 'utf8');

let failed = false;
for (const [field, limit] of Object.entries(LIMITS)) {
  const block = text.match(new RegExp(`## ${field} \\(${limit}\\)\\n\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``));
  if (!block) {
    console.error(`missing: ${field}`);
    failed = true;
    continue;
  }
  const length = [...block[1]].length;
  const ok = length <= limit;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'LONG'} ${field}: ${length}/${limit}`);
}
process.exit(failed ? 1 : 0);
