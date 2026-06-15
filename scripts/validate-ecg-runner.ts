// validate-ecg-runner.ts — actual validation logic run via tsx.
// Imports the TS lib directly and prints a human-readable report.

import { runFullValidationHarness } from '../lib/ecg-validate';
import { RHYTHMS } from '../lib/ecg-rhythms';

// Rhythms to skip validation entirely (no measurable morphology).
const SKIP = new Set<string>([
  'vfib',    // pure chaos — no segments
  'asystole',// flatline
  'pea',     // organized but near-flat; not morphologically diagnosable
  'afib',    // irregularly irregular; P suppressed; beat-to-beat varies
  'aflutter',// sawtooth + QRS; rules not defined
  'avb2mob1',// Wenckebach cycle; per-beat variation
  'svt',     // narrow complex tachy; rate is the feature, not morphology
  'st',      // rate-driven; morphology ≈ NSR
  'sb',      // rate-driven; morphology ≈ NSR
]);

// Intensities to test (covers early/mid/late stage expression).
const INTENSITIES = [0.3, 0.5, 0.75];

const harness = runFullValidationHarness(INTENSITIES);

let totalFailures = 0;
let totalChecks = 0;
let totalPasses = 0;

console.log('');
console.log('═'.repeat(72));
console.log('  PTB-XL ECG Explorer — Medical Accuracy Validator');
console.log('═'.repeat(72));
console.log(`  Rhythms with rules: ${harness.length}`);
console.log(`  Intensities tested: ${INTENSITIES.join(', ')}`);
console.log('═'.repeat(72));
console.log('');

for (const result of harness) {
  if (SKIP.has(result.rhythmId)) {
    console.log(`  ⊘  ${result.rhythmId.padEnd(14)} — skipped (no measurable morphology rules)`);
    continue;
  }
  const rhythmName = RHYTHMS.find((r) => r.id === result.rhythmId)?.name ?? result.rhythmId;
  if (result.overallPassed) {
    const allChecked = result.intensities.reduce((s, r) => s + (r.failedLeads.length === 0 ? 1 : 0), 0);
    console.log(`  ✓  ${result.rhythmId.padEnd(14)} ${rhythmName.padEnd(36)} PASS (${allChecked}/${result.intensities.length} intensities)`);
    totalPasses += 1;
  } else {
    console.log(`  ✗  ${result.rhythmId.padEnd(14)} ${rhythmName.padEnd(36)} FAIL`);
    for (const ri of result.intensities) {
      if (ri.allPassed) continue;
      totalFailures += ri.failedLeads.length;
      for (const d of ri.details) {
        console.log(`        @ ${ri.intensity.toFixed(2)}  ${d}`);
      }
    }
  }
  totalChecks += 1;
}

console.log('');
console.log('─'.repeat(72));
if (totalFailures === 0) {
  console.log(`  ✓  ALL ${totalPasses} rhythm${totalPasses === 1 ? '' : 's'} PASS medical-accuracy criteria`);
  console.log('');
  process.exit(0);
} else {
  console.log(`  ✗  ${totalFailures} criterion failure${totalFailures === 1 ? '' : 's'} across ${totalChecks} rhythm${totalChecks === 1 ? '' : 's'}`);
  console.log('');
  process.exit(1);
}
