import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/supportNoteDocx.ts', import.meta.url), 'utf8');
const marker = 'NMRNL_BUILD_SOURCE_V2_2026-09-01';

console.log(`[nmrnl] ${marker}`);

const staleExpression = 'supportNoteBreakdown?.referrals';
if (source.includes(staleExpression)) {
  console.error(`[nmrnl] stale supportNoteDocx.ts detected: ${staleExpression}`);
  process.exit(1);
}

if (!source.includes('parseStructuredSupportNote')) {
  console.error('[nmrnl] expected support-note parser is missing from current source');
  process.exit(1);
}

console.log('[nmrnl] supportNoteDocx.ts is the corrected source');
