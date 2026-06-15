// ════════════════════════════════════════════════════════════════
// ecg-math.ts — Beat sequencer + rendering fast-path
//
// Public API (preserved exactly for app/page.tsx):
//   - getWaveformForBeatIndex(phase, lead, beatIndex, rhythm, intensity, bpm,
//                            amplitude, noise, realistic, manualMode, waveParams): number
//   - buildAllLeadLUTs(rhythm, lead, intensity, amplitude, bpm, manualMode, waveParams): void
//   - sampleLeadLUT(lead, phase, rhythm, intensity, bpm, manualMode, waveParams): number
//   - addTraceNoise(val, phase, timeSeed, noiseLevelPct, realistic, bpm): number
//
// Internally this is a thin layer over:
//   - lib/ecg-model.ts      (segment primitives, baseline)
//   - lib/ecg-pathologies.ts(per-lead templates per rhythm)
// ════════════════════════════════════════════════════════════════

import {
  WaveSegment, renderCycle, composeBeat, applyOverrides,
  baselineSegments, INDEPENDENT_LEADS, DEPENDENT_LEAD_FORMULAS,
  pWave, qWave, rWave, sWave, tWave, uWave, jWave, stShift, deltaWave,
  WAVE_ANCHORS_MS as A, NORMAL_INTERVALS_MS as NI,
} from './ecg-model';
import { getTemplate } from './ecg-pathologies';
import {
  LEADS, BEAT_AWARE_RHYTHMS, LEAD_TARGET_AMPLITUDE,
} from './ecg-rhythms';

// ─── Cycle cache ────────────────────────────────────────────────
// Rendered one-beat Float32Array per (rhythm, lead, intensity, bpm).

const cycleCache = new Map<string, Float32Array>();
const CYCLE_SAMPLE_RATE = 500; // Hz

function getCycle(rhythm: string, lead: string, intensity: number, bpm: number): Float32Array {
  const key = `${rhythm}|${lead}|${intensity.toFixed(4)}|${bpm}`;
  const cached = cycleCache.get(key);
  if (cached) return cached;

  const rrMs = 60000 / Math.max(1, bpm);
  const overrides = getTemplate(rhythm)(intensity);
  const segments = applyOverrides(lead, overrides);
  const cycle = renderCycle(segments, rrMs, CYCLE_SAMPLE_RATE);
  // Cap the cache to avoid unbounded growth in long sessions.
  if (cycleCache.size > 4096) cycleCache.clear();
  cycleCache.set(key, cycle);
  return cycle;
}

/** Clear the cycle cache (used when settings change aggressively). */
export function clearCycleCache(): void {
  cycleCache.clear();
}

// ─── Sample an independent lead at fractional phase ─────────────

function sampleIndependent(rhythm: string, lead: string, intensity: number, bpm: number, phase: number): number {
  const cycle = getCycle(rhythm, lead, intensity, bpm);
  const N = cycle.length;
  const idxFloat = ((phase % 1) + 1) % 1 * N;
  const i0 = Math.floor(idxFloat) % N;
  const i1 = (i0 + 1) % N;
  const frac = idxFloat - Math.floor(idxFloat);
  return cycle[i0] * (1 - frac) + cycle[i1] * frac;
}

function sampleDependent(
  rhythm: string,
  depLead: string,
  intensity: number,
  bpm: number,
  phase: number,
  beatIndex: number
): number {
  const fn = DEPENDENT_LEAD_FORMULAS[depLead];
  if (!fn) return 0;
  const vI  = sampleBeatSequenced(rhythm, 'I',  intensity, bpm, phase, beatIndex);
  const vII = sampleBeatSequenced(rhythm, 'II', intensity, bpm, phase, beatIndex);
  return fn(vI, vII);
}

// ─── Beat sequencer ─────────────────────────────────────────────
// Handles rhythms whose morphology depends on which beat in a group
// we're on (afib fibrillation, flutter sawtooth, AV block cycles,
// PVC trigeminy, VT, VFib, asystole, PEA).

