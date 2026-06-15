// ════════════════════════════════════════════════════════════════
// ecg-pathologies.ts — Per-lead segment overrides for 43 rhythms
//
// Each template takes a normalized intensity i ∈ [0,1] and returns
// LeadOverrides — per-lead instructions to drop / replace / scale /
// augment the baseline normal beat (see ecg-model.ts).
//
// Every template now provides explicit overrides for ALL clinically
// affected independent leads (I, II, V1–V6). Dependent leads
// (III, aVR, aVL, aVF) are computed at the math layer as linear
// combinations of I and II, so they derive automatically when I/II
// are correct — but where a dependent lead's clinical appearance
// depends on a specific driving pattern (e.g. PE's S1Q3T3 needs
// III to be net-negative), we tune I and II together so the derived
// lead comes out right.
//
// Templates are designed so that, at the intensity where the
// pathology is "fully expressed", the measured waveform satisfies
// the published diagnostic criteria (validated by ecg-validate.ts)
// in EVERY clinically-relevant lead.
//
// References:
//   - Surawicz & Knilans, Chou's Electrocardiography (2008)
//   - Wagner, Marriott's Practical Electrocardiography (2008)
//   - Thygesen et al., Fourth Universal Definition of MI (2018)
//   - Anter et al., Brugada syndrome diagnostic criteria (2016 Consensus)
//   - Bayés de Luna, Clinical Electrocardiography (2012)
//   - Longo et al., Harrison's Principles of Internal Medicine
// ════════════════════════════════════════════════════════════════

import {
  LeadOverrides,
  pWave, qWave, rWave, sWave, tWave, uWave, jWave, deltaWave, stShift, stElevPlateau,
  WAVE_ANCHORS_MS as A, NORMAL_INTERVALS_MS as NI,
} from './ecg-model';

export type PathologyTemplate = (intensity: number) => LeadOverrides;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Convenience constants for the lead groups used throughout.
const LIMB = ['I', 'II'];
const LATERAL = ['I', 'aVL', 'V5', 'V6'];
const INFERIOR = ['II', 'III', 'aVF'];
const ANTERIOR = ['V1', 'V2', 'V3', 'V4'];
const PRECORDIAL = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
const SEPTAL = ['V1', 'V2'];

// ════════════════════════════════════════════════════════════════
// Normal / rate-driven rhythms
// ════════════════════════════════════════════════════════════════

// ─── Normal Sinus Rhythm ────────────────────────────────────────
export const nsr: PathologyTemplate = () => ({});

// ─── Early Repolarization ───────────────────────────────────────
// Concave ST elevation, J-point notch, tall T — lateral/inferior,
// SPARING V1-V2 (right precordials remain normal). aVR shows
// reciprocal PR elevation (classic differentiator from pericarditis).
export const earlyrepo: PathologyTemplate = (i) => {
  const overrides: LeadOverrides = {};
  const stElev = 0.06 + 0.18 * i;
  const tAmp = 0.30 + 0.25 * i;
  const jAmp = 0.05 + 0.15 * i;
  for (const lead of ['I', 'II', 'V3', 'V4', 'V5', 'V6']) {
    overrides[lead] = {
      add: [
        jWave(A.jPoint + 5, jAmp, 30),
        stElevPlateau(stElev),
      ],
      replace: { t: [tWave(A.tCenter, tAmp, NI.tDuration)] },
    };
  }
  // aVR reciprocal: PR elevation + ST depression (subtle).
  return overrides;
};

// ─── Sinus Tachycardia ──────────────────────────────────────────
// Rate is the feature (handled by bpm). Morphology ≈ NSR with
// slightly taller P (sympathetic tone), shorter QT, flatter T at
// very high rates. Apply uniformly across all leads.
export const st: PathologyTemplate = (i) => {
  const pScale = 1 + 0.3 * i;
  const tScale = 1 - 0.2 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    const baseT = lead === 'V1' ? -0.10 : (lead === 'V4' || lead === 'V3' ? 0.45 : 0.30);
    ov[lead] = {
      replace: {
        p: [pWave(A.pCenter, NI.pAmplitude * pScale, NI.pDuration)],
        t: [tWave(A.tCenter, baseT * tScale, NI.tDuration)],
      },
    };
  }
  return ov;
};

// ─── Sinus Bradycardia ──────────────────────────────────────────
// Rate is the feature. Morphology ≈ NSR with enhanced vagal tone:
// slightly larger P and T from increased diastolic filling.
export const sb: PathologyTemplate = (i) => {
  const pScale = 1 + 0.15 * i;
  const tScale = 1 + 0.2 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    const baseT = lead === 'V1' ? -0.10 : (lead === 'V4' || lead === 'V3' ? 0.45 : 0.30);
    ov[lead] = {
      replace: {
        p: [pWave(A.pCenter, NI.pAmplitude * pScale, NI.pDuration)],
        t: [tWave(A.tCenter, baseT * tScale, NI.tDuration)],
      },
    };
  }
  return ov;
};

// ─── Atrial Fibrillation ────────────────────────────────────────
// No P waves (suppress everywhere); fibrillatory baseline added at
// sequencer. Slight T flattening in all leads.
export const afib: PathologyTemplate = (i) => {
  const tScale = 1 - 0.3 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    const baseT = lead === 'V1' ? -0.08 : (lead === 'V4' ? 0.45 : lead === 'V3' ? 0.40 : 0.28);
    ov[lead] = { suppressP: true, replace: { t: [tWave(A.tCenter, baseT * tScale, NI.tDuration)] } };
  }
  return ov;
};

// ─── Atrial Flutter ─────────────────────────────────────────────
// Sawtooth added at sequencer; suppress P, flatten T in all leads.
export const aflutter: PathologyTemplate = (i) => {
  const tScale = 1 - 0.4 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    const baseT = lead === 'V1' ? -0.05 : 0.15;
    ov[lead] = { suppressP: true, replace: { t: [tWave(A.tCenter, baseT * tScale, NI.tDuration)] } };
  }
  return ov;
};

// ─── SVT ────────────────────────────────────────────────────────
// Narrow complex, fast rate, retrograde P after QRS in inferior
// leads (II, III, aVF — driven by II here).
export const svt: PathologyTemplate = (i) => {
  const retroP = -0.05 - 0.10 * i;
  return {
    II: { replace: { p: [pWave(80, retroP, 60)] } },  // retrograde P after QRS
  };
};

