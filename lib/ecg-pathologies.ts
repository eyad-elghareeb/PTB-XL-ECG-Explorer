// ════════════════════════════════════════════════════════════════
// ecg-pathologies.ts — Per-lead segment overrides for 36 rhythms
//
// Each template takes a normalized intensity i ∈ [0,1] and returns
// LeadOverrides — per-lead instructions to drop / replace / scale /
// augment the baseline normal beat (see ecg-model.ts).
//
// Templates are designed so that, at the intensity where the
// pathology is "fully expressed", the measured waveform satisfies
// the published diagnostic criteria (validated by ecg-validate.ts).
//
// References:
//   - Surawicz & Knilans, Chou's Electrocardiography (2008)
//   - Wagner, Marriott's Practical Electrocardiography (2008)
//   - Thygesen et al., Fourth Universal Definition of MI (2018)
//   - Anter et al., Brugada syndrome diagnostic criteria (2016 Consensus)
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

// ─── Normal Sinus Rhythm ────────────────────────────────────────
export const nsr: PathologyTemplate = () => ({});

// ─── Early Repolarization ───────────────────────────────────────
// Concave ST elevation, J-point notch, tall T — lateral/inferior.
export const earlyrepo: PathologyTemplate = (i) => {
  const overrides: LeadOverrides = {};
  const stElev = 0.06 + 0.18 * i;
  const tAmp = 0.30 + 0.25 * i;
  const jAmp = 0.05 + 0.15 * i;
  for (const lead of ['I', 'II', 'III', 'aVF', 'V4', 'V5', 'V6']) {
    overrides[lead] = {
      add: [
        jWave(A.jPoint + 5, jAmp, 30),
        stElevPlateau(stElev),
      ],
      replace: { t: [tWave(A.tCenter, tAmp, NI.tDuration)] },
    };
  }
  return overrides;
};

// ─── Sinus Tachycardia ──────────────────────────────────────────
// Rate handled by bpm; morphology = slightly taller P, shorter QT.
export const st: PathologyTemplate = (i) => {
  const pScale = 1 + 0.3 * i;
  const tScale = 1 - 0.2 * i;
  return {
    I:  { replace: { p: [pWave(A.pCenter, NI.pAmplitude * pScale, NI.pDuration)], t: [tWave(A.tCenter, 0.20 * tScale, NI.tDuration)] } },
    II: { replace: { p: [pWave(A.pCenter, NI.pAmplitude * pScale, NI.pDuration)], t: [tWave(A.tCenter, 0.30 * tScale, NI.tDuration)] } },
    V5: { replace: { p: [pWave(A.pCenter, NI.pAmplitude * pScale, NI.pDuration)] } },
  };
};

// ─── Sinus Bradycardia ──────────────────────────────────────────
export const sb: PathologyTemplate = (i) => {
  const pScale = 1 + 0.15 * i;
  const tScale = 1 + 0.2 * i;
  return {
    I:  { replace: { p: [pWave(A.pCenter, NI.pAmplitude * pScale, NI.pDuration)], t: [tWave(A.tCenter, 0.22 * tScale, NI.tDuration)] } },
    II: { replace: { p: [pWave(A.pCenter, NI.pAmplitude * pScale, NI.pDuration)], t: [tWave(A.tCenter, 0.32 * tScale, NI.tDuration)] } },
  };
};

// ─── Atrial Fibrillation ────────────────────────────────────────
// No P waves (handled at beat sequencer); slight T flattening.
export const afib: PathologyTemplate = (i) => {
  const tScale = 1 - 0.3 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V5', 'V6']) {
    ov[lead] = { suppressP: true, replace: { t: [tWave(A.tCenter, (lead === 'II' ? 0.30 : 0.20) * tScale, NI.tDuration)] } };
  }
  for (const lead of ['III', 'aVF', 'V4']) {
    ov[lead] = { suppressP: true, replace: { t: [tWave(A.tCenter, 0.25 * tScale, NI.tDuration)] } };
  }
  return ov;
};

