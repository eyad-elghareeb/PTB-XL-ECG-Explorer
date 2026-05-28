// ════════════════════════════════════════════════════════════════
// PER-LEAD 12-LEAD SIMULATOR VALIDATION
// Samples the synthesized waveform for each of the 12 leads and
// verifies morphology against clinical expectations per rhythm.
// ════════════════════════════════════════════════════════════════

import { generateLeadWaveformUnscaled } from "./ecg-math";
import { LEADS, INTENSITY_STAGES, rhythmRates } from "./ecg-rhythms";

export interface LeadValidationResult {
  lead: string;
  passed: boolean;
  tag: string;       // Short annotation e.g. "ST↑", "Tall R", "Inverted T"
  detail: string;    // Longer explanation
}

export interface LeadValidationSummary {
  allPassed: boolean;
  checkedLeads: number;
  passedLeads: number;
  results: LeadValidationResult[];
}

// ── Waveform Feature Extraction ───────────────────────────────────────────────

interface WaveformMetrics {
  maxVal: number;    // Peak positive (R wave)
  minVal: number;    // Peak negative (S/QS)
  stVal: number;     // Mean ST segment (35–50% of cycle)
  tVal: number;      // Mean T-wave region (55–80% of cycle)
  pVal: number;      // Mean P-wave region (0–15% of cycle)
  rRange: number;    // maxVal - minVal — overall amplitude
}

function sampleWaveformMetrics(
  rhythm: string,
  lead: string,
  intensity: number,
  bpm: number
): WaveformMetrics {
  const N = 256;
  let maxVal = -Infinity;
  let minVal = Infinity;
  let stSum = 0, stCount = 0;
  let tSum = 0, tCount = 0;
  let pSum = 0, pCount = 0;

  const waveParams = {}; // not used in auto (non-manual) mode

  for (let i = 0; i < N; i++) {
    const phase = i / N;
    const val = generateLeadWaveformUnscaled(
      rhythm, lead, bpm, intensity, phase, 0, waveParams, false
    );
    if (!Number.isFinite(val)) continue;
    if (val > maxVal) maxVal = val;
    if (val < minVal) minVal = val;

    if (phase < 0.15)                        { pSum += val; pCount++; }
    if (phase >= 0.35 && phase < 0.50)       { stSum += val; stCount++; }
    if (phase >= 0.55 && phase < 0.80)       { tSum += val; tCount++; }
  }

  const safeMax = Number.isFinite(maxVal) ? maxVal : 0;
  const safeMin = Number.isFinite(minVal) ? minVal : 0;

  return {
    maxVal: safeMax,
    minVal: safeMin,
    stVal:  stCount > 0 ? stSum / stCount : 0,
    tVal:   tCount > 0  ? tSum  / tCount  : 0,
    pVal:   pCount > 0  ? pSum  / pCount  : 0,
    rRange: safeMax - safeMin,
  };
}

// ── Per-Rhythm Lead Expectation Rules ─────────────────────────────────────────
// Each rule receives the WaveformMetrics for a specific lead and returns a
// { passed, tag, detail } tuple.  Rules return null when the lead is not
// clinically relevant for this rhythm (skipped, not failed).

type CheckFn = (m: WaveformMetrics, intensity: number) => { passed: boolean; tag: string; detail: string } | null;

interface RhythmLeadRules {
  [lead: string]: CheckFn;
}

// Helpers
const ST_ELEV_THRESHOLD   = 0.08;  // mV — meaningful ST elevation
const ST_DEP_THRESHOLD    = -0.06; // mV — meaningful ST depression
const TALL_R_THRESHOLD    = 0.80;  // mV — dominant R wave
const DEEP_S_THRESHOLD    = -0.50; // mV — deep S wave
const NEG_T_THRESHOLD     = -0.04; // mV — inverted T
const WIDE_QRS_THRESHOLD  = 0.18;  // amplitude range proxy for wide/abnormal QRS

function stElevCheck(m: WaveformMetrics): { passed: boolean; tag: string; detail: string } {
  const passed = m.stVal > ST_ELEV_THRESHOLD;
  return {
    passed,
    tag: passed ? "ST↑" : "ST flat",
    detail: passed
      ? `ST elevation confirmed (mean ST ${m.stVal.toFixed(2)} mV)`
      : `Expected ST elevation (got ${m.stVal.toFixed(2)} mV)`,
  };
}

function stDepCheck(m: WaveformMetrics): { passed: boolean; tag: string; detail: string } {
  const passed = m.stVal < ST_DEP_THRESHOLD;
  return {
    passed,
    tag: passed ? "ST↓" : "ST flat",
    detail: passed
      ? `Reciprocal ST depression confirmed (${m.stVal.toFixed(2)} mV)`
      : `Expected ST depression (got ${m.stVal.toFixed(2)} mV)`,
  };
}

