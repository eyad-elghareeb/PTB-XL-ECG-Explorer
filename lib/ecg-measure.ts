// ════════════════════════════════════════════════════════════════
// ecg-measure.ts — Measurement of synthesized ECG cycles
//
// Samples a one-beat cycle (Float32Array) at high resolution and
// extracts clinical measurements using energy-based delineation:
//   - PR interval  (P-onset → QRS-onset)
//   - QRS duration (QRS-onset → J-point)
//   - QT / QTc     (QRS-onset → T-end; Bazett correction)
//   - ST elevation (deviation at J+60 ms vs TP baseline)
//   - R / S / T / P amplitudes (extrema in their windows)
//   - Frontal axis  (net QRS area in I vs aVF)
//   - Sokolov-Lyon  (SV1 + RV5 in mm)
//
// The QRS is located via a |slope| (energy) envelope rather than by
// assuming a positive R-peak — this makes delineation robust to
// dominantly-negative QRS morphologies (LBBB V1, posterior MI V1,
// QS patterns in evolved STEMI, deep S in lead III, etc.).
//
// All times returned in ms; amplitudes in mV.
// ════════════════════════════════════════════════════════════════

export interface CycleSample {
  /** Sampled mV values, one per ms across one RR interval. */
  mv: Float32Array;
  /** RR interval in ms. */
  rrMs: number;
  /** Heart rate in bpm (derived). */
  bpm: number;
  /** Sample rate in Hz (= samples/ms because we resample to 1 ms spacing). */
  sampleRateHz: number;
}

export interface WaveDelineation {
  pOnsetIdx: number;
  pOffsetIdx: number;
  qrsOnsetIdx: number;
  qrsOffsetIdx: number;   // = J point
  tOnsetIdx: number;
  tOffsetIdx: number;     // T end
  qrsCenterIdx: number;   // centroid of QRS energy
}

export interface CycleMeasurement {
  prIntervalMs: number;
  qrsDurationMs: number;
  qtIntervalMs: number;
  qtcMs: number;
  rAmplitudeMv: number;   // peak positive in QRS
  sAmplitudeMv: number;   // peak negative in QRS (≤ 0)
  tAmplitudeMv: number;   // peak in T window (signed)
  tPolarity: 'upright' | 'inverted' | 'flat';
  stElevationJ60Mv: number; // ST elevation at J + 60 ms
  stMeanMv: number;
  tpBaselineMv: number;
  pAmplitudeMv: number;   // peak |P| in PR segment (signed)
  pDurationMs: number;    // P-wave duration
  del: WaveDelineation;
  rPeakIdx: number;
}

// ─── Resample to 1 ms spacing ───────────────────────────────────

/**
 * Resample any cycle ( Float32Array spanning one RR interval, sampled
 * at sampleRateHz ) to a uniform 1 sample per millisecond, normalized
 * so that the QRS center sits at index floor(rrMs * 0.25). This makes
 * all downstream measurements time-indexed and lead-independent.
 */
export function resampleToMsPerSample(
  cycle: Float32Array,
  sampleRateHz: number,
  rrMs: number
): CycleSample {
  const n = Math.max(64, Math.round(rrMs));
  const out = new Float32Array(n);
  // Match ecg-model.renderCycle R-peak placement (30% into cycle).
  const rIdx = Math.floor(n * 0.30);
  const origRIdx = Math.floor(cycle.length * 0.30);
  const msPerOrigSample = 1000 / sampleRateHz;
  for (let i = 0; i < n; i++) {
    const tMs = (i - rIdx) * 1;
    const origIdxFloat = origRIdx + tMs / msPerOrigSample;
    const i0 = Math.floor(origIdxFloat);
    const i1 = i0 + 1;
    if (i0 < 0 || i1 >= cycle.length) {
      out[i] = 0;
      continue;
    }
    const frac = origIdxFloat - i0;
    out[i] = cycle[i0] * (1 - frac) + cycle[i1] * frac;
  }
  const bpm = Math.round(60000 / rrMs);
  return { mv: out, rrMs, bpm, sampleRateHz: 1000 };
}

  // ─── QRS energy envelope ────────────────────────────────────────
// |slope| (rectified first derivative) summed in a sliding window,
// GATED by direction-change frequency. The QRS produces a burst of
// high-frequency content with many directional reversals; ST-shift
// ramps are monotonic (one direction). Multiplying the slope-sum by
// the count of derivative sign changes within the window produces an
// envelope that peaks inside the QRS and stays low across ST ramps.
//
// This is the key discriminator that lets the delineator distinguish
// a true QRS (R-S-R' with multiple reversals) from a wide ST-elevation
// or ST-depression ramp (single direction).