// ─── Atrial Flutter ─────────────────────────────────────────────
// Sawtooth added at beat sequencer; suppress P, flatten T.
export const aflutter: PathologyTemplate = (i) => {
  const tScale = 1 - 0.4 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'III', 'aVF', 'V4', 'V5', 'V6']) {
    ov[lead] = { suppressP: true, replace: { t: [tWave(A.tCenter, 0.15 * tScale, NI.tDuration)] } };
  }
  return ov;
};

// ─── SVT ────────────────────────────────────────────────────────
// Narrow complex, fast rate, retrograde P after QRS.
export const svt: PathologyTemplate = (i) => {
  const retroP = -0.05 - 0.10 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['II', 'III', 'aVF']) {
    ov[lead] = {
      replace: { p: [pWave(80, retroP, 60)] }, // retrograde P just after QRS
    };
  }
  return ov;
};

// ─── AV Block 1° ────────────────────────────────────────────────
// Constant prolonged PR (P pushed earlier so PR interval lengthens).
// Baseline PR ≈ 160 ms; we shift P earlier so the lowest intensity
// (i=0.30) still measures ≥ 200 ms (the diagnostic threshold).
export const avb1: PathologyTemplate = (i) => {
  // At i=0.30 we need PR ≥ 200 → extraPr must clear baseline PR gap.
  // Bumped by 10 ms over previous attempt.
  const extraPr = 55 + 80 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'III', 'aVF', 'V1', 'V5']) {
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
  return {
    I:  { replace: { r: [rWave(A.rCenter, 0.55, halfW * 2)], s: [sWave(A.sCenter, 0.10, halfW)] } },
    II: { replace: { r: [rWave(A.rCenter, 0.90, halfW * 2)], s: [sWave(A.sCenter, 0.15, halfW)] } },
    V1: { replace: { r: [rWave(A.rCenter, 0.20, halfW * 2)], s: [sWave(A.sCenter, 0.70, halfW * 2)] } },
    V5: { replace: { r: [rWave(A.rCenter, 1.30, halfW * 2)], s: [sWave(A.sCenter, 0.20, halfW)] } },
  };
};

// ─── AV Block 3° (Complete) ─────────────────────────────────────
// Wide escape rhythm; independent atrial P's at sequencer.
export const avb3: PathologyTemplate = (i) => {
  const halfW = 35 + 25 * i;
  return {
    V1: {
      replace: {
        r: [rWave(A.rCenter - 5, 0.25 + 0.1 * i, halfW * 2)],
        s: [sWave(A.sCenter + 5, 0.60, halfW * 2)],
        t: [tWave(A.tCenter, -0.20, NI.tDuration)],
      },
    },
    V5: {
      replace: {
        r: [rWave(A.rCenter - 5, 0.80 + 0.2 * i, halfW * 2)],
        s: [sWave(A.sCenter + 5, 0.15, halfW * 2)],
        t: [tWave(A.tCenter, -0.15, NI.tDuration)],
      },
    },
    I:  { replace: { r: [rWave(A.rCenter, 0.50, halfW * 2)], t: [tWave(A.tCenter, -0.10, NI.tDuration)] } },
    II: { replace: { r: [rWave(A.rCenter, 0.70, halfW * 2)], t: [tWave(A.tCenter, -0.10, NI.tDuration)] } },
  };
};

