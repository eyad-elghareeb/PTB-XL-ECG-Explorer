import {
  LEADS,
  NK_GAMMA,
  LEAD_TARGET_AMPLITUDE,
  BASELINE_TI,
  BASELINE_AI,
  BASELINE_BI,
  WAVEFORM_LUT_SIZE,
  ODE_DAMPING,
  DEPENDENT_LEADS
} from "./ecg-rhythms";

// Global cache for computed cycle waveforms
const cycleCache: Record<string, Float32Array> = {};
const leadLUTs: Record<string, Float32Array> = {};
let leadLUTCacheKey: string = '';

// Laplace distribution sampler (exact inverse CDF method)
export function randomLaplace(loc: number = 0, scale: number = 1): number {
  const u = Math.random() - 0.5;
  return loc - scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

// RK4 ODE Integration Solver for McSharry ECGSYN Model
export function solveECGSYN(
  ti: number[],
  ai: number[],
  bi: number[],
  bpm: number,
  targetAmplitude: number = 1.6,
  samplingRate: number = 512
): Float32Array {
  const T = 60 / Math.max(1, bpm);
  const N = Math.max(128, Math.round(T * samplingRate));
  const dt = T / N;
  const omega = (2 * Math.PI) / T;

  const M = 2 * N; // Solve for two cycles to eliminate transients
  const output = new Float32Array(N);
  let z = 0.04; // safe initial condition

  // Derivative evaluator
  function getDzDt(theta: number, zVal: number) {
    let sum = 0;
    for (let i = 0; i < ti.length; i++) {
      let dti = theta - ti[i];
      dti = dti - Math.round(dti / (2 * Math.PI)) * (2 * Math.PI);
      sum += (ai[i] / (bi[i] * bi[i])) * dti * Math.exp(-0.5 * Math.pow(dti / bi[i], 2));
    }
    return -sum - ODE_DAMPING * zVal;
  }

  // RK4 Integration Loop
  const dtheta = dt * omega;
  for (let j = 0; j < M; j++) {
    const t = j * dt;
    const theta = -Math.PI + omega * t;

    const k1 = getDzDt(theta, z);
    const k2 = getDzDt(theta + 0.5 * dtheta, z + 0.5 * dtheta * k1);
    const k3 = getDzDt(theta + 0.5 * dtheta, z + 0.5 * dtheta * k2);
    const k4 = getDzDt(theta + dtheta, z + dtheta * k3);
    z = z + (dtheta / 6) * (k1 + 2 * k2 + 2 * k3 + k4);

    if (j >= N) {
      output[j - N] = z;
    }
  }

  // Baseline-preserving normalization: TP segment maps to 0 mV
  const isoStart = Math.floor(N * 0.05);
  const isoEnd = Math.floor(N * 0.15);
  let baseline = 0;
  for (let i = isoStart; i < isoEnd; i++) {
    baseline += output[i];
  }
  baseline /= (isoEnd - isoStart);

  for (let i = 0; i < N; i++) {
    output[i] -= baseline;
  }

  let zmin = output[0];
  let zmax = output[0];
  for (let i = 1; i < N; i++) {
    if (output[i] < zmin) zmin = output[i];
    if (output[i] > zmax) zmax = output[i];
  }
  const zrange = zmax - zmin;

  if (zrange > 0.1) {
    const scale = targetAmplitude / zrange;
    for (let i = 0; i < N; i++) {
      output[i] *= scale;
    }
  } else {
    for (let i = 0; i < N; i++) {
      output[i] = 0.0;
    }
  }

  return output;
}

// Build precomputed Look Up Tables (LUT) for independent leads
export function buildAllLeadLUTs(
  rhythm: string,
  lead: string,
  intensity: number,
  amplitude: number,
  bpm: number,
  manualMode: boolean,
  waveParams: any
) {
  const cacheKey = [
    rhythm,
    lead,
    intensity.toFixed(4),
    amplitude.toFixed(4),
    manualMode ? 'manual' : 'auto',
    JSON.stringify(waveParams)
  ].join('|');
  
  if (leadLUTCacheKey === cacheKey) return;

  LEADS.forEach(l => {
    if (!leadLUTs[l]) leadLUTs[l] = new Float32Array(WAVEFORM_LUT_SIZE);
    const lut = leadLUTs[l];
    for (let i = 0; i < WAVEFORM_LUT_SIZE; i++) {
      const phase = i / WAVEFORM_LUT_SIZE;
      lut[i] = getWaveformValueRaw(phase, l, rhythm, intensity, bpm, manualMode, waveParams);
    }
  });
  leadLUTCacheKey = cacheKey;
}

export function sampleLeadLUT(lead: string, phase: number, rhythm: string, intensity: number, bpm: number, manualMode: boolean, waveParams: any): number {
  const lut = leadLUTs[lead];
  if (!lut) return getWaveformValueRaw(phase, lead, rhythm, intensity, bpm, manualMode, waveParams);
  const idx = phase * WAVEFORM_LUT_SIZE;
  const i0 = Math.floor(idx) & (WAVEFORM_LUT_SIZE - 1);
  const i1 = (i0 + 1) & (WAVEFORM_LUT_SIZE - 1);
  const frac = idx - Math.floor(idx);
  return lut[i0] + (lut[i1] - lut[i0]) * frac;
}

// Pathological Rhythms Parameter Mapping
export function getRhythmParams(rhythm: string, lead: string, intensity: number, bpm: number) {
  const ti = BASELINE_TI.map(deg => deg * Math.PI / 180);
  const ai = [...BASELINE_AI];
  const bi = [...BASELINE_BI];

  const hrfact = Math.sqrt(bpm / 60);
  const hrfact2 = Math.sqrt(hrfact);
  for (let i = 0; i < bi.length; i++) {
    bi[i] *= hrfact;
  }
  const tiScale = [hrfact2, hrfact, 1, hrfact, hrfact2];
  for (let i = 0; i < ti.length; i++) {
    ti[i] *= tiScale[i];
  }

  const gamma = NK_GAMMA[lead] || [1.0, 1.0, 1.0, 1.0, 1.0];
  for (let i = 0; i < ai.length; i++) {
    ai[i] *= gamma[i];
  }

  function addSTChange(deg: number, amp: number, width: number) {
    ti.push(deg * Math.PI / 180);
    ai.push(amp);
    bi.push(width);
  }

  function addExtraWave(deg: number, amp: number, width: number) {
    ti.push(deg * Math.PI / 180);
    ai.push(amp);
    bi.push(width);
  }

  if (lead === 'V1' && !['afib', 'aflutter', 'svt', 'vtach', 'vfib', 'asystole'].includes(rhythm)) {
    ai[0] = Math.abs(ai[0]);
    addExtraWave(-45, -Math.abs(ai[0]) * 1.1, bi[0] * 0.9);
  }

  switch (rhythm) {
    case 'st':
      ti[0] = -55 * Math.PI / 180 * hrfact2;
      ai[0] *= 1.2 + 0.3 * intensity;
      ai[4] *= 0.8 - 0.2 * intensity;
      break;
    case 'sb':
      ti[0] = -85 * Math.PI / 180 * hrfact2;
      ai[0] *= 1.0 + 0.2 * intensity;
      ai[4] *= 1.2 + 0.3 * intensity;
      break;
    case 'avb1':
      const shift = 40 + 60 * intensity;
      ti[0] = (-70 - shift) * Math.PI / 180;
      break;
    case 'wpw':
      ti[0] = -40 * Math.PI / 180;
      addExtraWave(-8, 8.0 * intensity, 0.08);
      bi[1] *= 1.3;
      bi[2] *= 1.3;
      bi[3] *= 1.3;
      ai[4] = -Math.abs(ai[4]) * (0.5 + 1.2 * intensity);
      break;
    case 'lbbb':
      bi[1] *= 1.8; bi[2] *= 1.8; bi[3] *= 1.8;
      if (['I', 'V5', 'V6'].includes(lead)) {
        ai[1] = 0; ai[2] *= 0.65;
        addExtraWave(12, ai[2] * 0.9, 0.12);
        addSTChange(35, -2.5 * intensity, 0.15);
        ai[4] = -Math.abs(ai[4]) * (1.2 + 1.0 * intensity);
      } else if (['V1', 'V2'].includes(lead)) {
        ai[2] *= 0.1; ai[3] *= 1.8 + 0.8 * intensity;
        addSTChange(35, 3.5 * intensity, 0.15);
        ai[4] = Math.abs(ai[4]) * (1.8 + 1.5 * intensity);
      } else {
        ai[2] *= 0.7;
        addExtraWave(10, ai[2] * 0.7, 0.15);
      }
      break;
    case 'rbbb':
      bi[1] *= 1.8; bi[2] *= 1.8; bi[3] *= 1.8;
      if (['V1', 'V2'].includes(lead)) {
        ai[2] *= 0.3; ai[3] *= 0.8;
        addExtraWave(22, 18.0 * (0.8 + 0.4 * intensity), 0.15);
        addSTChange(35, -2.0 * intensity, 0.15);
        ai[4] = -Math.abs(ai[4]) * (1.5 + 1.2 * intensity);
      } else if (['I', 'V5', 'V6'].includes(lead)) {
        bi[3] *= 2.8; ai[3] *= 1.3 + 0.5 * intensity;
      }
      break;
    case 'stemi_ant':
    case 'stemi_inf':
    case 'stemi_lat':
    case 'stemi_antlat':
    case 'stemi_inflat':
    case 'stemi_rv': {
      const culpritMap: Record<string, string[]> = {
        'stemi_ant':    ['V1','V2','V3','V4'],
        'stemi_inf':    ['II'],
        'stemi_lat':    ['I','V5','V6'],
        'stemi_antlat': ['V1','V2','V3','V4','I','V5','V6'],
        'stemi_inflat': ['II','V5','V6'],
        'stemi_rv':     ['V1']
      };
      const reciprocalMap: Record<string, string[]> = {
        'stemi_ant':    ['II'],
        'stemi_inf':    ['I'],
        'stemi_lat':    ['V1','V2','V3'],
        'stemi_antlat': ['II'],
        'stemi_inflat': ['I'],
        'stemi_rv':     ['I']
      };
      
      const culpritLeads = culpritMap[rhythm] || [];
      const reciprocalLeads = reciprocalMap[rhythm] || [];
      const isCulprit = culpritLeads.includes(lead);
      const isReciprocal = reciprocalLeads.includes(lead);

      if (isCulprit) {
        const stElev = (3.0 + 8.0 * intensity) * 2.5;
        addSTChange(30, stElev, 0.22);
        if (intensity < 0.45) {
          ai[4] *= 3.5; bi[4] *= 1.4;
        } else {
          ai[4] = -Math.abs(ai[4]) * (1.2 + 1.5 * (intensity - 0.45));
        }
        ai[2] *= Math.max(0.3, 1.0 - 0.6 * intensity);
      } else if (isReciprocal) {
        const stDep = -(2.0 + 6.0 * intensity) * 2.5;
        addSTChange(30, stDep, 0.22);
        if (intensity > 0.45) {
          ai[4] = -Math.abs(ai[4]) * (0.8 + 1.2 * intensity);
        }
      }
      break;
    }
    case 'pwmi':
      if (['V1', 'V2', 'V3'].includes(lead)) {
        const stDep = -(1.5 + 3.5 * intensity);
        addSTChange(30, stDep, 0.18);
        ai[2] *= 1.5 + 0.8 * intensity;
        ai[4] = Math.abs(ai[4]) * (1.8 + 1.5 * intensity);
      }
      break;
    case 'hyperk':
      ai[4] *= 3.5 + 8.0 * intensity;
      bi[4] *= Math.max(0.55, 0.92 - 0.2 * intensity);
      if (intensity > 0.3) {
        ti[0] = (-70 - 40 * (intensity - 0.3)) * Math.PI / 180;
        bi[1] *= 1.4; bi[2] *= 1.4; bi[3] *= 1.4;
        ai[0] *= Math.max(0.0, 1.0 - 1.5 * (intensity - 0.3));
      }
      if (intensity > 0.7) {
        ai[0] = 0; bi[1] *= 2.2; bi[2] *= 2.2; bi[3] *= 2.2;
        addSTChange(45, 6.0 * intensity, 0.3);
      }
      break;
    case 'hypokalemia': {
      const tAmp = 0.22 * Math.max(0, 1 - intensity * 1.8);
      const uAmp = 0.04 + 0.32 * intensity;
      ai[4] = tAmp;
      addSTChange(30, -1.5 * intensity, 0.15);
      addExtraWave(130, uAmp * 10, 0.22);
      break;
    }
    case 'hypothermia':
      if (['II', 'V5', 'V6'].includes(lead)) {
        addExtraWave(22, 5.0 * intensity, 0.08);
      }
      break;
    case 'wellens':
      if (['V2', 'V3'].includes(lead)) {
        ai[4] = 0;
        addExtraWave(90, 1.5 * intensity, 0.15);
        addExtraWave(125, -2.5 * intensity, 0.15);
      }
      break;
    case 'dewinter':
      if (['V1','V2','V3','V4','V5','V6'].includes(lead)) {
        addSTChange(25, -2.5 * intensity, 0.12);
        ai[4] *= 3.0 + 5.0 * intensity;
        bi[4] *= 0.8;
      }
      break;
    case 'longqt':
      ti[4] = (100 + 45 * intensity) * Math.PI / 180;
      bi[4] *= 1.4 + 0.8 * intensity;
      break;
    case 'brugada':
      if (['V1', 'V2'].includes(lead)) {
        addSTChange(25, 4.5 * intensity, 0.15);
        ai[4] = -Math.abs(ai[4]) * (1.5 + 2.0 * intensity);
      }
      break;
    case 'pericarditis':
      if (lead === 'aVR' || lead === 'V1') {
        addSTChange(30, -1.5 * intensity, 0.15);
        ti[0] = -55 * Math.PI / 180;
        ai[0] *= 1.2;
      } else {
        addSTChange(30, 2.0 * intensity, 0.15);
        ti[0] = -85 * Math.PI / 180;
        ai[0] *= 0.8;
      }
      break;
    case 'digoxin':
      if (['I', 'II', 'V5', 'V6'].includes(lead)) {
        addSTChange(30, -2.2 * intensity, 0.15);
        ai[4] *= 0.5;
      }
      break;
    case 'earlyrepo':
      if (['I', 'II', 'V5', 'V6'].includes(lead)) {
        addExtraWave(20, 1.2 * intensity, 0.05);
        addSTChange(30, 1.5 * intensity, 0.15);
        ai[4] *= 1.5 + 1.5 * intensity;
      }
      break;
    case 'lvh':
      if (['I', 'V5', 'V6'].includes(lead)) {
        ai[2] *= 1.8 + 1.2 * intensity;
        addSTChange(30, -1.8 * intensity, 0.15);
        ai[4] = -Math.abs(ai[4]) * (1.2 + 1.0 * intensity);
      } else if (['V1', 'V2'].includes(lead)) {
        ai[3] *= 1.8 + 1.5 * intensity;
      }
      break;
    case 'rvh':
      if (lead === 'V1') {
        ai[2] *= 2.5 + 2.0 * intensity;
        addSTChange(30, -1.5 * intensity, 0.15);
        ai[4] = -Math.abs(ai[4]) * (1.2 + 1.0 * intensity);
      } else if (['I', 'V5', 'V6'].includes(lead)) {
        ai[3] *= 1.8 + 1.2 * intensity;
      }
      break;
    case 'bve':
      if (lead === 'V1') {
        ai[2] *= 1.5; ai[3] *= 1.8;
      } else if (['V5', 'V6'].includes(lead)) {
        ai[2] *= 2.0; ai[3] *= 1.5;
      }
      break;
    case 'lah':
      if (lead === 'II') {
        ai[0] *= 0.7;
        addExtraWave(-82 * Math.PI / 180 * hrfact2, ai[0] * 0.8, bi[0]);
        bi[0] *= 1.4;
      } else if (lead === 'V1') {
        ai[0] *= 0.5;
        addExtraWave(-55 * Math.PI / 180 * hrfact2, -ai[0] * 1.5, bi[0] * 1.2);
      }
      break;
    case 'rah':
      if (lead === 'II') {
        ai[0] *= 1.8 + 1.2 * intensity;
        bi[0] *= 0.8;
      } else if (['V1', 'V2'].includes(lead)) {
        ai[0] *= 1.5 + 1.0 * intensity;
        bi[0] *= 0.85;
      }
      break;
    case 'pe':
      if (lead === 'I') {
        ai[2] *= 0.4; ai[3] *= 2.5 * intensity;
      } else if (lead === 'II') {
        ai[1] *= 2.0 + 1.5 * intensity; ai[4] *= 0.4;
      }
      break;
    case 'lafb':
      if (lead === 'I') {
        ai[2] *= 1.5 + 0.5 * intensity; ai[3] = 0;
      } else if (lead === 'II') {
        ai[2] *= 0.3; ai[3] *= 1.8 + 1.0 * intensity;
      }
      break;
    case 'lpfb':
      if (lead === 'I') {
        ai[2] *= 0.3; ai[3] *= 1.8 + 1.0 * intensity;
      } else if (lead === 'II') {
        ai[2] *= 1.5 + 0.5 * intensity; ai[3] = 0;
      }
      break;
  }

  return { ti, ai, bi };
}

export function generateLeadWaveformUnscaled(
  rhythm: string,
  lead: string,
  bpm: number,
  intensity: number,
  phase: number,
  beatIndex: number,
  waveParams: any,
  manualMode: boolean
): number {
  if (DEPENDENT_LEADS[lead]) {
    const valI = generateLeadWaveformUnscaled(rhythm, 'I', bpm, intensity, phase, beatIndex, waveParams, manualMode);
    const valII = generateLeadWaveformUnscaled(rhythm, 'II', bpm, intensity, phase, beatIndex, waveParams, manualMode);
    return DEPENDENT_LEADS[lead](valI, valII);
  }

  if (rhythm === 'asystole') {
    const t = (beatIndex + phase) * (60 / Math.max(1, bpm));
    return intensity * (0.005 * Math.sin(t * 23.0) + 0.003 * Math.sin(t * 67.0));
  }
  
  if (rhythm === 'vfib') {
    const t = (beatIndex + phase) * (60 / 72);
    const amp = 0.5 - 0.35 * intensity;
    const freq1 = 45 + 30 * intensity;
    const freq2 = 73 + 25 * intensity;
    const freq3 = 127 - 20 * intensity;
    return amp * (Math.sin(t * freq1) + 0.8 * Math.sin(t * freq2) + 0.6 * Math.sin(t * freq3) + 0.4 * Math.sin(t * 199.9));
  }

  if (rhythm === 'vtach' && intensity > 0.8) {
    const t = (beatIndex + phase) * (60 / bpm);
    const twist = Math.sin(t * 1.5);
    const ti = [0 * Math.PI / 180, 45 * Math.PI / 180];
    const ai = [(1.5 + 2.5 * intensity) * 10, -(1.0 + 1.5 * intensity) * 8];
    const bi = [(0.15 + 0.12 * intensity) * 1.5, (0.18 + 0.10 * intensity) * 1.5];
    const cycleData = solveECGSYN(ti, ai, bi, 160);
    const len = cycleData.length;
    const idx = Math.floor(phase * len) % len;
    return cycleData[idx] * twist;
  }

  const targetAmp = LEAD_TARGET_AMPLITUDE[lead] || 1.6;
  const cacheKey = `${rhythm}_${lead}_${intensity.toFixed(2)}_${bpm}_${targetAmp.toFixed(2)}`;
  let cycleData = cycleCache[cacheKey];

  if (!cycleData) {
    const { ti, ai, bi } = getRhythmParams(rhythm, lead, intensity, bpm);
    cycleData = solveECGSYN(ti, ai, bi, bpm, targetAmp);
    cycleCache[cacheKey] = cycleData;
  }

  const len = cycleData.length;
  const idxFloat = phase * len;
  const idx = Math.floor(idxFloat) % len;
  const nextIdx = (idx + 1) % len;
  const frac = idxFloat - Math.floor(idxFloat);

  return cycleData[idx] * (1.0 - frac) + cycleData[nextIdx] * frac;
}

export function ecgManualWaveform(phase: number, bpm: number, p: any): number {
  const ti = BASELINE_TI.map(deg => deg * Math.PI / 180);
  const ai = [...BASELINE_AI];
  const bi = [...BASELINE_BI];

  const hrfact = Math.sqrt(bpm / 60);
  const hrfact2 = Math.sqrt(hrfact);
  for (let i = 0; i < bi.length; i++) bi[i] *= hrfact;
  const tiScale = [hrfact2, hrfact, 1, hrfact, hrfact2];
  for (let i = 0; i < ti.length; i++) ti[i] *= tiScale[i];

  ai[0] = p.pAmp * 10;
  bi[0] = p.pDur * hrfact;

  const prExt = (p.prInt - 0.12) * 360 * Math.PI / 180;
  ti[0] -= prExt;

  ai[1] = -0.15 * p.qrsAmp * 30;
  ai[2] = p.qrsAmp * 30;
  ai[3] = -0.22 * p.qrsAmp * 30;
  bi[1] = p.qrsDur * 0.5 * hrfact;
  bi[2] = p.qrsDur * hrfact;
  bi[3] = p.qrsDur * 0.8 * hrfact;

  if (Math.abs(p.stElev) > 0.01) {
    const stSlopeVal = p.stSlope === 2 ? 0.22 : (p.stSlope === -1 ? -0.22 : 0.0);
    ti.push(30 * Math.PI / 180);
    ai.push(p.stElev * 15 + stSlopeVal);
    bi.push(p.stDur * hrfact);
  }

  ai[4] = p.tAmp * 12;
  bi[4] = p.tDur * hrfact;

  if (p.uAmp > 0) {
    ti.push(140 * Math.PI / 180);
    ai.push(p.uAmp * 10);
    bi.push(p.uDur * hrfact);
  }

  const cacheKey = `manual_${bpm}_${p.pAmp}_${p.pDur}_${p.prInt}_${p.qrsAmp}_${p.qrsDur}_${p.stElev}_${p.stDur}_${p.stSlope}_${p.tAmp}_${p.tDur}_${p.uAmp}_${p.uDur}`;
  let cycleData = cycleCache[cacheKey];

  if (!cycleData) {
    // manual designs target 1.6 mV
    cycleData = solveECGSYN(ti, ai, bi, bpm);
    cycleCache[cacheKey] = cycleData;
  }

  const len = cycleData.length;
  const idxFloat = phase * len;
  const idx = Math.floor(idxFloat) % len;
  const nextIdx = (idx + 1) % len;
  const frac = idxFloat - Math.floor(idxFloat);

  return cycleData[idx] * (1.0 - frac) + cycleData[nextIdx] * frac;
}

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
  let val = 0;

  if (manualMode) {
    val = ecgManualWaveform(phase, bpm, waveParams);
  } else if (rhythm === 'afib') {
    const baseNoise = 0.05 + 0.15 * intensity;
    const t = (beatIndex + phase) * (60 / 95);
    const fib = baseNoise * (Math.sin(t * 137.5) + 0.7 * Math.sin(t * 89.3) + 0.5 * Math.sin(t * 197.1) + 0.3 * Math.sin(t * 251.7 + 1.2));
    const rawClean = generateLeadWaveformUnscaled('nsr', lead, 95, 0.0, phase, beatIndex, waveParams, manualMode);
    const cleanVal = phase < 0.15 ? 0.0 : rawClean;
    const leadAmp = LEAD_TARGET_AMPLITUDE[lead] || 1.6;
    const leadScale = leadAmp / 1.6;
    val = cleanVal + fib * leadScale;
  } else if (rhythm === 'aflutter') {
    const flAmp = 0.08 + 0.12 * intensity;
    const flutterRate = 300 + 30 * intensity;
    const t = (beatIndex + phase) * (60 / bpm);
    const flutterPhase = (t * flutterRate / 60) % 1;
    const saw = 2 * flutterPhase - 1;
    const fl = -flAmp * (saw + 0.25 * Math.sin(2 * Math.PI * flutterPhase));
    const rawClean = generateLeadWaveformUnscaled('nsr', lead, bpm, 0.0, phase, beatIndex, waveParams, manualMode);
    const cleanVal = phase < 0.15 ? 0.0 : rawClean;
    const leadAmp = LEAD_TARGET_AMPLITUDE[lead] || 1.6;
    const leadScale = leadAmp / 1.6;
    val = cleanVal + fl * leadScale;
  } else if (rhythm === 'avb1') {
    val = generateLeadWaveformUnscaled(rhythm, lead, bpm, intensity, phase, beatIndex, waveParams, manualMode);
  } else if (rhythm === 'avb2mob1' || rhythm === 'avb2mob2') {
    const dropEvery = rhythm === 'avb2mob1'
      ? (intensity > 0.55 ? 3 : intensity > 0.25 ? 4 : 5)
      : (intensity > 0.55 ? 2 : intensity > 0.25 ? 3 : 4);
    const droppedBeat = beatIndex % dropEvery === dropEvery - 1;
    if (droppedBeat) {
      const atrialOnly = generateLeadWaveformUnscaled('nsr', lead, bpm, 0.0, phase, beatIndex, waveParams, manualMode);
      val = phase < 0.22 ? atrialOnly * (0.85 + 0.2 * intensity) : 0;
    } else {
      val = generateLeadWaveformUnscaled(rhythm, lead, bpm, intensity, phase, beatIndex, waveParams, manualMode);
    }
  } else if (rhythm === 'avb3') {
    const ventRate = Math.max(18, bpm);
    const atrialRate = 82 + 10 * intensity;
    const t_abs = (beatIndex + phase) * (60 / ventRate);
    const phase_atrial = (t_abs * (atrialRate / 60)) % 1;
    const valAtrial = generateLeadWaveformUnscaled('nsr', lead, atrialRate, 0.0, phase_atrial, 0, waveParams, manualMode);
    const pOnly = phase_atrial < 0.15 ? valAtrial : 0.0;
    const valVent = generateLeadWaveformUnscaled('avb3', lead, ventRate, intensity, phase, beatIndex, waveParams, manualMode);
    const qrstOnly = phase < 0.15 ? 0.0 : valVent;
    val = pOnly + qrstOnly;
  } else if (rhythm === 'pvc') {
    if (beatIndex % 3 === 2) {
      const qrsW = 0.12 + 0.08 * intensity;
      const ti = [0 * Math.PI / 180, 40 * Math.PI / 180];
      const ai = [(1.5 + 2.0 * intensity) * 12, -(1.2 + 1.8 * intensity) * 10];
      const bi = [qrsW * 0.8, (0.2 + 0.06 * intensity) * 1.5];
      
      const isLateral = ['I', 'V5', 'V6'].includes(lead);
      if (isLateral) {
        ai[0] = -Math.abs(ai[0]);
        ai[1] = Math.abs(ai[1]);
      }
      
      const cacheKey = `pvc_${lead}_${intensity.toFixed(2)}_${bpm}`;
      let cycleData = cycleCache[cacheKey];
      if (!cycleData) {
        cycleData = solveECGSYN(ti, ai, bi, bpm);
        cycleCache[cacheKey] = cycleData;
      }
      const len = cycleData.length;
      const idx = Math.floor(phase * len) % len;
      val = cycleData[idx];
    } else {
      val = generateLeadWaveformUnscaled('nsr', lead, bpm, 0.0, phase, beatIndex, waveParams, manualMode);
    }
  } else {
    val = generateLeadWaveformUnscaled(rhythm, lead, bpm, intensity, phase, beatIndex, waveParams, manualMode);
  }

  if (!manualMode) {
    val *= amplitude;
  }

  return addTraceNoise(val, phase, beatIndex, noise, realistic, bpm);
}

export function getWaveformValueRaw(
  phase: number,
  lead: string,
  rhythm: string,
  intensity: number,
  bpm: number,
  manualMode: boolean,
  waveParams: any
): number {
  return generateLeadWaveformUnscaled(rhythm, lead, bpm, intensity, phase, 0, waveParams, manualMode);
}
