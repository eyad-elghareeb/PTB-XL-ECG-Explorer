// ecg-math.ts — Beat sequencer + rendering fast-path
//
// Public API (preserved exactly for app/page.tsx):
//   - getWaveformForBeatIndex(...): number
//   - buildAllLeadLUTs(...): void
//   - sampleLeadLUT(...): number
//   - addTraceNoise(val, phase, timeSeed, noiseLevelPct, realistic, bpm): number
//   - clearCycleCache(): void
//   - renderLeadCycle(rhythm, lead, intensity, bpm): Float32Array
//   - renderLeadCycleForBeat(rhythm, lead, intensity, bpm, beatIndex): Float32Array
//
// Internally uses:
//   - lib/ecg-model.ts       (piecewise sinusoidal waveform synthesis)
//   - lib/ecg-rhythms.ts     (rhythm definitions, LEAD_TARGET_AMPLITUDE)
//   - lib/ecg-model.ts       (nsrWaveformAtMs, generateLeadCycle, nsrWaveformAtMsLeadAware)

import {
  WaveParams,
  INDEPENDENT_LEADS,
  DEPENDENT_LEAD_FORMULAS,
  generateLeadCycle,
  nsrWaveformAtMs,
  nsrWaveformAtMsLeadAware,
} from './ecg-model';
import { LEADS, BEAT_AWARE_RHYTHMS, LEAD_TARGET_AMPLITUDE } from './ecg-rhythms';
import { INTENSITY_STAGES } from './ecg-rhythms';

// ─── Cycle cache ────────────────────────────────────────────────

const cycleCache = new Map<string, Float32Array>();
const CYCLE_SAMPLE_RATE = 500;

function getParams(rhythm: string, intensity: number): WaveParams {
  const config = INTENSITY_STAGES[rhythm] || INTENSITY_STAGES._default;
  return config.params(Math.max(0, Math.min(1, intensity)));
}

function getCycle(rhythm: string, lead: string, intensity: number, bpm: number): Float32Array {
  const key = `${rhythm}|${lead}|${intensity.toFixed(4)}|${bpm}`;
  const cached = cycleCache.get(key);
  if (cached) return cached;

  const rrMs = 60000 / Math.max(1, bpm);
  const params = getParams(rhythm, intensity);

  // For lead-aware rhythms, use the lead-aware waveform generator
  if (isLeadAwareRhythm(rhythm)) {
    const N = Math.max(64, Math.round((rrMs / 1000) * CYCLE_SAMPLE_RATE));
    const out = new Float32Array(N);
    const msPerSample = rrMs / N;
    for (let i = 0; i < N; i++) {
      const tMs = i * msPerSample;
      out[i] = nsrWaveformAtMsLeadAware(tMs, rrMs, params, lead, rhythm);
    }
    if (cycleCache.size > 4096) cycleCache.clear();
    cycleCache.set(key, out);
    return out;
  }

  const cycle = generateLeadCycle(lead, rrMs, params, CYCLE_SAMPLE_RATE);
  if (cycleCache.size > 4096) cycleCache.clear();
  cycleCache.set(key, cycle);
  return cycle;
}

export function clearCycleCache(): void {
  cycleCache.clear();
}

// ─── Sample at fractional phase ─────────────────────────────────

function sampleCycle(cycle: Float32Array, phase: number): number {
  const N = cycle.length;
  const idxFloat = ((phase % 1) + 1) % 1 * N;
  const i0 = Math.floor(idxFloat) % N;
  const i1 = (i0 + 1) % N;
  const frac = idxFloat - Math.floor(idxFloat);
  return cycle[i0] * (1 - frac) + cycle[i1] * frac;
}

function sampleIndependent(rhythm: string, lead: string, intensity: number, bpm: number, phase: number): number {
  const cycle = getCycle(rhythm, lead, intensity, bpm);
  return sampleCycle(cycle, phase);
}

function sampleDependent(
  rhythm: string, depLead: string, intensity: number, bpm: number, phase: number, beatIndex: number
): number {
  const fn = DEPENDENT_LEAD_FORMULAS[depLead];
  if (!fn) return 0;
  const vI  = sampleBeatSequenced(rhythm, 'I',  intensity, bpm, phase, beatIndex);
  const vII = sampleBeatSequenced(rhythm, 'II', intensity, bpm, phase, beatIndex);
  return fn(vI, vII);
}

// ─── Beat sequencer ─────────────────────────────────────────────