// ─── Ventricular Tachycardia ────────────────────────────────────
// Wide QRS (≥140ms), no P, discordant T. Polymorphic handled at sequencer.
export const vtach: PathologyTemplate = (i) => {
  const halfW = 40 + 20 * i;   // 80-120ms half-width → ≥140ms QRS
  const rAmp = 0.8 + 1.0 * i;
  return {
    V1: {
      suppressP: true,
      replace: {
        r: [rWave(A.rCenter - 10, rAmp * 0.5, halfW * 2)],
        s: [sWave(A.sCenter + 10, rAmp, halfW * 2)],
        t: [tWave(A.tCenter, 0.25 + 0.2 * i, NI.tDuration)],
      },
    },
    V5: {
      suppressP: true,
      replace: {
        r: [rWave(A.rCenter - 10, rAmp, halfW * 2)],
        s: [sWave(A.sCenter + 10, rAmp * 0.3, halfW * 2)],
        t: [tWave(A.tCenter, -0.25 - 0.2 * i, NI.tDuration)],
      },
    },
    I:  { suppressP: true, replace: { r: [rWave(A.rCenter, rAmp * 0.7, halfW * 2)], t: [tWave(A.tCenter, -0.20, NI.tDuration)] } },
    II: { suppressP: true, replace: { r: [rWave(A.rCenter, rAmp * 0.9, halfW * 2)], t: [tWave(A.tCenter, -0.20, NI.tDuration)] } },
  };
};

// ─── Ventricular Fibrillation ───────────────────────────────────
// Pure noise at sequencer; no segments.
export const vfib: PathologyTemplate = () => ({});

// ─── PVC (Trigeminy) ────────────────────────────────────────────
// Ectopic wide QRS handled at sequencer every 3rd beat.
export const pvc: PathologyTemplate = (i) => {
  const halfW = 45 + 25 * i;
  const rAmp = 1.0 + 1.0 * i;
  return {
    V1: { replace: { r: [rWave(A.rCenter - 10, rAmp * 0.4, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp, halfW * 2)], t: [tWave(A.tCenter, 0.30, NI.tDuration)] } },
    V5: { replace: { r: [rWave(A.rCenter - 10, rAmp, halfW * 2)], s: [sWave(A.sCenter + 10, rAmp * 0.2, halfW * 2)], t: [tWave(A.tCenter, -0.40, NI.tDuration)] } },
  };
};

// ─── LBBB ───────────────────────────────────────────────────────
// QRS ≥ 120 ms, broad notched R in I/V5/V6, deep QS in V1, no septal Q,
// ST/T discordance. Wide QRS built with explicit wide segment widths.
export const lbbb: PathologyTemplate = (i) => {
  const qrsHalfWidth = 30 + 30 * i;   // each R-peak half-width; two peaks → ~120-180ms total
  const notchOffset = 30 + 15 * i;    // separation between the two R peaks
  const lateralRAmp = 0.9 + 0.5 * i;
  const ov: LeadOverrides = {};
  // Lateral leads: broad notched R (two peaks), no septal Q, T inverted, ST depressed.
  for (const lead of ['I', 'V5', 'V6']) {
    ov[lead] = {
      drop: ['q'],
      replace: {
        r: [
          rWave(A.rCenter - notchOffset, lateralRAmp * 0.7, qrsHalfWidth * 2),
          rWave(A.rCenter + notchOffset, lateralRAmp,        qrsHalfWidth * 2),
        ],
        s: [],
        t: [tWave(A.tCenter, -0.25 - 0.15 * i, NI.tDuration)],
        st: [stElevPlateau(-0.10 - 0.10 * i)],
      },
    };
  }
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
  return ov;
};