function absSlopeEnvelope(mv: Float32Array, winMs: number = 16): Float32Array {
  const N = mv.length;
  const env = new Float32Array(N);
  const halfWin = Math.max(1, Math.floor(winMs / 2));
  // Pre-compute first differences.
  const diff = new Float32Array(N);
  for (let i = 1; i < N; i++) diff[i] = mv[i] - mv[i - 1];
  for (let i = 1; i < N; i++) {
    const lo = Math.max(1, i - halfWin);
    const hi = Math.min(N - 1, i + halfWin);
    let slopeSum = 0;
    let reversals = 0;
    let prevSign = 0;
    for (let k = lo; k <= hi; k++) {
      const d = diff[k];
      slopeSum += Math.abs(d);
      const sign = d > 0.001 ? 1 : (d < -0.001 ? -1 : 0);
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) reversals++;
      if (sign !== 0) prevSign = sign;
    }
    // Slope provides the base energy; reversals amplify it for true
    // QRS morphology. A monotonic ramp gets reversals ≤ 1 and is
    // effectively suppressed relative to a multi-deflection QRS
    // (3+ reversals). Light gating (0.2 weight) — enough to suppress
    // pure ST ramps while still detecting delta waves (which have
    // 1-2 reversals at the QRS-delta junction).
    env[i] = slopeSum * (1 + reversals * 0.2);
  }
  return env;
}

function movingAverage(arr: Float32Array, winMs: number): Float32Array {
  const N = arr.length;
  const out = new Float32Array(N);
  const half = Math.max(1, Math.floor(winMs / 2));
  let sum = 0;
  for (let i = 0; i < Math.min(N, half); i++) sum += arr[i];
  for (let i = 0; i < N; i++) {
    const addIdx = Math.min(N - 1, i + half);
    const subIdx = Math.max(0, i - half - 1);
    if (i > 0) {
      sum += arr[addIdx];
      if (i - half - 1 >= 0) sum -= arr[subIdx];
    }
    out[i] = sum / (2 * half + 1);
  }
  return out;
}

// ─── Delineation ────────────────────────────────────────────────

/**
 * Delineate P, QRS, and T from a resampled cycle (1 sample/ms).
 *
 * Strategy:
 *  1. Build |slope| envelope, smooth it.
 *  2. Find QRS center = max envelope in the central third of the cycle
 *     (we know R is at ~25%, but allow ±15% tolerance for conduction).
 *  3. QRS onset = walk LEFT from QRS center until envelope returns to
 *     baseline AND the signal settles near TP baseline.
 *  4. J point = walk RIGHT from QRS center until envelope settles.
 *  5. T end = rightmost point past J where signal returns to baseline.
 */