// ─── AV Block 1° ────────────────────────────────────────────────
// Constant prolonged PR across all leads (P pushed earlier so PR
// interval lengthens uniformly).
export const avb1: PathologyTemplate = (i) => {
  const extraPr = 55 + 80 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      replace: { p: [pWave(A.pCenter - extraPr, NI.pAmplitude, NI.pDuration)] },
    };
  }
  return ov;
};

// ─── AV Block 2° Mobitz I (Wenckebach) ──────────────────────────
// Progressive PR lengthening handled at beat sequencer (per-beat P shift).
export const avb2mob1: PathologyTemplate = () => ({});

// ─── AV Block 2° Mobitz II ──────────────────────────────────────
// Constant PR, wide QRS at high intensity, dropped beats at sequencer.
export const avb2mob2: PathologyTemplate = (i) => {
  const halfW = 30 + 30 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    if (lead === 'V1' || lead === 'V2') {
      ov[lead] = { replace: { r: [rWave(A.rCenter, 0.20 + 0.1 * i, halfW * 2)], s: [sWave(A.sCenter, 0.70 + 0.1 * i, halfW * 2)] } };
    } else if (lead === 'V3' || lead === 'V4') {
      ov[lead] = { replace: { r: [rWave(A.rCenter, 0.80 + 0.2 * i, halfW * 2)], s: [sWave(A.sCenter, 0.45, halfW)] } };
    } else {
      const rAmp = lead === 'II' ? 0.90 : (lead === 'V5' ? 1.30 : (lead === 'V6' ? 1.00 : 0.55));
      ov[lead] = { replace: { r: [rWave(A.rCenter, rAmp, halfW * 2)], s: [sWave(A.sCenter, 0.10 + 0.05 * i, halfW)] } };
    }
  }
  return ov;
};

// ─── AV Block 3° (Complete) ─────────────────────────────────────
// Wide escape rhythm across all leads; independent atrial P's at
// sequencer.
export const avb3: PathologyTemplate = (i) => {
  const halfW = 55 + 25 * i;   // 110-160ms half-width → ≥120ms QRS
  const ov: LeadOverrides = {};
  ov.V1 = { replace: { r: [rWave(A.rCenter - 5, 0.25 + 0.1 * i, halfW * 2)], s: [sWave(A.sCenter + 5, 0.60, halfW * 2)], t: [tWave(A.tCenter, -0.20, NI.tDuration)] } };
  ov.V2 = { replace: { r: [rWave(A.rCenter - 5, 0.40 + 0.1 * i, halfW * 2)], s: [sWave(A.sCenter + 5, 0.55, halfW * 2)], t: [tWave(A.tCenter, -0.10, NI.tDuration)] } };
  ov.V3 = { replace: { r: [rWave(A.rCenter - 5, 0.70 + 0.15 * i, halfW * 2)], s: [sWave(A.sCenter + 5, 0.40, halfW * 2)], t: [tWave(A.tCenter, -0.15, NI.tDuration)] } };
  ov.V4 = { replace: { r: [rWave(A.rCenter - 5, 1.00 + 0.20 * i, halfW * 2)], s: [sWave(A.sCenter + 5, 0.25, halfW)], t: [tWave(A.tCenter, -0.15, NI.tDuration)] } };
  ov.V5 = { replace: { r: [rWave(A.rCenter - 5, 0.80 + 0.2 * i, halfW * 2)], s: [sWave(A.sCenter + 5, 0.15, halfW * 2)], t: [tWave(A.tCenter, -0.15, NI.tDuration)] } };
  ov.V6 = { replace: { r: [rWave(A.rCenter - 5, 0.60 + 0.15 * i, halfW * 2)], s: [sWave(A.sCenter + 5, 0.10, halfW * 2)], t: [tWave(A.tCenter, -0.10, NI.tDuration)] } };
  ov.I  = { replace: { r: [rWave(A.rCenter, 0.50, halfW * 2)], t: [tWave(A.tCenter, -0.10, NI.tDuration)] } };
  ov.II = { replace: { r: [rWave(A.rCenter, 0.70, halfW * 2)], t: [tWave(A.tCenter, -0.10, NI.tDuration)] } };
  return ov;
};

// ─── Ventricular Tachycardia ────────────────────────────────────
// Wide QRS (≥140ms), no P, discordant ST-T across ALL leads.
export const vtach: PathologyTemplate = (i) => {
  const halfW = 50 + 20 * i;   // 100-140ms half-width → ≥140ms QRS
  const rAmp = 0.8 + 1.0 * i;
  return {
    V1: { suppressP: true, replace: { r: [rWave(A.rCenter - 10, rAmp * 0.5, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp, halfW * 2)], t: [tWave(A.tCenter, 0.25 + 0.2 * i, NI.tDuration)] } },
    V2: { suppressP: true, replace: { r: [rWave(A.rCenter - 10, rAmp * 0.7, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.8, halfW * 2)], t: [tWave(A.tCenter, 0.20, NI.tDuration)] } },
    V3: { suppressP: true, replace: { r: [rWave(A.rCenter - 10, rAmp * 1.0, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.4, halfW * 2)], t: [tWave(A.tCenter, -0.20, NI.tDuration)] } },
    V4: { suppressP: true, replace: { r: [rWave(A.rCenter - 10, rAmp * 1.2, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.2, halfW * 2)], t: [tWave(A.tCenter, -0.25, NI.tDuration)] } },
    V5: { suppressP: true, replace: { r: [rWave(A.rCenter - 10, rAmp, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.3, halfW * 2)], t: [tWave(A.tCenter, -0.25 - 0.2 * i, NI.tDuration)] } },
    V6: { suppressP: true, replace: { r: [rWave(A.rCenter - 10, rAmp * 0.8, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.4, halfW * 2)], t: [tWave(A.tCenter, -0.25, NI.tDuration)] } },
    I:  { suppressP: true, replace: { r: [rWave(A.rCenter, rAmp * 0.7, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.2, halfW)], t: [tWave(A.tCenter, -0.20, NI.tDuration)] } },
    II: { suppressP: true, replace: { r: [rWave(A.rCenter, rAmp * 0.9, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.15, halfW)], t: [tWave(A.tCenter, -0.20, NI.tDuration)] } },
  };
};

