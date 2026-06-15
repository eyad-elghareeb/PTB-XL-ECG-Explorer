// ecg-model.ts — Piecewise sinusoidal ECG waveform synthesis
//
// A cardiac beat is synthesized as a sum of half-sine wave segments
// in the time domain, producing smooth clinically realistic P-QRS-T-U
// morphologies. Per-lead amplitude scaling reproduces the normal 12-lead
// appearance.
//
// Coordinate convention: time is milliseconds from beat onset (P wave start).
// One full cycle = RR interval. Amplitude is in millivolts.
//
// Reference: Surawicz & Knilans, "Chou's Electrocardiography in Clinical
// Practice" (2008); Wagner, "Marriott's Practical Electrocardiography" (2008).

export interface WaveParams {
  pAmp: number;    // P wave amplitude (mV)
  pDur: number;    // P wave duration (seconds)
  prInt: number;   // PR interval (P onset to QRS onset, seconds)
  qrsAmp: number;  // QRS complex amplitude scalar
  qrsDur: number;  // QRS duration (seconds)
  stElev: number;  // ST segment elevation (mV, negative = depression)
  stDur: number;   // ST segment duration (seconds)
  stSlope: number; // ST slope direction (-1 downsloping, 0 flat, 1 upsloping)
  tAmp: number;    // T wave amplitude (mV)
  tDur: number;    // T wave duration (seconds)
  tShape: number;  // T wave shape (1 normal, 2 biphasic/notched)
  jNotch: number;  // J wave/Osborn notch amplitude (mV)
  uAmp: number;    // U wave amplitude (mV)
  uDur: number;    // U wave duration (seconds)
}

// ─── Standard intervals and anchors ─────────────────────────────

export const NORMAL_INTERVALS_MS = {
  pDuration: 100,
  pAmplitude: 0.12,
  prInterval: 160,
  qDuration: 25,
  qrsDuration: 88,
  qtcInterval: 400,
  qtAt60bpm: 400,
  stDuration: 80,
  tDuration: 160,
  tAmplitude: 0.30,
  uDuration: 100,
};

export const WAVE_ANCHORS_MS = {
  pCenter: -180,
  qCenter: -22,
  rCenter: 0,
  sCenter: +35,
  jPoint: +55,
  stCenter: +90,
  tCenter: +220,
  uCenter: +360,
};

// ─── Per-lead amplitude baselines ───────────────────────────────

export interface LeadBaseline {
  rMv: number;
  sMv: number;
  qMv: number;
  tMv: number;
  hasSeptalQ: boolean;
}

export const LEAD_BASELINE: Record<string, LeadBaseline> = {
  'I':  { rMv: 0.55, sMv: 0.05, qMv: 0.00, tMv: 0.20, hasSeptalQ: false },
  'II': { rMv: 0.95, sMv: 0.10, qMv: 0.02, tMv: 0.30, hasSeptalQ: true  },
  'V1': { rMv: 0.20, sMv: 0.80, qMv: 0.00, tMv: -0.10, hasSeptalQ: false },
  'V2': { rMv: 0.55, sMv: 1.10, qMv: 0.00, tMv: 0.35, hasSeptalQ: false },
  'V3': { rMv: 1.00, sMv: 0.80, qMv: 0.00, tMv: 0.45, hasSeptalQ: false },
  'V4': { rMv: 1.55, sMv: 0.35, qMv: 0.05, tMv: 0.55, hasSeptalQ: true  },
  'V5': { rMv: 1.40, sMv: 0.20, qMv: 0.08, tMv: 0.40, hasSeptalQ: true  },
  'V6': { rMv: 1.05, sMv: 0.10, qMv: 0.06, tMv: 0.30, hasSeptalQ: true  },
};

// ─── Dependent lead derivation ──────────────────────────────────

export const DEPENDENT_LEAD_FORMULAS: Record<string, (I: number, II: number) => number> = {
  'III':  (I, II) => II - I,
  'aVR':  (I, II) => -0.5 * (I + II),
  'aVL':  (I, II) => I - 0.5 * II,
  'aVF':  (I, II) => II - 0.5 * I,
};

export const INDEPENDENT_LEADS = ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
export const DEPENDENT_LEADS_LIST = ['III', 'aVR', 'aVL', 'aVF'];
export const ALL_LEADS = [...INDEPENDENT_LEADS, ...DEPENDENT_LEADS_LIST];

