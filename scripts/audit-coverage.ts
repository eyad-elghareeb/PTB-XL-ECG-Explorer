// audit-coverage.ts — for each pathology template, list which leads
// have explicit overrides vs. which fall through to baseline-only.
import { getTemplate } from '../lib/ecg-pathologies';
import { applyOverrides, baselineSegments, INDEPENDENT_LEADS, DEPENDENT_LEADS_LIST, ALL_LEADS } from '../lib/ecg-model';

const INTENSITIES = [0.3, 0.5, 0.75];

const templateIds = Object.keys(getTemplate as any).length
  ? (Object.keys((globalThis as any).PATHOLOGY_TEMPLATES || {}))
  : [];

console.log('═'.repeat(80));
console.log('  Per-lead override coverage audit');
console.log('═'.repeat(80));

// Pull template ids by importing the registry directly.
import { PATHOLOGY_TEMPLATES } from '../lib/ecg-pathologies';

for (const id of Object.keys(PATHOLOGY_TEMPLATES)) {
  const i = 0.5;
  const ov = getTemplate(id)(i);
  const overriddenLeads = ALL_LEADS.filter(l => {
    const base = baselineSegments(l).length; // 0 for dependent leads
    const final = applyOverrides(l, ov).length;
    return final > base && (base > 0 || ov[l] !== undefined);
  });
  const explicitLeads = ALL_LEADS.filter(l => ov[l] !== undefined);
  const allLeads = ALL_LEADS;
  const missing = allLeads.filter(l => !explicitLeads.includes(l));
  console.log(`\n  ${id}`);
  console.log(`    explicit: ${explicitLeads.length ? explicitLeads.join(', ') : '(none — diffuse)'}`);
  if (missing.length) {
    console.log(`    missing:  ${missing.join(', ')}`);
  }
}
