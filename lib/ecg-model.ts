// ════════════════════════════════════════════════════════════════
// ecg-model.ts — Piecewise analytic ECG wave-segment synthesis
//
// A cardiac beat is modeled as a sum of time-anchored wave segments,
// each with an explicit basis shape and asymmetric rise/fall widths.
// This makes every clinical morphology structurally expressible:
//   - rsR' (RBBB V1)         = three QRS deflections
//   - Notched M (LBBB V5/V6) = two R peaks + absent septal Q
//   - Delta wave (WPW)       = ramp_up segment fused into R onset
//   - Coved ST (Brugada)     = cosine_bell hump + descending T
//   - Tombstone STEMI        = ST segment fused into massive T
//   - Asymmetric T inversion = unequal left/right widths
//   - Osborn J-wave          = narrow positive segment at J point
//
// Coordinate convention: time is in milliseconds, R-peak at t = 0.
// Amplitude is in millivolts (signed). One full cycle = RR interval.
// ════════════════════════════════════════════════════════════════

// ─── Segment type ───────────────────────────────────────────────

export type SegmentShape =
  | 'gaussian'      // symmetric bell
  | 'cosine_bell'   // asymmetric cosine lobe
  | 'triangle'      // asymmetric linear lobe
  | 'ramp_up'       // linear rise then sharp drop (delta wave)
  | 'ramp_down'     // sharp rise then linear fall
  | 'sine_half';    // half sine lobe (asymmetric)

export interface WaveSegment {
  shape: SegmentShape;
  /** Time of segment peak, relative to R-peak at t=0, in ms. */
  centerMs: number;
  /** Rise time (left of center), ms. */
  leftWidthMs: number;
  /** Fall time (right of center), ms. */
  rightWidthMs: number;
  /** Signed peak amplitude in mV. */
  amplitudeMv: number;
  /** Anchor category tag — used by drop/replace to identify segments
   *  robustly regardless of where their center sits. */
  category?: 'p' | 'q' | 'r' | 's' | 'st' | 't' | 'u' | 'j' | 'delta' | 'extra';
}

// ─── Shape basis functions ──────────────────────────────────────
// Each returns a value in [0, 1] (or [-1, 0] for negative inputs
// once multiplied by amplitude). All are 0 outside their support.

function gaussianBasis(t: number, c: number, lw: number, rw: number): number {
  // Symmetric Gaussian — left/right widths are 3σ; allow asymmetry
  // by using separate σ on each side of the center.
  if (t < c - lw || t > c + rw) return 0;
  const sigma = t < c ? lw / 3 : rw / 3;
  const dt = t - c;
  return Math.exp(-0.5 * (dt / sigma) ** 2);
}

function cosineBellBasis(t: number, c: number, lw: number, rw: number): number {
  if (t < c - lw || t > c + rw) return 0;
  if (t <= c) {
    const x = (t - (c - lw)) / lw; // 0..1
    return 0.5 - 0.5 * Math.cos(Math.PI * x);
  } else {
    const x = (t - c) / rw; // 0..1
    return 0.5 + 0.5 * Math.cos(Math.PI * x);
  }
}

function triangleBasis(t: number, c: number, lw: number, rw: number): number {
  if (t < c - lw || t > c + rw) return 0;
  if (t <= c) {
    return (t - (c - lw)) / lw;
  } else {
    return 1 - (t - c) / rw;
  }
}

function rampUpBasis(t: number, c: number, lw: number, rw: number): number {
  // Linear rise from c-lw to c (peak), then linear fall to c+rw.
  // Used for delta-wave slurred upstrokes.
  return triangleBasis(t, c, lw, rw);
}

function rampDownBasis(t: number, c: number, lw: number, rw: number): number {
  // Sharp rise then linear fall (mirror of ramp_up).
  return triangleBasis(t, c, lw, rw);
}