// ─── Half-sine utility ─────────────────────────────────────────

function halfSine(tMs: number, startMs: number, endMs: number, amp: number): number {
  if (tMs < startMs || tMs > endMs) return 0;
  const dur = endMs - startMs;
  if (dur <= 0) return 0;
  const prog = (tMs - startMs) / dur;
  return amp * Math.sin(Math.PI * prog);
}

// ─── Lead-specific amplitude scales for NSR ─────────────────────
// Derived from LEAD_BASELINE: normalizes to lead II as base (1.0).
// For any waveform param (qrsAmp, tAmp, etc.), the lead-specific
// value = param * leadMultiplierForComponent.

interface LeadComponentScale {
  p: number;
  q: number;
  r: number;
  s: number;
  t: number;
  u: number;
}

function buildLeadScale(): Record<string, LeadComponentScale> {
  const ref = LEAD_BASELINE;
  // Reference II: r=0.95, s=0.10, t=0.30, q=0.02
  const rBase = ref['II'].rMv;
  const tBase = ref['II'].tMv;
  const sBase = ref['II'].sMv;
  const qBase = ref['II'].qMv || 0.02;
  const out: Record<string, LeadComponentScale> = {};
  for (const l of INDEPENDENT_LEADS) {
    const b = ref[l];
    out[l] = {
      p: 1.0,
      q: b.hasSeptalQ ? (b.qMv / qBase) : 0,
      r: b.rMv / rBase,
      s: b.sMv / sBase,
      t: b.tMv / tBase,
      u: 1.0,
    };
  }
  return out;
}

const LEAD_SCALE = buildLeadScale();

// ─── Core NSR beat waveform (time domain, in milliseconds) ──────

export function nsrWaveformAtMs(tMs: number, cycleMs: number, params: WaveParams, lead: string): number {
  const pMs = params.pDur * 1000;
  const prMs = params.prInt * 1000;
  const qrsMs = params.qrsDur * 1000;
  const stMs = params.stDur * 1000;
  const tMs_dur = params.tDur * 1000;
  const uMs = params.uDur * 1000;

  const sc = LEAD_SCALE[lead] || LEAD_SCALE['II'];

  let val = 0;

  // P wave
  if (lead === 'V1') {
    val += halfSine(tMs, 0, pMs * 0.55, params.pAmp * 0.55);
    val += halfSine(tMs, pMs * 0.45, pMs, -params.pAmp * 0.50);
  } else {
    val += halfSine(tMs, 0, pMs, params.pAmp * sc.p);
  }

  // Q wave (early 25% of QRS)
  const qEnd = prMs + qrsMs * 0.25;
  val += halfSine(tMs, prMs, qEnd, -0.15 * params.qrsAmp * sc.q);

  // R wave (middle 40% of QRS)
  const rStart = qEnd;
  const rEnd = rStart + qrsMs * 0.40;
  val += halfSine(tMs, rStart, rEnd, params.qrsAmp * sc.r);

  // S wave (late 35% of QRS)
  const sStart = rEnd;
  const sEnd = prMs + qrsMs;
  val += halfSine(tMs, sStart, sEnd, -0.25 * params.qrsAmp * sc.s);

  // J notch (at S-ST junction)
  if (params.jNotch !== 0) {
    val += halfSine(tMs, sEnd - 10, sEnd + 12, params.jNotch);
  }

  // ST segment
  const stStart = sEnd;
  const stEnd = stStart + stMs;
  if (tMs >= stStart && tMs < stEnd) {
    const stProg = (tMs - stStart) / stMs;
    val += params.stElev * (1 + params.stSlope * stProg * 0.8);
  }

  // T wave
  const tStart = stEnd;
  const tEnd = tStart + tMs_dur;
  if (tMs >= tStart && tMs < tEnd) {
    const tProg = (tMs - tStart) / tMs_dur;
    const tAmp = params.tAmp * sc.t;
    if (params.tShape === 2) {
      val += tAmp * Math.sin(2 * Math.PI * tProg) * (1 - tProg);
    } else {
      val += tAmp * Math.sin(Math.PI * tProg);
    }
  }

  // U wave
  const uStart = tEnd;
  const uEnd = uStart + uMs;
  val += halfSine(tMs, uStart, uEnd, params.uAmp * sc.u);

  return val;
}