function negTCheck(m: WaveformMetrics): { passed: boolean; tag: string; detail: string } {
  const passed = m.tVal < NEG_T_THRESHOLD;
  return {
    passed,
    tag: passed ? "T↓" : "T upright",
    detail: passed
      ? `T-wave inversion confirmed (mean ${m.tVal.toFixed(2)} mV)`
      : `Expected inverted T (got ${m.tVal.toFixed(2)} mV)`,
  };
}

function posTCheck(m: WaveformMetrics): { passed: boolean; tag: string; detail: string } {
  const passed = m.tVal > 0.03;
  return {
    passed,
    tag: passed ? "T+" : "T flat",
    detail: passed
      ? `Positive T wave confirmed (mean ${m.tVal.toFixed(2)} mV)`
      : `Expected positive T (got ${m.tVal.toFixed(2)} mV)`,
  };
}

// ── Rhythm-Specific Rule Tables ───────────────────────────────────────────────

const RHYTHM_LEAD_RULES: Record<string, RhythmLeadRules> = {

  // ── LBBB ─────────────────────────────────────────────────────
  lbbb: {
    V1: (m) => {
      // QS or rS — dominant negative QRS, discordant positive T
      const passed = m.minVal < DEEP_S_THRESHOLD && m.tVal > 0.02;
      return {
        passed,
        tag: passed ? "QS+T+" : "Check V1",
        detail: passed
          ? `V1: deep negative QRS (${m.minVal.toFixed(2)} mV) with concordant T+`
          : `V1 LBBB pattern weak (min=${m.minVal.toFixed(2)}, T=${m.tVal.toFixed(2)})`,
      };
    },
    V2: (m) => {
      const passed = m.minVal < DEEP_S_THRESHOLD * 0.7 && m.tVal > 0.01;
      return {
        passed,
        tag: passed ? "rS+T+" : "Check V2",
        detail: passed
          ? `V2: rS pattern with discordant T+ (${m.tVal.toFixed(2)} mV)`
          : `V2 rS pattern weak (min=${m.minVal.toFixed(2)})`,
      };
    },
    I: (m) => {
      // Broad positive R, discordant T-
      const passed = m.maxVal > TALL_R_THRESHOLD * 0.6 && m.tVal < NEG_T_THRESHOLD;
      return {
        passed,
        tag: passed ? "Broad R, T-" : "Check I",
        detail: passed
          ? `Lead I: broad R (${m.maxVal.toFixed(2)}) with discordant T inversion (${m.tVal.toFixed(2)})`
          : `Expected broad R + inverted T (R=${m.maxVal.toFixed(2)}, T=${m.tVal.toFixed(2)})`,
      };
    },
    V5: (m) => {
      const passed = m.maxVal > TALL_R_THRESHOLD * 0.5 && m.tVal < NEG_T_THRESHOLD;
      return {
        passed,
        tag: passed ? "R+, T-" : "Check V5",
        detail: passed
          ? `V5: tall R (${m.maxVal.toFixed(2)}) with ST-T discordance`
          : `V5 LBBB pattern incomplete (R=${m.maxVal.toFixed(2)}, T=${m.tVal.toFixed(2)})`,
      };
    },
    V6: (m) => {
      const passed = m.maxVal > TALL_R_THRESHOLD * 0.4 && m.tVal < NEG_T_THRESHOLD;
      return {
        passed,
        tag: passed ? "R+, T-" : "Check V6",
        detail: passed
          ? `V6: R wave (${m.maxVal.toFixed(2)}) with discordant T inversion`
          : `V6 lateral pattern weak (R=${m.maxVal.toFixed(2)}, T=${m.tVal.toFixed(2)})`,
      };
    },
  },

  // ── RBBB ─────────────────────────────────────────────────────
  rbbb: {
    V1: (m) => {
      // Terminal R' — peak positive, T inverted
      const passed = m.maxVal > TALL_R_THRESHOLD * 0.5 && m.tVal < NEG_T_THRESHOLD;
      return {
        passed,
        tag: passed ? "R', T-" : "Check V1",
        detail: passed
          ? `V1: terminal R' (${m.maxVal.toFixed(2)} mV) with T inversion`
          : `V1 rsR' pattern incomplete (R=${m.maxVal.toFixed(2)}, T=${m.tVal.toFixed(2)})`,
      };
    },
    V2: (m) => {
      const passed = m.maxVal > TALL_R_THRESHOLD * 0.4 && m.tVal < NEG_T_THRESHOLD * 0.5;
      return {
        passed,
        tag: passed ? "R', T-" : "Check V2",
        detail: passed
          ? `V2: R' pattern confirmed (${m.maxVal.toFixed(2)} mV)`
          : `V2 RBBB terminal deflection weak`,
      };
    },
    I: (m) => {
      // Wide S wave — net negative terminal
      const passed = m.minVal < DEEP_S_THRESHOLD * 0.5;
      return {
        passed,
        tag: passed ? "Wide S" : "Check I",
        detail: passed
          ? `Lead I: wide terminal S wave (${m.minVal.toFixed(2)} mV)`
          : `Expected deep S in I (got ${m.minVal.toFixed(2)})`,
      };
    },
    V5: (m) => {
      const passed = m.minVal < DEEP_S_THRESHOLD * 0.4;
      return {
        passed,
        tag: passed ? "Wide S" : "Check V5",
        detail: passed
          ? `V5: wide S wave (${m.minVal.toFixed(2)} mV) — RBBB lateral pattern`
          : `Expected wide S in V5 (got ${m.minVal.toFixed(2)})`,
      };
    },
    V6: (m) => {
      const passed = m.minVal < DEEP_S_THRESHOLD * 0.35;
      return {
        passed,
        tag: passed ? "Wide S" : "Check V6",
        detail: passed
          ? `V6: wide terminal S (${m.minVal.toFixed(2)}) — RBBB lateral pattern`
          : `Expected wide S in V6 (got ${m.minVal.toFixed(2)})`,
      };
    },
  },

  // ── LVH ──────────────────────────────────────────────────────
  lvh: {
    I: (m, i) => {
      const minInt = 0.25;
      if (i < minInt) return null;
      const passed = m.maxVal > TALL_R_THRESHOLD && m.stVal < 0 && m.tVal < NEG_T_THRESHOLD;
      return {
        passed,
        tag: passed ? "Tall R+Strain" : "Check I",
        detail: passed
          ? `Lead I: tall R (${m.maxVal.toFixed(2)}) + strain (ST ${m.stVal.toFixed(2)}, T ${m.tVal.toFixed(2)})`
          : `LVH lateral strain pattern incomplete in I`,
      };
    },
    V5: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.maxVal > TALL_R_THRESHOLD * 1.1 && m.tVal < NEG_T_THRESHOLD;
      return {
        passed,
        tag: passed ? "HV+Strain" : "Check V5",
        detail: passed
          ? `V5: high-voltage R (${m.maxVal.toFixed(2)}) with repolarization strain`
          : `LVH voltage/strain in V5 not fully expressed (R=${m.maxVal.toFixed(2)})`,
      };
    },
    V6: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.maxVal > TALL_R_THRESHOLD * 0.7 && m.tVal < NEG_T_THRESHOLD;
      return {
        passed,
        tag: passed ? "R+, T-" : "Check V6",
        detail: passed
          ? `V6: R (${m.maxVal.toFixed(2)}) + strain T inversion`
          : `V6 LVH strain incomplete`,
      };
    },
    V1: (m) => {
      const passed = m.minVal < DEEP_S_THRESHOLD;
      return {
        passed,
        tag: passed ? "Deep S" : "Check V1",
        detail: passed
          ? `V1: deep S (${m.minVal.toFixed(2)}) — LVH right-precordial criterion`
          : `V1 deep S not pronounced (${m.minVal.toFixed(2)})`,
      };
    },
    V2: (m) => {
      const passed = m.minVal < DEEP_S_THRESHOLD * 0.8;
      return {
        passed,
        tag: passed ? "Deep S" : "Check V2",
        detail: passed
          ? `V2: deep S wave (${m.minVal.toFixed(2)} mV) consistent with LVH`
          : `V2 deep S pattern weak`,
      };
    },
  },

  // ── RVH ──────────────────────────────────────────────────────
  rvh: {
    V1: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.maxVal > TALL_R_THRESHOLD * 0.7 && m.stVal < 0;
      return {
        passed,
        tag: passed ? "Dom R+Strain" : "Check V1",
        detail: passed
          ? `V1: dominant R (${m.maxVal.toFixed(2)}) + RV strain (ST ${m.stVal.toFixed(2)})`
          : `RVH dominant R in V1 not expressed (R=${m.maxVal.toFixed(2)})`,
      };
    },
    V5: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.minVal < DEEP_S_THRESHOLD * 0.5;
      return {
        passed,
        tag: passed ? "Deep S" : "Check V5",
        detail: passed
          ? `V5: deep S (${m.minVal.toFixed(2)}) — RVH lateral criterion`
          : `V5 deep S pattern weak for RVH`,
      };
    },
    V6: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.minVal < DEEP_S_THRESHOLD * 0.4;
      return {
        passed,
        tag: passed ? "Deep S" : "Check V6",
        detail: passed
          ? `V6: deep S (${m.minVal.toFixed(2)}) — RVH lateral pattern`
          : `V6 lateral S pattern weak`,
      };
    },
  },

  // ── Brugada ──────────────────────────────────────────────────
  brugada: {
    V1: (m, i) => {
      if (i < 0.3) return null;
      const passed = m.stVal > ST_ELEV_THRESHOLD * 0.8 && m.tVal < NEG_T_THRESHOLD;
      return {
        passed,
        tag: passed ? "Coved" : "Check V1",
        detail: passed
          ? `V1: coved ST elevation (${m.stVal.toFixed(2)}) + negative T (${m.tVal.toFixed(2)}) — Brugada type 1`
          : `V1 Brugada coved pattern not fully expressed (ST=${m.stVal.toFixed(2)}, T=${m.tVal.toFixed(2)})`,
      };
    },
    V2: (m, i) => {
      if (i < 0.25) return null;
      const passed = m.stVal > ST_ELEV_THRESHOLD * 0.5;
      return {
        passed,
        tag: passed ? "ST↑" : "Check V2",
        detail: passed
          ? `V2: ST elevation (${m.stVal.toFixed(2)}) — Brugada right-precordial pattern`
          : `V2 Brugada ST elevation not confirmed (${m.stVal.toFixed(2)})`,
      };
    },
    // Other leads should be relatively normal
    II: (m) => {
      const passed = Math.abs(m.stVal) < ST_ELEV_THRESHOLD;
      return {
        passed,
        tag: passed ? "Normal" : "Abnormal",
        detail: passed
          ? `Lead II: no significant ST change (${m.stVal.toFixed(2)}) — Brugada is right-specific`
          : `Unexpected ST deviation in II — Brugada should be V1/V2 specific`,
      };
    },
  },

  // ── Posterior MI ─────────────────────────────────────────────
  pwmi: {
    V1: (m) => {
      const passed = m.stVal < ST_DEP_THRESHOLD && m.maxVal > TALL_R_THRESHOLD * 0.4 && m.tVal > 0.03;
      return {
        passed,
        tag: passed ? "ST↓, Tall R, T+" : "Check V1",
        detail: passed
          ? `V1: posterior MI mirror — ST↓ (${m.stVal.toFixed(2)}), tall R (${m.maxVal.toFixed(2)}), T+ (${m.tVal.toFixed(2)})`
          : `V1 posterior pattern incomplete (ST=${m.stVal.toFixed(2)}, R=${m.maxVal.toFixed(2)})`,
      };
    },
    V2: (m) => {
      const passed = m.stVal < ST_DEP_THRESHOLD && m.tVal > 0.02;
      return {
        passed,
        tag: passed ? "ST↓, T+" : "Check V2",
        detail: passed
          ? `V2: reciprocal posterior MI (ST ${m.stVal.toFixed(2)}, T ${m.tVal.toFixed(2)})`
          : `V2 posterior reciprocal pattern weak`,
      };
    },
    V3: (m) => {
      const passed = m.stVal < 0;
      return {
        passed,
        tag: passed ? "ST↓" : "Check V3",
        detail: passed
          ? `V3: some reciprocal ST depression (${m.stVal.toFixed(2)})`
          : `V3 ST depression absent`,
      };
    },
  },

  // ── Pericarditis ─────────────────────────────────────────────
  pericarditis: {
    II: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.stVal > ST_ELEV_THRESHOLD;
      return {
        passed,
        tag: passed ? "Diffuse ST↑" : "Check II",
        detail: passed
          ? `Lead II: diffuse pericarditis ST elevation (${m.stVal.toFixed(2)} mV)`
          : `Expected concave ST elevation in II (${m.stVal.toFixed(2)})`,
      };
    },
    V5: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.stVal > ST_ELEV_THRESHOLD;
      return {
        passed,
        tag: passed ? "ST↑" : "Check V5",
        detail: passed
          ? `V5: pericarditis ST elevation (${m.stVal.toFixed(2)})`
          : `Expected ST elevation in V5 (got ${m.stVal.toFixed(2)})`,
      };
    },
    V1: (m, i) => {
      // aVR/V1 classically show reciprocal depression or PR depression
      if (i < 0.25) return null;
      const passed = m.stVal < ST_ELEV_THRESHOLD * 0.5;
      return {
        passed,
        tag: passed ? "No ST↑" : "Unexpected ST↑",
        detail: passed
          ? `V1: no ST elevation — consistent with pericarditis (V1 typically spared or depressed)`
          : `V1 unexpectedly shows ST elevation in pericarditis`,
      };
    },
  },

  // ── Wellens ───────────────────────────────────────────────────
  wellens: {
    V2: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.tVal < NEG_T_THRESHOLD * 0.7;
      return {
        passed,
        tag: passed ? "T inv" : "Check V2",
        detail: passed
          ? `V2: T-wave inversion (${m.tVal.toFixed(2)}) — Wellens type B pattern`
          : `V2 T inversion not sufficient (${m.tVal.toFixed(2)})`,
      };
    },
    V3: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.tVal < NEG_T_THRESHOLD;
      return {
        passed,
        tag: passed ? "T inv" : "Check V3",
        detail: passed
          ? `V3: T inversion (${m.tVal.toFixed(2)}) — Wellens anterior pattern`
          : `V3 T inversion weak (${m.tVal.toFixed(2)})`,
      };
    },
    V5: (m) => {
      // Should remain relatively normal
      const passed = m.tVal > NEG_T_THRESHOLD;
      return {
        passed,
        tag: passed ? "Normal T" : "T inv",
        detail: passed
          ? `V5: T-wave positive — Wellens limited to V2/V3`
          : `V5 T inversion unexpected for Wellens`,
      };
    },
  },

  // ── De Winter ─────────────────────────────────────────────────
  dewinter: {
    V2: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.stVal < ST_DEP_THRESHOLD && m.tVal > 0.10;
      return {
        passed,
        tag: passed ? "ST↓, Tall T" : "Check V2",
        detail: passed
          ? `V2: De Winter ST depression (${m.stVal.toFixed(2)}) + tall T (${m.tVal.toFixed(2)})`
          : `V2 De Winter pattern incomplete (ST=${m.stVal.toFixed(2)}, T=${m.tVal.toFixed(2)})`,
      };
    },
    V4: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.stVal < 0 && m.tVal > 0.08;
      return {
        passed,
        tag: passed ? "ST↓, T↑" : "Check V4",
        detail: passed
          ? `V4: upsloping depression + tall T (T=${m.tVal.toFixed(2)})`
          : `V4 De Winter pattern incomplete`,
      };
    },
    V6: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.stVal < 0 && m.tVal > 0.04;
      return {
        passed,
        tag: passed ? "ST↓" : "Check V6",
        detail: passed
          ? `V6: ST depression (${m.stVal.toFixed(2)}) — De Winter LAD occlusion`
          : `V6 ST depression absent`,
      };
    },
  },

  // ── WPW ──────────────────────────────────────────────────────
  wpw: {
    I: (m, i) => {
      if (i < 0.2) return null;
      // Wide QRS (delta wave slurs onset), discordant T
      const passed = m.rRange > WIDE_QRS_THRESHOLD && m.tVal < 0;
      return {
        passed,
        tag: passed ? "Delta+T-" : "Check I",
        detail: passed
          ? `Lead I: wide QRS with delta slur (range ${m.rRange.toFixed(2)}) + discordant T (${m.tVal.toFixed(2)})`
          : `WPW delta-wave morphology not prominent in I`,
      };
    },
    V1: (m, i) => {
      if (i < 0.2) return null;
      // May show positive delta (type A) or negative (type B) depending on accessory pathway
      const passed = m.rRange > WIDE_QRS_THRESHOLD * 0.8;
      return {
        passed,
        tag: passed ? "Wide QRS" : "Check V1",
        detail: passed
          ? `V1: QRS widened by delta wave (range ${m.rRange.toFixed(2)})`
          : `V1 WPW QRS widening not expressed`,
      };
    },
  },

  // ── Hyperkalemia ─────────────────────────────────────────────
  hyperk: {
    II: (m) => {
      // Tall narrow T (peaked), possible QRS widening at higher intensity
      const passed = m.tVal > 0.15 || m.maxVal > TALL_R_THRESHOLD * 0.6;
      return {
        passed,
        tag: passed ? "Peaked T" : "Check II",
        detail: passed
          ? `Lead II: peaked T (${m.tVal.toFixed(2)}) — hyperkalemia early sign`
          : `Hyperkalemia T-wave peaking not expressed in II (T=${m.tVal.toFixed(2)})`,
      };
    },
    V4: (m) => {
      const passed = m.tVal > 0.12;
      return {
        passed,
        tag: passed ? "Peaked T" : "Check V4",
        detail: passed
          ? `V4: peaked T (${m.tVal.toFixed(2)}) — hyperkalemia precordial pattern`
          : `V4 T peaking weak (${m.tVal.toFixed(2)})`,
      };
    },
    V5: (m) => {
      const passed = m.tVal > 0.10;
      return {
        passed,
        tag: passed ? "Peaked T" : "Check V5",
        detail: passed
          ? `V5: peaked T (${m.tVal.toFixed(2)})`
          : `V5 T peaking weak`,
      };
    },
  },

  // ── Hypokalemia ──────────────────────────────────────────────
  hypokalemia: {
    II: (m, i) => {
      if (i < 0.15) return null;
      // Flat T, prominent U (U modelled as late positive wave)
      const passed = m.tVal < 0.10 && m.stVal < 0;
      return {
        passed,
        tag: passed ? "T flat, ST↓" : "Check II",
        detail: passed
          ? `Lead II: T flattening (${m.tVal.toFixed(2)}) + ST depression — hypokalemia`
          : `Hypokalemia T-flat/ST-dep pattern incomplete in II`,
      };
    },
    V5: (m, i) => {
      if (i < 0.15) return null;
      const passed = m.tVal < 0.12 && m.stVal < 0;
      return {
        passed,
        tag: passed ? "T flat" : "Check V5",
        detail: passed
          ? `V5: T flattening/inversion (${m.tVal.toFixed(2)}) — hypokalemia`
          : `V5 hypokalemia T change weak`,
      };
    },
  },

  // ── Hypothermia ───────────────────────────────────────────────
  hypothermia: {
    II: (m, i) => {
      if (i < 0.2) return null;
      // J-wave (Osborn) — positive notch just after QRS
      const passed = m.stVal > 0.02;
      return {
        passed,
        tag: passed ? "J-wave" : "Check II",
        detail: passed
          ? `Lead II: J-wave/Osborn wave visible (ST region ${m.stVal.toFixed(2)}) — hypothermia`
          : `J-wave in II not clearly expressed (${m.stVal.toFixed(2)})`,
      };
    },
    V5: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.stVal > 0.015;
      return {
        passed,
        tag: passed ? "J-wave" : "Check V5",
        detail: passed
          ? `V5: Osborn J-wave (${m.stVal.toFixed(2)}) — hypothermia lateral`
          : `V5 Osborn wave not confirmed (${m.stVal.toFixed(2)})`,
      };
    },
    V6: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.stVal > 0.01;
      return {
        passed,
        tag: passed ? "J-wave" : "Check V6",
        detail: passed
          ? `V6: Osborn wave (${m.stVal.toFixed(2)})`
          : `V6 Osborn wave absent`,
      };
    },
  },

  // ── Digoxin effect ────────────────────────────────────────────
  digoxin: {
    I:  (m, i) => {
      if (i < 0.15) return null;
      const passed = m.stVal < ST_DEP_THRESHOLD;
      return {
        passed,
        tag: passed ? "Sag ST" : "Check I",
        detail: passed
          ? `Lead I: scooped ST depression (${m.stVal.toFixed(2)}) — digoxin effect`
          : `Digoxin sag not confirmed in I (${m.stVal.toFixed(2)})`,
      };
    },
    II: (m, i) => {
      if (i < 0.15) return null;
      const passed = m.stVal < ST_DEP_THRESHOLD;
      return {
        passed,
        tag: passed ? "Sag ST" : "Check II",
        detail: passed
          ? `Lead II: ST sagging (${m.stVal.toFixed(2)}) — digoxin pattern`
          : `Digoxin sag in II not confirmed (${m.stVal.toFixed(2)})`,
      };
    },
    V5: (m, i) => {
      if (i < 0.15) return null;
      const passed = m.stVal < ST_DEP_THRESHOLD;
      return {
        passed,
        tag: passed ? "Sag ST" : "Check V5",
        detail: passed
          ? `V5: sagging ST depression (${m.stVal.toFixed(2)})`
          : `Digoxin sag in V5 not confirmed`,
      };
    },
    V6: (m, i) => {
      if (i < 0.15) return null;
      const passed = m.stVal < ST_DEP_THRESHOLD;
      return {
        passed,
        tag: passed ? "Sag ST" : "Check V6",
        detail: passed
          ? `V6: ST sagging (${m.stVal.toFixed(2)}) — digoxin lateral`
          : `V6 digoxin sag absent`,
      };
    },
  },

  // ── Pulmonary Embolism ────────────────────────────────────────
  pe: {
    I: (m, i) => {
      if (i < 0.25) return null;
      // S1 — deep S wave in lead I
      const passed = m.minVal < DEEP_S_THRESHOLD * 0.5;
      return {
        passed,
        tag: passed ? "S1" : "Check I",
        detail: passed
          ? `Lead I: S wave (${m.minVal.toFixed(2)}) — S1Q3T3 pattern in PE`
          : `Lead I S wave for S1Q3T3 not prominent (${m.minVal.toFixed(2)})`,
      };
    },
    V1: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.tVal < NEG_T_THRESHOLD || m.stVal < 0;
      return {
        passed,
        tag: passed ? "RV strain" : "Check V1",
        detail: passed
          ? `V1: right heart strain pattern (T=${m.tVal.toFixed(2)}, ST=${m.stVal.toFixed(2)})`
          : `V1 RV strain not confirmed`,
      };
    },
    V2: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.tVal < 0.05;
      return {
        passed,
        tag: passed ? "T flat/inv" : "Check V2",
        detail: passed
          ? `V2: T flattening (${m.tVal.toFixed(2)}) — anterior RV strain in PE`
          : `V2 anterior strain T change not expressed`,
      };
    },
  },

  // ── Long QT ───────────────────────────────────────────────────
  longqt: {
    II: (m, i) => {
      if (i < 0.2) return null;
      // Prolonged T — T region should contain larger amplitude across extended phase
      const passed = m.tVal > 0.08 && m.rRange > 0.5;
      return {
        passed,
        tag: passed ? "Long T" : "Check II",
        detail: passed
          ? `Lead II: prolonged T-wave region (T mean ${m.tVal.toFixed(2)}) — Long QT`
          : `Long QT T prolongation not clearly expressed in II`,
      };
    },
    V5: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.tVal > 0.06;
      return {
        passed,
        tag: passed ? "Long T" : "Check V5",
        detail: passed
          ? `V5: prolonged T-wave (${m.tVal.toFixed(2)}) — Long QT lateral`
          : `V5 T-wave prolongation not expressed`,
      };
    },
  },

  // ── Left Atrial Hypertrophy ───────────────────────────────────
  lah: {
    II: (m) => {
      // Broad, bifid P — P amplitude/duration increased
      const passed = m.pVal > 0.04;
      return {
        passed,
        tag: passed ? "Broad P" : "Check P",
        detail: passed
          ? `Lead II: broad bifid P (${m.pVal.toFixed(2)}) — P mitrale`
          : `P mitrale pattern not confirmed in II (${m.pVal.toFixed(2)})`,
      };
    },
    V1: (m) => {
      // Terminal negative P component in V1
      const passed = m.minVal < -0.02;
      return {
        passed,
        tag: passed ? "P neg" : "Check V1",
        detail: passed
          ? `V1: terminal negative P deflection (${m.minVal.toFixed(2)}) — LAH`
          : `V1 terminal P negativity not expressed`,
      };
    },
  },

  // ── Right Atrial Hypertrophy ──────────────────────────────────
  rah: {
    II: (m, i) => {
      if (i < 0.2) return null;
      // Tall peaked P — P pulmonale
      const passed = m.pVal > 0.08;
      return {
        passed,
        tag: passed ? "Tall P" : "Check P",
        detail: passed
          ? `Lead II: tall peaked P (${m.pVal.toFixed(2)}) — P pulmonale`
          : `P pulmonale not fully expressed in II (${m.pVal.toFixed(2)})`,
      };
    },
    V1: (m, i) => {
      if (i < 0.2) return null;
      const passed = m.pVal > 0.05;
      return {
        passed,
        tag: passed ? "Tall P" : "Check V1",
        detail: passed
          ? `V1: initial tall P positivity (${m.pVal.toFixed(2)}) — RAH`
          : `V1 RA initial P positivity weak`,
      };
    },
  },

  // ── LAFB ─────────────────────────────────────────────────────
  lafb: {
    I: (m, i) => {
      if (i < 0.2) return null;
      // qR pattern in I — positive QRS
      const passed = m.maxVal > TALL_R_THRESHOLD * 0.4 && m.maxVal > Math.abs(m.minVal);
      return {
        passed,
        tag: passed ? "qR" : "Check I",
        detail: passed
          ? `Lead I: qR pattern (R=${m.maxVal.toFixed(2)}) — LAFB left-axis`
          : `LAFB qR in I not clear (R=${m.maxVal.toFixed(2)}, S=${m.minVal.toFixed(2)})`,
      };
    },
    II: (m, i) => {
      if (i < 0.2) return null;
      // rS pattern in II — deep S, small r
      const passed = m.minVal < DEEP_S_THRESHOLD * 0.4 && Math.abs(m.minVal) > m.maxVal;
      return {
        passed,
        tag: passed ? "rS" : "Check II",
        detail: passed
          ? `Lead II: rS pattern (S=${m.minVal.toFixed(2)}) — LAFB inferior axis`
          : `LAFB rS in II not confirmed (R=${m.maxVal.toFixed(2)}, S=${m.minVal.toFixed(2)})`,
      };
    },
  },

  // ── LPFB ─────────────────────────────────────────────────────
  lpfb: {
    I: (m, i) => {
      if (i < 0.2) return null;
      // rS in I — right axis tendency
      const passed = m.minVal < DEEP_S_THRESHOLD * 0.4 && Math.abs(m.minVal) > m.maxVal;
      return {
        passed,
        tag: passed ? "rS" : "Check I",
        detail: passed
          ? `Lead I: rS (right axis) — LPFB pattern (S=${m.minVal.toFixed(2)})`
          : `LPFB rS in I not expressed`,
      };
    },
    II: (m, i) => {
      if (i < 0.2) return null;
      // qR in II — positive QRS
      const passed = m.maxVal > TALL_R_THRESHOLD * 0.4 && m.maxVal > Math.abs(m.minVal);
      return {
        passed,
        tag: passed ? "qR" : "Check II",
        detail: passed
          ? `Lead II: qR — LPFB inferior axis pattern (R=${m.maxVal.toFixed(2)})`
          : `LPFB qR in II not confirmed`,
      };
    },
  },
};