function sampleBeatSequenced(
  rhythm: string, lead: string, intensity: number, bpm: number, phase: number, beatIndex: number
): number {
  if (rhythm === 'vfib')     return vfibValue(intensity, phase, beatIndex, lead);
  if (rhythm === 'asystole') return asystoleValue(intensity, phase, beatIndex, lead);
  if (rhythm === 'pea')      return peaValue(intensity, phase, beatIndex, lead);

  if (rhythm === 'afib') {
    const qrs = sampleIndependent('afib', lead, intensity, bpm, phase);
    const fib = afibBaseline(intensity, phase, beatIndex, lead);
    return qrs + fib;
  }

  if (rhythm === 'aflutter') {
    const qrs = sampleIndependent('aflutter', lead, intensity, bpm, phase);
    const saw = flutterSawtooth(intensity, phase, bpm);
    const leadAmp = LEAD_TARGET_AMPLITUDE[lead] || 1.6;
    return qrs + saw * (leadAmp / 1.6);
  }

  if (rhythm === 'avb2mob1') {
    const cycleLen = intensity > 0.55 ? 3 : intensity > 0.25 ? 4 : 5;
    const idxInCycle = beatIndex % cycleLen;
    const isDropped = idxInCycle === cycleLen - 1;
    if (isDropped) {
      return pOnlyValue(lead, bpm, phase, intensity, beatIndex, idxInCycle);
    }
    const prExtra = (60 + 40 * intensity) * idxInCycle;
    const shiftedPhase = shiftPhaseForPR(phase, prExtra, bpm);
    return sampleIndependent('avb1', lead, intensity, bpm, shiftedPhase);
  }

  if (rhythm === 'avb2mob2') {
    const cycleLen = intensity > 0.55 ? 2 : intensity > 0.25 ? 3 : 4;
    const isDropped = beatIndex % cycleLen === cycleLen - 1;
    if (isDropped) return pOnlyValue(lead, bpm, phase, intensity, beatIndex, 0);
    return sampleIndependent('avb2mob2', lead, intensity, bpm, phase);
  }

  if (rhythm === 'avb3') {
    const ventRate = Math.max(18, bpm);
    const atrialRate = 70 + 20 * intensity;
    const tAbs = (beatIndex + phase) * (60000 / ventRate);
    const phaseAtrial = ((tAbs / 60000) * atrialRate) % 1;
    const pVal = sampleIndependent('avb3', lead, intensity, atrialRate, phaseAtrial);
    const pOnly = phaseAtrial < 0.18 ? pVal : 0;
    const vVal = sampleIndependent('avb3', lead, intensity, ventRate, phase);
    const qrst = phase < 0.18 ? 0 : vVal;
    return pOnly + qrst;
  }

  if (rhythm === 'pvc') {
    if (beatIndex % 3 === 2) {
      return pvcWaveform(phase, intensity, lead, bpm);
    }
    return sampleIndependent('nsr', lead, 0, bpm, phase);
  }

  if (rhythm === 'vtach') {
    return vtachWaveform(phase, intensity, lead, bpm);
  }

  return sampleIndependent(rhythm, lead, intensity, bpm, phase);
}

// ─── Rhythm-specific waveform helpers ───────────────────────────

function isLeadAwareRhythm(rhythm: string): boolean {
  if (!rhythm) return false;
  return LEADAWARE_RHYTHMS.has(rhythm);
}

const LEADAWARE_RHYTHMS = new Set([
  'lbbb', 'rbbb', 'brugada',
  'stemi_ant', 'stemi_inf', 'stemi_lat', 'stemi_antlat', 'stemi_inflat', 'stemi_rv',
  'pwmi', 'pericarditis', 'wellens', 'dewinter',
]);

function afibBaseline(intensity: number, phase: number, beatIndex: number, lead: string): number {
  const baseNoise = 0.04 + 0.14 * intensity;
  const t = (beatIndex + phase) * (60 / 95);
  const fib = baseNoise * (
    Math.sin(t * 137.5) +
    0.7 * Math.sin(t * 89.3) +
    0.5 * Math.sin(t * 197.1 + 0.4) +
    0.3 * Math.sin(t * 251.7 + 1.2)
  );
  const leadAmp = LEAD_TARGET_AMPLITUDE[lead] || 1.6;
  return fib * (leadAmp / 1.6);
}