// ─── Ventricular Fibrillation ───────────────────────────────────
// Pure chaos at sequencer; no segments.
export const vfib: PathologyTemplate = () => ({});

// ─── PVC (Trigeminy) ────────────────────────────────────────────
// Ectopic wide QRS handled at sequencer every 3rd beat. Wide QRS
// with discordant ST-T across all leads.
export const pvc: PathologyTemplate = (i) => {
  const halfW = 55 + 25 * i;
  const rAmp = 1.0 + 1.0 * i;
  return {
    V1: { replace: { r: [rWave(A.rCenter - 10, rAmp * 0.4, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp, halfW * 2)], t: [tWave(A.tCenter, 0.30, NI.tDuration)] } },
    V2: { replace: { r: [rWave(A.rCenter - 10, rAmp * 0.5, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.9, halfW * 2)], t: [tWave(A.tCenter, 0.25, NI.tDuration)] } },
    V3: { replace: { r: [rWave(A.rCenter - 10, rAmp * 0.8, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.5, halfW * 2)], t: [tWave(A.tCenter, -0.15, NI.tDuration)] } },
    V4: { replace: { r: [rWave(A.rCenter - 10, rAmp * 1.0, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.3, halfW * 2)], t: [tWave(A.tCenter, -0.30, NI.tDuration)] } },
    V5: { replace: { r: [rWave(A.rCenter - 10, rAmp, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.2, halfW * 2)], t: [tWave(A.tCenter, -0.40, NI.tDuration)] } },
    V6: { replace: { r: [rWave(A.rCenter - 10, rAmp * 0.9, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.25, halfW * 2)], t: [tWave(A.tCenter, -0.35, NI.tDuration)] } },
    I:  { replace: { r: [rWave(A.rCenter - 10, rAmp * 0.8, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.3, halfW * 2)], t: [tWave(A.tCenter, -0.25, NI.tDuration)] } },
    II: { replace: { r: [rWave(A.rCenter - 10, rAmp * 0.9, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.2, halfW * 2)], t: [tWave(A.tCenter, -0.30, NI.tDuration)] } },
  };
};

// ════════════════════════════════════════════════════════════════
// Conduction blocks
// ════════════════════════════════════════════════════════════════

// ─── LBBB ───────────────────────────────────────────────────────
// QRS ≥ 120 ms, broad notched R in I/V5/V6, deep QS/rS in V1-V2,
// no septal Q, ST/T discordance in EVERY lead (rule of appropriate
// discordance: T points away from the dominant QRS vector).
export const lbbb: PathologyTemplate = (i) => {
  const qrsHalfWidth = 30 + 30 * i;
  const notchOffset = 30 + 15 * i;
  const lateralRAmp = 0.9 + 0.5 * i;
  const ov: LeadOverrides = {};
  // Lateral leads (I, V5, V6): broad notched R, no septal Q, T inverted, ST depressed.
  // I depresses more strongly so derived aVL = I - 0.5·II reads clearly depressed.
  for (const lead of ['I', 'V5', 'V6']) {
    const stDep = lead === 'I' ? -0.25 - 0.15 * i : -0.15 - 0.15 * i;
    ov[lead] = {
      drop: ['q'],
      replace: {
        r: [
          rWave(A.rCenter - notchOffset, lateralRAmp * 0.7, qrsHalfWidth * 2),
          rWave(A.rCenter + notchOffset, lateralRAmp,        qrsHalfWidth * 2),
        ],
        s: [],
        t: [tWave(A.tCenter, -0.25 - 0.15 * i, NI.tDuration)],
        st: [stElevPlateau(stDep)],
      },
    };
  }
  // II: broad positive R (less tall than lateral but still wide), T inverted.
  // Stronger depression so derived aVF = II - 0.5·I reads clearly depressed.
  ov.II = {
    drop: ['q'],
    replace: {
      r: [
        rWave(A.rCenter - notchOffset * 0.7, lateralRAmp * 0.6, qrsHalfWidth * 2),
        rWave(A.rCenter + notchOffset * 0.7, lateralRAmp * 0.85, qrsHalfWidth * 2),
      ],
      s: [],
      t: [tWave(A.tCenter, -0.20 - 0.10 * i, NI.tDuration)],
      st: [stElevPlateau(-0.30 - 0.20 * i)],
    },
  };
  // V1: deep QS or rS, ST elevation, T upright (discordant).
  ov.V1 = {
    drop: ['r'],
    replace: {
      s: [sWave(A.sCenter, 1.0 + 0.5 * i, qrsHalfWidth * 2)],
      t: [tWave(A.tCenter, 0.30 + 0.15 * i, NI.tDuration)],
      st: [stElevPlateau(0.10 + 0.10 * i)],
    },
  };
  ov.V2 = {
    replace: {
      s: [sWave(A.sCenter, 1.2 + 0.4 * i, qrsHalfWidth * 2)],
      t: [tWave(A.tCenter, 0.30, NI.tDuration)],
      st: [stElevPlateau(0.08)],
    },
  };
  // V3: transition — small R + deep S, ST elevated, T upright.
  ov.V3 = {
    replace: {
      r: [rWave(A.rCenter, 0.30, qrsHalfWidth * 2)],
      s: [sWave(A.sCenter, 1.0 + 0.3 * i, qrsHalfWidth * 2)],
      t: [tWave(A.tCenter, 0.25, NI.tDuration)],
      st: [stElevPlateau(0.06)],
    },
  };
  // V4: intermediate — R becomes dominant, T starts to invert.
  ov.V4 = {
    drop: ['q'],
    replace: {
      r: [
        rWave(A.rCenter - notchOffset * 0.5, 0.55, qrsHalfWidth * 2),
        rWave(A.rCenter + notchOffset * 0.5, 0.85, qrsHalfWidth * 2),
      ],
      s: [sWave(A.sCenter, 0.40, qrsHalfWidth * 2)],
      t: [tWave(A.tCenter, -0.10, NI.tDuration)],
      st: [stElevPlateau(-0.04)],
    },
  };
  return ov;
};

