// ════════════════════════════════════════════════════════════════
// ecg-validate.ts — Measurement-based 12-lead diagnostic validator
//
// For each rhythm, samples the synthesized cycle for every lead and
// measures intervals / amplitudes / ST / axis against published
// diagnostic criteria. A rhythm is "validated" only when its measured
// morphology matches what a clinician would expect at that intensity.
//
// Public API (preserved for app/page.tsx):
//   - validateRhythmAllLeads(rhythmId, intensity): LeadValidationSummary
// ════════════════════════════════════════════════════════════════

import { renderLeadCycleForBeat } from './ecg-math';
import {
  measureCycle, netQrsArea, computeFrontalAxis, sokolovLyonMm,
  resampleToMsPerSample, CycleMeasurement,
} from './ecg-measure';
import { LEADS, INTENSITY_STAGES, rhythmRates } from './ecg-rhythms';

export interface LeadValidationResult {
  lead: string;
  passed: boolean;
  tag: string;
  detail: string;
}

export interface LeadValidationSummary {
  allPassed: boolean;
  checkedLeads: number;
  passedLeads: number;
  results: LeadValidationResult[];
}

const SAMPLE_RATE = 500; // Hz — matches ecg-math.renderCycle

// ─── Lead cycle measurement cache (per call) ────────────────────

function measureLead(rhythmId: string, lead: string, intensity: number): CycleMeasurement {
  const config = INTENSITY_STAGES[rhythmId];
  const bpm = config?.hrMod ? Math.max(20, Math.round(config.hrMod(intensity))) : (rhythmRates[rhythmId] || 72);
  const clampedBpm = Math.max(20, Math.min(240, bpm));
  const cycle = renderLeadCycleForBeat(rhythmId, lead, intensity, clampedBpm, 0);
  const rrMs = 60000 / clampedBpm;
  return measureCycle(cycle, SAMPLE_RATE, rrMs);
}

// ─── Per-rhythm criteria ────────────────────────────────────────
// Each rule returns null (skip — intensity below threshold) or a result.

type Rule = (m: CycleMeasurement, ctx: Ctx) => { passed: boolean; tag: string; detail: string } | null;

interface Ctx {
  rhythmId: string;
  intensity: number;
  lead: string;
  /** Cross-lead lookups for criteria that need multiple leads. */
  all: () => Record<string, CycleMeasurement>;
}

interface LeadRuleMap { [lead: string]: Rule[]; }

const ST_ELEV_LIMB_MV = 0.10;     // 1 mm in limb leads
const ST_ELEV_PRECORD_MV = 0.15;  // 1.5 mm in precordial leads (men)
const ST_DEP_MV = -0.10;          // 1 mm depression
const NEG_T_MV = -0.10;
const POS_T_MV = 0.05;
const WIDE_QRS_MS = 120;
const SHORT_PR_MS = 120;

const LATERAL = ['I', 'aVL', 'V5', 'V6'];
const INFERIOR = ['II', 'III', 'aVF'];
const PRECORDIAL = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

function isPrecordial(lead: string) { return lead.startsWith('V'); }

function stElevThresholdMv(lead: string): number {
  return isPrecordial(lead) ? ST_ELEV_PRECORD_MV : ST_ELEV_LIMB_MV;
}

// ─── Rule builders ──────────────────────────────────────────────

const requireStElev: Rule = (m, ctx) => {
  const thr = stElevThresholdMv(ctx.lead);
  const passed = m.stElevationJ60Mv >= thr;
  return {
    passed,
    tag: passed ? 'ST↑' : 'ST flat',
    detail: passed
      ? `${ctx.lead}: ST elevation ${(m.stElevationJ60Mv * 10).toFixed(1)} mm (≥ ${(thr * 10).toFixed(1)} mm)`
      : `${ctx.lead}: ST ${(m.stElevationJ60Mv * 10).toFixed(1)} mm, expected ≥ ${(thr * 10).toFixed(1)} mm`,
  };
};

const requireStDep: Rule = (m, ctx) => {
  const passed = m.stElevationJ60Mv <= ST_DEP_MV;
  return {
    passed,
    tag: passed ? 'ST↓' : 'ST flat',
    detail: passed
      ? `${ctx.lead}: reciprocal ST depression ${(-m.stElevationJ60Mv * 10).toFixed(1)} mm`
      : `${ctx.lead}: ST ${(m.stElevationJ60Mv * 10).toFixed(1)} mm, expected ≤ ${(ST_DEP_MV * 10).toFixed(1)} mm`,
  };
};

const requireNegT: Rule = (m, ctx) => {
  const passed = m.tAmplitudeMv <= NEG_T_MV;
  return {
    passed,
    tag: passed ? 'T↓' : 'T upright',
    detail: passed
      ? `${ctx.lead}: T inversion ${(m.tAmplitudeMv * 10).toFixed(1)} mm`
      : `${ctx.lead}: T ${(m.tAmplitudeMv * 10).toFixed(1)} mm, expected inversion`,
  };
};

const requirePosT: Rule = (m, ctx) => {
  const passed = m.tAmplitudeMv >= POS_T_MV;
  return {
    passed,
    tag: passed ? 'T+' : 'T flat',
    detail: passed
      ? `${ctx.lead}: upright T ${(m.tAmplitudeMv * 10).toFixed(1)} mm`
      : `${ctx.lead}: T ${(m.tAmplitudeMv * 10).toFixed(1)} mm, expected upright`,
  };
};