// ─── RBBB ───────────────────────────────────────────────────────
// QRS ≥ 120 ms, rsR' in V1 (R' > r), wide S in I/V5/V6, T inversion V1.
export const rbbb: PathologyTemplate = (i) => {
  const halfW = 25 + 20 * i;
  const ov: LeadOverrides = {};
  // V1/V2: rsR' — small initial r, small S, then tall terminal R'.
  ov.V1 = {
    replace: {
      r: [
        rWave(A.rCenter - 35, 0.25, halfW * 2),                     // initial r
        rWave(A.rCenter + 40, 0.70 + 0.5 * i, halfW * 2),           // R' (taller than r)
      ],
      s: [sWave(A.sCenter - 5, 0.20, halfW)],                       // small S between r and R'
      t: [tWave(A.tCenter, -0.20 - 0.10 * i, NI.tDuration)],
      st: [stElevPlateau(-0.05 - 0.05 * i)],
    },
  };
  ov.V2 = {
    replace: {
      r: [
        rWave(A.rCenter - 35, 0.35, halfW * 2),
        rWave(A.rCenter + 40, 0.60 + 0.4 * i, halfW * 2),
      ],
      s: [sWave(A.sCenter - 5, 0.30, halfW)],
      t: [tWave(A.tCenter, -0.15, NI.tDuration)],
    },
  };
  // Lateral leads: wide slurred S.
  for (const lead of ['I', 'V5', 'V6']) {
    ov[lead] = {
      replace: {
        s: [sWave(A.sCenter + 30, 0.30 + 0.25 * i, halfW * 2)],
      },
    };
  }
  return ov;
};

// ─── WPW ────────────────────────────────────────────────────────
// Short PR (< 120 ms), delta wave (slurred upstroke), wide QRS.
// Type A: delta positive in V1 (left-sided pathway).
export const wpw: PathologyTemplate = (i) => {
  const prShift = 60 + 40 * i; // pull P closer to QRS → short PR
  const deltaAmp = 0.10 + 0.25 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V5', 'V6']) {
    ov[lead] = {
      replace: { p: [pWave(A.pCenter + prShift, NI.pAmplitude, NI.pDuration)] },
      add: [
        deltaWave(A.rCenter - 35, deltaAmp, 60), // slurred onset
      ],
    };
  }
  ov.V1 = {
    replace: { p: [pWave(A.pCenter + prShift, NI.pAmplitude, NI.pDuration)] },
    add: [deltaWave(A.rCenter - 35, deltaAmp * 0.6, 60)],
  };
  return ov;
};

// ─── Long QT ────────────────────────────────────────────────────
// QTc > 440 ms (prolonged). Achieved by widening T wave.
export const longqt: PathologyTemplate = (i) => {
  const tScale = 1.5 + 1.2 * i;
  const uAmp = 0.05 + 0.15 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'V4', 'V5']) {
    ov[lead] = {
      replace: {
        t: [tWave(A.tCenter + 40 * i, 0.30, NI.tDuration * tScale)],
        u: [uWave(A.uCenter + 50 * i, uAmp, NI.uDuration)],
      },
    };
  }
  return ov;
};

// ─── Brugada ────────────────────────────────────────────────────
// Type 1 (coved): ST ≥ 2 mm in V1/V2, descending to negative T.
// Type 2 (saddleback): at lower intensity.
export const brugada: PathologyTemplate = (i) => {
  // ST elevation must measure ≥ 2 mm at J+60 in V1/V2 even at i=0.5
  // (start of coved stage). Plateau kept compact (100 ms wide) so its
  // positive peak falls inside the [J, J+80] ST window and is NOT
  // detected as the T-wave. The actual T-wave is wide and negative
  // (coved) — the validator checks coved criteria at i ≥ 0.45.
  // The S wave is suppressed so it doesn't drag down the J-point region.
  const stElev = 0.30 + 0.30 * i;
  const isCoved = i >= 0.45;
  const tAmp = isCoved ? -0.45 - 0.20 * i : 0.10;
  const ov: LeadOverrides = {};
  for (const lead of ['V1', 'V2']) {
    ov[lead] = {
      replace: {
        r: [rWave(A.rCenter - 10, 0.30, 50)],
        s: [], // suppress S — coved ST elevation arises from R'-ST fusion
        st: [stElevPlateau(stElev, 10, 100)],
        t: [tWave(A.tCenter + 30, tAmp, NI.tDuration * 1.3)],
      },
    };
  }
  return ov;
};

