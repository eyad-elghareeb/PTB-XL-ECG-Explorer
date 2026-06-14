import { renderLeadCycleForBeat } from '../lib/ecg-math';
import { INTENSITY_STAGES, rhythmRates } from '../lib/ecg-rhythms';
import { resampleToMsPerSample, measureCycle, delineateCycle } from '../lib/ecg-measure';

const rhythmId = process.argv[2] || 'stemi_inf';
const lead = process.argv[3] || 'aVL';
const intensity = parseFloat(process.argv[4] || '0.5');

const config = INTENSITY_STAGES[rhythmId];
const bpm = config?.hrMod ? Math.max(20, Math.round(config.hrMod(intensity))) : (rhythmRates[rhythmId] || 72);
const rrMs = 60000 / bpm;
const cycle = renderLeadCycleForBeat(rhythmId, lead, intensity, bpm, 0);
const s = resampleToMsPerSample(cycle, 500, rrMs);
const mv = s.mv;
const del = delineateCycle(s);

const rIdx = Math.floor(mv.length * 0.30);
console.log(`rIdx=${rIdx} N=${mv.length} bpm=${bpm} rrMs=${rrMs.toFixed(0)} cycle.length=${cycle.length}`);
console.log(`del: pOnset=${del.pOnsetIdx} pOffset=${del.pOffsetIdx} qrsOnset=${del.qrsOnsetIdx} qrsOffset=${del.qrsOffsetIdx} tOnset=${del.tOnsetIdx} tOffset=${del.tOffsetIdx} qrsCenter=${del.qrsCenterIdx}`);

let trace = '';
let count = 0;
for (let i = Math.max(0, rIdx - 100); i < Math.min(mv.length, rIdx + 350); i += 10) {
  trace += `[t=${(i-rIdx).toString().padStart(4)}: ${mv[i].toFixed(2).padStart(6)}] `;
  count++;
  if (count % 5 === 0) trace += '\n';
}
console.log('\nTrace around R-peak (resampled ms):');
console.log(trace);

const m = measureCycle(cycle, 500, rrMs);
console.log('measureCycle:', JSON.stringify({
  pr: m.prIntervalMs, qrs: m.qrsDurationMs, qt: m.qtIntervalMs, qtc: Math.round(m.qtcMs),
  rAmp: m.rAmplitudeMv.toFixed(3), sAmp: m.sAmplitudeMv.toFixed(3), tAmp: m.tAmplitudeMv.toFixed(3),
  stJ60: m.stElevationJ60Mv.toFixed(3), baseline: m.tpBaselineMv.toFixed(3)
}, null, 2));