// ─── Render one lead cycle as Float32Array ──────────────────────

export function generateLeadCycle(
  lead: string,
  cycleMs: number,
  params: WaveParams,
  sampleRate: number = 500
): Float32Array {
  const N = Math.max(64, Math.round((cycleMs / 1000) * sampleRate));
  const out = new Float32Array(N);
  const msPerSample = cycleMs / N;
  for (let i = 0; i < N; i++) {
    const tMs = i * msPerSample;
    out[i] = nsrWaveformAtMs(tMs, cycleMs, params, lead);
  }
  return out;
}

// ─── Get lead-adjusted params for culprit/reciprocal leads ──────
// Used by STEMI and other regional pathology rhythms.

export function adjustParamsForLead(
  params: WaveParams,
  lead: string,
  culpritLeads?: string[],
  reciprocalLeads?: string[]
): WaveParams {
  if (!culpritLeads && !reciprocalLeads) return params;
  const isCulprit = culpritLeads?.includes(lead);
  const isReciprocal = reciprocalLeads?.includes(lead);

  if (isCulprit) return params;
  if (isReciprocal) {
    return { ...params, stElev: -params.stElev * 0.5 };
  }
  return { ...params, stElev: 0 };
}

// ─── Rhythm-specific per-lead waveform generators ────────────────
// For rhythms where QRS morphology changes per lead (LBBB, RBBB, etc.)

export function nsrWaveformAtMsLeadAware(tMs: number, cycleMs: number, params: WaveParams, lead: string, rhythm: string): number {
  if (isBbbRhythm(rhythm)) {
    return bbbWaveformAtMs(tMs, cycleMs, params, lead, rhythm);
  }
  if (rhythm.startsWith('stemi_') || rhythm === 'pwmi' || rhythm === 'pericarditis' || rhythm === 'wellens' || rhythm === 'dewinter' || rhythm === 'brugada') {
    const adj = leadAwareParams(rhythm, params, lead);
    return nsrWaveformAtMs(tMs, cycleMs, adj, lead);
  }
  return nsrWaveformAtMs(tMs, cycleMs, params, lead);
}

function isBbbRhythm(rhythm: string): boolean {
  return rhythm === 'lbbb' || rhythm === 'rbbb';
}