// ─── Hyperkalemia ───────────────────────────────────────────────
// Tall narrow peaked T, P flattens then disappears, QRS widens.
export const hyperk: PathologyTemplate = (i) => {
  const tAmp = 0.50 + 0.50 * i;
  const tDur = lerp(160, 90, clamp(i * 2, 0, 1));
  const pScale = clamp(1 - i * 2.2, 0, 1);
  const halfW = 30 + clamp((i - 0.3) * 2, 0, 1) * 45; // QRS widening late
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'III', 'aVF', 'V3', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      suppressP: pScale < 0.05,
      replace: {
        t: [tWave(A.tCenter, tAmp, tDur)],
        r: [rWave(A.rCenter, lead === 'V4' || lead === 'V5' ? 1.5 : 1.0, halfW * 2)],
      },
    };
    if (pScale > 0.05) {
      ov[lead].replace!.p = [pWave(A.pCenter, NI.pAmplitude * pScale, NI.pDuration)];
    }
  }
  return ov;
};

// ─── Hypokalemia ────────────────────────────────────────────────
// Flat T, ST depression, prominent U wave, T-U fusion at high severity.
export const hypokalemia: PathologyTemplate = (i) => {
  const tScale = clamp(1 - i * 1.8, 0.1, 1);
  const uAmp = 0.05 + 0.30 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['II', 'III', 'aVF', 'V3', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      replace: {
        t: [tWave(A.tCenter, 0.18 * tScale, NI.tDuration)],
        u: [uWave(A.uCenter + 30 * i, uAmp, NI.uDuration)],
      },
      add: [stElevPlateau(-0.08 - 0.10 * i)],
    };
  }
  return ov;
};

// ─── Hypothermia ────────────────────────────────────────────────
// Osborn J waves at J point, bradycardia, prolonged intervals.
// The J-wave is broadened so the J-point elevation is still present
// at J+60 ms where the validator samples ST.
export const hypothermia: PathologyTemplate = (i) => {
  const jAmp = 0.10 + 0.40 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'III', 'aVF', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      add: [
        // Broad Osborn wave centered at J+30 with wide support so the
        // J-point through J+80 region stays elevated.
        jWave(A.jPoint + 30, jAmp, 90 + 40 * i),
        stElevPlateau(0.08 + 0.18 * i, 20, 180),
      ],
    };
  }
  return ov;
};

// ─── STEMI helpers ──────────────────────────────────────────────

interface StemiConfig {
  culpritLeads: string[];
  reciprocalLeads: string[];
}

