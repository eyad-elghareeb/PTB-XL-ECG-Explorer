// probe-all-leads.ts — dump measurements for all 12 leads of a rhythm.
// Used to see what's actually rendered before writing specificity rules.
import { renderLeadCycleForBeat } from '../lib/ecg-math';
import { measureCycle } from '../lib/ecg-measure';
import { INTENSITY_STAGES, rhythmRates } from '../lib/ecg-rhythms';

const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
const SAMPLE_RATE = 500;

function probe(rhythmId: string, intensity: number) {
  const config = INTENSITY_STAGES[rhythmId];
  const bpm = config?.hrMod ? Math.max(20, Math.round(config.hrMod(intensity))) : (rhythmRates[rhythmId] || 72);
  const clampedBpm = Math.max(20, Math.min(240, bpm));
  const rrMs = 60000 / clampedBpm;
  console.log(`\n=== ${rhythmId} i=${intensity} bpm=${clampedBpm} rrMs=${rrMs.toFixed(0)} ===`);
  console.log('  lead  PR   QRS  QTc    R      S      T      ST_J60  ST_mean  stSample100');
  for (const lead of LEADS) {
    const cycle = renderLeadCycleForBeat(rhythmId, lead, intensity, clampedBpm, 0);
    const m = measureCycle(cycle, SAMPLE_RATE, rrMs);
    // sampleSt(100)
    const N = cycle.length;
    const rIdx = Math.floor(N * 0.30);
    const sampleIdx = Math.round(rIdx + (100 / rrMs) * N);
    const st100 = cycle[sampleIdx] - m.tpBaselineMv;
    console.log(
      `  ${lead.padEnd(5)} ${String(m.prIntervalMs).padStart(3)} ${String(m.qrsDurationMs).padStart(4)} ${String(Math.round(m.qtcMs)).padStart(5)}  ` +
      `${m.rAmplitudeMv.toFixed(2).padStart(5)}  ${m.sAmplitudeMv.toFixed(2).padStart(6)}  ${m.tAmplitudeMv.toFixed(2).padStart(6)}  ` +
      `${m.stElevationJ60Mv.toFixed(3).padStart(6)}  ${m.stMeanMv.toFixed(3).padStart(7)}  ${st100.toFixed(3).padStart(9)}`
    );
  }
}

const targets = process.argv.slice(2);
const rhythms = targets.length ? targets : ['longqt', 'avb1', 'nsr', 'lafb', 'lpfb', 'vtach', 'avb3', 'rah'];
const intensity = 0.5;
for (const r of rhythms) probe(r, intensity);