// ─── RBBB ───────────────────────────────────────────────────────
// QRS ≥ 120 ms, rsR' in V1-V2 (R' > r), wide slurred S in I/V5/V6,
// T inversion V1-V2. Wide QRS in ALL leads.
export const rbbb: PathologyTemplate = (i) => {
  const halfW = 40 + 25 * i;   // wider half-width → reliably ≥110 ms QRS
  const ov: LeadOverrides = {};
  // V1/V2: rsR' — small initial r, small S, then tall terminal R'.
  for (const lead of ['V1', 'V2']) {
    ov[lead] = {
      replace: {
        r: [
          rWave(A.rCenter - 35, lead === 'V1' ? 0.25 : 0.35, halfW * 2),
          rWave(A.rCenter + 40, (lead === 'V1' ? 0.70 : 0.60) + 0.5 * i, halfW * 2),
        ],
        s: [sWave(A.sCenter - 5, lead === 'V1' ? 0.20 : 0.30, halfW)],
        t: [tWave(A.tCenter, -0.20 - 0.10 * i, NI.tDuration)],
        st: [stElevPlateau(-0.05 - 0.05 * i)],
      },
    };
  }
  // V3/V4: rsR' less prominent, but terminal R' still visible.
  for (const lead of ['V3', 'V4']) {
    ov[lead] = {
      replace: {
        r: [
          rWave(A.rCenter - 35, 0.55, halfW * 2),
          rWave(A.rCenter + 40, lead === 'V3' ? 0.45 : 0.35, halfW * 2),
        ],
        s: [sWave(A.sCenter - 5, 0.35, halfW)],
      },
    };
  }
  // Lateral leads (I, V5, V6) + II: wide slurred terminal S.
  // T remains upright (RBBB does not invert lateral T) — explicitly
  // boost T amplitude so the wide-S distortion doesn't read as T inversion.
  for (const lead of ['I', 'II', 'V5', 'V6']) {
    const baseT = lead === 'II' ? 0.30 : (lead === 'V5' || lead === 'V6' ? 0.40 : 0.20);
    ov[lead] = {
      replace: {
        s: [sWave(A.sCenter + 30, lead === 'II' ? 0.20 : (0.30 + 0.25 * i), halfW * 2)],
        t: [tWave(A.tCenter, baseT, NI.tDuration)],
      },
    };
  }
  return ov;
};

// ─── WPW ────────────────────────────────────────────────────────
// Short PR (< 120 ms), delta wave (slurred upstroke), wide QRS in
// ALL leads. Type A: delta positive in V1 (left-sided pathway).
// The delta wave's broad ramp (90 ms wide) extends the QRS onset
// earlier so the measured QRS duration is ≥ 120 ms.
export const wpw: PathologyTemplate = (i) => {
  const prShift = 60 + 40 * i;
  const deltaAmp = 0.10 + 0.25 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      replace: { p: [pWave(A.pCenter + prShift, NI.pAmplitude, NI.pDuration)] },
      add: [deltaWave(A.rCenter - 45, deltaAmp, 90)],
    };
  }
  return ov;
};

// ─── Long QT ────────────────────────────────────────────────────
// QTc > 440 ms (prolonged). Widened T wave + prominent U in ALL
// leads.
export const longqt: PathologyTemplate = (i) => {
  const tScale = 1.5 + 1.2 * i;
  const uAmp = 0.05 + 0.15 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    const baseT = lead === 'V1' ? -0.10 : (lead === 'V4' ? 0.50 : 0.30);
    ov[lead] = {
      replace: {
        t: [tWave(A.tCenter + 40 * i, baseT, NI.tDuration * tScale)],
        u: [uWave(A.uCenter + 50 * i, uAmp, NI.uDuration)],
      },
    };
  }
  return ov;
};

// ─── Brugada ────────────────────────────────────────────────────
// Type 1 (coved): ST ≥ 2 mm in V1/V2, descending to negative T.
// Other leads remain normal — Brugada is RIGHT-precordial specific.
export const brugada: PathologyTemplate = (i) => {
  const stElev = 0.30 + 0.30 * i;
  const isCoved = i >= 0.45;
  const tAmp = isCoved ? -0.45 - 0.20 * i : 0.10;
  const ov: LeadOverrides = {};
  for (const lead of ['V1', 'V2']) {
    ov[lead] = {
      replace: {
        r: [rWave(A.rCenter - 10, 0.30, 50)],
        s: [],
        st: [stElevPlateau(stElev, 10, 100)],
        t: [tWave(A.tCenter + 30, tAmp, NI.tDuration * 1.3)],
      },
    };
  }
  // V3 can show subtle ST elevation (extension) — intensity-dependent.
  // At i >= 0.6, V3 shows Brugada extension with coved morphology.
  if (i >= 0.6) {
    ov.V3 = {
      add: [stElevPlateau(0.15 + 0.15 * Math.min(1, (i - 0.6) * 3), 10, 100)],
      replace: {
        r: [rWave(A.rCenter - 10, 0.35, 50)],
        s: [],
        t: [tWave(A.tCenter + 30, -0.10 - 0.10 * Math.min(1, (i - 0.6) * 3), NI.tDuration * 1.2)],
      },
    };
  } else if (i >= 0.3) {
    ov.V3 = { add: [stElevPlateau(0.05 + 0.05 * i, 10, 80)] };
  }
  return ov;
};

// ════════════════════════════════════════════════════════════════
// Metabolic / electrolyte
// ════════════════════════════════════════════════════════════════

// ─── Hyperkalemia ───────────────────────────────────────────────
// Tall narrow peaked T, P flattens then disappears, QRS widens.
// Diffuse — affects all leads.
export const hyperk: PathologyTemplate = (i) => {
  const tAmp = 0.50 + 0.50 * i;
  const tDur = lerp(160, 90, clamp(i * 2, 0, 1));
  const pScale = clamp(1 - i * 2.2, 0, 1);
  const halfW = 30 + clamp((i - 0.3) * 2, 0, 1) * 45;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    // V1 normally has inverted T; in hyperkalemia it can become
    // upright (loss of normal T inversion) — but the diagnostic
    // tall-peaked-T is in lateral/anterior leads. Keep V1 T small.
    const leadTAmp = lead === 'V1' ? Math.min(tAmp, 0.20) : tAmp;
    const leadRAmp = (lead === 'V4' || lead === 'V5') ? 1.5 : (lead === 'V1' ? 0.20 : 1.0);
    ov[lead] = {
      suppressP: pScale < 0.05,
      replace: {
        t: [tWave(A.tCenter, leadTAmp, tDur)],
        r: [rWave(A.rCenter, leadRAmp, halfW * 2)],
      },
    };
    if (pScale > 0.05) {
      ov[lead].replace!.p = [pWave(A.pCenter, NI.pAmplitude * pScale, NI.pDuration)];
    }
  }
  return ov;
};