// ── Build STEMI rules dynamically ────────────────────────────────────────────

const STEMI_CULPRIT_MAP: Record<string, string[]> = {
  stemi_ant:    ['V1','V2','V3','V4'],
  stemi_inf:    ['II','III','aVF'],
  stemi_lat:    ['I','aVL','V5','V6'],
  stemi_antlat: ['V1','V2','V3','V4','V5','V6','I','aVL'],
  stemi_inflat: ['II','III','aVF','V5','V6'],
  stemi_rv:     ['V1'],
};

const STEMI_RECIPROCAL_MAP: Record<string, string[]> = {
  stemi_ant:    ['II','III','aVF'],
  stemi_inf:    ['I','aVL'],
  stemi_lat:    ['V1','V2','V3'],
  stemi_antlat: ['II','III','aVF'],
  stemi_inflat: ['I','aVL'],
  stemi_rv:     ['I','aVL','V5','V6'],
};

function buildStemiRules(rhythmId: string): RhythmLeadRules {
  const culprits = STEMI_CULPRIT_MAP[rhythmId] || [];
  const reciprocals = STEMI_RECIPROCAL_MAP[rhythmId] || [];
  const rules: RhythmLeadRules = {};

  for (const lead of culprits) {
    rules[lead] = (m, i) => {
      if (i < 0.2) return null;
      return stElevCheck(m);
    };
  }
  for (const lead of reciprocals) {
    rules[lead] = (m, i) => {
      if (i < 0.35) return null;
      return stDepCheck(m);
    };
  }
  return rules;
}