export function delineateCycle(s: CycleSample): WaveDelineation {
  const { mv, rrMs } = s;
  const N = mv.length;
  const rIdx = Math.floor(N * 0.25);

  const env = absSlopeEnvelope(mv, 16);
  const envSmooth = movingAverage(env, 12);

  // ── QRS center: locate via the CENTROID of the energy envelope
  // within the search window.  Using the centroid (rather than the
  // argmax) avoids biasing toward the rising edge of a triangle-wave
  // R-peak (where |slope| is constant across the whole upstroke).
  // The centroid sits at the R-peak for symmetric QRS, and at the
  // dominant deflection for asymmetric or M-shaped QRS.
  const absHalf = Math.min(Math.floor(rrMs * 0.12), 120);
  const searchLo = Math.max(1, rIdx - absHalf);
  const searchHi = Math.min(N - 2, rIdx + absHalf);
  let envSum = 0, envWeightedIdx = 0, envMax = -Infinity;
  for (let i = searchLo; i <= searchHi; i++) {
    envSum += envSmooth[i];
    envWeightedIdx += i * envSmooth[i];
    if (envSmooth[i] > envMax) envMax = envSmooth[i];
  }
  let qrsCenter = envSum > 0 ? Math.round(envWeightedIdx / envSum) : rIdx;
  let qrsCenterEnv = envMax;
  // Guard: if centroid fell outside the search window (rare edge case
  // with very flat envelopes), fall back to the expected R location.
  if (qrsCenter < searchLo || qrsCenter > searchHi) qrsCenter = rIdx;

  // QRS energy peak threshold — half the peak (used as onset search end).
  const qrsPeak = qrsCenterEnv;
  const onsetThreshold = qrsPeak * 0.08; // 8% of peak energy = onset level
  // Deflection threshold: 35% of QRS peak — used to identify QRS
  // deflection edges (R/R'/S falling/rising) within the bounded window.
  const deflectionThreshold = qrsPeak * 0.35;

  // ── QRS onset: bound the search to qrsCenter - 100 ms (QRS onset
  // is at most ~100 ms before R-peak in severe BBB). Find the earliest
  // env peak ≥ 35% of QRS peak within the bounded window, then walk
  // left to where env settles.
  const qrsOnsetHardCap = Math.max(1, qrsCenter - 100);
  let firstDeflectionIdx = qrsCenter;
  for (let i = qrsCenter - 5; i >= qrsOnsetHardCap; i--) {
    if (envSmooth[i] > deflectionThreshold) {
      firstDeflectionIdx = i;   // keep updating to earliest
    }
  }
  // Walk LEFT from firstDeflectionIdx to where env settles.
  let qrsOnset = firstDeflectionIdx - 15;
  let onsetLowRunMs = 0;
  for (let i = firstDeflectionIdx - 3; i > Math.max(1, firstDeflectionIdx - 50); i--) {
    if (envSmooth[i] < onsetThreshold) {
      onsetLowRunMs++;
      if (onsetLowRunMs >= 8) {
        qrsOnset = i + 8;
        break;
      }
    } else {
      onsetLowRunMs = 0;
    }
  }
  if (qrsOnset >= firstDeflectionIdx - 3) qrsOnset = Math.max(1, firstDeflectionIdx - 15);

  // ── J point (QRS offset): the J point is bounded by physiology.
  // QRS duration is at most ~160 ms (severe BBB/VT); typical is
  // 80-120 ms. The R-peak sits at qrsCenter; the J point is at most
  // qrsCenter + 100 ms. We find the latest deflection within this
  // bounded window, then walk a short distance past it to the J point.
  //
  // Key insight: deflection peaks PAST qrsCenter + 100 ms are NOT
  // QRS — they are ST-shift ramps or T waves. Hard-capping the
  // search window prevents these from extending the QRS.
  const qrsOffsetHardCap = Math.min(N - 1, qrsCenter + 130);
  // Find the latest env peak (≥ 35% of QRS peak) within the bounded
  // window. This is the last R/R'/S-falling-edge of the QRS.
  let lastDeflectionIdx = qrsCenter;
  for (let i = qrsCenter + 5; i <= qrsOffsetHardCap; i++) {
    if (envSmooth[i] > deflectionThreshold) {
      // Update to the latest sample above threshold — this captures
      // the trailing edge of the last QRS deflection.
      lastDeflectionIdx = i;
    }
  }

  // J point: walk right from lastDeflectionIdx looking for a sustained
  // low-env run (signal settling after the QRS).
  const qrsOffsetMaxSearch = Math.min(N - 1, lastDeflectionIdx + 50);
  let qrsOffset = lastDeflectionIdx + 15;
  let lowEnvRunMs = 0;
  const requiredRun = 8;
  for (let i = lastDeflectionIdx + 3; i <= qrsOffsetMaxSearch; i++) {
    if (envSmooth[i] < onsetThreshold) {
      lowEnvRunMs++;
      if (lowEnvRunMs >= requiredRun) {
        qrsOffset = i - requiredRun;
        break;
      }
    } else {
      lowEnvRunMs = 0;
    }
  }
  if (qrsOffset <= lastDeflectionIdx + 3) qrsOffset = Math.min(qrsOffsetMaxSearch, lastDeflectionIdx + 15);

  // Clamp QRS duration to a physiologic window: 40–180 ms.
  if (qrsOffset - qrsOnset < 40) qrsOffset = qrsOnset + 40;
  if (qrsOffset - qrsOnset > 180) qrsOffset = qrsOnset + 180;

  // ── P onset / offset: search in the PR segment before QRS onset.
  const pSearchStart = Math.max(1, qrsOnset - Math.floor(rrMs * 0.45));
  const pSearchEnd = qrsOnset - 5;
  let pOnset = pSearchEnd;
  let pOffset = pSearchEnd;
  for (let i = pSearchStart; i < pSearchEnd; i++) {
    if (Math.abs(mv[i] - 0) > 0.020) { pOnset = i; break; }
  }
  for (let i = pOnset; i < pSearchEnd; i++) {
    if (Math.abs(mv[i] - 0) < 0.020) { pOffset = i; break; }
  }
  if (pOnset >= pOffset) { pOnset = pSearchEnd; pOffset = pSearchEnd; }

  // ── T onset / offset: T starts shortly after J point, ends where
  // signal returns to baseline.
  const tOnset = qrsOffset + 5;
  const tSearchEnd = Math.min(N - 1, qrsOnset + Math.floor(rrMs * 0.70));
  let tOffset = tSearchEnd;
  // Walk back from tSearchEnd: find first point above baseline threshold.
  for (let i = tSearchEnd; i > tOnset; i--) {
    if (Math.abs(mv[i]) > 0.020) { tOffset = i; break; }
  }
  if (tOffset <= tOnset + 10) tOffset = Math.min(N - 1, qrsOffset + Math.floor(rrMs * 0.45));

  return {
    pOnsetIdx: pOnset,
    pOffsetIdx: pOffset,
    qrsOnsetIdx: qrsOnset,
    qrsOffsetIdx: qrsOffset,
    tOnsetIdx: tOnset,
    tOffsetIdx: tOffset,
    qrsCenterIdx: qrsCenter,
  };
}