// ─── Hypokalemia ────────────────────────────────────────────────
// Flat T, ST depression, prominent U wave, T-U fusion at high
// severity. Diffuse — all leads. Stronger depression on I (vs II)
// so derived aVL = I - 0.5·II reads depressed.
export const hypokalemia: PathologyTemplate = (i) => {
  const tScale = clamp(1 - i * 1.8, 0.1, 1);
  const uAmp = 0.05 + 0.30 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    const baseT = lead === 'V1' ? -0.08 : 0.18;
    // II depressed more strongly so derived aVF = II - 0.5·I reads depressed.
    const stDep = lead === 'I' ? -0.15 - 0.15 * i : (lead === 'II' ? -0.20 - 0.15 * i : -0.08 - 0.10 * i);
    ov[lead] = {
      replace: {
        t: [tWave(A.tCenter, baseT * tScale, NI.tDuration)],
        u: [uWave(A.uCenter + 30 * i, uAmp, NI.uDuration)],
      },
      add: [stElevPlateau(stDep)],
    };
  }
  return ov;
};

// ─── Hypothermia ────────────────────────────────────────────────
// Osborn J waves at J point (all leads except aVR), bradycardia,
// prolonged intervals. Diffuse.
export const hypothermia: PathologyTemplate = (i) => {
  const jAmp = 0.10 + 0.40 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      add: [
        jWave(A.jPoint + 30, jAmp, 90 + 40 * i),
        stElevPlateau(0.08 + 0.18 * i, 20, 180),
      ],
    };
  }
  return ov;
};

// ════════════════════════════════════════════════════════════════
// Ischemia / infarction
// ════════════════════════════════════════════════════════════════

// ─── STEMI helpers ──────────────────────────────────────────────

interface StemiConfig {
  culpritLeads: string[];
  reciprocalLeads: string[];
}

function stemiTemplate(cfg: StemiConfig, i: number, tHyperBoost = 0.40): LeadOverrides {
  const ov: LeadOverrides = {};
  const isHyperacute = i <= 0.30;
  const isEvolved = i > 0.70;
  const stElev = 0.22 + 0.50 * i;
  const stDep = -0.40 - 0.70 * i;

  for (const lead of cfg.culpritLeads) {
    if (isHyperacute) {
      ov[lead] = {
        replace: {
          t: [tWave(A.tCenter, 0.55 + tHyperBoost, NI.tDuration * 1.1)],
          st: [stElevPlateau(0.12 + 0.06 * i)],
        },
      };
    } else if (isEvolved) {
      ov[lead] = {
        drop: ['r'],
        replace: {
          q: [qWave(A.qCenter, 0.40, 60)],
          t: [tWave(A.tCenter, -0.35, NI.tDuration)],
          st: [stElevPlateau(0.05)],
        },
      };
    } else {
      ov[lead] = {
        replace: {
          st: [stElevPlateau(stElev)],
          t: [tWave(A.tCenter, stElev * 0.7, NI.tDuration * 0.9)],
        },
      };
    }
  }
  for (const lead of cfg.reciprocalLeads) {
    if (isHyperacute) {
      ov[lead] = { add: [stElevPlateau(-0.10 - 0.08 * i)] };
    } else if (isEvolved) {
      ov[lead] = { replace: { t: [tWave(A.tCenter, 0.20, NI.tDuration)] } };
    } else {
      ov[lead] = { replace: { st: [stElevPlateau(stDep)] } };
    }
  }
  return ov;
}

export const stemi_ant:    PathologyTemplate = (i) => stemiTemplate({ culpritLeads: ['V1','V2','V3','V4'],         reciprocalLeads: ['II','III','aVF'] }, i);
export const stemi_inf:    PathologyTemplate = (i) => stemiTemplate({ culpritLeads: ['II','III','aVF'],            reciprocalLeads: ['I','aVL']        }, i);
export const stemi_lat:    PathologyTemplate = (i) => stemiTemplate({ culpritLeads: ['I','aVL','V5','V6'],         reciprocalLeads: ['II','III','aVF'] }, i);
export const stemi_antlat: PathologyTemplate = (i) => stemiTemplate({ culpritLeads: ['V1','V2','V3','V4','V5','V6','I','aVL'], reciprocalLeads: ['II','III','aVF'] }, i);
export const stemi_inflat: PathologyTemplate = (i) => stemiTemplate({ culpritLeads: ['II','III','aVF','V5','V6'],  reciprocalLeads: ['I','aVL','V1','V2'] }, i);
export const stemi_rv:     PathologyTemplate = (i) => stemiTemplate({ culpritLeads: ['V1','V2'],                   reciprocalLeads: ['I','aVL','V5','V6'] }, i);

// ─── Posterior Wall MI ──────────────────────────────────────────
// Mirror image in V1-V3: ST depression, tall R, upright T. Other
// leads often normal or with concurrent inferior MI. V3 has taller
// baseline R so its R-wave must be reduced AND depression amplified
// for the ST to read depressed.
export const pwmi: PathologyTemplate = (i) => {
  const rAmp = 0.45 + 0.55 * i;
  const ov: LeadOverrides = {};
  ov.V1 = {
    replace: {
      r: [rWave(A.rCenter, rAmp, 80)],
      s: [sWave(A.sCenter, 0.10, 50)],
      t: [tWave(A.tCenter, 0.45 + 0.30 * i, NI.tDuration)],
      st: [stElevPlateau(-0.25 - 0.30 * i, 20, 130)],
    },
  };
  ov.V2 = {
    replace: {
      r: [rWave(A.rCenter, rAmp * 0.9, 80)],
      s: [sWave(A.sCenter, 0.20, 50)],
      t: [tWave(A.tCenter, 0.40 + 0.25 * i, NI.tDuration)],
      st: [stElevPlateau(-0.30 - 0.30 * i, 20, 130)],
    },
  };
  ov.V3 = {
    replace: {
      r: [rWave(A.rCenter, rAmp * 0.8, 80)],
      s: [sWave(A.sCenter, 0.30, 50)],
      t: [tWave(A.tCenter, 0.35 + 0.20 * i, NI.tDuration)],
      st: [stElevPlateau(-0.35 - 0.30 * i, 20, 130)],
    },
  };
  return ov;
};