// Inject STEMI rules
for (const rhythmId of Object.keys(STEMI_CULPRIT_MAP)) {
  RHYTHM_LEAD_RULES[rhythmId] = buildStemiRules(rhythmId);
}

// ── Main Validation Entry Point ───────────────────────────────────────────────

export function validateRhythmAllLeads(
  rhythmId: string,
  intensity: number
): LeadValidationSummary {
  const rules = RHYTHM_LEAD_RULES[rhythmId];
  if (!rules) {
    // Rhythm has no lead-specific rules — return a neutral summary
    return {
      allPassed: true,
      checkedLeads: 0,
      passedLeads: 0,
      results: LEADS.map((lead) => ({
        lead,
        passed: true,
        tag: "—",
        detail: "No lead-specific clinical rules defined for this rhythm.",
      })),
    };
  }

  const config = INTENSITY_STAGES[rhythmId];
  const bpm = config?.hrMod ? Math.max(20, Math.round(config.hrMod(intensity))) : (rhythmRates[rhythmId] || 72);
  const clampedBpm = Math.max(20, Math.min(240, bpm));

  const results: LeadValidationResult[] = LEADS.map((lead) => {
    const rule = rules[lead];
    if (!rule) {
      return {
        lead,
        passed: true,
        tag: "—",
        detail: "No specific expectation defined for this lead.",
      };
    }

    const metrics = sampleWaveformMetrics(rhythmId, lead, intensity, clampedBpm);
    const result = rule(metrics, intensity);

    if (result === null) {
      // Rule returned null → intensity not high enough to check, skip
      return {
        lead,
        passed: true,
        tag: "—",
        detail: "Check deferred — intensity below threshold for this criterion.",
      };
    }

    return { lead, ...result };
  });

  const checkedResults = results.filter((r) => r.tag !== "—");
  const passedResults  = checkedResults.filter((r) => r.passed);

  return {
    allPassed: checkedResults.every((r) => r.passed),
    checkedLeads: checkedResults.length,
    passedLeads:  passedResults.length,
    results,
  };
}