// ─── Measurement ────────────────────────────────────────────────

function tpBaseline(s: CycleSample, qrsOnsetIdx: number, pOnsetIdx: number, tOffsetIdx: number): number {
  // TP baseline = the truly isoelectric segment. Three candidates:
  //   1. The flat region just before P-wave onset (TP segment proper).
  //   2. The PR segment between P-offset and QRS-onset (when P is
  //      wide/bifid and TP sits before cycle start).
  //   3. The post-T diastolic region between T-end and cycle end
  //      (used for very long cycles where T ends early).
  // We prefer the region with the smallest |amplitude| (most isoelectric).
  const { mv } = s;

  function meanIn(lo: number, hi: number): { mean: number; absmean: number; n: number } {
    const a = Math.max(1, lo);
    const b = Math.min(mv.length - 1, hi);
    if (b <= a) return { mean: 0, absmean: Infinity, n: 0 };
    let sum = 0, cnt = 0;
    for (let i = a; i <= b; i++) { sum += mv[i]; cnt++; }
    return { mean: sum / cnt, absmean: Math.abs(sum / cnt), n: cnt };
  }

  // Candidate A: 60 ms just before P onset (TP segment).
  const candA = meanIn(pOnsetIdx - 70, pOnsetIdx - 20);
  // Candidate B: PR segment, P-offset → QRS-onset.
  const candB = meanIn(pOnsetIdx + 5, qrsOnsetIdx - 5);
  // Candidate C: post-T diastolic flat region.
  const candC = meanIn(tOffsetIdx + 10, tOffsetIdx + 80);

  // Pick the most isoelectric (lowest |mean|) candidate with samples.
  const candidates = [candA, candB, candC].filter(c => c.n > 0);
  if (candidates.length === 0) return 0;
  let best = candidates[0];
  for (const c of candidates) if (c.absmean < best.absmean) best = c;
  return best.mean;
}

/**
 * Measure a single cycle. `rrMs` is the true RR for QTc.
 */