// ─── Acute Pericarditis ─────────────────────────────────────────
// Diffuse concave ST elevation (all leads EXCEPT aVR), PR depression
// (most leads), aVR shows PR elevation + ST depression.
export const pericarditis: PathologyTemplate = (i) => {
  const stElev = 0.15 + 0.15 * i;
  const prDep = -0.05 - 0.10 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      add: [
        stElevPlateau(stElev),
        stShift(A.pCenter + 30, prDep, 80),  // PR depression
      ],
    };
  }
  // V1 typically shows ST depression (reciprocal to lateral) + PR elevation.
  ov.V1 = {
    add: [
      stElevPlateau(-0.08 - 0.08 * i),  // slight ST depression
      stShift(A.pCenter + 30, 0.03 + 0.05 * i, 80),  // PR elevation (reciprocal)
    ],
  };
  return ov;
};

// ─── Digoxin Effect ─────────────────────────────────────────────
// Sagging ("reverse tick") ST depression, flat/inverted T, short QT.
// Diffuse — affects lateral and anterior leads most prominently.
// Stronger depression on I (vs II) so derived aVL = I - 0.5·II reads
// depressed after the linear transform.
export const digoxin: PathologyTemplate = (i) => {
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    const baseT = lead === 'V1' ? -0.08 : (lead === 'V4' ? 0.45 : 0.30);
    // Stronger depression on I AND II so derived aVL and aVF both depress.
    const stDep = (lead === 'I' || lead === 'II') ? -0.50 - 0.30 * i : -0.30 - 0.25 * i;
    ov[lead] = {
      replace: { t: [tWave(A.tCenter, lerp(baseT, -0.05, i), NI.tDuration * 0.9)] },
      add: [stElevPlateau(stDep, 10, 160)],
    };
  }
  return ov;
};

// ─── Wellens Syndrome ───────────────────────────────────────────
// Deep/biphasic T inversion in V2-V3, preserved R waves, pain-free.
// Other leads normal.
export const wellens: PathologyTemplate = (i) => {
  const isTypeB = i > 0.35;
  const ov: LeadOverrides = {};
  for (const lead of ['V2', 'V3']) {
    if (isTypeB) {
      ov[lead] = {
        replace: { t: [tWave(A.tCenter, -0.35 - 0.30 * i, NI.tDuration * 1.2)] },
      };
    } else {
      ov[lead] = {
        replace: {
          t: [
            tWave(A.tCenter - 50, 0.20, 70),
            tWave(A.tCenter + 30, -0.30 - 0.20 * i, 100),
          ],
        },
      };
    }
  }
  // V1 and V4 may show milder T inversion (extension).
  ov.V1 = { replace: { t: [tWave(A.tCenter, -0.10 - 0.10 * i, NI.tDuration)] } };
  ov.V4 = { replace: { t: [tWave(A.tCenter, -0.10 - 0.10 * i, NI.tDuration)] } };
  ov.V5 = { replace: { t: [tWave(A.tCenter, -0.05 - 0.05 * i, NI.tDuration)] } };
  return ov;
};

// ─── De Winter T Waves ──────────────────────────────────────────
// Upsloping ST depression + tall symmetric T in precordials
// (LAD-occlusion equivalent). Limb leads may show subtle changes.
export const dewinter: PathologyTemplate = (i) => {
  const stDep = -0.25 - 0.25 * i;
  const tAmp = 0.40 + 0.40 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      replace: { t: [tWave(A.tCenter, tAmp, NI.tDuration * 0.9)] },
      add: [stElevPlateau(stDep)],
    };
  }
  // Limb leads for derived lead consistency (III, aVR, aVL, aVF).
  ov.I = { replace: { t: [tWave(A.tCenter, 0.30 + 0.20 * i, NI.tDuration * 0.9)] }, add: [stElevPlateau(-0.10 - 0.10 * i)] };
  ov.II = { replace: { t: [tWave(A.tCenter, 0.30 + 0.20 * i, NI.tDuration * 0.9)] }, add: [stElevPlateau(-0.10 - 0.10 * i)] };
  return ov;
};

// ─── Pulmonary Embolism ─────────────────────────────────────────
// Sinus tachy, S1Q3T3 (S in I, Q in III, T inversion in III),
// right-axis, anterior T inversion (V1-V3). Drive I (S1) and II
// (so III = II - I gets a small R + deep S/Q3 + T3 inversion).
// II itself is NOT inverted — only III (and sometimes aVF).
export const pe: PathologyTemplate = (i) => {
  const ov: LeadOverrides = {};
  // S1: rS in I — small r, deep S.
  ov.I = {
    replace: {
      r: [rWave(A.rCenter, 0.20 + 0.10 * i, 60)],
      s: [sWave(A.sCenter + 10, 0.45 + 0.30 * i, 70)],
    }
  };
  // II: qR pattern, small T — so III = II - I creates Q3 + T3.
  ov.II = {
    replace: {
      q: [qWave(A.qCenter, 0.08 + 0.04 * i, 30)],
      r: [rWave(A.rCenter, 0.65 + 0.15 * i, 70)],
      s: [sWave(A.sCenter, 0.15 + 0.10 * i, 50)],
      t: [tWave(A.tCenter, 0.04, NI.tDuration)],
    },
  };
  // Anterior T inversion (RV strain) — V1-V3.
  for (const lead of ['V1', 'V2', 'V3']) {
    ov[lead] = { replace: { t: [tWave(A.tCenter, -0.10 - 0.25 * i, NI.tDuration)] } };
  }
  // V4 may show subtle T flattening at high intensity.
  ov.V4 = { replace: { t: [tWave(A.tCenter, 0.05 - 0.10 * i, NI.tDuration)] } };
  return ov;
};

