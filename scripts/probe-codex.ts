// Usage: npx tsx scripts/probe-codex.ts — what the real Codex CLI on this machine can run (the picker's default and flags)
import { getProviderStatuses } from '../apps/server/src/providers';
const t0 = Date.now(); const c = (await getProviderStatuses()).find((p) => p.id === 'codex')!;
console.log(`ready=${c.ready} default=${c.defaultModel} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
for (const m of c.models) console.log(' ', m.id.padEnd(16), m.hint ?? '');