function sampleBeatSequenced(
  rhythm: string,
  lead: string,
  intensity: number,
  bpm: number,
  phase: number,
  beatIndex: number
): number {
  // VFib / asystole / PEA: direct noise synthesis.
  if (rhythm === 'vfib')     return vfibValue(intensity, phase, beatIndex, lead);
  if (rhythm === 'asystole') return asystoleValue(intensity, phase, beatIndex, lead);
  if (rhythm === 'pea')      return peaValue(intensity, phase, beatIndex, lead);

  // Atrial fibrillation: NSR QRS + fibrillatory baseline, no P.
  if (rhythm === 'afib') {
    const qrs = sampleIndependent('afib', lead, intensity, bpm, phase);
    const fib = afibBaseline(intensity, phase, beatIndex, lead);
    return qrs + fib;
  }

  // Atrial flutter: NSR QRS + sawtooth at flutter rate.
  if (rhythm === 'aflutter') {
    const qrs = sampleIndependent('aflutter', lead, intensity, bpm, phase);
    const saw = flutterSawtooth(intensity, phase, bpm);
    const leadAmp = LEAD_TARGET_AMPLITUDE[lead] || 1.6;
    return qrs + saw * (leadAmp / 1.6);
  }

  // AV Block 2° Mobitz I (Wenckebach): progressive PR lengthening,
  // then a P-only beat (no QRS).
  if (rhythm === 'avb2mob1') {
    const cycleLen = intensity > 0.55 ? 3 : intensity > 0.25 ? 4 : 5;
    const idxInCycle = beatIndex % cycleLen;
    const isDropped = idxInCycle === cycleLen - 1;
    if (isDropped) {
      // P wave only — phase 0..0.2 maps to P region; rest flat.
      return pOnlyValue(lead, bpm, phase, intensity, beatIndex, idxInCycle);
    }
    // Progressive PR prolongation: each beat in cycle has longer PR.
    const prExtra = (60 + 40 * intensity) * idxInCycle;
    const shiftedPhase = shiftPhaseForPR(phase, prExtra, bpm);
    return sampleIndependent('avb1', lead, intensity, bpm, shiftedPhase);
  }

  // AV Block 2° Mobitz II: constant PR, sudden dropped QRS, wide QRS.
  if (rhythm === 'avb2mob2') {
    const cycleLen = intensity > 0.55 ? 2 : intensity > 0.25 ? 3 : 4;
    const isDropped = beatIndex % cycleLen === cycleLen - 1;
    if (isDropped) return pOnlyValue(lead, bpm, phase, intensity, beatIndex, 0);
    return sampleIndependent('avb2mob2', lead, intensity, bpm, phase);
  }

  // AV Block 3° (complete): independent atrial P's + ventricular escape.
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

  // PVC trigeminy: every 3rd beat is a wide ectopic.
  if (rhythm === 'pvc') {
    if (beatIndex % 3 === 2) {
      return sampleIndependent('pvc', lead, intensity, bpm, phase);
    }
    return sampleIndependent('nsr', lead, 0, bpm, phase);
  }

  // Default: render the rhythm's template directly.
  return sampleIndependent(rhythm, lead, intensity, bpm, phase);
}

// ─── Beat-sequencer helpers ─────────────────────────────────────

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

function pOnlyValue(lead: string, bpm: number, phase: number, intensity: number, beatIndex: number, cycleIdx: number): number {
  // For dropped-beat phases in AV blocks, render an isolated P wave.
  if (phase > 0.30) return 0;
  const rrMs = 60000 / Math.max(1, bpm);
  const cycle = getCycle('nsr', lead, 0, bpm);
  // P region sits in the first ~18% of cycle; map phase 0..0.25 → 0..0.20.
  const N = cycle.length;
  const pFraction = Math.min(0.20, phase / 0.25 * 0.20);
  const idxFloat = pFraction * N;
  const i0 = Math.floor(idxFloat) % N;
  const i1 = (i0 + 1) % N;
  const frac = idxFloat - Math.floor(idxFloat);
  return cycle[i0] * (1 - frac) + cycle[i1] * frac;
}

function shiftPhaseForPR(phase: number, extraPrMs: number, bpm: number): number {
  // Each ms of extra PR shifts the beat later by that fraction of cycle.
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
  // Low-amplitude organized QRS complexes.
  const base = sampleIndependent('pea', 'II', intensity, 35, phase);
  const t = (beatIndex + phase) * (60 / 35);
  return base * (1 - 0.3 * intensity) + 0.02 * Math.sin(t * 11);
}

// ─── Public: per-beat sample (drop-in for page.tsx) ─────────────