// ════════════════════════════════════════════════════════════════
// Hypertrophy / enlargement
// ════════════════════════════════════════════════════════════════

// ─── LVH ────────────────────────────────────────────────────────
// Sokolov-Lyon: SV1 + RV5 > 35 mm. Lateral strain ST/T (I, aVL,
// V5, V6). Deep S in V1-V3, tall R in V4-V6.
export const lvh: PathologyTemplate = (i) => {
  const rScale = 1.5 + 1.0 * i;
  const sScaleV1 = 1.5 + 1.5 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'V5', 'V6']) {
    const baseT = lead === 'I' ? 0.20 : 0.40;
    ov[lead] = {
      amplitudeScale: rScale,
      add: [stElevPlateau(-0.05 - 0.15 * i)],
      replace: { t: [tWave(A.tCenter, lerp(baseT, -0.25, i), NI.tDuration)] },
    };
  }
  ov.V1 = { replace: { s: [sWave(A.sCenter, 0.80 * sScaleV1, 80)] } };
  ov.V2 = { replace: { s: [sWave(A.sCenter, 1.10 * sScaleV1 * 0.9, 80)] } };
  ov.V3 = { replace: { r: [rWave(A.rCenter, 0.80 * rScale, 80)], s: [sWave(A.sCenter, 0.90 * sScaleV1 * 0.6, 80)] } };
  ov.V4 = { replace: { r: [rWave(A.rCenter, 1.30 * rScale, 80)], s: [sWave(A.sCenter, 0.30, 60)] } };
  return ov;
};

// ─── RVH ────────────────────────────────────────────────────────
// R/S ratio in V1 > 1, right-axis, RV strain (T inversion V1-V3,
// ST depression). Deep S in lateral leads (I, V5, V6).
export const rvh: PathologyTemplate = (i) => {
  const ov: LeadOverrides = {};
  ov.V1 = {
    replace: {
      r: [rWave(A.rCenter, 0.50 + 0.50 * i, 70)],
      s: [sWave(A.sCenter, 0.30 - 0.20 * i, 60)],
      t: [tWave(A.tCenter, -0.10 - 0.20 * i, NI.tDuration)],
    },
    add: [stElevPlateau(-0.05 - 0.10 * i)],
  };
  ov.V2 = {
    replace: {
      r: [rWave(A.rCenter, 0.40 + 0.30 * i, 70)],
      s: [sWave(A.sCenter, 0.80 - 0.20 * i, 70)],
      t: [tWave(A.tCenter, -0.05 - 0.15 * i, NI.tDuration)],
    },
  };
  ov.V3 = {
    replace: {
      r: [rWave(A.rCenter, 0.60 + 0.20 * i, 70)],
      s: [sWave(A.sCenter, 0.60, 70)],
    },
  };
  ov.V4 = {
    replace: {
      r: [rWave(A.rCenter, 0.80 + 0.20 * i, 70)],
      s: [sWave(A.sCenter, 0.50, 70)],
    },
  };
  for (const lead of ['I', 'V5', 'V6']) {
    ov[lead] = {
      replace: { s: [sWave(A.sCenter + 10, 0.30 + 0.30 * i, 70)] },
    };
  }
  // II retains normal R (right-axis pulls inferior R tall).
  ov.II = { replace: { r: [rWave(A.rCenter, 1.10 + 0.20 * i, 80)] } };
  return ov;
};

// ─── Biventricular Enlargement ──────────────────────────────────
// Combined LVH + RVH voltage features.
export const bve: PathologyTemplate = (i) => {
  const ov: LeadOverrides = {};
  ov.V1 = {
    replace: {
      r: [rWave(A.rCenter, 0.80 + 0.40 * i, 70)],
      s: [sWave(A.sCenter, 0.60, 70)],
    },
  };
  ov.V2 = { replace: { r: [rWave(A.rCenter, 0.70 + 0.30 * i, 70)], s: [sWave(A.sCenter, 1.10, 80)] } };
  ov.V3 = { replace: { r: [rWave(A.rCenter, 1.10 + 0.30 * i, 80)], s: [sWave(A.sCenter, 0.70, 80)] } };
  ov.V4 = { replace: { r: [rWave(A.rCenter, 1.60 + 0.40 * i, 80)] } };
  ov.V5 = { replace: { r: [rWave(A.rCenter, 2.0 + 0.8 * i, 80)], s: [sWave(A.sCenter, 0.40, 60)] }, add: [stElevPlateau(-0.10 - 0.10 * i)] };
  ov.V6 = { replace: { r: [rWave(A.rCenter, 1.5 + 0.6 * i, 80)], s: [sWave(A.sCenter, 0.30, 60)] } };
  ov.I = { replace: { r: [rWave(A.rCenter, 1.2 + 0.5 * i, 80)] } };
  ov.II = { replace: { r: [rWave(A.rCenter, 1.40 + 0.4 * i, 80)] } };
  return ov;
};

// ─── Left Atrial Enlargement (P mitrale) ────────────────────────
// Broad notched P in II (≥ 120 ms), terminal negative P in V1.
export const lah: PathologyTemplate = (i) => {
  const pDur = 170 + 40 * i;
  const pAmp = 0.15 + 0.05 * i;
  const half = pDur * 0.5;
  const separation = 25 + 10 * i;
  const pCenter = A.pCenter + 30;
  const ov: LeadOverrides = {};
  // All limb leads show broad notched P (P mitrale); V1 shows
  // terminal negative P component (P-terminal force).
  ov.I = { replace: { p: [pWave(pCenter - separation, pAmp, half), pWave(pCenter + separation, pAmp, half)] } };
  ov.II = { replace: { p: [pWave(pCenter - separation, pAmp, half), pWave(pCenter + separation, pAmp, half)] } };
  ov.V1 = {
    replace: {
      p: [
        pWave(pCenter - 5, 0.05, 40),
        pWave(pCenter + 30, -0.08 - 0.08 * i, 50),
      ],
    },
  };
  // Lateral precordials also show broad notched P.
  for (const lead of ['V5', 'V6']) {
    ov[lead] = { replace: { p: [pWave(pCenter - separation, pAmp, half), pWave(pCenter + separation, pAmp, half)] } };
  }
  return ov;
};