function sineHalfBasis(t: number, c: number, lw: number, rw: number): number {
  if (t < c - lw || t > c + rw) return 0;
  if (t <= c) {
    const x = (t - (c - lw)) / lw;
    return Math.sin(0.5 * Math.PI * x);
  } else {
    const x = (t - c) / rw;
    return Math.cos(0.5 * Math.PI * x);
  }
}

export function evaluateSegment(seg: WaveSegment, tMs: number): number {
  const { shape, centerMs, leftWidthMs, rightWidthMs, amplitudeMv } = seg;
  if (leftWidthMs <= 0 && rightWidthMs <= 0) return 0;
  let basis = 0;
  switch (shape) {
    case 'gaussian':    basis = gaussianBasis(tMs, centerMs, leftWidthMs, rightWidthMs); break;
    case 'cosine_bell': basis = cosineBellBasis(tMs, centerMs, leftWidthMs, rightWidthMs); break;
    case 'triangle':    basis = triangleBasis(tMs, centerMs, leftWidthMs, rightWidthMs); break;
    case 'ramp_up':     basis = rampUpBasis(tMs, centerMs, leftWidthMs, rightWidthMs); break;
    case 'ramp_down':   basis = rampDownBasis(tMs, centerMs, leftWidthMs, rightWidthMs); break;
    case 'sine_half':   basis = sineHalfBasis(tMs, centerMs, leftWidthMs, rightWidthMs); break;
  }
  return basis * amplitudeMv;
}

// ─── Segment factory helpers ────────────────────────────────────
// Convenience builders using the standard "physiologic" shape per wave.
// Each tags the segment with its anchor category so drop/replace operate
// by tag (robust) instead of by time-proximity (collision-prone).

export type WaveCategory = 'p' | 'q' | 'r' | 's' | 'st' | 't' | 'u' | 'j' | 'delta' | 'extra';

/** Atrial P wave — smooth asymmetric bell. */
export function pWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'cosine_bell', centerMs, leftWidthMs: durMs * 0.4, rightWidthMs: durMs * 0.6, amplitudeMv: ampMv, category: 'p' };
}

/** Septal Q — small negative deflection. */
export function qWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'triangle', centerMs, leftWidthMs: durMs * 0.4, rightWidthMs: durMs * 0.6, amplitudeMv: -Math.abs(ampMv), category: 'q' };
}

/** R wave — sharp positive spike. */
export function rWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'triangle', centerMs, leftWidthMs: durMs * 0.4, rightWidthMs: durMs * 0.6, amplitudeMv: Math.abs(ampMv), category: 'r' };
}

/** S wave — sharp negative deflection. */
export function sWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'triangle', centerMs, leftWidthMs: durMs * 0.4, rightWidthMs: durMs * 0.6, amplitudeMv: -Math.abs(ampMv), category: 's' };
}

/** T wave — broad asymmetric lobe; positive or negative. */
export function tWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'cosine_bell', centerMs, leftWidthMs: durMs * 0.45, rightWidthMs: durMs * 0.55, amplitudeMv: ampMv, category: 't' };
}

/** U wave — small positive lobe after T. */
export function uWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'cosine_bell', centerMs, leftWidthMs: durMs * 0.5, rightWidthMs: durMs * 0.5, amplitudeMv: ampMv, category: 'u' };
}

/** Osborn / J wave — narrow positive deflection at J point. */
export function jWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'gaussian', centerMs, leftWidthMs: durMs * 0.5, rightWidthMs: durMs * 0.5, amplitudeMv: ampMv, category: 'j' };
}

/** Delta wave — slurred upstroke fused into QRS onset. */
export function deltaWave(centerMs: number, ampMv: number, durMs: number): WaveSegment {
  return { shape: 'ramp_up', centerMs, leftWidthMs: durMs * 0.9, rightWidthMs: durMs * 0.1, amplitudeMv: Math.abs(ampMv), category: 'delta' };
}

