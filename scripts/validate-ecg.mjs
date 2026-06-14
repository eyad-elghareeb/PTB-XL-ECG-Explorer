// ════════════════════════════════════════════════════════════════
// validate-ecg.mjs — Standalone 12-lead morphology validator launcher
//
// Runs the TypeScript validator via tsx (resolved through npx so we
// don't depend on a locally-installed binary). tsx resolves the
// extensionless imports in lib/ the same way the Next.js bundler does.
//
// Usage:  npm run validate
// Exit:   0 = all rhythms pass; 1 = at least one rhythm failed
// ════════════════════════════════════════════════════════════════

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const runner = path.join(__dirname, 'validate-ecg-runner.ts');

const result = spawnSync('npx', ['--yes', 'tsx', runner], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
