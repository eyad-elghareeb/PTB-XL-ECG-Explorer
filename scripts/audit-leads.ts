// audit-leads.ts — Coverage matrix: for every (rhythm × 12 leads),
// report whether a non-trivial rule fires (PASS / FAIL / NEUTRAL).
// NEUTRAL means the lead falls through to "no specific criterion" —
// a real coverage gap for a trustable learning tool.
import { validateRhythmAllLeads } from '../lib/ecg-validate';

const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
const INTENSITIES = [0.3, 0.5, 0.75];

// All rhythms with rules (rhythmIds returned via the harness reflect RHYTHM_RULES keys).
const rhythmIds = [
  'lbbb', 'rbbb', 'lvh', 'rvh', 'wpw', 'longqt', 'brugada', 'hyperk',
  'hypokalemia', 'hypothermia', 'pwmi', 'pericarditis', 'digoxin',
  'wellens', 'dewinter', 'pe', 'lafb', 'lpfb', 'lah', 'rah', 'avb1',
  'nsr', 'earlyrepo', 'avb3', 'vtach', 'pvc', 'bve',
  'stemi_ant', 'stemi_inf', 'stemi_lat', 'stemi_antlat', 'stemi_inflat', 'stemi_rv',
];

let totalGaps = 0;
const gapReport: string[] = [];

for (const rhythmId of rhythmIds) {
  const gapsThis: string[] = [];
  for (const lead of LEADS) {
    // A lead is a "gap" only if it is NEUTRAL at ALL three intensities
    // (i.e., no criterion ever fires for it).
    let anyChecked = false;
    let allPass = true;
    for (const intensity of INTENSITIES) {
      const summary = validateRhythmAllLeads(rhythmId, intensity);
      const r = summary.results.find(x => x.lead === lead);
      if (!r) continue;
      if (r.tag !== '—') anyChecked = true;
      if (!r.passed) allPass = false;
    }
    if (!anyChecked) {
      gapsThis.push(lead);
      totalGaps++;
    }
  }
  if (gapsThis.length) {
    gapReport.push(`  ${rhythmId.padEnd(13)} gaps: ${gapsThis.join(', ')}`);
  }
}

console.log('═'.repeat(70));
console.log('  12-lead coverage audit — NEUTRAL lead cells (no rule ever fires)');
console.log('═'.repeat(70));
if (gapReport.length === 0) {
  console.log('  No gaps — every rhythm has a rule for every lead.');
} else {
  console.log(`  ${gapReport.length} rhythms with gaps, ${totalGaps} total (rhythm,lead) gaps:`);
  for (const line of gapReport) console.log(line);
}
console.log('═'.repeat(70));