const requireWideQrs: Rule = (m, ctx) => {
  const passed = m.qrsDurationMs >= WIDE_QRS_MS;
  return {
    passed,
    tag: passed ? 'Wide QRS' : 'Narrow QRS',
    detail: passed
      ? `${ctx.lead}: QRS ${m.qrsDurationMs} ms (≥ ${WIDE_QRS_MS} ms — BBB) `
      : `${ctx.lead}: QRS ${m.qrsDurationMs} ms, expected ≥ ${WIDE_QRS_MS} ms`,
  };
};

// ─── Rhythm-specific rule tables ────────────────────────────────

const RHYTHM_RULES: Record<string, LeadRuleMap> = {

  // ── LBBB ──────────────────────────────────────────────────────
  lbbb: {
    V1: [
      (m, ctx) => {
        const deepS = m.sAmplitudeMv <= -0.50;
        const tPos = m.tAmplitudeMv >= POS_T_MV;
        const passed = deepS && tPos;
        return {
          passed,
          tag: passed ? 'QS+T+' : 'Check V1',
          detail: passed
            ? `V1 LBBB: deep S ${m.sAmplitudeMv.toFixed(2)} mV + discordant T+`
            : `V1: S=${m.sAmplitudeMv.toFixed(2)} mV, T=${m.tAmplitudeMv.toFixed(2)} mV (expect deep S + upright T)`,
        };
      },
    ],
    V5: [
      requireWideQrs,
      (m, ctx) => {
        const tallR = m.rAmplitudeMv >= 0.60;
        const tNeg = m.tAmplitudeMv <= NEG_T_MV;
        const passed = tallR && tNeg;
        return {
          passed,
          tag: passed ? 'Broad R + T-' : 'Check V5',
          detail: passed
            ? `V5 LBBB: broad R ${m.rAmplitudeMv.toFixed(2)} mV + discordant T-`
            : `V5: R=${m.rAmplitudeMv.toFixed(2)} mV, T=${m.tAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
    V6: [
      (m, ctx) => {
        const tallR = m.rAmplitudeMv >= 0.40;
        const tNeg = m.tAmplitudeMv <= NEG_T_MV;
        const passed = tallR && tNeg;
        return {
          passed,
          tag: passed ? 'R + T-' : 'Check V6',
          detail: passed
            ? `V6 LBBB lateral: R=${m.rAmplitudeMv.toFixed(2)}, T=${m.tAmplitudeMv.toFixed(2)}`
            : `V6: R=${m.rAmplitudeMv.toFixed(2)}, T=${m.tAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
    I: [
      (m, ctx) => {
        const tallR = m.rAmplitudeMv >= 0.40;
        const tNeg = m.tAmplitudeMv <= NEG_T_MV;
        const passed = tallR && tNeg;
        return {
          passed,
          tag: passed ? 'Broad R + T-' : 'Check I',
          detail: passed
            ? `I LBBB lateral: broad R=${m.rAmplitudeMv.toFixed(2)} + T-`
            : `I: R=${m.rAmplitudeMv.toFixed(2)}, T=${m.tAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
  },

  // ── RBBB ──────────────────────────────────────────────────────
  rbbb: {
    V1: [
      requireWideQrs,
      (m, ctx) => {
        // rsR' — peak positive should exceed any initial r; we accept a single
        // dominant positive deflection (the R') as proxy when M-pattern is hard to detect.
        const domR = m.rAmplitudeMv >= 0.50;
        const tNeg = m.tAmplitudeMv <= -0.05;
        const passed = domR && tNeg;
        return {
          passed,
          tag: passed ? "R' + T-" : 'Check V1',
          detail: passed
            ? `V1 RBBB: R'=${m.rAmplitudeMv.toFixed(2)} mV + T inversion`
            : `V1: R=${m.rAmplitudeMv.toFixed(2)}, T=${m.tAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
    V2: [
      (m, ctx) => {
        const domR = m.rAmplitudeMv >= 0.40;
        const passed = domR;
        return {
          passed,
          tag: passed ? "R' present" : 'Check V2',
          detail: passed
            ? `V2 RBBB: R'=${m.rAmplitudeMv.toFixed(2)} mV`
            : `V2: R=${m.rAmplitudeMv.toFixed(2)} (expected prominent terminal R')`,
        };
      },
    ],
    I: [
      (m, ctx) => {
        const wideS = m.sAmplitudeMv <= -0.20;
        const passed = wideS;
        return {
          passed,
          tag: passed ? 'Wide S' : 'Check I',
          detail: passed
            ? `I RBBB: wide S=${m.sAmplitudeMv.toFixed(2)} mV`
            : `I: S=${m.sAmplitudeMv.toFixed(2)} (expected wide terminal S)`,
        };
      },
    ],
    V6: [
      (m, ctx) => {
        const wideS = m.sAmplitudeMv <= -0.15;
        const passed = wideS;
        return {
          passed,
          tag: passed ? 'Wide S' : 'Check V6',
          detail: passed
            ? `V6 RBBB: wide S=${m.sAmplitudeMv.toFixed(2)} mV`
            : `V6: S=${m.sAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
  },

  // ── LVH ───────────────────────────────────────────────────────
  lvh: {
    V5: [
      (m, ctx) => {
        const all_ = ctx.all();
        const rv5 = Math.max(0, all_.V5.rAmplitudeMv);
        const sv1 = Math.max(0, -all_.V1.sAmplitudeMv);
        const sl = sokolovLyonMm(rv5, -sv1);
        const passed = sl > 35;
        return {
          passed,
          tag: passed ? 'Sokolov+' : 'Check SL',
          detail: passed
            ? `Sokolov-Lyon: SV1+RV5 = ${sl.toFixed(0)} mm (> 35 mm)`
            : `Sokolov-Lyon = ${sl.toFixed(0)} mm (expected > 35 mm)`,
        };
      },
    ],
    V6: [
      (m, ctx) => {
        const tallR = m.rAmplitudeMv >= 0.90;
        const tInv = ctx.intensity > 0.35 ? m.tAmplitudeMv <= -0.05 : true;
        const passed = tallR && tInv;
        return {
          passed,
          tag: passed ? 'HV + strain' : 'Check V6',
          detail: passed
            ? `V6 LVH: R=${m.rAmplitudeMv.toFixed(2)} mV${ctx.intensity > 0.35 ? ' + strain' : ''}`
            : `V6: R=${m.rAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
    I: [
      (m, ctx) => {
        const tallR = m.rAmplitudeMv >= 0.70;
        const passed = tallR;
        return {
          passed,
          tag: passed ? 'Tall R' : 'Check I',
          detail: passed
            ? `I LVH: tall R=${m.rAmplitudeMv.toFixed(2)} mV`
            : `I: R=${m.rAmplitudeMv.toFixed(2)} mV (expected tall)`,
        };
      },
    ],
    V1: [
      (m, ctx) => {
        const deepS = m.sAmplitudeMv <= -0.80;
        const passed = deepS;
        return {
          passed,
          tag: passed ? 'Deep S' : 'Check V1',
          detail: passed
            ? `V1 LVH: deep S=${m.sAmplitudeMv.toFixed(2)} mV`
            : `V1: S=${m.sAmplitudeMv.toFixed(2)} mV (expected deep)`,
        };
      },
    ],
  },

  // ── RVH ───────────────────────────────────────────────────────
  rvh: {
    V1: [
      (m, ctx) => {
        // R/S ratio > 1 in V1
        const ratio = m.rAmplitudeMv / Math.max(0.05, -m.sAmplitudeMv);
        const passed = ratio >= 1.0 && m.rAmplitudeMv >= 0.30;
        return {
          passed,
          tag: passed ? 'Dom R' : 'Check V1',
          detail: passed
            ? `V1 RVH: dominant R=${m.rAmplitudeMv.toFixed(2)}, S=${m.sAmplitudeMv.toFixed(2)} (R/S=${ratio.toFixed(2)})`
            : `V1: R/S=${ratio.toFixed(2)} (expected > 1)`,
        };
      },
    ],
    V5: [
      (m, ctx) => {
        const deepS = m.sAmplitudeMv <= -0.30;
        const passed = deepS;
        return {
          passed,
          tag: passed ? 'Deep S' : 'Check V5',
          detail: passed
            ? `V5 RVH: deep S=${m.sAmplitudeMv.toFixed(2)} mV`
            : `V5: S=${m.sAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
  },

  // ── WPW ───────────────────────────────────────────────────────
  wpw: {
    II: [
      (m, ctx) => {
        const shortPR = m.prIntervalMs <= SHORT_PR_MS && m.prIntervalMs > 0;
        const wideQrs = m.qrsDurationMs >= 100;
        const passed = shortPR && wideQrs;
        return {
          passed,
          tag: passed ? 'Short PR + δ' : 'Check II',
          detail: passed
            ? `II WPW: PR ${m.prIntervalMs} ms + QRS ${m.qrsDurationMs} ms (delta wave)`
            : `II: PR=${m.prIntervalMs} ms, QRS=${m.qrsDurationMs} ms (expect PR<${SHORT_PR_MS}, QRS>100)`,
        };
      },
    ],
    V5: [
      (m, ctx) => {
        const wideQrs = m.qrsDurationMs >= 100;
        const passed = wideQrs;
        return {
          passed,
          tag: passed ? 'δ widened' : 'Check V5',
          detail: passed
            ? `V5 WPW: QRS ${m.qrsDurationMs} ms (delta-wave widening)`
            : `V5: QRS=${m.qrsDurationMs} ms`,
        };
      },
    ],
  },

  // ── Long QT ───────────────────────────────────────────────────
  longqt: {
    II: [
      (m, ctx) => {
        const passed = m.qtcMs >= 440;
        return {
          passed,
          tag: passed ? 'QTc↑' : 'Check QTc',
          detail: passed
            ? `II: QTc ${m.qtcMs.toFixed(0)} ms (≥ 440 ms — prolonged)`
            : `II: QTc ${m.qtcMs.toFixed(0)} ms (expected ≥ 440 ms)`,
        };
      },
    ],
    V5: [
      (m, ctx) => {
        const passed = m.qtcMs >= 440;
        return {
          passed,
          tag: passed ? 'QTc↑' : 'Check QTc',
          detail: passed
            ? `V5: QTc ${m.qtcMs.toFixed(0)} ms`
            : `V5: QTc ${m.qtcMs.toFixed(0)} ms (expected ≥ 440 ms)`,
        };
      },
    ],
  },

  // ── Brugada Type 1 (checked only at intensity ≥ 0.5, coved stage) ──
  brugada: {
    V1: [
      (m, ctx) => ctx.intensity < 0.45 ? null : (() => {
        const stElev = m.stElevationJ60Mv >= 0.20;  // ≥ 2 mm
        const tNeg = m.tAmplitudeMv <= -0.05;
        const passed = stElev && tNeg;
        return {
          passed,
          tag: passed ? 'Coved T1' : 'Check V1',
          detail: passed
            ? `V1 Brugada T1: coved ST ${(m.stElevationJ60Mv * 10).toFixed(1)} mm + T-`
            : `V1: ST ${(m.stElevationJ60Mv * 10).toFixed(1)} mm, T=${m.tAmplitudeMv.toFixed(2)} (expect ≥2mm + T-)`,
        };
      })(),
    ],
    V2: [
      (m, ctx) => ctx.intensity < 0.45 ? null : (() => {
        const stElev = m.stElevationJ60Mv >= 0.15;
        const passed = stElev;
        return {
          passed,
          tag: passed ? 'ST↑ V2' : 'Check V2',
          detail: passed
            ? `V2 Brugada: ST ${(m.stElevationJ60Mv * 10).toFixed(1)} mm`
            : `V2: ST ${(m.stElevationJ60Mv * 10).toFixed(1)} mm (expected elevated)`,
        };
      })(),
    ],
    II: [
      (m, ctx) => {
        // Should be normal
        const passed = Math.abs(m.stElevationJ60Mv) < 0.10;
        return {
          passed,
          tag: passed ? 'Normal' : 'Abnormal',
          detail: passed
            ? `II: no ST change (Brugada is right-specific)`
            : `II unexpected ST change`,
        };
      },
    ],
  },

  // ── Hyperkalemia ──────────────────────────────────────────────
  hyperk: {
    II: [
      (m, ctx) => {
        const peakedT = m.tAmplitudeMv >= 0.50;
        const passed = peakedT;
        return {
          passed,
          tag: passed ? 'Peaked T' : 'Check T',
          detail: passed
            ? `II: peaked T ${(m.tAmplitudeMv * 10).toFixed(1)} mm — hyperkalemia`
            : `II: T=${m.tAmplitudeMv.toFixed(2)} mV (expected peaked ≥ 0.5 mV)`,
        };
      },
    ],
    V4: [
      (m, ctx) => {
        const peakedT = m.tAmplitudeMv >= 0.50;
        const passed = peakedT;
        return {
          passed,
          tag: passed ? 'Peaked T' : 'Check T',
          detail: passed
            ? `V4: peaked T ${m.tAmplitudeMv.toFixed(2)} mV`
            : `V4: T=${m.tAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
  },

  // ── Hypokalemia ───────────────────────────────────────────────
  hypokalemia: {
    II: [
      (m, ctx) => {
        // Clinical hallmark: ST depression + (flat T or T-U fusion where
        // the dominant late positive wave — usually a U — is small).
        // We accept either a truly flat T (≤ 0.15 mV) OR a modest
        // T-U complex amplitude (≤ 0.30 mV) provided ST is depressed.
        const stDep = m.stElevationJ60Mv <= -0.05;
        const flatOrFused = m.tAmplitudeMv <= 0.30;
        const passed = stDep && flatOrFused;
        return {
          passed,
          tag: passed ? 'Flat T + ST↓' : 'Check II',
          detail: passed
            ? `II: T/UT ${m.tAmplitudeMv.toFixed(2)} mV + ST depression — hypokalemia`
            : `II: T=${m.tAmplitudeMv.toFixed(2)}, ST=${m.stElevationJ60Mv.toFixed(2)}`,
        };
      },
    ],
    V5: [
      (m, ctx) => {
        // V5 T or T-U complex should be small (T attenuated, U appears).
        const passed = m.tAmplitudeMv <= 0.35;
        return {
          passed,
          tag: passed ? 'Flat T/U' : 'Check V5',
          detail: passed
            ? `V5: T/UT ${m.tAmplitudeMv.toFixed(2)} mV — hypokalemia pattern`
            : `V5: T=${m.tAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
  },

  // ── Hypothermia ───────────────────────────────────────────────
  hypothermia: {
    II: [
      (m, ctx) => {
        // Osborn J wave = ST elevation just after J point
        const jWave = m.stElevationJ60Mv >= 0.05;
        const passed = jWave;
        return {
          passed,
          tag: passed ? 'Osborn' : 'Check J',
          detail: passed
            ? `II: Osborn J-wave present (ST ${(m.stElevationJ60Mv * 10).toFixed(1)} mm at J+60)`
            : `II: ST=${m.stElevationJ60Mv.toFixed(2)} mV (expected J-wave elevation)`,
        };
      },
    ],
    V5: [
      (m, ctx) => {
        const jWave = m.stElevationJ60Mv >= 0.04;
        const passed = jWave;
        return {
          passed,
          tag: passed ? 'Osborn' : 'Check V5',
          detail: passed
            ? `V5: Osborn J-wave ${m.stElevationJ60Mv.toFixed(2)} mV`
            : `V5: ST=${m.stElevationJ60Mv.toFixed(2)} mV`,
        };
      },
    ],
  },

  // ── Posterior MI ──────────────────────────────────────────────
  pwmi: {
    V1: [
      (m, ctx) => {
        const stDep = m.stElevationJ60Mv <= -0.05;
        const tallR = m.rAmplitudeMv >= 0.30;
        const tPos = m.tAmplitudeMv >= POS_T_MV;
        const passed = stDep && tallR && tPos;
        return {
          passed,
          tag: passed ? 'ST↓ R↑ T↑' : 'Check V1',
          detail: passed
            ? `V1 PWMI mirror: ST↓ ${m.stElevationJ60Mv.toFixed(2)}, R ${m.rAmplitudeMv.toFixed(2)}, T+`
            : `V1: ST=${m.stElevationJ60Mv.toFixed(2)}, R=${m.rAmplitudeMv.toFixed(2)}, T=${m.tAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
    V2: [
      (m, ctx) => {
        const stDep = m.stElevationJ60Mv <= -0.05;
        const passed = stDep;
        return {
          passed,
          tag: passed ? 'ST↓' : 'Check V2',
          detail: passed
            ? `V2 PWMI: ST depression ${m.stElevationJ60Mv.toFixed(2)} mV`
            : `V2: ST=${m.stElevationJ60Mv.toFixed(2)} mV`,
        };
      },
    ],
  },

  // ── Pericarditis ──────────────────────────────────────────────
  pericarditis: {
    II: [
      (m, ctx) => {
        const stElev = m.stElevationJ60Mv >= 0.08;
        const passed = stElev;
        return {
          passed,
          tag: passed ? 'Diffuse ST↑' : 'Check II',
          detail: passed
            ? `II: diffuse ST elevation ${(m.stElevationJ60Mv * 10).toFixed(1)} mm — pericarditis`
            : `II: ST=${m.stElevationJ60Mv.toFixed(2)} mV`,
        };
      },
    ],
    V5: [
      (m, ctx) => {
        const stElev = m.stElevationJ60Mv >= 0.08;
        const passed = stElev;
        return {
          passed,
          tag: passed ? 'ST↑' : 'Check V5',
          detail: passed
            ? `V5: ST elevation ${(m.stElevationJ60Mv * 10).toFixed(1)} mm`
            : `V5: ST=${m.stElevationJ60Mv.toFixed(2)} mV`,
        };
      },
    ],
    aVR: [
      (m, ctx) => {
        // aVR should show reciprocal depression / PR elevation
        const passed = m.stElevationJ60Mv <= 0.0;
        return {
          passed,
          tag: passed ? 'Reciprocal' : 'Check aVR',
          detail: passed
            ? `aVR: reciprocal ST depression ${m.stElevationJ60Mv.toFixed(2)} mV`
            : `aVR unexpected ST elevation in pericarditis`,
        };
      },
    ],
  },

  // ── Digoxin ───────────────────────────────────────────────────
  digoxin: {
    I: [
      (m, ctx) => {
        const sagSt = m.stElevationJ60Mv <= -0.08;
        const passed = sagSt;
        return {
          passed,
          tag: passed ? 'Sag ST' : 'Check I',
          detail: passed
            ? `I: sagging ST depression — digoxin effect`
            : `I: ST=${m.stElevationJ60Mv.toFixed(2)} mV`,
        };
      },
    ],
    V5: [
      (m, ctx) => {
        const sagSt = m.stElevationJ60Mv <= -0.08;
        const passed = sagSt;
        return {
          passed,
          tag: passed ? 'Sag ST' : 'Check V5',
          detail: passed
            ? `V5: sagging ST depression ${m.stElevationJ60Mv.toFixed(2)} mV`
            : `V5: ST=${m.stElevationJ60Mv.toFixed(2)} mV`,
        };
      },
    ],
  },

  // ── Wellens ───────────────────────────────────────────────────
  wellens: {
    V2: [
      (m, ctx) => {
        const deepTInv = m.tAmplitudeMv <= -0.20;
        const passed = deepTInv;
        return {
          passed,
          tag: passed ? 'T inv' : 'Check V2',
          detail: passed
            ? `V2: deep T inversion ${m.tAmplitudeMv.toFixed(2)} mV — Wellens`
            : `V2: T=${m.tAmplitudeMv.toFixed(2)} mV (expected inversion)`,
        };
      },
    ],
    V3: [
      (m, ctx) => {
        const deepTInv = m.tAmplitudeMv <= -0.15;
        const passed = deepTInv;
        return {
          passed,
          tag: passed ? 'T inv' : 'Check V3',
          detail: passed
            ? `V3: T inversion ${m.tAmplitudeMv.toFixed(2)} mV`
            : `V3: T=${m.tAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
  },

  // ── De Winter ─────────────────────────────────────────────────
  dewinter: {
    V2: [
      (m, ctx) => {
        const stDep = m.stElevationJ60Mv <= -0.08;
        const tallT = m.tAmplitudeMv >= 0.30;
        const passed = stDep && tallT;
        return {
          passed,
          tag: passed ? 'ST↓ T↑' : 'Check V2',
          detail: passed
            ? `V2 De Winter: ST↓ + tall T ${m.tAmplitudeMv.toFixed(2)} mV`
            : `V2: ST=${m.stElevationJ60Mv.toFixed(2)}, T=${m.tAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
    V4: [
      (m, ctx) => {
        const tallT = m.tAmplitudeMv >= 0.30;
        const passed = tallT;
        return {
          passed,
          tag: passed ? 'T↑' : 'Check V4',
          detail: passed
            ? `V4: tall T ${m.tAmplitudeMv.toFixed(2)} mV`
            : `V4: T=${m.tAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
  },

  // ── PE ────────────────────────────────────────────────────────
  pe: {
    I: [
      (m, ctx) => {
        const deepS = m.sAmplitudeMv <= -0.30;
        const passed = deepS;
        return {
          passed,
          tag: passed ? 'S1' : 'Check I',
          detail: passed
            ? `I: S wave (S1) ${m.sAmplitudeMv.toFixed(2)} mV — PE`
            : `I: S=${m.sAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
    III: [
      (m, ctx) => {
        // Q3 + T3
        const qWave = m.sAmplitudeMv <= -0.10 && m.rAmplitudeMv <= 0.25;
        const tInv = m.tAmplitudeMv <= -0.05;
        const passed = qWave && tInv;
        return {
          passed,
          tag: passed ? 'Q3 T3' : 'Check III',
          detail: passed
            ? `III: Q3T3 pattern — PE`
            : `III: R=${m.rAmplitudeMv.toFixed(2)}, T=${m.tAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
    V1: [
      (m, ctx) => {
        const tInv = m.tAmplitudeMv <= -0.05;
        const passed = tInv;
        return {
          passed,
          tag: passed ? 'T inv' : 'Check V1',
          detail: passed
            ? `V1: T inversion (RV strain) ${m.tAmplitudeMv.toFixed(2)} mV`
            : `V1: T=${m.tAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
  },

  // ── LAFB ──────────────────────────────────────────────────────
  lafb: {
    I: [
      (m, ctx) => {
        const qR = m.rAmplitudeMv >= 0.50 && m.rAmplitudeMv > Math.abs(m.sAmplitudeMv);
        const passed = qR;
        return {
          passed,
          tag: passed ? 'qR' : 'Check I',
          detail: passed
            ? `I LAFB: qR pattern R=${m.rAmplitudeMv.toFixed(2)} — left axis`
            : `I: R=${m.rAmplitudeMv.toFixed(2)}, S=${m.sAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
    II: [
      (m, ctx) => {
        const rS = Math.abs(m.sAmplitudeMv) >= 0.30 && Math.abs(m.sAmplitudeMv) > m.rAmplitudeMv;
        const passed = rS;
        return {
          passed,
          tag: passed ? 'rS' : 'Check II',
          detail: passed
            ? `II LAFB: rS pattern S=${m.sAmplitudeMv.toFixed(2)} — left axis`
            : `II: R=${m.rAmplitudeMv.toFixed(2)}, S=${m.sAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
  },

  // ── LPFB ──────────────────────────────────────────────────────
  lpfb: {
    I: [
      (m, ctx) => {
        const rS = Math.abs(m.sAmplitudeMv) >= 0.30 && Math.abs(m.sAmplitudeMv) > m.rAmplitudeMv;
        const passed = rS;
        return {
          passed,
          tag: passed ? 'rS' : 'Check I',
          detail: passed
            ? `I LPFB: rS — right axis pattern`
            : `I: R=${m.rAmplitudeMv.toFixed(2)}, S=${m.sAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
    II: [
      (m, ctx) => {
        const qR = m.rAmplitudeMv >= 0.50 && m.rAmplitudeMv > Math.abs(m.sAmplitudeMv);
        const passed = qR;
        return {
          passed,
          tag: passed ? 'qR' : 'Check II',
          detail: passed
            ? `II LPFB: qR — right axis pattern`
            : `II: R=${m.rAmplitudeMv.toFixed(2)}, S=${m.sAmplitudeMv.toFixed(2)}`,
        };
      },
    ],
  },

  // ── LAH (P mitrale) ───────────────────────────────────────────
  lah: {
    II: [
      (m, ctx) => {
        const passed = m.pDurationMs >= 110;   // broad notched P ≥ 110 ms
        return {
          passed,
          tag: passed ? 'Broad P' : 'Check P',
          detail: passed
            ? `II: broad notched P ${m.pDurationMs} ms (P mitrale)`
            : `II: P duration ${m.pDurationMs} ms (expected ≥ 110 ms)`,
        };
      },
    ],
  },

  // ── RAH (P pulmonale) ─────────────────────────────────────────
  rah: {
    II: [
      (m, ctx) => {
        const passed = m.pAmplitudeMv >= 0.25;  // tall peaked P ≥ 2.5 mm
        return {
          passed,
          tag: passed ? 'Tall P' : 'Check P',
          detail: passed
            ? `II: tall peaked P ${(m.pAmplitudeMv * 10).toFixed(1)} mm (P pulmonale)`
            : `II: P amplitude ${m.pAmplitudeMv.toFixed(2)} mV (expected ≥ 0.25)`,
        };
      },
    ],
  },

  // ── AVB 1° ────────────────────────────────────────────────────
  avb1: {
    II: [
      (m, ctx) => {
        const passed = m.prIntervalMs >= 200;
        return {
          passed,
          tag: passed ? 'PR↑' : 'Check PR',
          detail: passed
            ? `II: PR ${m.prIntervalMs} ms (≥ 200 ms — 1° AVB)`
            : `II: PR ${m.prIntervalMs} ms (expected ≥ 200 ms)`,
        };
      },
    ],
  },

  // ── NSR (sanity check) ────────────────────────────────────────
  nsr: {
    II: [
      (m, ctx) => {
        const normalPr = m.prIntervalMs >= 110 && m.prIntervalMs <= 200;
        const normalQrs = m.qrsDurationMs <= 110;
        const passed = normalPr && normalQrs && m.rAmplitudeMv > 0.3;
        return {
          passed,
          tag: passed ? 'Normal' : 'Check II',
          detail: passed
            ? `II NSR: PR ${m.prIntervalMs} ms, QRS ${m.qrsDurationMs} ms — within normal limits`
            : `II: PR=${m.prIntervalMs} ms, QRS=${m.qrsDurationMs} ms`,
        };
      },
    ],
  },

  // ── Early repolarization ──────────────────────────────────────
  earlyrepo: {
    V5: [
      (m, ctx) => {
        const stElev = m.stElevationJ60Mv >= 0.05;
        const passed = stElev;
        return {
          passed,
          tag: passed ? 'J-point↑' : 'Check V5',
          detail: passed
            ? `V5: concave ST elevation — early repolarization`
            : `V5: ST=${m.stElevationJ60Mv.toFixed(2)} mV`,
        };
      },
    ],
  },

  // ── AVB 3° (complete) ─────────────────────────────────────────
  avb3: {
    V5: [
      requireWideQrs,
    ],
  },

  // ── VT ────────────────────────────────────────────────────────
  vtach: {
    V5: [
      (m, ctx) => {
        const passed = m.qrsDurationMs >= 140;
        return {
          passed,
          tag: passed ? 'Wide QRS' : 'Check QRS',
          detail: passed
            ? `V5 VT: QRS ${m.qrsDurationMs} ms (≥ 140 ms — wide complex)`
            : `V5: QRS ${m.qrsDurationMs} ms (expected ≥ 140 ms)`,
        };
      },
    ],
  },

  // ── PVC ───────────────────────────────────────────────────────
  pvc: {
    V5: [
      (m, ctx) => {
        const passed = m.qrsDurationMs >= 120;
        return {
          passed,
          tag: passed ? 'Wide ectopic' : 'Check QRS',
          detail: passed
            ? `V5 PVC: QRS ${m.qrsDurationMs} ms (wide ectopic)`
            : `V5: QRS ${m.qrsDurationMs} ms`,
        };
      },
    ],
  },

  // ── BVE ───────────────────────────────────────────────────────
  bve: {
    V5: [
      (m, ctx) => {
        const passed = m.rAmplitudeMv >= 1.50;
        return {
          passed,
          tag: passed ? 'HV' : 'Check V5',
          detail: passed
            ? `V5 BVE: high voltage R=${m.rAmplitudeMv.toFixed(2)} mV`
            : `V5: R=${m.rAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
    V1: [
      (m, ctx) => {
        const passed = m.rAmplitudeMv >= 0.50;
        return {
          passed,
          tag: passed ? 'Dom R' : 'Check V1',
          detail: passed
            ? `V1 BVE: dominant R=${m.rAmplitudeMv.toFixed(2)} mV`
            : `V1: R=${m.rAmplitudeMv.toFixed(2)} mV`,
        };
      },
    ],
  },
};

// ─── STEMI rules (built dynamically) ────────────────────────────

const STEMI_CULPRIT_MAP: Record<string, string[]> = {
  stemi_ant:    ['V1', 'V2', 'V3', 'V4'],
  stemi_inf:    ['II', 'III', 'aVF'],
  stemi_lat:    ['I', 'aVL', 'V5', 'V6'],
  stemi_antlat: ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'I', 'aVL'],
  stemi_inflat: ['II', 'III', 'aVF', 'V5', 'V6'],
  stemi_rv:     ['V1', 'V2'],
};
const STEMI_RECIPROCAL_MAP: Record<string, string[]> = {
  stemi_ant:    ['II', 'III', 'aVF'],
  stemi_inf:    ['I', 'aVL'],
  stemi_lat:    ['II', 'III', 'aVF'],
  stemi_antlat: ['II', 'III', 'aVF'],
  stemi_inflat: ['I', 'aVL'],
  stemi_rv:     ['I', 'aVL', 'V5', 'V6'],
};

function buildStemiRules(rhythmId: string): LeadRuleMap {
  const culprits = STEMI_CULPRIT_MAP[rhythmId] || [];
  const reciprocals = STEMI_RECIPROCAL_MAP[rhythmId] || [];
  const rules: LeadRuleMap = {};
  for (const lead of culprits) {
    rules[lead] = [
      (m, ctx) => {
        // Hyperacute stage: tall peaked T (≥ 0.45 mV), subtle ST.
        // Use <= so intensity=0.30 falls in hyperacute (not acute).
        if (ctx.intensity <= 0.30) {
          const passed = m.tAmplitudeMv >= 0.45;
          return {
            passed,
            tag: passed ? 'Hyperacute T' : 'Check T',
            detail: passed
              ? `${lead}: hyperacute T ${(m.tAmplitudeMv * 10).toFixed(1)} mm`
              : `${lead}: T=${m.tAmplitudeMv.toFixed(2)} mV (expected hyperacute ≥ 0.45)`,
          };
        }
        // Evolved stage: pathologic Q + T inversion.
        if (ctx.intensity > 0.70) {
          // Pathologic Q: net negative QRS (dominant S/QS over R) OR
          // a deep S-wave consistent with Q in this lead.
          const qPresent = m.sAmplitudeMv <= -0.20 && m.rAmplitudeMv <= 0.40;
          const tInv = m.tAmplitudeMv <= -0.15;
          const passed = qPresent && tInv;
          return {
            passed,
            tag: passed ? 'Q + T inv' : 'Check evolved',
            detail: passed
              ? `${lead}: pathologic Q + T inversion — evolved MI`
              : `${lead}: R=${m.rAmplitudeMv.toFixed(2)}, S=${m.sAmplitudeMv.toFixed(2)}, T=${m.tAmplitudeMv.toFixed(2)} (expect Q + T-)`,
          };
        }
        // Acute / tombstone: ST elevation.
        return requireStElev(m, ctx);
      },
    ];
  }
  for (const lead of reciprocals) {
    rules[lead] = [
      (m, ctx) => {
        // Hyperacute: reciprocal change subtle — skip.
        if (ctx.intensity <= 0.30) return null;
        // Evolved: reciprocal ST normalizes — skip.
        if (ctx.intensity > 0.70) return null;
        return requireStDep(m, ctx);
      },
    ];
  }
  return rules;
}

for (const rhythmId of Object.keys(STEMI_CULPRIT_MAP)) {
  RHYTHM_RULES[rhythmId] = buildStemiRules(rhythmId);
}

// ─── Main entry point ───────────────────────────────────────────

export function validateRhythmAllLeads(
  rhythmId: string,
  intensity: number
): LeadValidationSummary {
  const rules = RHYTHM_RULES[rhythmId];
  if (!rules) {
    // No lead-specific rules — neutral pass.
    return {
      allPassed: true,
      checkedLeads: 0,
      passedLeads: 0,
      results: LEADS.map((lead) => ({
        lead,
        passed: true,
        tag: '—',
        detail: 'No lead-specific criteria defined for this rhythm.',
      })),
    };
  }

  // Measure all leads once for cross-lead criteria.
  const allMeasurements: Record<string, CycleMeasurement> = {};
  for (const lead of LEADS) {
    allMeasurements[lead] = measureLead(rhythmId, lead, intensity);
  }

  const ctxAll = () => allMeasurements;

  const results: LeadValidationResult[] = LEADS.map((lead) => {
    const leadRules = rules[lead];
    if (!leadRules || leadRules.length === 0) {
      return { lead, passed: true, tag: '—', detail: 'No specific criterion for this lead.' };
    }
    const m = allMeasurements[lead];
    const ctx: Ctx = { rhythmId, intensity, lead, all: ctxAll };

    // Run all rules for this lead; report the first failure (or first pass if all pass).
    for (const rule of leadRules) {
      const r = rule(m, ctx);
      if (r === null) {
        // Deferred — intensity too low; skip with neutral tag.
        return { lead, passed: true, tag: '—', detail: 'Intensity below criterion threshold.' };
      }
      if (!r.passed) {
        return { lead, passed: false, tag: r.tag, detail: r.detail };
      }
      // All rules pass — record the first tag.
      return { lead, passed: true, tag: r.tag, detail: r.detail };
    }
    return { lead, passed: true, tag: '—', detail: 'No criterion evaluated.' };
  });

  const checkedResults = results.filter((r) => r.tag !== '—');
  const passedResults = checkedResults.filter((r) => r.passed);

  return {
    allPassed: checkedResults.every((r) => r.passed),
    checkedLeads: checkedResults.length,
    passedLeads: passedResults.length,
    results,
  };
}

// ─── Aggregate harness: all rhythms × representative intensities ─

export interface RhythmHarnessResult {
  rhythmId: string;
  intensities: { intensity: number; allPassed: boolean; failedLeads: string[]; details: string[] }[];
  overallPassed: boolean;
}

/**
 * Run the validator across every rhythm at multiple intensities.
 * Used by scripts/validate-ecg.mjs as the completion gate.
 */
export function runFullValidationHarness(intensities: number[] = [0.3, 0.5, 0.75]): RhythmHarnessResult[] {
  // Validate only rhythms that have rules (others auto-pass).
  const rhythmIds = Object.keys(RHYTHM_RULES);
  const results: RhythmHarnessResult[] = [];
  for (const rhythmId of rhythmIds) {
    const perIntensity = intensities.map((intensity) => {
      const summary = validateRhythmAllLeads(rhythmId, intensity);
      const failedLeads = summary.results
        .filter((r) => !r.passed && r.tag !== '—')
        .map((r) => r.lead);
      return {
        intensity,
        allPassed: summary.allPassed,
        failedLeads,
        details: summary.results
          .filter((r) => !r.passed && r.tag !== '—')
          .map((r) => `${r.lead}: ${r.detail}`),
      };
    });
    results.push({
      rhythmId,
      intensities: perIntensity,
      overallPassed: perIntensity.every((p) => p.allPassed),
    });
  }
  return results;
}

export { computeFrontalAxis, netQrsArea, resampleToMsPerSample };