export function getWaveformForBeatIndex(
  phase: number,
  lead: string,
  beatIndex: number,
  rhythm: string,
  intensity: number,
  bpm: number,
  amplitude: number,
  noise: number,
  realistic: boolean,
  manualMode: boolean,
  waveParams: any
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

// ─── LUT fast-path (used by page.tsx for non-beat-aware rhythms) ─

const leadLUTs: Record<string, Float32Array> = {};
let leadLUTCacheKey = '';
const LUT_SIZE = 2048;

export function buildAllLeadLUTs(
  rhythm: string,
  _lead: string,
  intensity: number,
  _amplitude: number,
  bpm: number,
  manualMode: boolean,
  waveParams: any
): void {
  const cacheKey = [rhythm, intensity.toFixed(4), bpm, manualMode ? 'm' : 'a', JSON.stringify(waveParams || {})].join('|');
  if (leadLUTCacheKey === cacheKey) return;

  for (const l of LEADS) {
    // Skip dependent leads — derived on-the-fly from I and II in sampleLeadLUT.
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
  lead: string,
  phase: number,
  rhythm: string,
  intensity: number,
  bpm: number,
  manualMode: boolean,
  waveParams: any
): number {
  // Dependent leads: derive from I and II (LUT or on-the-fly).
  // This ensures pathology applied to I/II propagates correctly.
  if (DEPENDENT_LEAD_FORMULAS[lead]) {
    const vI  = sampleLeadLUT('I',  phase, rhythm, intensity, bpm, manualMode, waveParams);
    const vII = sampleLeadLUT('II', phase, rhythm, intensity, bpm, manualMode, waveParams);
    return DEPENDENT_LEAD_FORMULAS[lead](vI, vII);
  }

  // Beat-aware rhythms must NOT use the cached LUT (they depend on beatIndex).
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

// ─── Manual mode waveform (Wave Builder customizer) ─────────────
// Preserved: maps user waveParams → segments.

export function ecgManualWaveform(phase: number, bpm: number, p: any): number {
  const rrMs = 60000 / Math.max(1, bpm);
  const N = Math.max(64, Math.round((rrMs / 1000) * CYCLE_SAMPLE_RATE));
  const rIdx = Math.floor(N * 0.25);

  // Build a synthetic segment list from p each call. p may be missing
  // fields; fall back to baseline intervals.
  const pr = (p?.prInt ?? 0.16) * 1000;          // s → ms
  const qrsDur = (p?.qrsDur ?? 0.08) * 1000;
  const tDur = (p?.tDur ?? 0.16) * 1000;
  const pDur = (p?.pDur ?? 0.10) * 1000;
  const uDur = (p?.uDur ?? 0.10) * 1000;

  const segs: WaveSegment[] = [];
  if ((p?.pAmp ?? 0) !== 0) {
    segs.push(pWave(A.rCenter - pr - pDur * 0.5, p.pAmp, pDur));
  }
  if ((p?.qrsAmp ?? 1) > 0) {
    segs.push(rWave(A.rCenter, p.qrsAmp, qrsDur));
  }
  if (p?.stElev && Math.abs(p.stElev) > 0.01) {
    segs.push(stShift(A.jPoint + 20, p.stElev, 100));
  }
  if ((p?.tAmp ?? 0) !== 0) {
    segs.push(tWave(A.rCenter + 60 + tDur * 0.5 + 100, p.tAmp, tDur));
  }
  if ((p?.uAmp ?? 0) > 0) {
    segs.push(uWave(A.tCenter + 150, p.uAmp, uDur));
  }
  if ((p?.jNotch ?? 0) > 0) {
    segs.push(jWave(A.jPoint + 5, p.jNotch, 30));
  }

  const msPerSample = rrMs / N;
  const tMs = (Math.floor(((phase % 1) + 1) % 1 * N) - rIdx) * msPerSample;
  return composeBeat(segs, tMs);
}

// ─── Noise (preserved signature) ────────────────────────────────

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

// ─── Diagnostic exports (used by ecg-validate.ts) ───────────────

export function renderLeadCycle(rhythm: string, lead: string, intensity: number, bpm: number): Float32Array {
  return getCycle(rhythm, lead, intensity, bpm);
}

export function renderLeadCycleForBeat(
  rhythm: string,
  lead: string,
  intensity: number,
  bpm: number,
  beatIndex: number
): Float32Array {
  // For beat-aware rhythms, render the representative beat (beatIndex 0
  // for non-ectopic; for PVC trigeminy use the ectopic beat at index 2).
  const sampleBeat = (rhythm === 'pvc') ? 2 : 0;
  const N = Math.max(64, Math.round((60000 / Math.max(1, bpm) / 1000) * CYCLE_SAMPLE_RATE));
  const out = new Float32Array(N);

  // Dependent leads (III, aVR, aVL, aVF) derive from I and II at each sample.
  if (DEPENDENT_LEAD_FORMULAS[lead]) {
    const cycleI  = renderLeadCycleForBeat(rhythm, 'I',  intensity, bpm, beatIndex);
    const cycleII = renderLeadCycleForBeat(rhythm, 'II', intensity, bpm, beatIndex);
    const fn = DEPENDENT_LEAD_FORMULAS[lead];
    for (let i = 0; i < N; i++) out[i] = fn(cycleI[i], cycleII[i]);
    return out;
  }

  for (let i = 0; i < N; i++) {
    const phase = i / N;
    out[i] = sampleBeatSequenced(rhythm, lead, intensity, bpm, phase, sampleBeat);
  }
  return out;
}

export { INDEPENDENT_LEADS, baselineSegments, getTemplate, composeBeat };