function flutterSawtooth(intensity: number, phase: number, bpm: number): number {
  const flAmp = 0.10 + 0.15 * intensity;
  const flutterRate = 300 + 30 * intensity;
  const t = phase * (60 / bpm);
  const flutterPhase = (t * flutterRate / 60) % 1;
  const saw = 2 * flutterPhase - 1;
  return -flAmp * (saw + 0.25 * Math.sin(2 * Math.PI * flutterPhase));
}

function pOnlyValue(lead: string, bpm: number, phase: number, _intensity: number, _beatIndex: number, _cycleIdx: number): number {
  if (phase > 0.30) return 0;
  const cycle = getCycle('nsr', lead, 0, bpm);
  const pFraction = Math.min(0.20, phase / 0.25 * 0.20);
  return sampleCycle(cycle, pFraction);
}

function shiftPhaseForPR(phase: number, extraPrMs: number, bpm: number): number {
  const cycleMs = 60000 / Math.max(1, bpm);
  const shift = extraPrMs / cycleMs;
  return ((phase - shift) % 1 + 1) % 1;
}

function vfibValue(intensity: number, phase: number, beatIndex: number, _lead: string): number {
  const t = (beatIndex + phase) * (60 / 72);
  const amp = 0.5 - 0.35 * intensity;
  const f1 = 45 + 30 * intensity;
  const f2 = 73 + 25 * intensity;
  const f3 = 127 - 20 * intensity;
  return amp * (
    Math.sin(t * f1) +
    0.8 * Math.sin(t * f2) +
    0.6 * Math.sin(t * f3) +
    0.4 * Math.sin(t * 199.9 + 1.1)
  );
}

function asystoleValue(intensity: number, phase: number, beatIndex: number, _lead: string): number {
  const t = (beatIndex + phase) * (60 / 60);
  return intensity * (0.005 * Math.sin(t * 23.0) + 0.003 * Math.sin(t * 67.0));
}

function peaValue(intensity: number, phase: number, beatIndex: number, _lead: string): number {
  const base = sampleIndependent('pea', 'II', intensity, 35, phase);
  const t = (beatIndex + phase) * (60 / 35);
  return base * (1 - 0.3 * intensity) + 0.02 * Math.sin(t * 11);
}

// ─── PVC waveform (piecewise sinusoidal) ────────────────────────

function pvcWaveform(phase: number, intensity: number, lead: string, bpm: number): number {
  const rrMs = 60000 / Math.max(1, bpm);
  const tMs = phase * rrMs;
  const pMs = 80;
  const amp = 0.8 + 0.6 * intensity;
  const qrsW = 0.12 + 0.08 * intensity;

  const msPerQRS = qrsW * rrMs;
  let val = 0;

  // No P wave before PVC

  // Wide bizarre QRS
  const qrsEnd = pMs + msPerQRS;
  if (tMs >= pMs && tMs < pMs + msPerQRS * 0.55) {
    const prog = (tMs - pMs) / (msPerQRS * 0.55);
    val += amp * Math.sin(Math.PI * prog);
  }
  if (tMs >= pMs + msPerQRS * 0.55 && tMs < qrsEnd) {
    const prog = (tMs - pMs - msPerQRS * 0.55) / (msPerQRS * 0.45);
    const sDepth = 0.6 + 0.4 * intensity;
    val += -sDepth * Math.sin(Math.PI * prog) * (1 + 0.15 * Math.sin(Math.PI * prog * 3));
  }

  // Discordant ST-T
  const stEnd = qrsEnd + 0.08 * rrMs;
  if (tMs >= qrsEnd && tMs < stEnd) {
    val += -(0.08 + 0.12 * intensity);
  }

  const tEnd = stEnd + (0.20 + 0.06 * intensity) * rrMs;
  if (tMs >= stEnd && tMs < tEnd) {
    const tDiscordant = -(0.25 + 0.25 * intensity);
    val += tDiscordant * Math.sin(Math.PI * (tMs - stEnd) / (tEnd - stEnd));
  }

  return val;
}

// ─── VTach waveform ─────────────────────────────────────────────

function vtachWaveform(phase: number, intensity: number, _lead: string, _bpm: number): number {
  const widening = 0.08 + 0.12 * intensity;
  const polymorph = 0.15 * intensity * Math.sin(phase * 0.8);
  const amp = 0.5 + 0.7 * intensity;
  if (phase < 0.5) {
    return amp * (Math.sin(Math.PI * phase / 0.5) + 0.25 * Math.sin(Math.PI * phase / 0.25) + polymorph * 0.3);
  }
  return -amp * (Math.sin(Math.PI * (phase - 0.5) / 0.5) * 0.6 + polymorph * 0.2);
}

