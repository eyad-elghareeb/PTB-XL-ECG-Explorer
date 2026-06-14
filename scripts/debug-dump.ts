// debug-dump.ts — render one cycle for a (rhythm, lead) and print stats.
import { renderLeadCycleForBeat } from '../lib/ecg-math';
import { measureCycle } from '../lib/ecg-measure';
import { INTENSITY_STAGES, rhythmRates } from '../lib/ecg-rhythms';

const rhythmId = process.argv[2] || 'lbbb';
const lead = process.argv[3] || 'V5';
const intensity = parseFloat(process.argv[4] || '0.5');

const config = INTENSITY_STAGES[rhythmId];
const bpm = config?.hrMod ? Math.max(20, Math.round(config.hrMod(intensity))) : (rhythmRates[rhythmId] || 72);
const rrMs = 60000 / bpm;
const cycle = renderLeadCycleForBeat(rhythmId, lead, intensity, bpm, 0);
const m = measureCycle(cycle, 500, rrMs);

console.log(`Rhythm: ${rhythmId}  Lead: ${lead}  intensity: ${intensity}  bpm: ${bpm}  rrMs: ${rrMs.toFixed(0)}`);
console.log(`Cycle length: ${cycle.length} samples`);
let minV = Infinity, maxV = -Infinity;
const peaks: number[] = [];
for (let i = 0; i < cycle.length; i++) {
  if (cycle[i] < minV) minV = cycle[i];
  if (cycle[i] > maxV) maxV = cycle[i];
}
console.log(`Raw cycle min=${minV.toFixed(3)} max=${maxV.toFixed(3)} range=${(maxV-minV).toFixed(3)}`);

// Print 80 samples across the cycle
const step = Math.max(1, Math.floor(cycle.length / 80));
let trace = '';
for (let i = 0; i < cycle.length; i += step) {
  const tMs = (i - Math.floor(cycle.length * 0.18)) * (rrMs / cycle.length);
  trace += `[${tMs.toFixed(0).padStart(5)}:${cycle[i].toFixed(2).padStart(6)}] `;
  if (((i / step) + 1) % 4 === 0) trace += '\n';
}
console.log('Trace (ms: mV):');
console.log(trace);

// Also dump the actual segments used
import { getTemplate } from '../lib/ecg-math';
import { applyOverrides, baselineSegments } from '../lib/ecg-model';
const overrides = getTemplate(rhythmId)(intensity);
const baseSegs = baselineSegments(lead);
const finalSegs = applyOverrides(lead, overrides);
console.log(`\nBaseline segments for ${lead}: ${baseSegs.length}`);
baseSegs.forEach(s => console.log(`  ${s.shape} center=${s.centerMs.toFixed(0)} L=${s.leftWidthMs.toFixed(0)} R=${s.rightWidthMs.toFixed(0)} amp=${s.amplitudeMv.toFixed(3)}`));
console.log(`Final segments for ${lead}: ${finalSegs.length}`);
finalSegs.forEach(s => console.log(`  ${s.shape} center=${s.centerMs.toFixed(0)} L=${s.leftWidthMs.toFixed(0)} R=${s.rightWidthMs.toFixed(0)} amp=${s.amplitudeMv.toFixed(3)}`));

console.log('Measurement:');
console.log(JSON.stringify({
  prIntervalMs: m.prIntervalMs,
  qrsDurationMs: m.qrsDurationMs,
  qtIntervalMs: m.qtIntervalMs,
  qtcMs: Math.round(m.qtcMs),
  rAmplitudeMv: m.rAmplitudeMv,
  sAmplitudeMv: m.sAmplitudeMv,
  tAmplitudeMv: m.tAmplitudeMv,
  tPolarity: m.tPolarity,
  stElevationJ60Mv: m.stElevationJ60Mv,
  stMeanMv: m.stMeanMv,
  tpBaselineMv: m.tpBaselineMv,
  del: m.del,
  rPeakIdx: m.rPeakIdx,
}, null, 2));