// ─── Right Atrial Enlargement (P pulmonale) ────────────────────
// Tall peaked P in II (> 2.5 mm), peaked P in V1-V2.
export const rah: PathologyTemplate = (i) => {
  const pAmp = 0.30 + 0.20 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V5', 'V6']) {
    ov[lead] = { replace: { p: [pWave(A.pCenter, lead === 'II' ? pAmp : pAmp * 0.6, 90)] } };
  }
  // P pulmonale: tall peaked P in right-precordial leads.
  // V1/V2 show prominent initial P deflection (right atrial component).
  // Amplitude set to reach ≥0.20 mV at i≥0.3 for validation.
  ov.V1 = { replace: { p: [pWave(A.pCenter, 0.20 + 0.15 * i, 70)] } };
  ov.V2 = { replace: { p: [pWave(A.pCenter, 0.18 + 0.12 * i, 70)] } };
  ov.V3 = { replace: { p: [pWave(A.pCenter, 0.10 + 0.06 * i, 70)] } };
  return ov;
};

// ─── LAFB ───────────────────────────────────────────────────────
// Left axis deviation: qR in I/aVL, rS in II/III/aVF. QRS slightly
// widened but <120ms. Drive I (qR) and II (rS) — III/aVL derive.
export const lafb: PathologyTemplate = (i) => {
  const ov: LeadOverrides = {};
  ov.I = { replace: { r: [rWave(A.rCenter, 0.80 + 0.30 * i, 80)], s: [] } };
  ov.II = {
    replace: {
      r: [rWave(A.rCenter, 0.20 - 0.10 * i, 50)],
      s: [sWave(A.sCenter + 10, 0.40 + 0.30 * i, 70)],
    },
  };
  // Precordials: relatively normal but with left-axis shift (taller
  // R in lateral, deeper S in septal).
  ov.V1 = { replace: { s: [sWave(A.sCenter, 0.90 + 0.10 * i, 80)] } };
  ov.V2 = { replace: { s: [sWave(A.sCenter, 1.20, 80)] } };
  ov.V3 = { replace: { r: [rWave(A.rCenter, 0.90, 80)], s: [sWave(A.sCenter, 0.90, 80)] } };
  ov.V4 = { replace: { r: [rWave(A.rCenter, 1.40, 80)] } };
  ov.V5 = { replace: { r: [rWave(A.rCenter, 1.50, 80)] } };
  ov.V6 = { replace: { r: [rWave(A.rCenter, 1.20, 80)] } };
  return ov;
};

// ─── LPFB ───────────────────────────────────────────────────────
// Right axis deviation: rS in I/aVL, qR in II/III/aVF.
export const lpfb: PathologyTemplate = (i) => {
  const ov: LeadOverrides = {};
  ov.I = {
    replace: {
      r: [rWave(A.rCenter, 0.20 - 0.10 * i, 50)],
      s: [sWave(A.sCenter + 10, 0.40 + 0.30 * i, 70)],
    },
  };
  ov.II = { replace: { r: [rWave(A.rCenter, 0.80 + 0.30 * i, 80)], s: [] } };
  ov.V1 = { replace: { r: [rWave(A.rCenter, 0.40 + 0.10 * i, 70)], s: [sWave(A.sCenter, 0.50, 70)] } };
  ov.V2 = { replace: { r: [rWave(A.rCenter, 0.60, 70)], s: [sWave(A.sCenter, 0.80, 80)] } };
  ov.V3 = { replace: { r: [rWave(A.rCenter, 0.90, 80)], s: [sWave(A.sCenter, 0.70, 80)] } };
  ov.V4 = { replace: { r: [rWave(A.rCenter, 1.20, 80)] } };
  ov.V5 = { replace: { r: [rWave(A.rCenter, 1.20, 80)], s: [sWave(A.sCenter, 0.40, 60)] } };
  ov.V6 = { replace: { r: [rWave(A.rCenter, 1.00, 80)], s: [sWave(A.sCenter, 0.30, 60)] } };
  return ov;
};

// ════════════════════════════════════════════════════════════════
// Cardiac arrest
// ════════════════════════════════════════════════════════════════

// ─── PEA / Asystole ─────────────────────────────────────────────
// Near-flatline; handled at sequencer (low-amplitude noise).
export const pea: PathologyTemplate = (i) => ({
  V1: { amplitudeScale: 0.4 - 0.35 * i, suppressP: true },
  V5: { amplitudeScale: 0.4 - 0.35 * i, suppressP: true },
  I:  { amplitudeScale: 0.4 - 0.35 * i, suppressP: true },
  II: { amplitudeScale: 0.4 - 0.35 * i, suppressP: true },
});

export const asystole: PathologyTemplate = () => ({
  V1: { amplitudeScale: 0.0, suppressP: true },
  V5: { amplitudeScale: 0.0, suppressP: true },
  I:  { amplitudeScale: 0.0, suppressP: true },
  II: { amplitudeScale: 0.0, suppressP: true },
});

// ════════════════════════════════════════════════════════════════
// Registry
// ════════════════════════════════════════════════════════════════

export const PATHOLOGY_TEMPLATES: Record<string, PathologyTemplate> = {
  nsr,
  earlyrepo,
  st,
  sb,
  afib,
  aflutter,
  svt,
  avb1,
  avb2mob1,
  avb2mob2,
  avb3,
  vtach,
  vfib,
  pvc,
  lbbb,
  rbbb,
  wpw,
  longqt,
  brugada,
  hyperk,
  hypokalemia,
  hypothermia,
  stemi_ant,
  stemi_inf,
  stemi_lat,
  stemi_antlat,
  stemi_inflat,
  stemi_rv,
  pwmi,
  pericarditis,
  digoxin,
  wellens,
  dewinter,
  pe,
  lvh,
  rvh,
  bve,
  lah,
  rah,
  lafb,
  lpfb,
  pea,
  asystole,
};

export function getTemplate(rhythmId: string): PathologyTemplate {
  return PATHOLOGY_TEMPLATES[rhythmId] || nsr;
}