function bbbWaveformAtMs(tMs: number, cycleMs: number, params: WaveParams, lead: string, rhythm: string): number {
  const qrsMs = params.qrsDur * 1000;
  const prMs = params.prInt * 1000;
  const sc = LEAD_SCALE[lead] || LEAD_SCALE['II'];
  const rightPrecordial = ['V1', 'V2'].includes(lead);
  const lateral = ['I', 'aVL', 'V5', 'V6'].includes(lead);
  const inferior = ['II', 'III', 'aVF'].includes(lead);

  let val = 0;

  // P wave (normal P before QRS)
  if (lead === 'V1') {
    val += halfSine(tMs, 0, 50, params.pAmp * 0.5);
    val += halfSine(tMs, 40, 90, -params.pAmp * 0.4);
  } else {
    val += halfSine(tMs, 0, 90, params.pAmp * sc.p);
  }

  if (rhythm === 'lbbb') {
    if (rightPrecordial) {
      if (tMs >= prMs && tMs < prMs + qrsMs) {
        const prog = (tMs - prMs) / qrsMs;
        val += -params.qrsAmp * sc.s * Math.sin(Math.PI * prog) * (1 + 0.12 * Math.sin(2 * Math.PI * prog));
      }
      if (tMs >= prMs + qrsMs && tMs < prMs + qrsMs + 160) {
        const prog = (tMs - prMs - qrsMs) / 160;
        val += 0.2 * Math.sin(Math.PI * prog);
      }
    } else if (lateral) {
      if (tMs >= prMs && tMs < prMs + qrsMs * 0.35) {
        const prog = (tMs - prMs) / (qrsMs * 0.35);
        val += params.qrsAmp * sc.r * Math.sin(Math.PI * prog) * (1 - 0.4 * Math.sin(2 * Math.PI * prog));
      }
      if (tMs >= prMs + qrsMs * 0.35 && tMs < prMs + qrsMs) {
        const prog = (tMs - prMs - qrsMs * 0.35) / (qrsMs * 0.65);
        val += params.qrsAmp * sc.r * 0.7 * Math.sin(Math.PI * prog);
      }
      if (tMs >= prMs + qrsMs && tMs < prMs + qrsMs + 160) {
        const prog = (tMs - prMs - qrsMs) / 160;
        val += -0.25 * Math.sin(Math.PI * prog);
      }
    } else {
      // Inferior and other leads: broad R with discordant ST-T
      if (tMs >= prMs && tMs < prMs + qrsMs * 0.40) {
        const prog = (tMs - prMs) / (qrsMs * 0.40);
        val += params.qrsAmp * sc.r * 0.65 * Math.sin(Math.PI * prog);
      }
      if (tMs >= prMs + qrsMs * 0.40 && tMs < prMs + qrsMs) {
        const prog = (tMs - prMs - qrsMs * 0.40) / (qrsMs * 0.60);
        val += params.qrsAmp * sc.r * 0.45 * Math.sin(Math.PI * prog);
      }
      if (tMs >= prMs + qrsMs && tMs < prMs + qrsMs + 160) {
        const prog = (tMs - prMs - qrsMs) / 160;
        const tDir = inferior ? -0.18 : -0.20;
        val += tDir * Math.sin(Math.PI * prog);
      }
    }
  } else if (rhythm === 'rbbb') {
    if (rightPrecordial) {
      if (tMs >= prMs && tMs < prMs + qrsMs * 0.30) {
        const prog = (tMs - prMs) / (qrsMs * 0.30);
        val += 0.2 * params.qrsAmp * Math.sin(Math.PI * prog);
      }
      if (tMs >= prMs + qrsMs * 0.30 && tMs < prMs + qrsMs * 0.60) {
        const prog = (tMs - prMs - qrsMs * 0.30) / (qrsMs * 0.30);
        val += -0.6 * params.qrsAmp * Math.sin(Math.PI * prog);
      }
      if (tMs >= prMs + qrsMs * 0.60 && tMs < prMs + qrsMs) {
        const prog = (tMs - prMs - qrsMs * 0.60) / (qrsMs * 0.40);
        val += 0.5 * params.qrsAmp * Math.sin(Math.PI * prog);
      }
      if (tMs >= prMs + qrsMs && tMs < prMs + qrsMs + 160) {
        const prog = (tMs - prMs - qrsMs) / 160;
        val += -0.15 * Math.sin(Math.PI * prog);
      }
    } else if (lateral || inferior) {
      if (tMs >= prMs && tMs < prMs + 20) {
        const prog = (tMs - prMs) / 20;
        val += -0.05 * Math.sin(Math.PI * prog);
      }
      if (tMs >= prMs + 20 && tMs < prMs + qrsMs * 0.35) {
        const prog = (tMs - prMs - 20) / (qrsMs * 0.35 - 20);
        val += params.qrsAmp * sc.r * Math.sin(Math.PI * prog);
      }
      if (tMs >= prMs + qrsMs * 0.35 && tMs < prMs + qrsMs) {
        const prog = (tMs - prMs - qrsMs * 0.35) / (qrsMs * 0.65);
        val += -0.3 * params.qrsAmp * Math.sin(Math.PI * prog);
      }
      if (tMs >= prMs + qrsMs && tMs < prMs + qrsMs + 160) {
        const prog = (tMs - prMs - qrsMs) / 160;
        val += 0.2 * Math.sin(Math.PI * prog);
      }
    }
  }

  return val;
}

// ─── Lead-aware param adjustment for regional pathology ─────────

function leadAwareParams(rhythm: string, params: WaveParams, lead: string): WaveParams {
  const cv = CULPRIT_MAP[rhythm];
  if (!cv) return params;
  return adjustParamsForLead(params, lead, cv.culprit, cv.reciprocal);
}