// ─── Manual mode waveform ───────────────────────────────────────

export function ecgManualWaveform(phase: number, bpm: number, p: any): number {
  const rrMs = 60000 / Math.max(1, bpm);
  const tMs = phase * rrMs;
  const params: WaveParams = {
    pAmp: p?.pAmp ?? 0.12,
    pDur: p?.pDur ?? 0.10,
    prInt: p?.prInt ?? 0.19,
    qrsAmp: p?.qrsAmp ?? 1.0,
    qrsDur: p?.qrsDur ?? 0.06,
    stElev: p?.stElev ?? 0,
    stDur: p?.stDur ?? 0.12,
    stSlope: p?.stSlope ?? 0,
    tAmp: p?.tAmp ?? 0.22,
    tDur: p?.tDur ?? 0.19,
    tShape: p?.tShape ?? 1,
    jNotch: p?.jNotch ?? 0,
    uAmp: p?.uAmp ?? 0,
    uDur: p?.uDur ?? 0.10,
  };
  return nsrWaveformAtMs(tMs, rrMs, params, 'II');
}

// ─── Public: per-beat sample (drop-in for page.tsx) ─────────────

export function getWaveformForBeatIndex(
  phase: number, lead: string, beatIndex: number,
  rhythm: string, intensity: number, bpm: number,
  amplitude: number, noise: number, realistic: boolean,
  manualMode: boolean, waveParams: any
): number {
  let val: number;

  if (manualMode) {
    val = ecgManualWaveform(phase, bpm, waveParams);
  } else if (DEPENDENT_LEAD_FORMULAS[lead]) {
    val = sampleDependent(rhythm, lead, intensity, bpm, phase, beatIndex);
  } else {
    val = sampleBeatSequenced(rhythm, lead, intensity, bpm, phase, beatIndex);
  }

  if (!manualMode) {
    val *= amplitude;
  }

  return addTraceNoise(val, phase, beatIndex, noise, realistic, bpm);
}

// ─── LUT fast-path ──────────────────────────────────────────────

const leadLUTs: Record<string, Float32Array> = {};
let leadLUTCacheKey = '';
const LUT_SIZE = 2048;

export function buildAllLeadLUTs(
  rhythm: string, _lead: string, intensity: number, _amplitude: number,
  bpm: number, manualMode: boolean, waveParams: any
): void {
  const cacheKey = [rhythm, intensity.toFixed(4), bpm, manualMode ? 'm' : 'a', JSON.stringify(waveParams || {})].join('|');
  if (leadLUTCacheKey === cacheKey) return;

  for (const l of LEADS) {
    if (DEPENDENT_LEAD_FORMULAS[l]) continue;
    if (!leadLUTs[l]) leadLUTs[l] = new Float32Array(LUT_SIZE);
    const lut = leadLUTs[l];
    for (let i = 0; i < LUT_SIZE; i++) {
      const phase = i / LUT_SIZE;
      lut[i] = sampleBeatSequenced(rhythm, l, intensity, bpm, phase, 0);
    }
  }
  leadLUTCacheKey = cacheKey;
}

export function sampleLeadLUT(
  lead: string, phase: number, rhythm: string, intensity: number,
  bpm: number, manualMode: boolean, waveParams: any
): number {
  if (DEPENDENT_LEAD_FORMULAS[lead]) {
    const vI  = sampleLeadLUT('I',  phase, rhythm, intensity, bpm, manualMode, waveParams);
    const vII = sampleLeadLUT('II', phase, rhythm, intensity, bpm, manualMode, waveParams);
    return DEPENDENT_LEAD_FORMULAS[lead](vI, vII);
  }

  if (BEAT_AWARE_RHYTHMS.has(rhythm)) {
    return sampleBeatSequenced(rhythm, lead, intensity, bpm, phase, 0);
  }

  const lut = leadLUTs[lead];
  if (!lut) {
    return sampleBeatSequenced(rhythm, lead, intensity, bpm, phase, 0);
  }
  const idx = ((phase % 1) + 1) % 1 * LUT_SIZE;
  const i0 = Math.floor(idx) & (LUT_SIZE - 1);
  const i1 = (i0 + 1) & (LUT_SIZE - 1);
  const frac = idx - Math.floor(idx);
  return lut[i0] + (lut[i1] - lut[i0]) * frac;
}