function stemiTemplate(cfg: StemiConfig, i: number, tHyperBoost = 0.40): LeadOverrides {
  const ov: LeadOverrides = {};
  const isHyperacute = i <= 0.30;       // tall T, subtle ST↑
  const isEvolved = i > 0.70;           // Q waves, T inversion, ST resolving
  // Tombstone (mid): prominent ST elevation sustained across the ST window.
  // Bumped so even at i=0.40 (just past hyperacute) ST exceeds 1 mm limb / 1.5 mm precordial.
  const stElev = 0.22 + 0.50 * i;       // ≥ 2.2 mm limb, ≥ 3.7 mm precordial at i=0.3+
  // Reciprocal depression — must clear ≥ 1 mm after the linear-lead transform
  // attenuates it on dependent leads (III, aVF, aVL). Bumped substantially
  // to compensate for the cross-lead cancellation in dependent-lead math
  // (e.g., aVL = I - 0.5·II loses up to half the I depression).
  const stDep = -0.30 - 0.60 * i;

  for (const lead of cfg.culpritLeads) {
    if (isHyperacute) {
      // Hyperacute T stage: tall peaked T with subtle ST elevation.
      ov[lead] = {
        replace: {
          t: [tWave(A.tCenter, 0.55 + tHyperBoost, NI.tDuration * 1.1)],
          st: [stElevPlateau(0.12 + 0.06 * i)],
        },
      };
    } else if (isEvolved) {
      // Evolved: pathologic Q waves, T inversion, ST mostly resolved.
      ov[lead] = {
        drop: ['r'],
        replace: {
          q: [qWave(A.qCenter, 0.40, 60)],
          t: [tWave(A.tCenter, -0.35, NI.tDuration)],
          st: [stElevPlateau(0.05)],
        },
      };
    } else {
      // Tombstone: ST elevation fused into large T.
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
      // Subtle reciprocal change at hyperacute stage.
      ov[lead] = { add: [stElevPlateau(-0.10 - 0.08 * i)] };
    } else if (isEvolved) {
      // Reciprocal T waves normalize; ST returns to baseline.
      ov[lead] = { replace: { t: [tWave(A.tCenter, 0.20, NI.tDuration)] } };
    } else {
      // Reciprocal ST depression during acute phase.
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
// Mirror image in V1-V3: ST depression, tall R, upright T.
export const pwmi: PathologyTemplate = (i) => {
  // ST depression must clear ≥ 0.5 mm at low intensity and grow with severity.
  // ST plateau kept compact so it doesn't extend into the T window (the
  // posterior-MI mirror image has an UPRIGHT tall T in V1-V3).
  const stDep = -0.25 - 0.30 * i;
  const rAmp = 0.45 + 0.55 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['V1', 'V2', 'V3']) {
    ov[lead] = {
      replace: {
        r: [rWave(A.rCenter, rAmp, 80)],
        s: [sWave(A.sCenter, 0.10, 50)],
        t: [tWave(A.tCenter, 0.45 + 0.30 * i, NI.tDuration)],
        st: [stElevPlateau(stDep, 20, 130)],
      },
    };
  }
  return ov;
};

// ─── Acute Pericarditis ─────────────────────────────────────────
// Diffuse concave ST elevation + PR depression (aVR/V1 reciprocal).
export const pericarditis: PathologyTemplate = (i) => {
  const stElev = 0.10 + 0.15 * i;
  const prDep = -0.05 - 0.10 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'III', 'aVL', 'aVF', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      add: [
        stElevPlateau(stElev),
        stShift(A.pCenter + 30, prDep, 80), // PR depression
      ],
    };
  }
  ov.aVR = { add: [stElevPlateau(-stElev * 0.7), stShift(A.pCenter + 30, 0.10, 80)] };
  ov.V1 = { add: [stElevPlateau(-stElev * 0.5)] };
  return ov;
};

// ─── Digoxin Effect ─────────────────────────────────────────────
// Sagging ("reverse tick") ST depression, flat/inverted T, short QT.
export const digoxin: PathologyTemplate = (i) => {
  // ST depression must clear ≥ 0.8 mm at low intensity.
  const stDep = -0.25 - 0.22 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'II', 'aVF', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      replace: { t: [tWave(A.tCenter, lerp(0.25, -0.05, i), NI.tDuration * 0.9)] },
      add: [stElevPlateau(stDep, 20, 200)],
    };
  }
  return ov;
};