/** ST segment shift — broad plateau offset (signed amp = elevation).
 *  The cosine bell is wide enough to span the ST measurement window
 *  (J point through J+80 ms) so the validator reads a stable plateau. */
export function stShift(centerMs: number, elevMv: number, durMs: number): WaveSegment {
  return { shape: 'cosine_bell', centerMs, leftWidthMs: durMs * 0.5, rightWidthMs: durMs * 0.5, amplitudeMv: elevMv, category: 'st' };
}

/** ST elevation as a sustained plateau (cosine_bell with very wide support)
 *  so J+60 measurement reads the peak amplitude reliably. */
export function stElevPlateau(elevMv: number, fromJMs: number = 20, widthMs: number = 160): WaveSegment {
  return { shape: 'cosine_bell', centerMs: WAVE_ANCHORS_MS.jPoint + fromJMs + widthMs * 0.3, leftWidthMs: widthMs * 0.5, rightWidthMs: widthMs * 0.5, amplitudeMv: elevMv, category: 'st' };
}

// ─── Beat composition ───────────────────────────────────────────

/**
 * Sum all segments at time t (ms). The beat's R-peak sits at t=0.
 * Output is in millivolts, isoelectric baseline = 0.
 */
export function composeBeat(segments: WaveSegment[], tMs: number): number {
  let v = 0;
  for (let i = 0; i < segments.length; i++) {
    v += evaluateSegment(segments[i], tMs);
  }
  return v;
}

/**
 * Render a beat (one cycle) into an evenly-sampled Float32Array.
 * @param segments   wave segments defining the cycle
 * @param cycleMs    RR interval in ms (e.g. 60_000 / bpm)
 * @param sampleRate samples per second (Hz)
 */
export function renderCycle(segments: WaveSegment[], cycleMs: number, sampleRate = 500): Float32Array {
  const N = Math.max(64, Math.round((cycleMs / 1000) * sampleRate));
  const out = new Float32Array(N);
  const msPerSample = cycleMs / N;
  // Place R-peak at ~30% into the cycle so there's enough room for
  // prolonged PR intervals (1°/2°/3° AV block) and broad notched P
  // waves (P mitrale) before the QRS without clipping the P onset.
  // t=0 corresponds to R; samples before it are negative time, after positive.
  const rIdx = Math.floor(N * 0.30);
  for (let i = 0; i < N; i++) {
    const tMs = (i - rIdx) * msPerSample;
    out[i] = composeBeat(segments, tMs);
  }
  return out;
}

// ─── Per-lead baseline normal beat ──────────────────────────────
// Calibrated to textbook adult 12-lead amplitudes and intervals at
// resting sinus rhythm. Pathology templates compose on top of these.
//
// Reference: Surawicz & Knilans, "Chou's Electrocardiography in
// Clinical Practice" (2008); Wagner, "Marriott's Practical
// Electrocardiography" (2008).

export const NORMAL_INTERVALS_MS = {
  pDuration: 100,     // 80–110 ms
  pAmplitude: 0.12,   // ≤ 0.25 mV in limb leads
  prInterval: 160,    // 120–200 ms
  qDuration: 25,      // septal Q ~ 20–30 ms
  qrsDuration: 88,    // 80–100 ms
  qtcInterval: 400,   // ≤ 440 ms
  qtAt60bpm: 400,     // Bazett baseline
  stDuration: 80,
  tDuration: 160,
  tAmplitude: 0.30,
  uDuration: 100,
};

// R-peak anchor at t = 0; P precedes, ST-T follows.
export const WAVE_ANCHORS_MS = {
  pCenter:    -180,   // P wave center
  qCenter:    -22,    // septal Q
  rCenter:    0,      // R peak
  sCenter:    +35,    // S nadir
  jPoint:     +55,    // J point (QRS-ST junction)
  stCenter:   +90,    // ST segment midpoint
  tCenter:    +220,   // T peak
  uCenter:    +360,   // U peak
};