const CULPRIT_MAP: Record<string, { culprit?: string[]; reciprocal?: string[] }> = {
  stemi_ant:    { culprit: ['V1','V2','V3','V4'],                         reciprocal: ['II','III','aVF'] },
  stemi_inf:    { culprit: ['II','III','aVF'],                            reciprocal: ['I','aVL'] },
  stemi_lat:    { culprit: ['I','aVL','V5','V6'],                         reciprocal: ['V1','V2','V3'] },
  stemi_antlat: { culprit: ['V1','V2','V3','V4','V5','V6','I','aVL'],    reciprocal: ['II','III','aVF'] },
  stemi_inflat: { culprit: ['II','III','aVF','V5','V6'],                  reciprocal: ['I','aVL','V1','V2'] },
  stemi_rv:     { culprit: ['V1'],                                         reciprocal: ['I','aVL','V5','V6'] },
  pwmi:         { culprit: ['V1','V2','V3'],                               reciprocal: ['II','III','aVF'] },
  pericarditis: { culprit: ['I','II','III','aVL','aVF','V2','V3','V4','V5','V6'], reciprocal: ['aVR','V1'] },
  wellens:      { culprit: ['V2','V3','V4'],                               reciprocal: [] },
  dewinter:     { culprit: ['V1','V2','V3','V4','V5','V6'],               reciprocal: ['aVR'] },
  brugada:      { culprit: ['V1','V2'],                                    reciprocal: [] },
};

export { LEAD_SCALE };

// ════════════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY STUBS
// The following types and functions are no longer used by the
// runtime (ecg-math.ts uses params-based generation), but are
// needed for compilation of ecg-pathologies.ts and debug scripts.
// ════════════════════════════════════════════════════════════════

export type SegmentShape =
  | 'gaussian' | 'cosine_bell' | 'triangle' | 'ramp_up' | 'ramp_down' | 'sine_half';

export interface WaveSegment {
  shape: SegmentShape;
  centerMs: number;
  leftWidthMs: number;
  rightWidthMs: number;
  amplitudeMv: number;
  category?: string;
}

export interface LeadOverride {
  drop?: string[];
  replace?: Record<string, WaveSegment[]>;
  add?: WaveSegment[];
  suppressP?: boolean;
  amplitudeScale?: number;
  qrsWidthScale?: number;
}

export type LeadOverrides = Record<string, LeadOverride>;

function cosineBellBasis(t: number, c: number, lw: number, rw: number): number {
  if (t < c - lw || t > c + rw) return 0;
  if (t <= c) {
    const x = (t - (c - lw)) / lw;
    return 0.5 - 0.5 * Math.cos(Math.PI * x);
  }
  const x = (t - c) / rw;
  return 0.5 + 0.5 * Math.cos(Math.PI * x);
}

function triangleBasis(t: number, c: number, lw: number, rw: number): number {
  if (t < c - lw || t > c + rw) return 0;
  if (t <= c) return (t - (c - lw)) / lw;
  return 1 - (t - c) / rw;
}

function evaluateSegment(seg: WaveSegment, tMs: number): number {
  if (seg.leftWidthMs <= 0 && seg.rightWidthMs <= 0) return 0;
  const c = seg.centerMs, lw = seg.leftWidthMs, rw = seg.rightWidthMs;
  if (seg.shape === 'cosine_bell') return cosineBellBasis(tMs, c, lw, rw) * seg.amplitudeMv;
  if (seg.shape === 'triangle' || seg.shape === 'ramp_up' || seg.shape === 'ramp_down') return triangleBasis(tMs, c, lw, rw) * seg.amplitudeMv;
  return 0;
}

export function composeBeat(segments: WaveSegment[], tMs: number): number {
  let v = 0;
  for (let i = 0; i < segments.length; i++) v += evaluateSegment(segments[i], tMs);
  return v;
}

export function renderCycle(segments: WaveSegment[], cycleMs: number, sampleRate = 500): Float32Array {
  const N = Math.max(64, Math.round((cycleMs / 1000) * sampleRate));
  const out = new Float32Array(N);
  const msPerSample = cycleMs / N;
  const rIdx = Math.floor(N * 0.30);
  for (let i = 0; i < N; i++) {
    const tMs = (i - rIdx) * msPerSample;
    out[i] = composeBeat(segments, tMs);
  }
  return out;
}

export function pWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'cosine_bell', centerMs, leftWidthMs: durMs * 0.4, rightWidthMs: durMs * 0.6, amplitudeMv: ampMv, category: 'p' };
}

export function qWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'triangle', centerMs, leftWidthMs: durMs * 0.4, rightWidthMs: durMs * 0.6, amplitudeMv: -Math.abs(ampMv), category: 'q' };
}

