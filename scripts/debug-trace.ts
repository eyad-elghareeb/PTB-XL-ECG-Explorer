import { renderLeadCycleForBeat } from '../lib/ecg-math';
import { INTENSITY_STAGES, rhythmRates } from '../lib/ecg-rhythms';

const rhythmId = process.argv[2] || 'brugada';
const lead = process.argv[3] || 'V1';
const intensity = parseFloat(process.argv[4] || '0.75');

const config = INTENSITY_STAGES[rhythmId];
const bpm = config?.hrMod ? Math.max(20, Math.round(config.hrMod(intensity))) : (rhythmRates[rhythmId] || 72);
const rrMs = 60000 / bpm;
const cycle = renderLeadCycleForBeat(rhythmId, lead, intensity, bpm, 0);

const N = cycle.length;
const rIdx = Math.floor(N * 0.30);
console.log(`N=${N} rIdx=${rIdx} bpm=${bpm} rrMs=${rrMs.toFixed(0)}`);

// Print samples every 10ms from R-peak
let trace = '';
let count = 0;
for (let i = rIdx - 50; i < Math.min(N, rIdx + 350); i += 5) {
  if (i < 0) continue;
  const tMs = (i - rIdx) * (rrMs / N);
  trace += `[t=${tMs.toFixed(0).padStart(4)}: ${cycle[i].toFixed(2).padStart(6)}] `;
  count++;
  if (count % 5 === 0) trace += '\n';
}
console.log('\nTrace around R-peak (raw cycle, ms):');
console.log(trace);

// Show ST samples at fixed offsets
for (const off of [0, 20, 40, 60, 80, 100]) {
  const sampleIdx = Math.round(rIdx + (off / rrMs) * N);
  console.log(`ST@+${off}ms (idx ${sampleIdx}): ${cycle[sampleIdx].toFixed(3)} mV`);
}