// Per-lead baseline R/S/Q/T amplitudes for an adult normal ECG.
// Indexed by independent lead (I, II, V1–V6). III/aVR/aVL/aVF derive.
export interface LeadBaseline {
  rMv: number;
  sMv: number;
  qMv: number;
  tMv: number;
  hasSeptalQ: boolean;
}

export const LEAD_BASELINE: Record<string, LeadBaseline> = {
  // Limb leads
  'I':  { rMv: 0.55, sMv: 0.05, qMv: 0.00, tMv: 0.20, hasSeptalQ: false },
  'II': { rMv: 0.95, sMv: 0.10, qMv: 0.02, tMv: 0.30, hasSeptalQ: true  },
  // V1: small r, deep S, inverted T (normal in young adults)
  'V1': { rMv: 0.20, sMv: 0.80, qMv: 0.00, tMv: -0.10, hasSeptalQ: false },
  // V2: transition zone — R/S ~ 1
  'V2': { rMv: 0.55, sMv: 1.10, qMv: 0.00, tMv: 0.35, hasSeptalQ: false },
  // V3: R becomes dominant
  'V3': { rMv: 1.00, sMv: 0.80, qMv: 0.00, tMv: 0.45, hasSeptalQ: false },
  // V4: tallest R
  'V4': { rMv: 1.55, sMv: 0.35, qMv: 0.05, tMv: 0.55, hasSeptalQ: true  },
  // V5: lateral
  'V5': { rMv: 1.40, sMv: 0.20, qMv: 0.08, tMv: 0.40, hasSeptalQ: true  },
  // V6: lateral, smaller R than V5
  'V6': { rMv: 1.05, sMv: 0.10, qMv: 0.06, tMv: 0.30, hasSeptalQ: true  },
};

/** Build the baseline normal beat segments for an independent lead. */
export function baselineSegments(lead: string): WaveSegment[] {
  const b = LEAD_BASELINE[lead];
  if (!b) return [];
  const A = WAVE_ANCHORS_MS;
  const I = NORMAL_INTERVALS_MS;
  const segs: WaveSegment[] = [
    pWave(A.pCenter, I.pAmplitude, I.pDuration),
    rWave(A.rCenter, b.rMv, I.qrsDuration),
    sWave(A.sCenter, b.sMv, I.qrsDuration * 0.6),
    tWave(A.tCenter, b.tMv, I.tDuration),
  ];
  if (b.hasSeptalQ) segs.push(qWave(A.qCenter, b.qMv, I.qDuration));
  return segs;
}

// ─── Beat modifier DSL ──────────────────────────────────────────
// Pathology templates return one of these. Apply via applyOverrides().

export interface LeadOverride {
  /** Drop these anchor categories before adding segments. */
  drop?: Array<'p' | 'q' | 'r' | 's' | 'st' | 't' | 'u' | 'j' | 'delta'>;
  /** Replace an anchor category entirely. */
  replace?: {
    p?: WaveSegment[];
    q?: WaveSegment[];
    r?: WaveSegment[];
    s?: WaveSegment[];
    st?: WaveSegment[];
    t?: WaveSegment[];
    u?: WaveSegment[];
    j?: WaveSegment[];
    delta?: WaveSegment[];
  };
  /** Extra segments appended (summed) onto the beat. */
  add?: WaveSegment[];
  /** Suppress P waves entirely (e.g., AFib, junctional). */
  suppressP?: boolean;
  /** Multiplier applied to all existing amplitudes (e.g., LVH voltage). */
  amplitudeScale?: number;
  /** Multiplier applied to QRS widths (e.g., BBB). */
  qrsWidthScale?: number;
}

export type LeadOverrides = Record<string, LeadOverride>;

const EMPTY_OVERRIDE: LeadOverride = {};

export function getOverride(o: LeadOverrides, lead: string): LeadOverride {
  return o[lead] || EMPTY_OVERRIDE;
}