export function rWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'triangle', centerMs, leftWidthMs: durMs * 0.4, rightWidthMs: durMs * 0.6, amplitudeMv: Math.abs(ampMv), category: 'r' };
}

export function sWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'triangle', centerMs, leftWidthMs: durMs * 0.4, rightWidthMs: durMs * 0.6, amplitudeMv: -Math.abs(ampMv), category: 's' };
}

export function tWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'cosine_bell', centerMs, leftWidthMs: durMs * 0.45, rightWidthMs: durMs * 0.55, amplitudeMv: ampMv, category: 't' };
}

export function uWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'cosine_bell', centerMs, leftWidthMs: durMs * 0.5, rightWidthMs: durMs * 0.5, amplitudeMv: ampMv, category: 'u' };
}

export function jWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'cosine_bell', centerMs, leftWidthMs: durMs * 0.5, rightWidthMs: durMs * 0.5, amplitudeMv: ampMv, category: 'j' };
}

export function deltaWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'ramp_up', centerMs, leftWidthMs: durMs * 0.9, rightWidthMs: durMs * 0.1, amplitudeMv: Math.abs(ampMv), category: 'delta' };
}

export function stShift(centerMs: number, elevMv: number, durMs: number): WaveSegment {
  return { shape: 'cosine_bell', centerMs, leftWidthMs: durMs * 0.5, rightWidthMs: durMs * 0.5, amplitudeMv: elevMv, category: 'st' };
}

export function stElevPlateau(elevMv: number, fromJMs: number = 20, widthMs: number = 160): WaveSegment {
  return { shape: 'cosine_bell', centerMs: WAVE_ANCHORS_MS.jPoint + fromJMs + widthMs * 0.3, leftWidthMs: widthMs * 0.5, rightWidthMs: widthMs * 0.5, amplitudeMv: elevMv, category: 'st' };
}

// Rebuild baselineSegments for backward compat
export function baselineSegments(lead: string): WaveSegment[] {
  const b = LEAD_BASELINE[lead];
  if (!b) return [];
  const A = WAVE_ANCHORS_MS;
  const I = NORMAL_INTERVALS_MS;
  const segs: WaveSegment[] = [];
  if (lead === 'V1') {
    segs.push(pWave(A.pCenter - 10, 0.06, 50));
    segs.push(pWave(A.pCenter + 25, -0.06, 50));
  } else {
    segs.push(pWave(A.pCenter, I.pAmplitude, I.pDuration));
  }
  segs.push(rWave(A.rCenter, b.rMv, I.qrsDuration));
  segs.push(sWave(A.sCenter, b.sMv, I.qrsDuration * 0.6));
  segs.push(tWave(A.tCenter, b.tMv, I.tDuration));
  if (b.hasSeptalQ) segs.push(qWave(A.qCenter, b.qMv, I.qDuration));
  return segs;
}

const EMPTY_OVERRIDE: LeadOverride = {};
export function getOverride(o: LeadOverrides, lead: string): LeadOverride {
  return o[lead] || EMPTY_OVERRIDE;
}

export function applyOverrides(lead: string, o: LeadOverrides | null | undefined): WaveSegment[] {
  let segs = baselineSegments(lead);
  if (!o) return segs;
  const ov = getOverride(o, lead);
  if (ov.drop && ov.drop.length) segs = segs.filter(s => !ov.drop!.includes(s.category!));
  if (ov.suppressP) segs = segs.filter(s => s.category !== 'p');
  if (ov.replace) {
    const r = ov.replace;
    for (const cat of Object.keys(r)) {
      segs = segs.filter(s => s.category !== cat);
      segs.push(...(r[cat] || []));
    }
  }
  if (ov.add && ov.add.length) segs.push(...ov.add);
  if (ov.qrsWidthScale && ov.qrsWidthScale !== 1) {
    const w = ov.qrsWidthScale;
    segs = segs.map(s => ({
      ...s,
      leftWidthMs: s.leftWidthMs * w,
      rightWidthMs: s.rightWidthMs * w,
      centerMs: s.centerMs * w,
    }));
  }
  if (ov.amplitudeScale && ov.amplitudeScale !== 1) {
    segs = segs.map(s => ({ ...s, amplitudeMv: s.amplitudeMv * ov.amplitudeScale! }));
  }
  return segs;
}