export function measureCycle(cycle: Float32Array, sampleRateHz: number, rrMs: number): CycleMeasurement {
  const s = resampleToMsPerSample(cycle, sampleRateHz, rrMs);
  const { mv } = s;
  const del = delineateCycle(s);

  // Intervals (samples are 1 ms apart, so idx difference = ms).
  const prIntervalMs = Math.max(0, del.qrsOnsetIdx - del.pOnsetIdx);
  const qrsDurationMs = Math.max(0, del.qrsOffsetIdx - del.qrsOnsetIdx);
  const qtIntervalMs = Math.max(0, del.tOffsetIdx - del.qrsOnsetIdx);

  // Bazett: QTc = QT / sqrt(RR in seconds).
  const rrSec = rrMs / 1000;
  const qtcMs = rrSec > 0 ? qtIntervalMs / Math.sqrt(rrSec) : qtIntervalMs;

  // Baseline
  const baseline = tpBaseline(s, del.qrsOnsetIdx, del.pOnsetIdx, del.tOffsetIdx);

  // R / S amplitudes (relative to baseline) — within [QRS onset - 5, QRS offset + 5].
  let rMax = -Infinity, sMin = Infinity;
  const qrsStart = Math.max(0, del.qrsOnsetIdx - 5);
  const qrsEnd = Math.min(mv.length - 1, del.qrsOffsetIdx + 5);
  for (let i = qrsStart; i <= qrsEnd; i++) {
    const v = mv[i] - baseline;
    if (v > rMax) rMax = v;
    if (v < sMin) sMin = v;
  }
  if (!Number.isFinite(rMax)) rMax = 0;
  if (!Number.isFinite(sMin)) sMin = 0;

  // T amplitude — peak in [J+15, T-end], signed.
  let tPeak = 0;
  const tStart = Math.min(mv.length - 1, del.qrsOffsetIdx + 15);
  const tEnd = Math.min(mv.length - 1, del.tOffsetIdx);
  for (let i = tStart; i <= tEnd; i++) {
    const v = mv[i] - baseline;
    if (Math.abs(v) > Math.abs(tPeak)) tPeak = v;
  }
  const tPolarity: CycleMeasurement['tPolarity'] =
    tPeak > 0.05 ? 'upright' : tPeak < -0.05 ? 'inverted' : 'flat';

  // ST elevation at J + 60 ms (J-point = qrsOffsetIdx).
  const j60Idx = Math.min(mv.length - 1, del.qrsOffsetIdx + 60);
  const stElevationJ60Mv = mv[j60Idx] - baseline;

  // ST mean over [J, J+80]
  let stSum = 0, stCnt = 0;
  for (let i = del.qrsOffsetIdx; i <= j60Idx && i < mv.length; i++) {
    stSum += mv[i] - baseline; stCnt++;
  }
  const stMeanMv = stCnt > 0 ? stSum / stCnt : 0;

  // P amplitude — peak |P| in PR segment [pOnset, pOffset] (signed).
  let pPeak = 0;
  if (del.pOffsetIdx > del.pOnsetIdx) {
    for (let i = del.pOnsetIdx; i <= del.pOffsetIdx && i < mv.length; i++) {
      const v = mv[i] - baseline;
      if (Math.abs(v) > Math.abs(pPeak)) pPeak = v;
    }
  }
  const pDurationMs = Math.max(0, del.pOffsetIdx - del.pOnsetIdx);

  return {
    prIntervalMs,
    qrsDurationMs,
    qtIntervalMs,
    qtcMs,
    rAmplitudeMv: rMax,
    sAmplitudeMv: sMin,
    tAmplitudeMv: tPeak,
    tPolarity,
    stElevationJ60Mv,
    stMeanMv,
    tpBaselineMv: baseline,
    pAmplitudeMv: pPeak,
    pDurationMs,
    del,
    rPeakIdx: del.qrsCenterIdx,
  };
}

// ─── Frontal axis ───────────────────────────────────────────────
// Net QRS area sign in I and aVF gives the quadrant.
// Returns degrees (-180..+180) and a label.

export type AxisLabel = 'normal' | 'left' | 'right' | 'extreme' | 'indeterminate';

export function computeFrontalAxis(netAreaI: number, netAreaAVF: number): { degrees: number; label: AxisLabel } {
  // Net area proportional to (R - S) in each lead; we already have signed areas.
  const degrees = Math.atan2(netAreaAVF, netAreaI) * 180 / Math.PI;
  let label: AxisLabel = 'normal';
  if (degrees >= -30 && degrees <= 90) label = 'normal';
  else if (degrees >= -90 && degrees < -30) label = 'left';
  else if (degrees > 90 && degrees <= 180) label = 'right';
  else label = 'extreme';
  if (Math.abs(netAreaI) < 0.05 && Math.abs(netAreaAVF) < 0.05) label = 'indeterminate';
  return { degrees, label };
}

/** Net QRS area for a resampled cycle (mV·ms). Signed. */
export function netQrsArea(s: CycleSample): number {
  const { mv } = s;
  const d = delineateCycle(s);
  let area = 0;
  for (let i = d.qrsOnsetIdx; i <= d.qrsOffsetIdx && i < mv.length; i++) {
    area += mv[i];
  }
  return area;
}

// ─── Sokolov-Lyon voltage ───────────────────────────────────────
// SV1 + RV5 (in mm, where 1 mV = 10 mm at standard gain).

export function sokolovLyonMm(rv5Mv: number, sv1Mv: number): number {
  return (Math.max(0, rv5Mv) + Math.max(0, -sv1Mv)) * 10;
}