function dropAnchorCategory(segs: WaveSegment[], category: string): WaveSegment[] {
  // Drop by category tag (robust) — segments with matching tag are removed.
  return segs.filter(s => s.category !== category);
}

/**
 * Build the final segment list for an independent lead by applying
 * pathology overrides to the baseline.
 */
export function applyOverrides(lead: string, o: LeadOverrides | null | undefined): WaveSegment[] {
  let segs = baselineSegments(lead);
  if (!o) return segs;
  const ov = getOverride(o, lead);

  // Drop categories (drop happens before replace so a replace with an
  // empty array fully clears a category).
  if (ov.drop && ov.drop.length) {
    for (const cat of ov.drop) segs = dropAnchorCategory(segs, cat);
  }
  if (ov.suppressP) segs = dropAnchorCategory(segs, 'p');

  // Replace categories (drop baseline anchor, push replacement).
  if (ov.replace) {
    const r = ov.replace;
    if (r.p)     { segs = dropAnchorCategory(segs, 'p');     segs.push(...r.p);     }
    if (r.q)     { segs = dropAnchorCategory(segs, 'q');     segs.push(...r.q);     }
    if (r.r)     { segs = dropAnchorCategory(segs, 'r');     segs.push(...r.r);     }
    if (r.s)     { segs = dropAnchorCategory(segs, 's');     segs.push(...r.s);     }
    if (r.st)    { segs = dropAnchorCategory(segs, 'st');    segs.push(...r.st);    }
    if (r.t)     { segs = dropAnchorCategory(segs, 't');     segs.push(...r.t);     }
    if (r.u)     { segs = dropAnchorCategory(segs, 'u');     segs.push(...r.u);     }
    if (r.j)     { segs = dropAnchorCategory(segs, 'j');     segs.push(...r.j);     }
    if (r.delta) { segs = dropAnchorCategory(segs, 'delta'); segs.push(...r.delta); }
  }

  // Extra add segments (summed on top).
  if (ov.add && ov.add.length) segs.push(...ov.add);

  // Apply QRS widening AFTER drops/replaces so all final QRS-range
  // segments get scaled uniformly. QRS range = within ±90ms of R-peak.
  if (ov.qrsWidthScale && ov.qrsWidthScale !== 1) {
    const w = ov.qrsWidthScale;
    segs = segs.map(s => {
      if (Math.abs(s.centerMs) < 90) {
        return {
          ...s,
          leftWidthMs: s.leftWidthMs * w,
          rightWidthMs: s.rightWidthMs * w,
          // Spread the segment center outward from R-peak (0) so two
          // notched peaks separate properly; center=0 stays at 0.
          centerMs: s.centerMs * w,
        };
      }
      return s;
    });
  }

  // Apply amplitude scale last.
  if (ov.amplitudeScale && ov.amplitudeScale !== 1) {
    const a = ov.amplitudeScale;
    segs = segs.map(s => ({ ...s, amplitudeMv: s.amplitudeMv * a }));
  }

  return segs;
}

// ─── Dependent-lead derivation ──────────────────────────────────
// III, aVR, aVL, aVF are linear combinations of I and II.
// Given a time vector for I and II (ms vs mV), compute the same
// for the dependent lead. Used by the renderer, not by per-segment
// overrides.

export const DEPENDENT_LEAD_FORMULAS: Record<string, (I: number, II: number) => number> = {
  'III':  (I, II) => II - I,
  'aVR':  (I, II) => -0.5 * (I + II),
  'aVL':  (I, II) => I - 0.5 * II,
  'aVF':  (I, II) => II - 0.5 * I,
};

export const INDEPENDENT_LEADS = ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
export const DEPENDENT_LEADS_LIST = ['III', 'aVR', 'aVL', 'aVF'];
export const ALL_LEADS = [...INDEPENDENT_LEADS, ...DEPENDENT_LEADS_LIST];