// ─── Wellens Syndrome ───────────────────────────────────────────
// Deep/biphasic T inversion in V2-V3, preserved R waves, pain-free.
export const wellens: PathologyTemplate = (i) => {
  const isTypeB = i > 0.35;
  const ov: LeadOverrides = {};
  for (const lead of ['V2', 'V3']) {
    if (isTypeB) {
      ov[lead] = {
        replace: {
          t: [tWave(A.tCenter, -0.35 - 0.30 * i, NI.tDuration * 1.2)],
        },
      };
    } else {
      // Type A: biphasic (positive then negative).
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
  return ov;
};

// ─── De Winter T Waves ──────────────────────────────────────────
// Upsloping ST depression + tall symmetric T in precordials (LAD equiv).
export const dewinter: PathologyTemplate = (i) => {
  const stDep = -0.12 - 0.18 * i;
  const tAmp = 0.40 + 0.40 * i;
  const ov: LeadOverrides = {};
  for (const lead of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    ov[lead] = {
      replace: { t: [tWave(A.tCenter, tAmp, NI.tDuration * 0.9)] },
      add: [stElevPlateau(stDep)],
    };
  }
  return ov;
};

// ─── Pulmonary Embolism ─────────────────────────────────────────
// Sinus tachy, S1Q3T3, right-axis, anterior T inversion.
export const pe: PathologyTemplate = (i) => {
  const ov: LeadOverrides = {};
  // S1: deep S in lead I.
  ov.I = { replace: { s: [sWave(A.sCenter + 10, 0.40 + 0.30 * i, 70)] } };
  // Q3 T3: small R + deep S/QS pattern in III (so R≤0.25 and S≤-0.10).
  // III = II - I. To make III have small R AND deep S, II must have
  // reduced R (so III_R is small) and modest S (so III_S = II_S - I_S
  // still produces net negative). Drive II to R≈0.5, S≈0.7 → III ≈
  // (0.5 - 0.55) - 0.7 = small R then deep S. Plus T inversion in III.
  ov.II = {
    replace: {
      r: [rWave(A.rCenter, 0.55 - 0.10 * i, 80)],
      s: [sWave(A.sCenter, 0.70 + 0.20 * i, 70)],
      t: [tWave(A.tCenter, -0.20 - 0.15 * i, NI.tDuration)],
    },
  };
  // Anterior T inversion (V1-V3) — RV strain.
  for (const lead of ['V1', 'V2', 'V3']) {
    ov[lead] = { replace: { t: [tWave(A.tCenter, -0.10 - 0.20 * i, NI.tDuration)] } };
  }
  return ov;
};

// ─── LVH ────────────────────────────────────────────────────────
// Sokolov-Lyon: SV1 + RV5 > 35 mm. Lateral strain ST/T.
export const lvh: PathologyTemplate = (i) => {
  const rScale = 1.5 + 1.0 * i;   // RV5 → ~2.5 mV (25 mm)
  const sScaleV1 = 1.5 + 1.5 * i; // SV1 → ~1.5 mV (15 mm)
  const ov: LeadOverrides = {};
  for (const lead of ['I', 'V5', 'V6']) {
    ov[lead] = {
      amplitudeScale: rScale,
      add: [stElevPlateau(-0.05 - 0.15 * i)],
      replace: { t: [tWave(A.tCenter, lerp(0.30, -0.25, i), NI.tDuration)] },
    };
  }
  ov.V1 = {
    replace: { s: [sWave(A.sCenter, 0.80 * sScaleV1, 80)] },
  };
  ov.V2 = {
    replace: { s: [sWave(A.sCenter, 1.10 * sScaleV1 * 0.9, 80)] },
  };
  return ov;
};

// ─── RVH ────────────────────────────────────────────────────────
// R/S ratio in V1 > 1, right-axis, RV strain.
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
  for (const lead of ['I', 'V5', 'V6']) {
    ov[lead] = {
      replace: { s: [sWave(A.sCenter + 10, 0.30 + 0.30 * i, 70)] },
    };
  }
  return ov;
};

// ─── Biventricular Enlargement ──────────────────────────────────
export const bve: PathologyTemplate = (i) => {
  const ov: LeadOverrides = {};
  ov.V1 = {
    replace: {
      r: [rWave(A.rCenter, 0.80 + 0.40 * i, 70)],
      s: [sWave(A.sCenter, 0.60, 70)],
    },
  };
  ov.V5 = {
    replace: { r: [rWave(A.rCenter, 2.0 + 0.8 * i, 80)] },
    add: [stElevPlateau(-0.10 - 0.10 * i)],
  };
  ov.V6 = {
    replace: { r: [rWave(A.rCenter, 1.5 + 0.6 * i, 80)] },
  };
  ov.I = { replace: { r: [rWave(A.rCenter, 1.2 + 0.5 * i, 80)] } };
  return ov;
};

// ─── Left Atrial Enlargement (P mitrale) ────────────────────────
// Broad notched P in II (≥ 120 ms), terminal negative P in V1.
export const lah: PathologyTemplate = (i) => {
  // Total P duration target ≥ 160 ms (validator wants ≥ 110 ms).
  // Two notched lobes centered closer to QRS so the full bifid P
  // fits within the rendered cycle window.
  const pDur = 170 + 40 * i;
  const pAmp = 0.15 + 0.05 * i;
  const half = pDur * 0.5;
  const separation = 25 + 10 * i;
  const pCenter = A.pCenter + 30;
  const ov: LeadOverrides = {};
  ov.II = {
    replace: {
      p: [
        pWave(pCenter - separation, pAmp, half),
        pWave(pCenter + separation, pAmp, half),
      ],
    },
  };
  ov.V1 = {
    replace: {
      p: [
        pWave(pCenter - 5, 0.05, 40),
        pWave(pCenter + 30, -0.08 - 0.08 * i, 50),
      ],
    },
  };
  return ov;
};

// ─── Right Atrial Enlargement (P pulmonale) ────────────────────
// Tall peaked P in II (> 2.5 mm), peaked P in V1.
export const rah: PathologyTemplate = (i) => {
  const pAmp = 0.30 + 0.20 * i;   // ≥ 3 mm at lowest intensity
  const ov: LeadOverrides = {};
  for (const lead of ['II', 'III', 'aVF']) {
    ov[lead] = {
      replace: { p: [pWave(A.pCenter, pAmp, 90)] },
    };
  }
  ov.V1 = {
    replace: { p: [pWave(A.pCenter, 0.15 + 0.10 * i, 70)] },
  };
  ov.V2 = {
    replace: { p: [pWave(A.pCenter, 0.12 + 0.08 * i, 70)] },
  };
  return ov;
};

// ─── LAFB ───────────────────────────────────────────────────────
// Left axis deviation: qR in I/aVL, rS in II/III/aVF.
export const lafb: PathologyTemplate = (i) => {
  const ov: LeadOverrides = {};
  ov.I = { replace: { r: [rWave(A.rCenter, 0.80 + 0.30 * i, 80)] } };
  ov.aVL = { replace: { r: [rWave(A.rCenter, 0.60 + 0.30 * i, 80)] } };
  ov.II = {
    replace: {
      r: [rWave(A.rCenter, 0.20 - 0.10 * i, 50)],
      s: [sWave(A.sCenter + 10, 0.40 + 0.30 * i, 70)],
    },
  };
  ov.III = {
    replace: {
      r: [rWave(A.rCenter, 0.15, 50)],
      s: [sWave(A.sCenter + 10, 0.50 + 0.30 * i, 70)],
    },
  };
  ov.aVF = {
    replace: {
      r: [rWave(A.rCenter, 0.15 - 0.05 * i, 50)],
      s: [sWave(A.sCenter + 10, 0.45 + 0.25 * i, 70)],
    },
  };
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
  ov.aVL = {
    replace: {
      r: [rWave(A.rCenter, 0.15, 50)],
      s: [sWave(A.sCenter + 10, 0.45 + 0.25 * i, 70)],
    },
  };
  ov.II = { replace: { r: [rWave(A.rCenter, 0.80 + 0.30 * i, 80)] } };
  ov.III = { replace: { r: [rWave(A.rCenter, 0.70 + 0.30 * i, 80)] } };
  ov.aVF = { replace: { r: [rWave(A.rCenter, 0.75 + 0.30 * i, 80)] } };
  return ov;
};

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

// ─── Registry ───────────────────────────────────────────────────

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