// ─── Noise ──────────────────────────────────────────────────────

const noiseCache: Record<string, Float32Array> = {};

export function getLaplaceNoiseSample(index: number, length: number, samplingRate: number, amplitude: number, frequency: number): number {
  const cacheKey = `${length}_${samplingRate}_${amplitude.toFixed(4)}_${frequency}`;
  let noiseBuf = noiseCache[cacheKey];
  if (!noiseBuf) {
    const duration = length / samplingRate;
    const noiseDuration = Math.max(1, Math.floor(duration * frequency));
    const rawNoise = new Float32Array(noiseDuration);
    const scale = amplitude / Math.sqrt(2);
    for (let i = 0; i < noiseDuration; i++) {
      const seed = Math.sin((i + frequency) * 12.9898 + 78.233) * 43758.5453;
      const u = (seed - Math.floor(seed)) - 0.5;
      rawNoise[i] = -scale * Math.sign(u) * Math.log(1.0 - 2.0 * Math.abs(u));
    }
    noiseBuf = new Float32Array(length);
    if (noiseDuration === 1) {
      noiseBuf.fill(rawNoise[0]);
    } else {
      const step = (noiseDuration - 1) / (length - 1);
      for (let i = 0; i < length; i++) {
        const floatIdx = i * step;
        const idx = Math.floor(floatIdx);
        const nextIdx = Math.min(noiseDuration - 1, idx + 1);
        const frac = floatIdx - idx;
        noiseBuf[i] = rawNoise[idx] * (1.0 - frac) + rawNoise[nextIdx] * frac;
      }
    }
    noiseCache[cacheKey] = noiseBuf;
  }
  return noiseBuf[index % length];
}

export function addTraceNoise(val: number, phase: number, timeSeed: number, noiseLevelPct: number, realistic: boolean, bpm: number): number {
  let noise = 0;
  const samplingRate = 512;
  const length = 5120;

  const baseWander = 0.005 * Math.sin((timeSeed + phase) * 0.5);
  const baseJitter = 0.002 * (Math.random() * 2 - 1);
  noise += baseWander + baseJitter;

  if (noiseLevelPct > 0) {
    const noiseLevel = noiseLevelPct / 100;
    const freqs = [5, 10, 100];
    const index = Math.floor((timeSeed + phase) * length);
    const signalSd = 0.35;
    for (let i = 0; i < freqs.length; i++) {
      const amp = noiseLevel * 0.08 * signalSd;
      noise += getLaplaceNoiseSample(index + i * 100, length, samplingRate, amp, freqs[i]);
    }
  }

  if (realistic) {
    const t = (timeSeed + phase) * (60 / Math.max(1, bpm));
    const wander = 0.12 * Math.sin(t * 0.8) + 0.04 * Math.sin(t * 2.1);
    noise += wander;
    const index = Math.floor((timeSeed + phase) * length);
    noise += getLaplaceNoiseSample(index, length, samplingRate, 0.015, 150);
  }

  return val + noise;
}

// ─── Diagnostic exports ─────────────────────────────────────────

export function renderLeadCycle(rhythm: string, lead: string, intensity: number, bpm: number): Float32Array {
  return getCycle(rhythm, lead, intensity, bpm);
}

export function renderLeadCycleForBeat(
  rhythm: string, lead: string, intensity: number, bpm: number, _beatIndex: number
): Float32Array {
  const sampleBeat = (rhythm === 'pvc') ? 2 : 0;
  const rrMs = 60000 / Math.max(1, bpm);
  const N = Math.max(64, Math.round((rrMs / 1000) * CYCLE_SAMPLE_RATE));

  if (DEPENDENT_LEAD_FORMULAS[lead]) {
    const cycleI  = renderLeadCycleForBeat(rhythm, 'I',  intensity, bpm, _beatIndex);
    const cycleII = renderLeadCycleForBeat(rhythm, 'II', intensity, bpm, _beatIndex);
    const fn = DEPENDENT_LEAD_FORMULAS[lead];
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) out[i] = fn(cycleI[i], cycleII[i]);
    return out;
  }

  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const phase = i / N;
    out[i] = sampleBeatSequenced(rhythm, lead, intensity, bpm, phase, sampleBeat);
  }
  return out;
}

export { INDEPENDENT_LEADS, baselineSegments } from './ecg-model';
export { LEAD_SCALE } from './ecg-model';
export { getTemplate } from './ecg-pathologies';
