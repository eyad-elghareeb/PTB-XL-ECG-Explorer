"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import {
  RHYTHM_CLASSIFICATIONS,
  RHYTHMS,
  ICONS,
  INTENSITY_STAGES,
  rhythmRates,
  LAYOUT_12,
  LEADS,
  BEAT_AWARE_RHYTHMS,
  LEAD_TARGET_AMPLITUDE,
  validateRhythmProfile
} from "../lib/ecg-rhythms";
import {
  getWaveformForBeatIndex,
  buildAllLeadLUTs,
  sampleLeadLUT,
  addTraceNoise
} from "../lib/ecg-math";
import { validateRhythmAllLeads } from "../lib/ecg-validate";

function getImpureTimestamp(): string {
  if (typeof window !== "undefined") {
    return String(Math.floor(window.performance.now() + Date.now()));
  }
  return "0";
}

function getRecordSignalForLead(signals: any, leadName: string): number[] | null {
  if (!signals || !leadName) return null;
  
  let targetArr: number[] | null = null;
  if (Array.isArray(signals[leadName])) {
    targetArr = signals[leadName];
  } else {
    const lowerName = leadName.toLowerCase();
    for (const key of Object.keys(signals)) {
      if (key.toLowerCase() === lowerName) {
        if (Array.isArray(signals[key])) {
          targetArr = signals[key];
          break;
        }
      }
    }
    if (!targetArr) {
      const mappings: Record<string, string> = {
        avr: "AVR", avl: "AVL", avf: "AVF",
        "aVR": "AVR", "aVL": "AVL", "aVF": "AVF",
      "AVR": "aVR", "AVL": "aVL", "AVF": "aVF"
      };
      const targetKey = mappings[leadName] || mappings[lowerName];
      if (targetKey && Array.isArray(signals[targetKey])) {
        targetArr = signals[targetKey];
      }
    }
  }
  
  return targetArr;
}

interface DbLoopWindow {
  startSec: number;
  durationSec: number;
  source: "rpeak" | "full";
}

const DEFAULT_DB_SIGNAL_DURATION_SEC = 10.0;

function positiveModulo(value: number, modulo: number): number {
  if (modulo <= 0) return 0;
  return ((value % modulo) + modulo) % modulo;
}

function clampSignalValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function sampleDbSignal(
  signal: number[],
  absoluteTimeSec: number,
  frequency: number,
  loop: DbLoopWindow,
  smoothing: boolean
): { value: number; sampleIndex: number; wrappedTimeSec: number } {
  const len = signal.length;
  if (len === 0) return { value: 0, sampleIndex: 0, wrappedTimeSec: 0 };

  const inferredDuration = frequency > 0 ? len / frequency : DEFAULT_DB_SIGNAL_DURATION_SEC;
  const fullDuration = Math.max(0.001, inferredDuration || DEFAULT_DB_SIGNAL_DURATION_SEC);
  const loopStart = Math.min(Math.max(loop.startSec, 0), fullDuration);
  const loopDuration = Math.min(Math.max(loop.durationSec, 0.001), fullDuration);
  const wrappedTimeSec = positiveModulo(absoluteTimeSec, loopDuration);
  const signalTimeSec = positiveModulo(loopStart + wrappedTimeSec, fullDuration);
  const floatIndex = positiveModulo(signalTimeSec * Math.max(1, frequency), len);
  const idx1 = Math.floor(floatIndex) % len;
  const frac = floatIndex - Math.floor(floatIndex);
  const idx2 = (idx1 + 1) % len;

  if (!smoothing) {
    const val1 = clampSignalValue(signal[idx1]);
    const val2 = clampSignalValue(signal[idx2]);
    return {
      value: val1 * (1 - frac) + val2 * frac,
      sampleIndex: idx1,
      wrappedTimeSec
    };
  }

  const idx0 = (idx1 - 1 + len) % len;
  const idx3 = (idx1 + 2) % len;
  return {
    value: catmullRom(
      clampSignalValue(signal[idx0]),
      clampSignalValue(signal[idx1]),
      clampSignalValue(signal[idx2]),
      clampSignalValue(signal[idx3]),
      frac
    ),
    sampleIndex: idx1,
    wrappedTimeSec
  };
}

function buildDbLoopWindow(signals: any, frequency: number): DbLoopWindow {
  const fallback: DbLoopWindow = {
    startSec: 0,
    durationSec: DEFAULT_DB_SIGNAL_DURATION_SEC,
    source: "full"
  };
  const leadII = getRecordSignalForLead(signals, "II");
  if (!leadII || leadII.length < Math.max(10, frequency * 2)) return fallback;

  const fullDuration = frequency > 0 ? leadII.length / frequency : DEFAULT_DB_SIGNAL_DURATION_SEC;
  const analysis = analyzeECGPeaks(signals, "II", frequency);
  const peaks = analysis?.peaksInfo || [];
  if (peaks.length < 3) {
    return { ...fallback, durationSec: Math.max(0.001, fullDuration || DEFAULT_DB_SIGNAL_DURATION_SEC) };
  }

  const firstPeak = peaks[0]?.time;
  const lastPeak = peaks[peaks.length - 1]?.time;
  if (typeof firstPeak !== "number" || typeof lastPeak !== "number" || lastPeak <= firstPeak) {
    return { ...fallback, durationSec: Math.max(0.001, fullDuration || DEFAULT_DB_SIGNAL_DURATION_SEC) };
  }

  const rrIntervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const prev = peaks[i - 1]?.time;
    const next = peaks[i]?.time;
    if (typeof prev === "number" && typeof next === "number" && next > prev) {
      rrIntervals.push(next - prev);
    }
  }
  const medianRR = rrIntervals.length > 0
    ? [...rrIntervals].sort((a, b) => a - b)[Math.floor(rrIntervals.length / 2)]
    : 0.8;

  const startSec = Math.max(0, firstPeak - medianRR * 0.45);
  const endSec = Math.min(fullDuration, lastPeak + medianRR * 0.55);
  const durationSec = endSec - startSec;
  if (durationSec < 2.0) {
    return { ...fallback, durationSec: Math.max(0.001, fullDuration || DEFAULT_DB_SIGNAL_DURATION_SEC) };
  }

  return { startSec, durationSec, source: "rpeak" };
}

function isLikelyEnglishReport(raw: string | null): boolean {
  if (!raw) return true;
  const text = raw.trim();
  if (!text) return true;
  if (/[äöüÄÖÜß]|Linkstyp|Rechtstyp|Schenkelblock|Vorhof|Herz|Infarkt|Strecke|Sinusrhythmus/i.test(text)) {
    return false;
  }
  if (/[åäöÅÄÖ]|vänster|höger|sinusrytm|förmaks|hjärt/i.test(text)) {
    return false;
  }
  const englishHints = /\b(normal|sinus|rhythm|block|infarction|ischemia|axis|ventricular|atrial|left|right|heart|ecg|st|t wave)\b/i;
  return englishHints.test(text) || /^[\x00-\x7F]+$/.test(text);
}

// ── Rich SCP Code Reference (PhysioNet 1.0.1 aligned) ─────────────────────────
interface ScpInfo {
  name: string;         // Full human-readable medical name
  simple: string;       // Plain-English explanation for beginners
  severity: "normal" | "mild" | "moderate" | "severe" | "critical";
  icon: string;         // FontAwesome icon class
  tip: string;          // ECG teaching tip: what to look for on the tracing
}

function scpInfo(
  name: string,
  simple: string,
  severity: ScpInfo["severity"],
  icon: string,
  tip: string
): ScpInfo {
  return { name, simple, severity, icon, tip };
}

const SCP_INFO: Record<string, ScpInfo> = {
  NORM: scpInfo(
    "Normal ECG",
    "All measurements are within normal limits.",
    "normal",
    "fa-solid fa-circle-check",
    "Regular rhythm, upright P before each QRS, PR interval 120–200ms, narrow QRS <120ms, normal T waves."
  ),
  MI: scpInfo(
    "Myocardial Infarction",
    "Umbrella class for infarction patterns in the PTB-XL code set.",
    "critical",
    "fa-solid fa-heart-crack",
    "Usually appears as infarction-pattern codes such as IMI, AMI, LMI, or PMI."
  ),
  CD: scpInfo(
    "Conduction Disturbance",
    "Umbrella class for AV, bundle-branch, and fascicular conduction problems.",
    "moderate",
    "fa-solid fa-code-branch",
    "Look for PR prolongation, bundle branch patterns, or axis shifts."
  ),
  HYP: scpInfo(
    "Hypertrophy",
    "Umbrella class for chamber hypertrophy or overload patterns.",
    "moderate",
    "fa-solid fa-weight-hanging",
    "Look for voltage criteria, axis deviation, or atrial enlargement patterns."
  ),
  STTC: scpInfo(
    "ST-T Changes",
    "Umbrella class for repolarization abnormalities and nonspecific ST-T patterns.",
    "moderate",
    "fa-solid fa-wave-square",
    "Look for ST elevation/depression, T-wave inversion, low amplitude T waves, or digitalis-effect patterns."
  ),
  NDT: scpInfo(
    "Non-diagnostic T Abnormalities",
    "T-wave changes that are too nonspecific to classify further.",
    "mild",
    "fa-solid fa-wave-square",
    "Look for nonspecific T-wave flattening, inversion, or minor repolarization shifts."
  ),
  NST_: scpInfo(
    "Non-specific ST Changes",
    "ST changes that do not fit a specific ischemic pattern.",
    "mild",
    "fa-solid fa-wave-square",
    "Look for mild ST deviation without a classic localization pattern."
  ),
  DIG: scpInfo(
    "Digitalis-Effect",
    "Classic repolarization changes associated with digoxin exposure.",
    "moderate",
    "fa-solid fa-prescription-bottle-medical",
    "Look for the characteristic scooped ST segment and associated ST-T changes."
  ),
  LNGQT: scpInfo(
    "Long QT-Interval",
    "Delayed repolarization that can increase arrhythmia risk.",
    "severe",
    "fa-solid fa-hourglass-half",
    "Measure the QT interval carefully, especially at slower rates."
  ),
  IMI: scpInfo(
    "Inferior Myocardial Infarction",
    "Infarction pattern localized to the inferior wall.",
    "critical",
    "fa-solid fa-heart-crack",
    "Look for Q waves or ST-T changes in II, III, and aVF."
  ),
  ASMI: scpInfo(
    "Anteroseptal Myocardial Infarction",
    "Infarction pattern localized to the anteroseptal region.",
    "critical",
    "fa-solid fa-heart-crack",
    "Look for Q waves or ST-T changes in V1–V4."
  ),
  LVH: scpInfo(
    "Left Ventricular Hypertrophy",
    "Left ventricular hypertrophy pattern.",
    "moderate",
    "fa-solid fa-weight-hanging",
    "Look for tall lateral R waves, deep septal S waves, and possible strain changes."
  ),
  LAFB: scpInfo(
    "Left Anterior Fascicular Block",
    "Left anterior fascicular conduction block.",
    "mild",
    "fa-solid fa-code-branch",
    "Look for left axis deviation with the typical qR / rS pattern."
  ),
  ISC_: scpInfo(
    "Non-specific Ischemic",
    "Broad ischemic ST-T abnormality without a more specific localization.",
    "moderate",
    "fa-solid fa-droplet-slash",
    "Look for ST depression or T-wave inversion that does not localize cleanly."
  ),
  IRBBB: scpInfo(
    "Incomplete Right Bundle Branch Block",
    "Partial right bundle branch delay.",
    "mild",
    "fa-solid fa-code-branch",
    "Look for an rSR' pattern in V1 with QRS still under the complete block threshold."
  ),
  "1AVB": scpInfo(
    "First Degree AV Block",
    "PR prolongation with every P wave still conducted.",
    "mild",
    "fa-solid fa-hourglass-half",
    "Look for PR interval >200ms with preserved 1:1 AV conduction."
  ),
  IVCD: scpInfo(
    "Non-specific Intraventricular Conduction Disturbance",
    "Widened QRS conduction delay that does not meet a specific bundle-branch block pattern.",
    "moderate",
    "fa-solid fa-bolt-lightning",
    "Look for a widened QRS without classic LBBB or RBBB morphology."
  ),
  ISCAL: scpInfo(
    "Ischemic in Anterolateral Leads",
    "Ischemic ST-T changes involving the anterolateral leads.",
    "moderate",
    "fa-solid fa-droplet-slash",
    "Look for ST/T abnormalities in V1–V6, I, or aVL."
  ),
  CRBBB: scpInfo(
    "Complete Right Bundle Branch Block",
    "Complete right bundle branch block pattern.",
    "moderate",
    "fa-solid fa-code-branch",
    "Look for QRS widening and an RSR' pattern in V1."
  ),
  CLBBB: scpInfo(
    "Complete Left Bundle Branch Block",
    "Complete left bundle branch block pattern.",
    "severe",
    "fa-solid fa-code-branch",
    "Look for a wide QRS with broad notched R waves in lateral leads and discordant ST-T changes."
  ),
  ILMI: scpInfo(
    "Inferolateral Myocardial Infarction",
    "Infarction pattern involving the inferior and lateral walls.",
    "critical",
    "fa-solid fa-heart-crack",
    "Look for Q waves or ST-T changes in inferior plus lateral leads."
  ),
  "LAO/LAE": scpInfo(
    "Left Atrial Overload/Enlargement",
    "Left atrial enlargement or overload pattern.",
    "mild",
    "fa-solid fa-arrows-left-right-to-line",
    "Look for broad or notched P waves in lead II and left atrial abnormality in V1."
  ),
  AMI: scpInfo(
    "Anterior Myocardial Infarction",
    "Infarction pattern localized to the anterior wall.",
    "critical",
    "fa-solid fa-heart-crack",
    "Look for Q waves or ST-T changes in the anterior chest leads."
  ),
  ALMI: scpInfo(
    "Anterolateral Myocardial Infarction",
    "Infarction pattern involving the anterior and lateral walls.",
    "critical",
    "fa-solid fa-heart-crack",
    "Look for combined anterior and lateral infarction changes."
  ),
  ISCIN: scpInfo(
    "Ischemic in Inferior Leads",
    "Ischemic ST-T changes involving the inferior leads.",
    "moderate",
    "fa-solid fa-droplet-slash",
    "Look for ST depression, T-wave inversion, or other ischemic changes in II, III, and aVF."
  ),
  INJAS: scpInfo(
    "Subendocardial Injury in Anteroseptal Leads",
    "Subendocardial injury pattern in the anteroseptal region.",
    "severe",
    "fa-solid fa-triangle-exclamation",
    "Look for ST depression or injury-type changes in V1–V4."
  ),
  LMI: scpInfo(
    "Lateral Myocardial Infarction",
    "Infarction pattern localized to the lateral wall.",
    "critical",
    "fa-solid fa-heart-crack",
    "Look for Q waves or ST-T changes in I, aVL, V5, and V6."
  ),
  ISCIL: scpInfo(
    "Ischemic in Inferolateral Leads",
    "Ischemic ST-T changes involving inferior and lateral leads.",
    "moderate",
    "fa-solid fa-droplet-slash",
    "Look for combined inferior and lateral repolarization abnormalities."
  ),
  LPFB: scpInfo(
    "Left Posterior Fascicular Block",
    "Left posterior fascicular conduction block.",
    "mild",
    "fa-solid fa-code-branch",
    "Look for right axis deviation with the typical fascicular block pattern."
  ),
  ISCAS: scpInfo(
    "Ischemic in Anteroseptal Leads",
    "Ischemic ST-T changes involving the anteroseptal leads.",
    "moderate",
    "fa-solid fa-droplet-slash",
    "Look for ST/T changes in V1–V3."
  ),
  INJAL: scpInfo(
    "Subendocardial Injury in Anterolateral Leads",
    "Subendocardial injury pattern in the anterolateral region.",
    "severe",
    "fa-solid fa-triangle-exclamation",
    "Look for ST depression or injury-type changes in anterior plus lateral leads."
  ),
  ISCLA: scpInfo(
    "Ischemic in Lateral Leads",
    "Ischemic ST-T changes involving the lateral leads.",
    "moderate",
    "fa-solid fa-droplet-slash",
    "Look for ST/T changes in I, aVL, V5, and V6."
  ),
  RVH: scpInfo(
    "Right Ventricular Hypertrophy",
    "Right ventricular hypertrophy pattern.",
    "moderate",
    "fa-solid fa-weight-hanging",
    "Look for dominant R in V1 and right axis deviation."
  ),
  ANEUR: scpInfo(
    "ST-T Changes Compatible With Ventricular Aneurysm",
    "Repolarization pattern that can be seen with ventricular aneurysm.",
    "severe",
    "fa-solid fa-heart-circle-exclamation",
    "Look for persistent ST-T abnormalities after an infarction pattern."
  ),
  "RAO/RAE": scpInfo(
    "Right Atrial Overload/Enlargement",
    "Right atrial enlargement or overload pattern.",
    "mild",
    "fa-solid fa-arrows-left-right-to-line",
    "Look for tall peaked P waves, especially in II, III, and aVF."
  ),
  EL: scpInfo(
    "Electrolytic Disturbance or Drug",
    "ST-T changes that may reflect electrolyte imbalance or medication effects.",
    "moderate",
    "fa-solid fa-flask-vial",
    "Look for diffuse repolarization changes in the right clinical context."
  ),
  WPW: scpInfo(
    "Wolf-Parkinson-White Syndrome",
    "Pre-excitation pattern caused by an accessory pathway.",
    "moderate",
    "fa-solid fa-bolt",
    "Look for a short PR interval, delta wave, and widened QRS."
  ),
  ILBBB: scpInfo(
    "Incomplete Left Bundle Branch Block",
    "Partial left bundle branch block pattern.",
    "moderate",
    "fa-solid fa-code-branch",
    "Look for a wider QRS with left bundle-type morphology, but not fully complete."
  ),
  IPLMI: scpInfo(
    "Inferoposterolateral Myocardial Infarction",
    "Infarction pattern involving inferior, posterior, and lateral territory.",
    "critical",
    "fa-solid fa-heart-crack",
    "Look for combined inferior and lateral infarction clues with posterior mirror findings."
  ),
  ISCAN: scpInfo(
    "Ischemic in Anterior Leads",
    "Ischemic ST-T changes involving the anterior leads.",
    "moderate",
    "fa-solid fa-droplet-slash",
    "Look for ST/T abnormalities in V1–V4."
  ),
  IPMI: scpInfo(
    "Inferoposterior Myocardial Infarction",
    "Infarction pattern involving inferior and posterior territory.",
    "critical",
    "fa-solid fa-heart-crack",
    "Look for inferior infarct signs plus posterior mirror findings in V1–V2."
  ),
  SEHYP: scpInfo(
    "Septal Hypertrophy",
    "Septal hypertrophy pattern.",
    "moderate",
    "fa-solid fa-weight-hanging",
    "Look for septal voltage or morphology consistent with hypertrophy."
  ),
  INJIN: scpInfo(
    "Subendocardial Injury in Inferior Leads",
    "Subendocardial injury pattern in the inferior leads.",
    "severe",
    "fa-solid fa-triangle-exclamation",
    "Look for ST depression or injury-type changes in II, III, and aVF."
  ),
  INJLA: scpInfo(
    "Subendocardial Injury in Lateral Leads",
    "Subendocardial injury pattern in the lateral leads.",
    "severe",
    "fa-solid fa-triangle-exclamation",
    "Look for ST depression or injury-type changes in I, aVL, V5, and V6."
  ),
  PMI: scpInfo(
    "Posterior Myocardial Infarction",
    "Infarction pattern localized to the posterior wall.",
    "critical",
    "fa-solid fa-heart-crack",
    "Look for tall R waves and ST changes in V1–V2 as a posterior mirror image."
  ),
  "3AVB": scpInfo(
    "Third Degree AV Block",
    "Complete AV dissociation.",
    "critical",
    "fa-solid fa-triangle-exclamation",
    "Look for P waves and QRS complexes that march independently."
  ),
  INJIL: scpInfo(
    "Subendocardial Injury in Inferolateral Leads",
    "Subendocardial injury pattern in the inferolateral region.",
    "severe",
    "fa-solid fa-triangle-exclamation",
    "Look for ST depression or injury-type changes in inferior plus lateral leads."
  ),
  "2AVB": scpInfo(
    "Second Degree AV Block",
    "Intermittent failure of AV conduction.",
    "severe",
    "fa-solid fa-hourglass-half",
    "Look for dropped QRS complexes with some P waves not conducted."
  ),
  ABQRS: scpInfo(
    "Abnormal QRS",
    "General abnormal QRS morphology.",
    "moderate",
    "fa-solid fa-wave-square",
    "Look for QRS morphology that does not fit a normal pattern."
  ),
  PVC: scpInfo(
    "Ventricular Premature Complex",
    "An early beat originating from the ventricles.",
    "mild",
    "fa-solid fa-bolt",
    "Look for a wide premature QRS without a preceding P wave."
  ),
  STD_: scpInfo(
    "Non-specific ST Depression",
    "ST depression that is not specific for one cause or territory.",
    "severe",
    "fa-solid fa-arrow-trend-down",
    "Look for horizontal or downsloping ST depression, especially in multiple leads."
  ),
  VCLVH: scpInfo(
    "Voltage Criteria (QRS) for Left Ventricular Hypertrophy",
    "QRS voltage pattern that meets LVH criteria.",
    "moderate",
    "fa-solid fa-weight-hanging",
    "Look for large QRS amplitudes meeting common LVH voltage thresholds."
  ),
  QWAVE: scpInfo(
    "Q Waves Present",
    "Pathologic or notable Q waves are present.",
    "moderate",
    "fa-solid fa-wave-square",
    "Look for abnormal Q waves in the expected infarct territory."
  ),
  LOWT: scpInfo(
    "Low Amplitude T-Waves",
    "T waves with unusually low amplitude.",
    "mild",
    "fa-solid fa-wave-square",
    "Look for flattened, low-voltage T waves."
  ),
  NT_: scpInfo(
    "Non-specific T-Wave Changes",
    "T-wave abnormalities that do not fit a specific pattern.",
    "mild",
    "fa-solid fa-wave-square",
    "Look for flattening, inversion, or minor shape changes."
  ),
  PAC: scpInfo(
    "Atrial Premature Complex",
    "An early beat originating from the atria.",
    "mild",
    "fa-solid fa-bolt",
    "Look for an early, differently shaped P wave followed by a narrow QRS."
  ),
  LPR: scpInfo(
    "Prolonged PR Interval",
    "PR interval prolongation without dropping beats.",
    "mild",
    "fa-solid fa-hourglass-half",
    "Look for PR interval >200ms with 1:1 conduction."
  ),
  INVT: scpInfo(
    "Inverted T-Waves",
    "T waves that are flipped downward.",
    "moderate",
    "fa-solid fa-rotate-180",
    "Look for T waves pointing downward in leads where they are normally upright."
  ),
  LVOLT: scpInfo(
    "Low QRS Voltages in the Frontal and Horizontal Leads",
    "Low-amplitude QRS complexes in both limb and precordial leads.",
    "mild",
    "fa-solid fa-signal",
    "Look for QRS amplitude below the usual low-voltage thresholds."
  ),
  HVOLT: scpInfo(
    "High QRS Voltage",
    "QRS complexes with unusually high amplitude.",
    "mild",
    "fa-solid fa-signal",
    "Look for unusually tall QRS complexes, often with LVH-type patterns."
  ),
  TAB_: scpInfo(
    "T-Wave Abnormality",
    "General T-wave abnormality.",
    "moderate",
    "fa-solid fa-wave-square",
    "Look for abnormal T-wave shape, amplitude, or polarity."
  ),
  STE_: scpInfo(
    "Non-specific ST Elevation",
    "ST elevation that is not tied to a specific diagnostic pattern.",
    "critical",
    "fa-solid fa-arrow-trend-up",
    "Look for ST elevation and correlate with territory and clinical context."
  ),
  "PRC(S)": scpInfo(
    "Premature Complex(es)",
    "Premature ectopic complexes of one or more types.",
    "mild",
    "fa-solid fa-bolt",
    "Look for early beats that interrupt the expected rhythm."
  ),
  SR: scpInfo(
    "Sinus Rhythm",
    "Normal sinus rhythm.",
    "normal",
    "fa-solid fa-circle-check",
    "Look for a P wave before every QRS with a regular rhythm."
  ),
  AFIB: scpInfo(
    "Atrial Fibrillation",
    "Chaotic atrial rhythm with irregular ventricular response.",
    "severe",
    "fa-solid fa-wave-square",
    "Look for irregularly irregular R-R intervals and absent discrete P waves."
  ),
  STACH: scpInfo(
    "Sinus Tachycardia",
    "Fast sinus rhythm.",
    "mild",
    "fa-solid fa-bolt-lightning",
    "Look for a regular sinus rhythm with rate above 100 bpm."
  ),
  SARRH: scpInfo(
    "Sinus Arrhythmia",
    "Respiratory variation in sinus rhythm.",
    "normal",
    "fa-solid fa-lungs",
    "Look for normal sinus morphology with cyclic R-R variation."
  ),
  SBRAD: scpInfo(
    "Sinus Bradycardia",
    "Slow sinus rhythm.",
    "mild",
    "fa-solid fa-circle-info",
    "Look for normal sinus morphology with rate below 60 bpm."
  ),
  PACE: scpInfo(
    "Normal Functioning Artificial Pacemaker",
    "A paced rhythm from a functioning artificial pacemaker.",
    "moderate",
    "fa-solid fa-microchip",
    "Look for pacing spikes followed by captured depolarization."
  ),
  SVARR: scpInfo(
    "Supraventricular Arrhythmia",
    "Arrhythmia originating above the ventricles.",
    "moderate",
    "fa-solid fa-wave-square",
    "Look for atrial-origin rhythm disturbances or supraventricular ectopy."
  ),
  BIGU: scpInfo(
    "Bigeminal Pattern (Unknown Origin, SV or Ventricular)",
    "Bigeminy with uncertain supraventricular or ventricular origin.",
    "moderate",
    "fa-solid fa-repeat",
    "Look for every other beat occurring prematurely."
  ),
  AFLT: scpInfo(
    "Atrial Flutter",
    "Rapid organized atrial rhythm.",
    "moderate",
    "fa-solid fa-water",
    "Look for sawtooth flutter waves, often most obvious in inferior leads."
  ),
  SVTAC: scpInfo(
    "Supraventricular Tachycardia",
    "Fast tachycardia originating above the ventricles.",
    "moderate",
    "fa-solid fa-bolt-lightning",
    "Look for a narrow-complex tachycardia with hidden or retrograde P waves."
  ),
  PSVT: scpInfo(
    "Paroxysmal Supraventricular Tachycardia",
    "Intermittent supraventricular tachycardia episodes.",
    "moderate",
    "fa-solid fa-bolt-lightning",
    "Look for sudden-onset narrow-complex tachycardia."
  ),
  TRIGU: scpInfo(
    "Trigeminal Pattern (Unknown Origin, SV or Ventricular)",
    "Trigeminy with uncertain supraventricular or ventricular origin.",
    "moderate",
    "fa-solid fa-repeat",
    "Look for a premature beat every third beat."
  ),
  // Legacy aliases for older local data or earlier UI labels.
  LBBB: scpInfo(
    "Complete Left Bundle Branch Block",
    "Legacy alias for CLBBB.",
    "severe",
    "fa-solid fa-code-branch",
    "Look for a complete left bundle branch block pattern."
  ),
  RBBB: scpInfo(
    "Complete Right Bundle Branch Block",
    "Legacy alias for CRBBB.",
    "moderate",
    "fa-solid fa-code-branch",
    "Look for a complete right bundle branch block pattern."
  ),
  LAE: scpInfo(
    "Left Atrial Overload/Enlargement",
    "Legacy alias for LAO/LAE.",
    "mild",
    "fa-solid fa-arrows-left-right-to-line",
    "Look for left atrial enlargement clues in the P wave."
  ),
  RAE: scpInfo(
    "Right Atrial Overload/Enlargement",
    "Legacy alias for RAO/RAE.",
    "mild",
    "fa-solid fa-arrows-left-right-to-line",
    "Look for right atrial enlargement clues in the P wave."
  ),
  ISCI: scpInfo(
    "Ischemic in Inferior Leads",
    "Legacy alias for ISCIN.",
    "moderate",
    "fa-solid fa-droplet-slash",
    "Look for inferior-lead ischemic ST-T changes."
  ),
  ISCL: scpInfo(
    "Ischemic in Lateral Leads",
    "Legacy alias for ISCLA.",
    "moderate",
    "fa-solid fa-droplet-slash",
    "Look for lateral-lead ischemic ST-T changes."
  ),
  ISCALL: scpInfo(
    "Ischemic in Anterolateral Leads",
    "Legacy alias for ISCAL.",
    "moderate",
    "fa-solid fa-droplet-slash",
    "Look for anterolateral ischemic ST-T changes."
  ),
  STTY: scpInfo(
    "Non-specific ST Changes",
    "Legacy alias for NST_.",
    "mild",
    "fa-solid fa-wave-square",
    "Look for nonspecific ST deviation or minor repolarization change."
  ),
  TINV: scpInfo(
    "Inverted T-Waves",
    "Legacy alias for INVT.",
    "moderate",
    "fa-solid fa-rotate-180",
    "Look for downward T waves in leads where they are normally upright."
  )
};

// Backward-compatible alias
const SCP_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  Object.entries(SCP_INFO).map(([k, v]) => [k, v.name])
);

/** Returns the overall worst severity among SCP codes present */
function getOverallSeverity(scpCodes: Record<string, number>): "normal" | "mild" | "moderate" | "severe" | "critical" {
  const order: Record<string, number> = { normal: 0, mild: 1, moderate: 2, severe: 3, critical: 4 };
  let worst: "normal" | "mild" | "moderate" | "severe" | "critical" = "normal";
  for (const code of Object.keys(scpCodes)) {
    const info = SCP_INFO[code];
    if (info && order[info.severity] > order[worst]) {
      worst = info.severity;
    }
  }
  return worst;
}

/** Returns a plain-English one-liner summary for the overall ECG */
function getVerdictSummary(superclass: string, severity: string, scpCodes: Record<string, number>): string {
  const topCodes = Object.entries(scpCodes)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 2)
    .map(([c]) => SCP_INFO[c]?.name || c)
    .join(" and ");

  if (superclass === "NORM" || severity === "normal") {
    return "No significant cardiac abnormalities detected. The electrical activity of the heart appears within normal limits.";
  }
  if (severity === "critical") {
    return `Critical cardiac findings detected${topCodes ? ` including ${topCodes}` : ""}. Urgent clinical correlation required.`;
  }
  if (severity === "severe") {
    return `Significant abnormalities present${topCodes ? `: ${topCodes}` : ""}. Clinical evaluation is strongly recommended.`;
  }
  if (severity === "moderate") {
    return `Moderate ECG abnormalities noted${topCodes ? ` (${topCodes})` : ""}. Correlation with symptoms and clinical history is advised.`;
  }
  return `Mild ECG abnormalities${topCodes ? ` (${topCodes})` : ""}. Likely clinically relevant — compare with prior recordings.`;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, severe: 1, moderate: 2, mild: 3, normal: 4 };

const SEVERITY_META: Record<string, { label: string; icon: string }> = {
  critical: { label: "Critical", icon: "fa-solid fa-circle-exclamation" },
  severe:   { label: "Severe",   icon: "fa-solid fa-triangle-exclamation" },
  moderate: { label: "Moderate", icon: "fa-solid fa-circle-radiation" },
  mild:     { label: "Mild",     icon: "fa-solid fa-circle-info" },
  normal:   { label: "Normal",   icon: "fa-solid fa-circle-check" },
};

function estimateHeartRate(signalArray: number[], freq: number = 100): number {
  if (!signalArray || signalArray.length === 0) return 72;
  let peaks = 0;
  let inPeak = false;
  let lastPeakIndex = -100;
  const threshold = 0.5; 
  const minInterval = Math.round(0.4 * freq); // 400ms filter
  for (let i = 0; i < signalArray.length; i++) {
    if (signalArray[i] > threshold) {
      if (!inPeak && (i - lastPeakIndex) > minInterval) {
        peaks++;
        lastPeakIndex = i;
        inPeak = true;
      }
    } else if (signalArray[i] < threshold - 0.1) {
      inPeak = false;
    }
  }
  if (peaks === 0) return 70;
  const durationInSeconds = signalArray.length / freq;
  const bpm = (peaks / durationInSeconds) * 60;
  return Math.round(bpm);
}

function analyzeECGPeaks(signals: any, leadName: string, freq: number = 500) {
  const signalArray = getRecordSignalForLead(signals, leadName);
  if (!signalArray || signalArray.length === 0) {
    return null;
  }

  // 1. Find the maximum absolute value in the signal to set a threshold
  let maxAbs = 0;
  for (let i = 0; i < signalArray.length; i++) {
    const absVal = Math.abs(signalArray[i]);
    if (absVal > maxAbs) maxAbs = absVal;
  }

  // 2. Simple Pan-Tompkins derivative & integration
  const derivative = new Float32Array(signalArray.length);
  for (let i = 2; i < signalArray.length - 2; i++) {
    derivative[i] = (2 * signalArray[i+1] + signalArray[i] - signalArray[i-1] - 2 * signalArray[i-2]) / 8;
  }

  // Square and integrate derivative with a moving window
  const windowSize = Math.round(0.08 * freq); // 80ms moving window
  const integrated = new Float32Array(signalArray.length);
  for (let i = 0; i < signalArray.length; i++) {
    let sum = 0;
    for (let j = Math.max(0, i - windowSize); j <= i; j++) {
      sum += derivative[j] * derivative[j];
    }
    integrated[i] = sum;
  }

  // Find max in integrated signal
  let maxInt = 0;
  for (let i = 0; i < integrated.length; i++) {
    if (integrated[i] > maxInt) maxInt = integrated[i];
  }

  // 3. Peak detection on integrated signal
  const peakIndices: number[] = [];
  const minSpacing = Math.round(0.35 * freq); // Refractory period of 350ms (max HR ~170 bpm)
  const threshold = maxInt * 0.15; // Noise threshold

  let lastPeakIndex = -minSpacing;
  for (let i = 2; i < integrated.length - 2; i++) {
    if (integrated[i] > threshold && 
        integrated[i] > integrated[i-1] && 
        integrated[i] > integrated[i-2] && 
        integrated[i] > integrated[i+1] && 
        integrated[i] > integrated[i+2]) {
      
      if (i - lastPeakIndex > minSpacing) {
        // Search local neighborhood in original signal for exact R-peak (maximum value)
        let exactPeakIdx = i;
        let maxVal = -Infinity;
        const searchHalfWindow = Math.round(0.05 * freq); // 50ms search window
        const start = Math.max(0, i - searchHalfWindow);
        const end = Math.min(signalArray.length - 1, i + searchHalfWindow);
        
        for (let k = start; k <= end; k++) {
          if (signalArray[k] > maxVal) {
            maxVal = signalArray[k];
            exactPeakIdx = k;
          }
        }
        
        peakIndices.push(exactPeakIdx);
        lastPeakIndex = i;
      }
    }
  }

  // If no peaks found, fall back to simple thresholding
  if (peakIndices.length === 0) {
    let inPeak = false;
    let fallbackLastPeak = -minSpacing;
    const thresh = maxAbs * 0.5;
    for (let i = 0; i < signalArray.length; i++) {
      if (signalArray[i] > thresh) {
        if (!inPeak && (i - fallbackLastPeak) > minSpacing) {
          peakIndices.push(i);
          fallbackLastPeak = i;
          inPeak = true;
        }
      } else if (signalArray[i] < thresh - 0.1) {
        inPeak = false;
      }
    }
  }

  // Calculate metrics
  const rrIntervalsMs: number[] = [];
  for (let i = 1; i < peakIndices.length; i++) {
    const diffSamples = peakIndices[i] - peakIndices[i-1];
    const diffMs = (diffSamples / freq) * 1000;
    rrIntervalsMs.push(Number(diffMs.toFixed(1)));
  }

  const numPeaks = peakIndices.length;
  const durationSec = signalArray.length / freq;
  const calculatedBPM = Math.round((numPeaks / durationSec) * 60);

  // Heart Rate Variability (HRV) metrics
  let meanRR = 0;
  let sdnn = 0;
  let rmssd = 0;

  if (rrIntervalsMs.length > 0) {
    const sumRR = rrIntervalsMs.reduce((a, b) => a + b, 0);
    meanRR = sumRR / rrIntervalsMs.length;

    const squaredDiffs = rrIntervalsMs.map(val => Math.pow(val - meanRR, 2));
    const meanSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
    sdnn = Math.sqrt(meanSquaredDiff);

    let sumSuccessiveSquaredDiffs = 0;
    for (let i = 1; i < rrIntervalsMs.length; i++) {
      sumSuccessiveSquaredDiffs += Math.pow(rrIntervalsMs[i] - rrIntervalsMs[i-1], 2);
    }
    rmssd = rrIntervalsMs.length > 1 
      ? Math.sqrt(sumSuccessiveSquaredDiffs / (rrIntervalsMs.length - 1)) 
      : 0;
  }

  const peaksInfo = peakIndices.map((idx) => {
    return {
      index: idx,
      time: Number((idx / freq).toFixed(3)),
      value: signalArray[idx]
    };
  });

  return {
    calculatedBPM,
    peaksCount: numPeaks,
    peaksInfo,
    rrIntervalsMs,
    meanRR: Math.round(meanRR),
    sdnn: Number(sdnn.toFixed(1)),
    rmssd: Number(rmssd.toFixed(1))
  };
}

function getScpCategory(code: string): string {
  const mi = [
    "AMI", "ASMI", "ALMI", "IMI", "ILMI", "IPLMI", "IPMI", "LMI", "PMI",
    "INJAS", "INJAL", "INJIN", "INJIL", "INJLA",
    "ISCAL", "ISCAN", "ISCAS", "ISCIN", "ISCIL", "ISCLA", "ISC_",
  ];
  const cd = [
    "LAFB", "LPFB", "LBBB", "RBBB", "IRBBB", "ILBBB", "1AVB", "2AVB", "3AVB",
    "CLBBB", "CRBBB", "IVCD", "WPW", "LPR",
  ];
  const hyp = [
    "LVH", "RVH", "LAE", "RAE", "LAO/LAE", "RAO/RAE", "SEHYP", "VCLVH",
  ];
  const sttc = [
    "STTC", "STTY", "NDT", "NST_", "DIG", "LNGQT", "STE_", "STD_", "TAB_",
    "NT_", "TINV", "INVT", "LVOLT", "HVOLT", "QWAVE", "LOWT", "EL", "ANEUR",
  ];
  if (code === "NORM") return "norm";
  if (mi.includes(code)) return "mi";
  if (cd.includes(code)) return "cd";
  if (hyp.includes(code)) return "hyp";
  if (sttc.includes(code)) return "sttc";
  return "other";
}

// ── Human-readable superclass descriptions ────────────────────────────────────
const SUPERCLASS_INFO: Record<string, { label: string; simple: string; icon: string }> = {
  NORM: { label: "Normal ECG",               simple: "All electrical measurements are within normal limits. No significant cardiac abnormality was detected.",                                                                    icon: "fa-solid fa-circle-check" },
  MI:   { label: "Myocardial Infarction",    simple: "Evidence of a heart attack — part of the heart muscle has been damaged due to blocked blood supply to the coronary arteries.",                                             icon: "fa-solid fa-heart-crack" },
  CD:   { label: "Conduction Disorder",      simple: "A problem with the heart's electrical wiring — signals travel abnormally between the upper and lower chambers.",                                                           icon: "fa-solid fa-code-branch" },
  HYP:  { label: "Hypertrophy / Enlargement",simple: "One or more heart chambers are enlarged or thickened — commonly caused by chronic pressure overload from hypertension or valvular disease.",                               icon: "fa-solid fa-weight-hanging" },
  STTC: { label: "ST-T Wave Changes",        simple: "Abnormalities in the ST segment and/or T waves — a broad category that may indicate ischemia, electrolyte disturbances, or medication effects.",                          icon: "fa-solid fa-wave-square" },
};

// ── Heart rate clinical category ──────────────────────────────────────────────
function getHRInterpretation(bpm: number): { label: string; desc: string; color: string; icon: string } {
  if (bpm < 40)   return { label: "Severe Bradycardia",  desc: "Very slow rate (<40 bpm) — requires urgent evaluation. May need pacemaker therapy.",                  color: "var(--wrong)",   icon: "fa-solid fa-circle-exclamation" };
  if (bpm < 60)   return { label: "Bradycardia",         desc: "Slower than normal (<60 bpm). Common in athletes and during sleep — investigate if symptomatic.",       color: "var(--accent)", icon: "fa-solid fa-circle-info" };
  if (bpm <= 100) return { label: "Normal Sinus Rate",   desc: "Heart rate is within the normal resting range of 60–100 bpm.",                                          color: "var(--correct)", icon: "fa-solid fa-circle-check" };
  if (bpm <= 150) return { label: "Tachycardia",         desc: "Faster than normal (>100 bpm). Could be stress, fever, dehydration, or an arrhythmia — investigate.",  color: "var(--accent)", icon: "fa-solid fa-bolt-lightning" };
  return             { label: "Severe Tachycardia",    desc: "Very fast rate (>150 bpm) — needs urgent evaluation for a pathological arrhythmia.",                   color: "var(--wrong)",   icon: "fa-solid fa-bolt" };
}

// ── Heart axis plain-language interpretation ──────────────────────────────────
function getHeartAxisInterpretation(axis: string | undefined): { label: string; desc: string; color: string } {
  if (!axis) return { label: "Not Recorded", desc: "No axis data is available for this record.", color: "var(--text-muted)" };
  const u = axis.toUpperCase();
  if (u.includes("NORM"))                        return { label: "Normal Axis (0° to +90°)",       desc: "The heart's electrical axis points in the expected direction — no deviation detected.",                                             color: "var(--correct)" };
  if (u.includes("LAD") || u.includes("LEFT"))   return { label: "Left Axis Deviation",             desc: "Axis shifted left (−30° to −90°). Seen in LBBB, LAFB, left ventricular hypertrophy, or inferior MI.",                            color: "var(--accent)" };
  if (u.includes("RAD") || u.includes("RIGHT"))  return { label: "Right Axis Deviation",            desc: "Axis shifted right (+90° to +180°). Seen in right ventricular hypertrophy, LPFB, or lateral MI.",                                color: "var(--accent)" };
  if (u.includes("EXTR") || u.includes("INDET")) return { label: "Extreme / Indeterminate Axis",   desc: "Markedly abnormal axis (−90° to ±180°). Seen in ventricular rhythms or severe conduction disease.",                               color: "var(--wrong)" };
  return { label: axis, desc: "Axis information recorded — see clinical report for full context.", color: "var(--text-secondary)" };
}

// ── Infarction stadium plain-language label ───────────────────────────────────
function getInfarctionStadiumLabel(stadium: string): string {
  const s = stadium.toLowerCase();
  if (/\bstadium\s*i\b/.test(s) && !/ii|iii|iv/.test(s))
    return "Acute phase — ST elevation is present. The heart muscle is actively being injured right now. This is a medical emergency.";
  if (/\bstadium\s*ii\b/.test(s) && !/iii|iv/.test(s))
    return "Subacute phase — ST changes are resolving and Q waves are forming. Damage occurred recently (hours to days ago).";
  if (/\bstadium\s*iii\b/.test(s) && !/iv/.test(s))
    return "Chronic phase — Q waves remain, ST has normalized. This represents a healed (old) heart attack scar.";
  if (/\bstadium\s*iv\b/.test(s))
    return "Very old infarction — scarring is complete. May have permanent electrical changes on the ECG.";
  return "Infarction stage recorded — correlate with the clinical timeline for full interpretation.";
}

// Safely parse scp_codes: may already be an object (from lib/data.ts JSON) or a JSON string (from sql.js DB)
function parseScpCodes(val: any): Record<string, number> {
  if (!val) return {};
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return {}; }
}

export default function ECGSimulatorPage() {
  // ── Mode selection (clinical db vs mathematical simulator) ──
  const [mode, setMode] = useState<string>("database"); // "database" or "simulation"

  // ── Database pulling config ──
  const [pullMode, setPullMode] = useState<string>("metadata_only");
  const [pullCount, setPullCount] = useState<number>(21837);

  // ── Dev environment detection (hide DB Setup tab on Vercel/production) ──
  const [isDevEnvironment, setIsDevEnvironment] = useState<boolean>(false);

  // Safe accessor for INTENSITY_STAGES — falls back to _default for rhythms without pathological progression
  const getIntensityConfig = (rhythmId: string) => INTENSITY_STAGES[rhythmId] || INTENSITY_STAGES._default;
  const hasIntensityConfig = (rhythmId: string) => !!(INTENSITY_STAGES[rhythmId] && INTENSITY_STAGES[rhythmId].stages.length > 0 && rhythmId !== "_default");

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<string>("db-explorer");
  const [diagSubTab, setDiagSubTab] = useState<"overview" | "peaks" | "length">("overview");
  const [expandedScpTip, setExpandedScpTip] = useState<string | null>(null);

  // ── Database records state ──
  const [dbSeeded, setDbSeeded] = useState<boolean>(false);
  const [dbStatus, setDbStatus] = useState<string>("unknown");
  const [dbProgress, setDbProgress] = useState<string>("");
  const [seedingActive, setSeedingActive] = useState<boolean>(false);

  const [dbRecords, setDbRecords] = useState<any[]>([]);
  const [dbClassCounts, setDbClassCounts] = useState<Record<string, number>>({});
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [recordSignals, setRecordSignals] = useState<any | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [superclassFilter, setSuperclassFilter] = useState<string>("ALL");
  const [dbLimit, setDbLimit] = useState<number>(30);
  const [dbOffset, setDbOffset] = useState<number>(0);

  const [recordsLoading, setRecordsLoading] = useState<boolean>(false);
  const [signalsLoading, setSignalsLoading] = useState<boolean>(false);
  const [selectedFreq, setSelectedFreq] = useState<number>(500);
  const [dbVisualSmoothing, setDbVisualSmoothing] = useState<boolean>(true);
  const [dbLoopWindow, setDbLoopWindow] = useState<DbLoopWindow>({
    startSec: 0,
    durationSec: DEFAULT_DB_SIGNAL_DURATION_SEC,
    source: "full"
  });
  const [translationState, setTranslationState] = useState<{
    reportKey: string;
    status: "idle" | "loading" | "translated" | "skipped" | "error";
    translatedText: string;
    source: string;
    provider: string;
    error?: string;
  }>({
    reportKey: "",
    status: "idle",
    translatedText: "",
    source: "",
    provider: ""
  });
  const translationCacheRef = useRef<Record<string, {
    status: "translated" | "skipped" | "error";
    translatedText: string;
    source: string;
    provider: string;
    error?: string;
  }>>({});

  // ── Rhythm and lead selections ──
  const [currentRhythm, setCurrentRhythm] = useState<string>("nsr");
  const [currentLead, setCurrentLead] = useState<string>("II");
  const [expandedCategory, setExpandedCategory] = useState<string>("cat_normal");

  // ── Base simulation config state ──
  const [paused, setPaused] = useState<boolean>(false);
  const [heartRate, setHeartRate] = useState<number>(72);
  const [amplitude, setAmplitude] = useState<number>(1.0);
  const [speed, setSpeed] = useState<number>(25);
  const [noise, setNoise] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1.0);
  const [realistic, setRealistic] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [soundOn, setSoundOn] = useState<boolean>(false);
  const [stripMode, setStripMode] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<string>("single");
  const [colorScheme, setColorScheme] = useState<string>("ge");
  const [effectIntensity, setEffectIntensity] = useState<number>(0.0);
  const [comparisonMode, setComparisonMode] = useState<boolean>(false);

  // ── Manual controls state ──
  const [manualMode, setManualMode] = useState<boolean>(false);
  const [waveParams, setWaveParams] = useState<any>({
    pAmp: 0.12,
    pDur: 0.10,
    prInt: 0.19,
    qrsAmp: 1.00,
    qrsDur: 0.06,
    jNotch: 0.00,
    stElev: 0.00,
    stDur: 0.12,
    stSlope: 0,
    tAmp: 0.22,
    tDur: 0.19,
    tShape: 1,
    uAmp: 0.00,
    uDur: 0.10
  });

  // ── PDF Overlay state ──
  const [pdfOpen, setPdfOpen] = useState<boolean>(false);

  // ── Sidebar resizing width state ──
  const [sidebarWidth, setSidebarWidth] = useState<number>(360);

  // ── Refs for canvas & engine ──
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // ── Persistent state ref for the animation rendering loop ──
  const stateRef = useRef({
    paused: false,
    viewMode: "single",
    currentRhythm: "nsr",
    currentLead: "II",
    heartRate: 72,
    amplitude: 1.0,
    speed: 25,
    noise: 0,
    zoom: 1.0,
    realistic: false,
    showGrid: true,
    soundOn: false,
    stripMode: false,
    comparisonMode: false,
    colorScheme: "ge",
    effectIntensity: 0.0,
    manualMode: false,
    phase: 0.0,
    scanX: 0.0,
    lastPhase: 0.0,
    beatIndex: 0,
    rPeakDetected: false,
    waveParams: {
      pAmp: 0.12,
      pDur: 0.10,
      prInt: 0.19,
      qrsAmp: 1.00,
      qrsDur: 0.06,
      jNotch: 0.00,
      stElev: 0.00,
      stDur: 0.12,
      stSlope: 0,
      tAmp: 0.22,
      tDur: 0.19,
      tShape: 1,
      uAmp: 0.00,
      uDur: 0.10
    },
    // Trace sweeping buffers (physical px sizes populated dynamically)
    sweepBuf: null as Float32Array | null,
    sweepBufCompare: null as Float32Array | null,
    sweepWritten: null as Uint8Array | null,
    // Database mode values
    mode: "database",
    signals: null as any | null,
    frequency: 500,
    dbVisualSmoothing: true,
    dbLoopWindow: {
      startSec: 0,
      durationSec: DEFAULT_DB_SIGNAL_DURATION_SEC,
      source: "full" as "rpeak" | "full"
    },
    timeElapsed: 0.0,
    // 12-lead scrolling offset for database mode
    scrollOffset: 0.0,
    activeTab: "db-explorer",
    diagSubTab: "overview",
    peaksAnalysis: null as any | null
  });

  useEffect(() => {
    const host = window.location.hostname;
    setIsDevEnvironment(host === "localhost" || host === "127.0.0.1");
  }, []);

  // ── Synchronize React state variations to the drawing variables thread ──
  useEffect(() => {
    stateRef.current.paused = paused;
    stateRef.current.viewMode = viewMode;
    stateRef.current.currentRhythm = currentRhythm;
    stateRef.current.currentLead = currentLead;
    stateRef.current.heartRate = heartRate;
    stateRef.current.amplitude = amplitude;
    stateRef.current.speed = speed;
    stateRef.current.noise = noise;
    stateRef.current.zoom = zoom;
    stateRef.current.realistic = realistic;
    stateRef.current.showGrid = showGrid;
    stateRef.current.soundOn = soundOn;
    stateRef.current.stripMode = stripMode;
    stateRef.current.comparisonMode = comparisonMode;
    stateRef.current.colorScheme = colorScheme;
    stateRef.current.effectIntensity = effectIntensity;
    stateRef.current.manualMode = manualMode;
    stateRef.current.waveParams = waveParams;

    // Synchronize clinical DB parameters
    stateRef.current.mode = mode;
    stateRef.current.signals = recordSignals;
    stateRef.current.frequency = selectedFreq;
    stateRef.current.dbVisualSmoothing = dbVisualSmoothing;
    stateRef.current.dbLoopWindow = dbLoopWindow;
    stateRef.current.activeTab = activeTab;
    stateRef.current.diagSubTab = diagSubTab;
  }, [
    paused,
    viewMode,
    currentRhythm,
    currentLead,
    heartRate,
    amplitude,
    speed,
    noise,
    zoom,
    realistic,
    showGrid,
    soundOn,
    stripMode,
    comparisonMode,
    colorScheme,
    effectIntensity,
    manualMode,
    waveParams,
    mode,
    recordSignals,
    selectedFreq,
    dbVisualSmoothing,
    dbLoopWindow,
    activeTab,
    diagSubTab
  ]);

  // ── Database Setup and Records Integration Hooks ──
  async function checkDbStatus() {
    try {
      const res = await fetch("/api/setup");
      const data = await res.json();
      setDbSeeded(data.seeded);
      setDbStatus(data.status);
      setDbProgress(data.message || "");
    } catch (err) {
      console.error("Setup checking failed:", err);
    }
  }

  const [overwriteDb, setOverwriteDb] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadTotal, setDownloadTotal] = useState<number>(0);
  const fetchLock = useRef<boolean>(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fetchRecords(searchStr = searchQuery, filterStr = superclassFilter, currentOffset = dbOffset, append = false) {
    try {
      setRecordsLoading(true);
      const url = `/api/records?superclass=${filterStr}&limit=${dbLimit}&offset=${currentOffset}&search=${encodeURIComponent(searchStr)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.records) {
        if (append && currentOffset > 0) {
          setDbRecords(prev => {
            const existingIds = new Set(prev.map((r: any) => r.ecg_id));
            const newRecords = data.records.filter((r: any) => !existingIds.has(r.ecg_id));
            return [...prev, ...newRecords];
          });
        } else {
          setDbRecords(data.records);
        }
        setDbClassCounts(data.classCounts || {});
        
        // Auto-select first matching record if none selected or if selected is stale
        if (!append || currentOffset === 0) {
          if (data.records.length > 0) {
            const alreadySelectedIdx = data.records.findIndex((r: any) => selectedRecord && r.ecg_id === selectedRecord.ecg_id);
            if (alreadySelectedIdx < 0) {
              selectRecordItem(data.records[0]);
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch records:", err);
    } finally {
      setRecordsLoading(false);
      fetchLock.current = false;
    }
  }

  async function selectRecordItem(record: any, freq = selectedFreq) {
    setSelectedRecord(record);
    // Reset rendering state for new record
    stateRef.current.scrollOffset = 0.0;
    stateRef.current.scanX = 0.0;
    stateRef.current.phase = 0.0;
    stateRef.current.beatIndex = 0;
    const resetLoop = { startSec: 0, durationSec: DEFAULT_DB_SIGNAL_DURATION_SEC, source: "full" as const };
    setDbLoopWindow(resetLoop);
    stateRef.current.dbLoopWindow = resetLoop;
    // Clear sweep buffers
    if (stateRef.current.sweepBuf) stateRef.current.sweepBuf.fill(lastDimensions.current.H / 2);
    if (stateRef.current.sweepWritten) stateRef.current.sweepWritten.fill(0);
    try {
      setSignalsLoading(true);
      const url = `/api/ecg/${record.ecg_id}?frequency=${freq}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.signals) {
        setRecordSignals(data.signals);
        const loopWindow = buildDbLoopWindow(data.signals, freq);
        setDbLoopWindow(loopWindow);
        stateRef.current.dbLoopWindow = loopWindow;
        if (data.signals["II"]) {
          const bpmEst = estimateHeartRate(data.signals["II"], freq);
          setHeartRate(bpmEst);
        }
      }
    } catch (err) {
      console.error("Failed to load clinical signal trace:", record.ecg_id, err);
      showToastMsg("Error loading raw signals.");
    } finally {
      setSignalsLoading(false);
    }
  }

  // ── Compute Peak Analysis Dynamically ──
  const [peaksAnalysis, setPeaksAnalysis] = useState<any | null>(null);

  useEffect(() => {
    if (mode === "database" && recordSignals) {
      const analysis = analyzeECGPeaks(recordSignals, currentLead, selectedFreq);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPeaksAnalysis(analysis);
      stateRef.current.peaksAnalysis = analysis;
      if (analysis) {
        setHeartRate(analysis.calculatedBPM);
      }
    } else {
      setPeaksAnalysis(null);
      stateRef.current.peaksAnalysis = null;
    }
  }, [recordSignals, currentLead, selectedFreq, mode]);

  useEffect(() => {
    const rawReport = selectedRecord?.report || "";
    const reportKey = rawReport.trim();
    if (!reportKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTranslationState({
        reportKey: "",
        status: "idle",
        translatedText: "",
        source: "",
        provider: ""
      });
      return;
    }

    const cached = translationCacheRef.current[reportKey];
    if (cached) {
      setTranslationState({ reportKey, ...cached });
      return;
    }

    if (isLikelyEnglishReport(reportKey)) {
      const skipped = {
        status: "skipped" as const,
        translatedText: "",
        source: "en",
        provider: "local-language-check"
      };
      translationCacheRef.current[reportKey] = skipped;
      setTranslationState({ reportKey, ...skipped });
      return;
    }

    let cancelled = false;
    setTranslationState({
      reportKey,
      status: "loading",
      translatedText: "",
      source: "",
      provider: "MyMemory"
    });

    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reportKey, target: "en" })
    })
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || "Translation request failed");
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        const translatedText = String(payload.translatedText || "").trim();
        if (!translatedText) throw new Error("Translation provider returned no text");
        const translated = {
          status: "translated" as const,
          translatedText,
          source: String(payload.source || "auto"),
          provider: String(payload.provider || "MyMemory")
        };
        translationCacheRef.current[reportKey] = translated;
        setTranslationState({ reportKey, ...translated });
      })
      .catch((err) => {
        if (cancelled) return;
        const failed = {
          status: "error" as const,
          translatedText: "",
          source: "auto",
          provider: "MyMemory",
          error: err instanceof Error ? err.message : "Translation unavailable"
        };
        translationCacheRef.current[reportKey] = failed;
        setTranslationState({ reportKey, ...failed });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRecord?.report]);

  useEffect(() => {
    const timer = setTimeout(() => {
      checkDbStatus();
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let interval: any = null;
    if (seedingActive) {
      interval = setInterval(async () => {
        try {
          const res = await fetch("/api/setup");
          const data = await res.json();
          if (data.progress) {
            setDbStatus(data.progress.status);
            setDbProgress(data.progress.message || "");
            if (data.progress.count !== undefined) setDownloadProgress(data.progress.count);
            if (data.progress.total !== undefined) setDownloadTotal(data.progress.total);
            if (data.seeded) {
              setDbSeeded(true);
              setSeedingActive(false);
              clearInterval(interval);
              fetchRecords();
            } else if (data.progress.status === "error" || data.progress.status === "failed") {
              setSeedingActive(false);
              clearInterval(interval);
            }
          } else {
            setDbStatus(data.status);
            setDbProgress(data.message || "");
            if (data.seeded) {
              setDbSeeded(true);
              setSeedingActive(false);
              clearInterval(interval);
              fetchRecords();
            } else if (data.status === "failed") {
              setSeedingActive(false);
              clearInterval(interval);
            }
          }
        } catch {
          // Ignore failure during background sync
        }
      }, 1500);
    }
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedingActive]);

  const triggerDbSeeding = async () => {
    try {
      setSeedingActive(true);
      setDbStatus("running");
      setDbProgress("Starting PhysioNet clinical signal collection...");
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pullConfig: { mode: pullMode, count: pullCount }, overwrite: overwriteDb })
      });
      const data = await res.json();
      if (data.progress) {
        setDbStatus(data.progress.status);
        setDbProgress(data.progress.message || "");
        if (data.progress.count !== undefined) setDownloadProgress(data.progress.count);
        if (data.progress.total !== undefined) setDownloadTotal(data.progress.total);
      }
      if (data.seeded) {
        setDbSeeded(true);
        setSeedingActive(false);
        fetchRecords();
        showToastMsg("Clinical database successfully seeded/updated!");
      }
    } catch (err) {
      setDbStatus("failed");
      setDbProgress("Failed to ingest records: timeout or connection error.");
      setSeedingActive(false);
    }
  };

  // Re-fetch records when filter triggers
  useEffect(() => {
    if (dbSeeded) {
      const timer = setTimeout(() => {
        fetchRecords(searchQuery, superclassFilter, dbOffset, dbOffset > 0);
      }, 80);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbSeeded, superclassFilter, dbOffset, searchQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDbOffset(0);
    fetchRecords(searchQuery, superclassFilter, 0);
  };

  const toggleFrequency = async (freq: number) => {
    setSelectedFreq(freq);
    if (selectedRecord) {
      await selectRecordItem(selectedRecord, freq);
      showToastMsg(`Switched resolution to ${freq}Hz`);
    }
  };

  // ── Show temporary active tool status feedback ──
  const [toastMsg, setToastMsg] = useState<string>("");
  const [toastShow, setToastShow] = useState<boolean>(false);
  const toastTimerRef = useRef<any>(null);

  const showToastMsg = (msg: string) => {
    setToastMsg(msg);
    setToastShow(true);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastShow(false);
    }, 1800);
  };

  // ── Initialize Somatic Audio sound ──
  const initAudio = () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        audioContextRef.current = new AudioCtx();
      }
    }
  };

  const playBeep = () => {
    try {
      initAudio();
      if (!audioContextRef.current) return;
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.frequency.value = 950;
      osc.type = "sine";
      gainNode.gain.value = 0.12;
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.08);
    } catch {}
  };

  // ── Dynamic thematic colors lookup matches target design systems ──
  const getThemeColors = (dark: boolean, strip: boolean, scheme: string) => {
    if (strip) {
      return {
        bg: "#FFF5F5",
        trace: "#0f0f12",
        gridMinor: "rgba(230, 50, 50, 0.20)",
        gridMajor: "rgba(230, 50, 50, 0.50)",
        glow: "transparent",
        label: "#111111",
        lineWidth: 1.8
      };
    }

    const schemes: Record<string, any> = {
      monitor: {
        dark: {
          bg: "#04060a",
          trace: "#00ff88",
          gridMinor: "rgba(0,255,136,0.12)",
          gridMajor: "rgba(0,255,136,0.24)",
          glow: "rgba(0,255,136,0.15)",
          label: "#00ff88",
          lineWidth: 2
        },
        light: {
          bg: "#fbf9f5",
          trace: "#111111",
          gridMinor: "rgba(0,0,0,0.10)",
          gridMajor: "rgba(0,0,0,0.20)",
          glow: "transparent",
          label: "#111111",
          lineWidth: 2
        }
      },
      philips: {
        dark: {
          bg: "#0a1628",
          trace: "#00e676",
          gridMinor: "rgba(0,230,118,0.10)",
          gridMajor: "rgba(0,230,118,0.20)",
          glow: "rgba(0,230,118,0.12)",
          label: "#00e676",
          lineWidth: 1.8
        },
        light: {
          bg: "#f0f4f8",
          trace: "#1a3a5c",
          gridMinor: "rgba(26,58,92,0.10)",
          gridMajor: "rgba(26,58,92,0.20)",
          glow: "transparent",
          label: "#1a3a5c",
          lineWidth: 1.8
        }
      },
      ge: {
        dark: {
          bg: "#0d1117",
          trace: "#ffd600",
          gridMinor: "rgba(255,214,0,0.10)",
          gridMajor: "rgba(255,214,0,0.20)",
          glow: "rgba(255,214,0,0.10)",
          label: "#ffd600",
          lineWidth: 2
        },
        light: {
          bg: "#fffdf5",
          trace: "#1a1a00",
          gridMinor: "rgba(26,26,0,0.10)",
          gridMajor: "rgba(26,26,0,0.20)",
          glow: "transparent",
          label: "#1a1a00",
          lineWidth: 2
        }
      },
      paper: {
        dark: {
          bg: "#1a1a2e",
          trace: "#e63946",
          gridMinor: "rgba(230,57,70,0.10)",
          gridMajor: "rgba(230,57,70,0.20)",
          glow: "rgba(230,57,70,0.08)",
          label: "#e63946",
          lineWidth: 1.5
        },
        light: {
          bg: "#f5e6d3",
          trace: "#1d3557",
          gridMinor: "rgba(200,150,100,0.20)",
          gridMajor: "rgba(200,150,100,0.45)",
          glow: "transparent",
          label: "#1d3557",
          lineWidth: 1.5
        }
      },
      midnight: {
        dark: {
          bg: "#050510",
          trace: "#7c4dff",
          gridMinor: "rgba(124,77,255,0.10)",
          gridMajor: "rgba(124,77,255,0.20)",
          glow: "rgba(124,77,255,0.15)",
          label: "#7c4dff",
          lineWidth: 2
        },
        light: {
          bg: "#f5f0ff",
          trace: "#311b92",
          gridMinor: "rgba(49,27,146,0.10)",
          gridMajor: "rgba(49,27,146,0.20)",
          glow: "transparent",
          label: "#311b92",
          lineWidth: 2
        }
      }
    };

    const mode = dark ? "dark" : "light";
    return schemes[scheme]?.[mode] || schemes.monitor[mode];
  };

  // ── Global Canvas resizing ──
  const lastDimensions = useRef({ W: 0, H: 0, DPR: 1 });
  const gridCacheCanvas = useRef<HTMLCanvasElement | null>(null);
  const gridCacheValid = useRef<boolean>(false);

  const resizeCanvas = (canvas: HTMLCanvasElement, container: HTMLDivElement) => {
    const rect = container.getBoundingClientRect();
    const cw = rect.width || container.clientWidth;
    const ch = rect.height || container.clientHeight;
    if (cw <= 0 || ch <= 0) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(cw * DPR);
    canvas.height = Math.round(ch * DPR);
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    lastDimensions.current = { W: cw, H: ch, DPR };

    // Clear sweep buffers
    const bufLen = Math.max(1, Math.ceil(cw));
    stateRef.current.sweepBuf = new Float32Array(bufLen).fill(ch / 2);
    stateRef.current.sweepBufCompare = new Float32Array(bufLen).fill(ch / 2);
    stateRef.current.sweepWritten = new Uint8Array(bufLen).fill(0);

    // Invalidate cached grids
    if (!gridCacheCanvas.current) {
      gridCacheCanvas.current = document.createElement("canvas");
    }
    gridCacheCanvas.current.width = Math.round(cw * DPR);
    gridCacheCanvas.current.height = Math.round(ch * DPR);
    const gctx = gridCacheCanvas.current.getContext("2d");
    if (gctx) gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    gridCacheValid.current = false;
  };

  // ── Draw grid backgrounds in high resolution ──
  const drawGridCached = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    colors: any,
    durationSeconds: number,
    speedMM: number
  ) => {
    if (!gridCacheValid.current && gridCacheCanvas.current) {
      const gctx = gridCacheCanvas.current.getContext("2d");
      if (gctx) {
        gctx.clearRect(0, 0, w, h);
        if (stateRef.current.showGrid) {
          const pixelsPerMM = w / (speedMM * durationSeconds);
          const smallGrid = Math.max(1, pixelsPerMM);
          const largeGrid = Math.max(5, smallGrid * 5);

          gctx.save();
          gctx.beginPath();
          gctx.rect(0, 0, w, h);
          gctx.clip();

          gctx.strokeStyle = colors.gridMinor;
          gctx.lineWidth = 0.5;
          gctx.beginPath();
          for (let gx = 0; gx <= w; gx += smallGrid) {
            const rx = Math.round(gx) + 0.5;
            gctx.moveTo(rx, 0);
            gctx.lineTo(rx, h);
          }
          for (let gy = 0; gy <= h; gy += smallGrid) {
            const ry = Math.round(gy) + 0.5;
            gctx.moveTo(0, ry);
            gctx.lineTo(w, ry);
          }
          gctx.stroke();

          gctx.strokeStyle = colors.gridMajor;
          gctx.lineWidth = 0.95;
          gctx.beginPath();
          for (let gx = 0; gx <= w; gx += largeGrid) {
            const rx = Math.round(gx) + 0.5;
            gctx.moveTo(rx, 0);
            gctx.lineTo(rx, h);
          }
          for (let gy = 0; gy <= h; gy += largeGrid) {
            const ry = Math.round(gy) + 0.5;
            gctx.moveTo(0, ry);
            gctx.lineTo(w, ry);
          }
          gctx.stroke();

          gctx.restore();
        }
        gridCacheValid.current = true;
      }
    }

    if (gridCacheCanvas.current) {
      ctx.drawImage(gridCacheCanvas.current, 0, 0, w, h);
    }
  };

  // ── Engine Main integration rendering loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    resizeCanvas(canvas, container);

    let animationFrameId: number;
    let prevTimestamp = 0;

    const render = (timestamp: number) => {
      const activeCanvas = canvasRef.current;
      const activeContainer = containerRef.current;
      if (!activeCanvas || !activeContainer) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      const rect = activeContainer.getBoundingClientRect();
      const cw = rect.width || activeContainer.clientWidth;
      const ch = rect.height || activeContainer.clientHeight;
      const { W: oldW, H: oldH, DPR: oldDPR } = lastDimensions.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);

      if (Math.abs(cw - oldW) > 0.5 || Math.abs(ch - oldH) > 0.5 || dpr !== oldDPR) {
        resizeCanvas(activeCanvas, activeContainer);
      }

      const W = lastDimensions.current.W;
      const H = lastDimensions.current.H;
      if (W <= 0 || H <= 0) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      if (!prevTimestamp) prevTimestamp = timestamp;
      const dt = Math.min((timestamp - prevTimestamp) / 1000, 0.05);
      prevTimestamp = timestamp;

      const ctx = activeCanvas.getContext("2d");
      if (!ctx) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      const state = stateRef.current;
      if (!state.paused) {
        state.timeElapsed = (state.timeElapsed || 0) + dt;
      }
      const dark = document.documentElement.getAttribute("data-theme") !== "light";
      const colors = getThemeColors(dark, state.stripMode, state.colorScheme);
      const displayDuration = 10 / state.zoom;
      const pixelsPerMM = W / (state.speed * displayDuration);
      const pixelsPerSec = state.speed * pixelsPerMM;
      const pixelsPerMv = 10 * pixelsPerMM; // 10mm/mV standard sensitivity
      const centerY = H / 2;

      // ── Single Trace Sweep Plotting ──
      if (state.viewMode === "single") {
        if (state.mode === "database") {
          if (!state.paused) {
            const loopDuration = state.dbLoopWindow?.durationSec || DEFAULT_DB_SIGNAL_DURATION_SEC;
            state.scrollOffset = positiveModulo((state.scrollOffset || 0) + dt, loopDuration);
          }
        } else if (!state.paused) {
          const bpm = state.heartRate;
          const bps = bpm > 0 ? bpm / 60 : 0.5;
          const cycleDur = bps > 0 ? 1 / bps : 2;
          const pixelsThisFrame = pixelsPerSec * dt;
          const oldPhase = state.phase;
          const oldBeatIndex = state.beatIndex;

          if (bpm > 0) {
            let actualDt = dt;
            if (state.realistic) {
              const jitter = 1.0 + 0.03 * Math.sin(Date.now() * 0.001);
              actualDt *= jitter;
            }
            const totalCycles = state.phase + actualDt / cycleDur;
            const completedCycles = Math.floor(totalCycles);
            state.phase = totalCycles - completedCycles;
            state.beatIndex += completedCycles;
          } else {
            state.phase += dt * 0.5;
            if (state.phase >= 1) state.phase -= 1;
          }

          // R-Peak indicator audio chimes
          const rPeakPhase = state.manualMode
            ? state.waveParams.prInt + state.waveParams.qrsDur * 0.4
            : 0.50;
          const rStart = rPeakPhase - 0.035;
          if (state.phase >= rStart && state.phase <= rPeakPhase + 0.035 && state.lastPhase < rStart) {
            state.rPeakDetected = true;
            if (state.soundOn) playBeep();
          }
          state.lastPhase = state.phase;

          const oldScanX = state.scanX;
          state.scanX += pixelsThisFrame;
          let wrapped = false;
          if (state.scanX >= W) {
            state.scanX -= W;
            wrapped = true;
          }

          const totalAdvance = wrapped ? (W - oldScanX) + state.scanX : state.scanX - oldScanX;
          const drawSteps = Math.max(1, Math.ceil(totalAdvance));
          const maxX = state.sweepBuf ? state.sweepBuf.length : Math.ceil(W);

          for (let i = 0; i <= drawSteps; i++) {
            const frac = i / drawSteps;
            let x = oldScanX + frac * totalAdvance;
            if (x >= W) x -= W;
            const xi = Math.floor(x);
            if (xi >= 0 && xi < maxX) {
              const sampleSeconds = dt * frac;
              const cyclesAtSample = oldPhase + sampleSeconds / cycleDur;
              const beatIndex = oldBeatIndex + Math.floor(cyclesAtSample);
              const samplePhase = ((cyclesAtSample % 1) + 1) % 1;

              if (state.comparisonMode) {
                const centerY_top = H / 4;
                const centerY_bottom = (3 * H) / 4;
                
                const valNSR = getWaveformForBeatIndex(
                  samplePhase,
                  state.currentLead,
                  beatIndex,
                  "nsr",
                  0.0,
                  72,
                  state.amplitude,
                  state.noise,
                  state.realistic,
                  state.manualMode,
                  state.waveParams
                );

                const valCurrent = getWaveformForBeatIndex(
                  samplePhase,
                  state.currentLead,
                  beatIndex,
                  state.currentRhythm,
                  state.effectIntensity,
                  state.heartRate,
                  state.amplitude,
                  state.noise,
                  state.realistic,
                  state.manualMode,
                  state.waveParams
                );

                if (state.sweepBuf && state.sweepBufCompare && state.sweepWritten) {
                  state.sweepBufCompare[xi] = centerY_top - valNSR * pixelsPerMv;
                  state.sweepBuf[xi] = centerY_bottom - valCurrent * pixelsPerMv;
                  state.sweepWritten[xi] = 1;
                }
              } else {
                const val = getWaveformForBeatIndex(
                  samplePhase,
                  state.currentLead,
                  beatIndex,
                  state.currentRhythm,
                  state.effectIntensity,
                  state.heartRate,
                  state.amplitude,
                  state.noise,
                  state.realistic,
                  state.manualMode,
                  state.waveParams
                );
                const yi = centerY - val * pixelsPerMv;
                if (state.sweepBuf && state.sweepWritten) {
                  state.sweepBuf[xi] = yi;
                  state.sweepWritten[xi] = 1;
                }
              }
            }
          }
        }

        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, W, H);

        drawGridCached(ctx, W, H, colors, displayDuration, state.speed);

        if (state.comparisonMode) {
          ctx.strokeStyle = colors.gridMajor;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(0, H / 2);
          ctx.lineTo(W, H / 2);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.font = "bold 12px var(--font-mono)";
          ctx.fillStyle = colors.label;
          ctx.fillText("NORMAL SINUS (REF)", 10, 20);
          ctx.fillText(`${state.currentRhythm.toUpperCase()} (ACTIVE)`, 10, H / 2 + 20);
        }

        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        
        if (state.mode === "database") {
          const dbSignalArray = getRecordSignalForLead(state.signals, state.currentLead);
          if (dbSignalArray) {
            ctx.beginPath();
            let first = true;
            const signalLen = dbSignalArray.length;
            const signalFreq = state.frequency || selectedFreq || 500;
            const drawSteps = Math.max(Math.ceil(W), Math.ceil(displayDuration * signalFreq));
            
            let prevIdx = -1;
            for (let i = 0; i <= drawSteps; i++) {
              const norm = i / drawSteps;
              const px = norm * W;
              const t = norm * displayDuration;
              const sample = sampleDbSignal(
                dbSignalArray,
                t + (state.scrollOffset || 0),
                signalFreq,
                state.dbLoopWindow,
                state.dbVisualSmoothing
              );
              const idx0 = sample.sampleIndex;
              let val = sample.value * state.amplitude;

              if (state.noise > 0) {
                val = addTraceNoise(val, px * 0.05, 0, state.noise, state.realistic, state.heartRate);
              }
              
              const yCoord = centerY - val * pixelsPerMv;
              if (first) {
                ctx.moveTo(px, yCoord);
                first = false;
              } else {
                if (prevIdx !== -1 && Math.abs(idx0 - prevIdx) > signalLen / 2 && state.dbLoopWindow?.source === "full") {
                  ctx.moveTo(px, yCoord);
                } else {
                  ctx.lineTo(px, yCoord);
                }
              }
              prevIdx = idx0;
            }

            if (colors.glow !== "transparent") {
              ctx.strokeStyle = colors.glow;
              ctx.lineWidth = colors.lineWidth * 2.5;
              ctx.stroke();
            }

            ctx.strokeStyle = colors.trace;
            ctx.lineWidth = colors.lineWidth;
            ctx.stroke();

            // R-Peaks Canvas Overlay in db-diagnostic tab, peaks sub-tab
            if (state.activeTab === "db-diagnostic" && state.diagSubTab === "peaks" && state.peaksAnalysis) {
              const analysis = state.peaksAnalysis;
              const scroll = state.scrollOffset || 0;
              const dur = displayDuration;
              const loop = state.dbLoopWindow || { startSec: 0, durationSec: DEFAULT_DB_SIGNAL_DURATION_SEC, source: "full" as const };
              
              ctx.save();
              analysis.peaksInfo.forEach((peak: any) => {
                const peakLoopTime = positiveModulo(peak.time - loop.startSec, loop.durationSec);
                let diffT = peakLoopTime - scroll;
                diffT = positiveModulo(diffT, loop.durationSec);
                
                if (diffT >= 0 && diffT < dur) {
                  const px = (diffT / dur) * W;
                  const val = peak.value * state.amplitude;
                  const py = centerY - val * pixelsPerMv;
                  
                  // Draw R vertical dashed line
                  ctx.strokeStyle = "rgba(46, 160, 67, 0.4)";
                  ctx.lineWidth = 1.2;
                  ctx.setLineDash([4, 4]);
                  ctx.beginPath();
                  ctx.moveTo(px, 0);
                  ctx.lineTo(px, H);
                  ctx.stroke();
                  ctx.setLineDash([]);
                  
                  // Draw glowing green circle
                  ctx.fillStyle = "#2ea043";
                  ctx.beginPath();
                  ctx.arc(px, py, 6, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.strokeStyle = "#ffffff";
                  ctx.lineWidth = 1.5;
                  ctx.stroke();
                  
                  // Draw "R" label text
                  ctx.fillStyle = "#2ea043";
                  ctx.font = "bold 10px monospace";
                  ctx.fillText("R", px - 3, py - 10);
                }
              });
              ctx.restore();
            }

            if (!state.paused) {
              const currentSampleVal = sampleDbSignal(
                dbSignalArray,
                state.scrollOffset || 0,
                signalFreq,
                state.dbLoopWindow,
                false
              ).value;
              const threshold = 0.55;
              if (currentSampleVal > threshold && !state.rPeakDetected) {
                state.rPeakDetected = true;
                if (state.soundOn) playBeep();
              } else if (currentSampleVal < 0.15) {
                state.rPeakDetected = false;
              }
            }
          }
        } else {
          // Manual mode traces (Comparison & Active)
          const traceLen = state.sweepBuf ? Math.min(Math.ceil(W), state.sweepBuf.length) : Math.ceil(W);

          // Render NSR Trace
          if (state.comparisonMode && state.sweepBufCompare) {
            ctx.beginPath();
            let prevX_c = -1;
            for (let x = 0; x < traceLen; x++) {
              if (!state.sweepWritten || !state.sweepWritten[x]) {
                prevX_c = -1;
                continue;
              }
              const y = state.sweepBufCompare[x];
              if (prevX_c < 0 || x - prevX_c > 2) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
              prevX_c = x;
            }
            ctx.strokeStyle = colors.trace;
            ctx.lineWidth = colors.lineWidth;
            ctx.stroke();
          }

          // Render Active/Bottom Trace
          if (state.sweepBuf) {
            ctx.beginPath();
            let prevX = -1;
            for (let x = 0; x < traceLen; x++) {
              if (!state.sweepWritten || !state.sweepWritten[x]) {
                prevX = -1;
                continue;
              }
              const y = state.sweepBuf[x];
              if (prevX < 0 || x - prevX > 2) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
              prevX = x;
            }

            if (colors.glow !== "transparent") {
              ctx.strokeStyle = colors.glow;
              ctx.lineWidth = colors.lineWidth * 2.5;
              ctx.stroke();
            }

            let traceColor = colors.trace;
            if (state.currentRhythm.startsWith("stemi_")) {
              const config = INTENSITY_STAGES[state.currentRhythm];
              if (config?.culpritLeads?.includes(state.currentLead)) traceColor = "#ff4444";
              else if (config?.reciprocalLeads?.includes(state.currentLead)) traceColor = "#4499ff";
            }

            ctx.strokeStyle = traceColor;
            ctx.lineWidth = colors.lineWidth;
            ctx.stroke();
          }

          // Render vertical sweep scanning cursor
          let cursorColor = colors.trace;
          if (state.currentRhythm.startsWith("stemi_")) {
            const config = INTENSITY_STAGES[state.currentRhythm];
            if (config?.culpritLeads?.includes(state.currentLead)) cursorColor = "#ff4444";
            else if (config?.reciprocalLeads?.includes(state.currentLead)) cursorColor = "#4499ff";
          }
          ctx.strokeStyle = cursorColor;
          ctx.lineWidth = 1.25;
          ctx.globalAlpha = 0.35;
          ctx.beginPath();
          ctx.moveTo(state.scanX, 0);
          ctx.lineTo(state.scanX, H);
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        }

      } else {
        // ── Standard Diagnostic 12-Lead Rendering ──
        const numCols = 4, numRows = 3;
        const rhythmStripFrac = 0.18;
        const gridHeight = H * (1 - rhythmStripFrac);
        const rhythmHeight = H * rhythmStripFrac;
        const cellW = W / numCols;
        const cellH = gridHeight / numRows;

        const cellDuration = 2.5 / state.zoom;
        const totalDuration = numCols * cellDuration;
        const displayPixelsPerSec = W / totalDuration;

        if (state.mode === "database" && state.signals) {
          if (!state.paused) {
            const loopDuration = state.dbLoopWindow?.durationSec || DEFAULT_DB_SIGNAL_DURATION_SEC;
            state.scrollOffset = positiveModulo((state.scrollOffset || 0) + dt * state.zoom, loopDuration);
          }

          ctx.fillStyle = colors.bg;
          ctx.fillRect(0, 0, W, H);
          drawGridCached(ctx, W, H, colors, totalDuration, state.speed);

          ctx.lineJoin = "round";
          ctx.lineCap = "round";

          // Draw 12 dynamic database signal lines
          for (let row = 0; row < numRows; row++) {
            for (let col = 0; col < numCols; col++) {
              const lead = LAYOUT_12[row][col];
              const cx = col * cellW;
              const cy = row * cellH;
              const centerYLocal = cy + cellH / 2;

              ctx.save();
              ctx.beginPath();
              ctx.rect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
              ctx.clip();

              // Baseline lead marker
              ctx.strokeStyle = colors.gridMinor;
              ctx.lineWidth = 0.6;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(cx, centerYLocal);
              ctx.lineTo(cx + cellW, centerYLocal);
              ctx.stroke();
              ctx.setLineDash([]);

              const leadSignal = getRecordSignalForLead(state.signals, lead);
              if (leadSignal) {
                ctx.beginPath();
                let first = true;
                const signalLen = leadSignal.length;
                const signalFreq = state.frequency || selectedFreq || 500;
                const drawSteps = Math.max(Math.ceil(cellW), Math.ceil(cellDuration * signalFreq));
                
                let prevIdx = -1;
                for (let px = 0; px <= drawSteps; px++) {
                  const frac = px / drawSteps;
                  const t = frac * cellDuration;
                  const sample = sampleDbSignal(
                    leadSignal,
                    t + (state.scrollOffset || 0),
                    signalFreq,
                    state.dbLoopWindow,
                    state.dbVisualSmoothing
                  );
                  const idx0 = sample.sampleIndex;
                  let val = sample.value * state.amplitude;

                  if (state.noise > 0) {
                    val = addTraceNoise(val, idx0 * 0.05, 0, state.noise, state.realistic, state.heartRate);
                  }

                  const xCoord = cx + (frac * cellW);
                  const yCoord = centerYLocal - val * pixelsPerMv;
                  if (first) {
                    ctx.moveTo(xCoord, yCoord);
                    first = false;
                  } else {
                    if (prevIdx !== -1 && Math.abs(idx0 - prevIdx) > signalLen / 2 && state.dbLoopWindow?.source === "full") {
                      ctx.moveTo(xCoord, yCoord);
                    } else {
                      ctx.lineTo(xCoord, yCoord);
                    }
                  }
                  prevIdx = idx0;
                }

                if (colors.glow !== "transparent") {
                  ctx.strokeStyle = colors.glow;
                  ctx.lineWidth = 2.8;
                  ctx.stroke();
                }

                ctx.strokeStyle = colors.trace;
                ctx.lineWidth = 1.6;
                ctx.stroke();
              }

              // Lead label
              ctx.font = "bold 12px monospace";
              const lw = ctx.measureText(lead).width;
              ctx.fillStyle = dark ? "rgba(4,6,10,0.75)" : "rgba(255,255,255,0.85)";
              ctx.fillRect(cx + 4, cy + 4, lw + 8, 16);
              ctx.fillStyle = colors.trace;
              ctx.fillText(lead, cx + 8, cy + 16);

              ctx.restore();
            }
          }

          // Boundaries
          ctx.strokeStyle = dark ? "rgba(180,200,220,0.3)" : "rgba(30,40,50,0.3)";
          ctx.lineWidth = 1.5;
          for (let row = 1; row < numRows; row++) {
            ctx.beginPath();
            ctx.moveTo(0, row * cellH);
            ctx.lineTo(W, row * cellH);
            ctx.stroke();
          }
          for (let col = 1; col < numCols; col++) {
            ctx.beginPath();
            ctx.moveTo(col * cellW, 0);
            ctx.lineTo(col * cellW, gridHeight);
            ctx.stroke();
          }

          // Rhythm strip divider
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.moveTo(0, gridHeight);
          ctx.lineTo(W, gridHeight);
          ctx.stroke();

          // Lead II Rhythm Strip at bottom of 12-lead view
          const rhythmY = gridHeight + rhythmHeight / 2;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, gridHeight + 1, W, rhythmHeight - 1);
          ctx.clip();

          const iiSignal = getRecordSignalForLead(state.signals, "II");
          if (iiSignal) {
            ctx.beginPath();
            let firstR = true;
            const iiLen = iiSignal.length;
            const signalFreq = state.frequency || selectedFreq || 500;
            const drawSteps = Math.max(Math.ceil(W), Math.ceil(totalDuration * signalFreq));
            let prevRIdx = -1;
            for (let i = 0; i <= drawSteps; i++) {
              const norm = i / drawSteps;
              const px = norm * W;
              const t = norm * totalDuration;
              const sample = sampleDbSignal(
                iiSignal,
                t + (state.scrollOffset || 0),
                signalFreq,
                state.dbLoopWindow,
                state.dbVisualSmoothing
              );
              const idx0 = sample.sampleIndex;
              let val = sample.value * state.amplitude;

              if (state.noise > 0) {
                val = addTraceNoise(val, px * 0.05, 0, state.noise, state.realistic, state.heartRate);
              }

              const yCoord = rhythmY - val * pixelsPerMv;
              if (firstR) {
                ctx.moveTo(px, yCoord);
                firstR = false;
              } else {
                if (prevRIdx !== -1 && Math.abs(idx0 - prevRIdx) > iiLen / 2 && state.dbLoopWindow?.source === "full") {
                  ctx.moveTo(px, yCoord);
                } else {
                  ctx.lineTo(px, yCoord);
                }
              }
              prevRIdx = idx0;
            }

            if (colors.glow !== "transparent") {
              ctx.strokeStyle = colors.glow;
              ctx.lineWidth = 2.8;
              ctx.stroke();
            }

            ctx.strokeStyle = colors.trace;
            ctx.lineWidth = 1.8;
            ctx.stroke();
          }

          // Badge Label continuous
          ctx.font = "bold 11px monospace";
          const labelText = `II  — Continuous Rhythm Strip · ${Math.round(state.heartRate)} bpm · ${state.speed}mm/s · 10mm/mV`;
          const textW = ctx.measureText(labelText).width;
          ctx.fillStyle = dark ? "rgba(4,6,10,0.75)" : "rgba(255,255,255,0.85)";
          ctx.fillRect(8, gridHeight + 4, textW + 10, 16);
          ctx.fillStyle = colors.trace;
          ctx.fillText(labelText, 12, gridHeight + 16);

          ctx.restore();

        } else {
          if (!state.paused) {
            const bpm = state.heartRate;
            const bps = bpm > 0 ? bpm / 60 : 0.5;
            const cycleDur = bps > 0 ? 1 / bps : 2;
            state.phase += dt / cycleDur;
            if (state.phase >= 1) {
              state.phase -= 1;
              state.beatIndex++;
            }
          }

          ctx.fillStyle = colors.bg;
          ctx.fillRect(0, 0, W, H);

          drawGridCached(ctx, W, H, colors, totalDuration, state.speed);

          ctx.lineJoin = "round";
          ctx.lineCap = "round";

        const bps = state.heartRate > 0 ? state.heartRate / 60 : 1;
        let renderPhase = state.phase;
        let renderBeatCounter = state.beatIndex;

        if (state.heartRate > 0 && displayPixelsPerSec > 0) {
          const absoluteCycles = state.beatIndex + state.phase;
          const absoluteSeconds = absoluteCycles / bps;
          const pixelAlignedSeconds = Math.round(absoluteSeconds * displayPixelsPerSec) / displayPixelsPerSec;
          const pixelAlignedCycles = pixelAlignedSeconds * bps;
          renderBeatCounter = Math.floor(pixelAlignedCycles);
          renderPhase = pixelAlignedCycles - renderBeatCounter;
        }

        // Setup LUT caches for non-beat-aware segments
        const isBeatAware = BEAT_AWARE_RHYTHMS.has(state.currentRhythm);
        if (!isBeatAware) {
          buildAllLeadLUTs(
            state.currentRhythm,
            "II",
            state.effectIntensity,
            state.amplitude,
            state.heartRate,
            state.manualMode,
            state.waveParams
          );
        }

        // Draw 12 dynamic waveform cells
        for (let row = 0; row < numRows; row++) {
          for (let col = 0; col < numCols; col++) {
            const lead = LAYOUT_12[row][col];
            const cx = col * cellW;
            const cy = row * cellH;
            const centerYLocal = cy + cellH / 2;

            ctx.save();
            ctx.beginPath();
            ctx.rect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
            ctx.clip();

            // cell baseline
            ctx.strokeStyle = colors.gridMinor;
            ctx.lineWidth = 0.6;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(cx, centerYLocal);
            ctx.lineTo(cx + cellW, centerYLocal);
            ctx.stroke();
            ctx.setLineDash([]);

            let traceColor = colors.trace;
            if (state.currentRhythm.startsWith("stemi_")) {
              const config = INTENSITY_STAGES[state.currentRhythm];
              if (config?.culpritLeads?.includes(lead)) traceColor = "#ff4444";
              else if (config?.reciprocalLeads?.includes(lead)) traceColor = "#4499ff";
            }

            ctx.beginPath();
            let first = true;
            const steps = Math.ceil(cellW);

            for (let px = 0; px <= steps; px += 1) {
              const norm = (col + px / cellW) / numCols;
              const t_ago = (1 - norm) * totalDuration;
              let phaseLocal = renderPhase - t_ago * bps;
              const beatsAgo = Math.floor(-phaseLocal);
              const beatIndex = renderBeatCounter - beatsAgo;
              phaseLocal = ((phaseLocal % 1) + 10) % 1;

              let val = 0;
              if (isBeatAware) {
                val = getWaveformForBeatIndex(
                  phaseLocal,
                  lead,
                  beatIndex,
                  state.currentRhythm,
                  state.effectIntensity,
                  state.heartRate,
                  state.amplitude,
                  state.noise,
                  state.realistic,
                  state.manualMode,
                  state.waveParams
                );
              } else {
                val = sampleLeadLUT(
                  lead,
                  phaseLocal,
                  state.currentRhythm,
                  state.effectIntensity,
                  state.heartRate,
                  state.manualMode,
                  state.waveParams
                );
                val *= state.amplitude;
                val = addTraceNoise(val, phaseLocal, beatIndex + px * 0.017 + row * 0.37 + col * 0.19, state.noise, state.realistic, state.heartRate);
              }

              const xCoord = cx + (px / steps) * cellW;
              const yCoord = centerYLocal - val * pixelsPerMv;
              if (first) {
                ctx.moveTo(xCoord, yCoord);
                first = false;
              } else {
                ctx.lineTo(xCoord, yCoord);
              }
            }

            if (colors.glow !== "transparent") {
              ctx.strokeStyle = colors.glow;
              ctx.lineWidth = 2.8;
              ctx.stroke();
            }

            ctx.strokeStyle = traceColor;
            ctx.lineWidth = 1.6;
            ctx.stroke();

            // Lead Badge label
            const fs = Math.max(10, Math.min(14, cellH * 0.115));
            ctx.font = `bold ${fs}px monospace`;
            const lw = ctx.measureText(lead).width;
            const lx = cx + 6;
            const ly = cy + 5;
            ctx.fillStyle = dark ? "rgba(4,6,10,0.75)" : "rgba(255,255,255,0.82)";
            ctx.fillRect(lx - 3, ly, lw + 8, fs + 4);
            ctx.fillStyle = traceColor;
            ctx.fillText(lead, lx + 1, ly + fs);

            ctx.restore();
          }
        }

        // Draw boundaries grid lines
        const borderOpacity = dark ? 0.30 : 0.32;
        const borderColor = dark ? `rgba(180,200,220,${borderOpacity})` : `rgba(30,40,50,${borderOpacity})`;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1.8;

        for (let row = 1; row < numRows; row++) {
          ctx.beginPath();
          ctx.moveTo(0, row * cellH);
          ctx.lineTo(W, row * cellH);
          ctx.stroke();
        }
        for (let col = 1; col < numCols; col++) {
          ctx.beginPath();
          ctx.moveTo(col * cellW, 0);
          ctx.lineTo(col * cellW, gridHeight);
          ctx.stroke();
        }

        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, gridHeight);
        ctx.lineTo(W, gridHeight);
        ctx.stroke();

        // ── Lower Lead II Rhythm continuous strip tracing ──
        const rhythmY = gridHeight + rhythmHeight / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, gridHeight + 1, W, rhythmHeight - 1);
        ctx.clip();

        ctx.strokeStyle = colors.gridMinor;
        ctx.lineWidth = 0.6;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, rhythmY);
        ctx.lineTo(W, rhythmY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        let firstRhythm = true;

        for (let px = 0; px <= W; px += 1) {
          const norm = px / W;
          const t_ago = (1 - norm) * totalDuration;
          let phaseLocal = renderPhase - t_ago * bps;
          const beatsAgo = Math.floor(-phaseLocal);
          const beatIndex = renderBeatCounter - beatsAgo;
          phaseLocal = ((phaseLocal % 1) + 10) % 1;

          let val = 0;
          if (isBeatAware) {
            val = getWaveformForBeatIndex(
              phaseLocal,
              "II",
              beatIndex,
              state.currentRhythm,
              state.effectIntensity,
              state.heartRate,
              state.amplitude,
              state.noise,
              state.realistic,
              state.manualMode,
              state.waveParams
            );
          } else {
            val = sampleLeadLUT(
              "II",
              phaseLocal,
              state.currentRhythm,
              state.effectIntensity,
              state.heartRate,
              state.manualMode,
              state.waveParams
            );
            val *= state.amplitude;
            val = addTraceNoise(val, phaseLocal, beatIndex + px * 0.017 + 0.71, state.noise, state.realistic, state.heartRate);
          }

          const yCoord = rhythmY - val * pixelsPerMv;
          if (firstRhythm) {
            ctx.moveTo(px, yCoord);
            firstRhythm = false;
          } else {
            ctx.lineTo(px, yCoord);
          }
        }

        if (colors.glow !== "transparent") {
          ctx.strokeStyle = colors.glow;
          ctx.lineWidth = 2.8;
          ctx.stroke();
        }

        ctx.strokeStyle = colors.trace;
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Label Badge
        const rhythmFs = Math.max(10, Math.min(13, rhythmHeight * 0.18));
        ctx.font = `bold ${rhythmFs}px monospace`;
        const labelText = `II  —  Rhythm Strip  ·  ${Math.round(state.heartRate)} bpm  ·  ${state.speed}mm/s  ·  10mm/mV`;
        const labelW = ctx.measureText(labelText).width;
        ctx.fillStyle = dark ? "rgba(4,6,10,0.75)" : "rgba(255,255,255,0.82)";
        ctx.fillRect(5, gridHeight + 4, labelW + 10, rhythmFs + 5);
        ctx.fillStyle = colors.trace;
        ctx.fillText(labelText, 10, gridHeight + 4 + rhythmFs);

        // Timeline ticks
        ctx.fillStyle = colors.label;
        ctx.globalAlpha = 0.40;
        ctx.font = `${Math.max(8, rhythmHeight * 0.12)}px monospace`;
        for (let s = 1; s < 10; s++) {
          const x = (s / 10) * W;
          ctx.fillText(s + "s", x - 5, gridHeight + rhythmHeight - 4);
          ctx.beginPath();
          ctx.strokeStyle = colors.label;
          ctx.lineWidth = 0.8;
          ctx.moveTo(x, gridHeight + rhythmHeight - 16);
          ctx.lineTo(x, gridHeight + rhythmHeight - 4);
          ctx.stroke();
        }
        ctx.globalAlpha = 1.0;
        ctx.restore();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizeCanvas]);

  // ── Manual controls parameters setting ──
  const updateManualWaveParam = (param: string, sliderVal: number) => {
    if (!manualMode) {
      setManualMode(true);
    }
    const val = parseFloat(sliderVal as any);
    let converted = val;

    setWaveParams((prev: any) => {
      const next = { ...prev };
      switch (param) {
        case "pAmp":
          converted = val / 100;
          next.pAmp = converted;
          break;
        case "pDur":
          converted = val / 1000;
          next.pDur = converted;
          break;
        case "prInt":
          converted = val / 1000;
          next.prInt = converted;
          break;
        case "qrsAmp":
          converted = val / 100;
          next.qrsAmp = converted;
          break;
        case "qrsDur":
          converted = val / 1000;
          next.qrsDur = converted;
          break;
        case "jNotch":
          converted = val / 100;
          next.jNotch = converted;
          break;
        case "stElev":
          converted = val / 100;
          next.stElev = converted;
          break;
        case "stDur":
          converted = val / 1000;
          next.stDur = converted;
          break;
        case "stSlope":
          next.stSlope = val;
          break;
        case "tAmp":
          converted = val / 100;
          next.tAmp = converted;
          break;
        case "tDur":
          converted = val / 1000;
          next.tDur = converted;
          break;
        case "tShape":
          next.tShape = val;
          break;
        case "uAmp":
          converted = val / 100;
          next.uAmp = converted;
          break;
        case "uDur":
          converted = val / 1000;
          next.uDur = converted;
          break;
      }
      return next;
    });
  };

  // ── Sync slider fields inside parameters configuration ──
  const syncManualSliders = (p: any) => {
    setWaveParams({
      pAmp: p.pAmp,
      pDur: p.pDur,
      prInt: p.prInt,
      qrsAmp: p.qrsAmp,
      qrsDur: p.qrsDur,
      jNotch: p.jNotch || 0.00,
      stElev: p.stElev || 0.00,
      stDur: p.stDur || 0.12,
      stSlope: p.stSlope || 0,
      tAmp: p.tAmp,
      tDur: p.tDur,
      tShape: p.tShape || 1,
      uAmp: p.uAmp || 0.00,
      uDur: p.uDur || 0.10
    });
  };

  // ── Selector handler ──
  const selectRhythm = (id: string) => {
    if (manualMode) {
      setManualMode(false);
    }
    setCurrentRhythm(id);
    const rate = rhythmRates[id] || 72;
    setHeartRate(rate);

    const config = INTENSITY_STAGES[id];
    const defaultInt = config ? config.defaultIntensity : 0.0;
    setEffectIntensity(defaultInt);

    // Sync manual parameters
    if (config?.params) {
      const p = config.params(defaultInt);
      syncManualSliders(p);
    }

    // Force grid caches invalid
    gridCacheValid.current = false;
    stateRef.current.phase = 0.0;
    stateRef.current.scanX = 0.0;
    stateRef.current.beatIndex = 0;

    const matched = RHYTHMS.find((r) => r.id === id);
    showToastMsg("Rhythm Configured: " + (matched ? matched.name : id.toUpperCase()));
  };

  const selectLead = (lead: string) => {
    setCurrentLead(lead);
    gridCacheValid.current = false;
    stateRef.current.phase = 0.0;
    stateRef.current.scanX = 0.0;
    showToastMsg("Monitoring Lead: " + lead);
  };

  const adjustZoom = (dir: number) => {
    const step = 0.2;
    setZoom((prevZoom) => {
      const newVal = Math.max(0.2, Math.min(5.0, prevZoom + dir * step));
      const rounded = Math.round(newVal * 10) / 10;
      gridCacheValid.current = false;
      showToastMsg("Grid Zoom: " + rounded.toFixed(2) + "x");
      return rounded;
    });
  };

  const handleIntensityChange = (valStr: string) => {
    const numericSlider = parseInt(valStr);
    const intensityFloat = numericSlider / 100;
    setEffectIntensity(intensityFloat);

    const config = INTENSITY_STAGES[currentRhythm];
    if (config?.hrMod && !manualMode) {
      const modulatedHR = Math.round(config.hrMod(intensityFloat));
      setHeartRate(modulatedHR);
    }
    if (config?.params) {
      const p = config.params(intensityFloat);
      syncManualSliders(p);
    }
  };

  const toggleManualModeState = (on: boolean) => {
    setManualMode(on);
    gridCacheValid.current = false;
    stateRef.current.phase = 0.0;
    stateRef.current.scanX = 0.0;
    showToastMsg(on ? "Manual Wave Customizer Engaged" : "Preserving Medical Rhythm Presets");
  };

  const setViewModeState = (mode: string) => {
    setViewMode(mode);
    // Auto-navigate away from leads tab when entering 12-lead (leads are irrelevant there)
    if (mode === "12lead") {
      setActiveTab((prev) => {
        if (prev === "leads") return "rhythms";
        if (prev === "db-leads") return "db-explorer";
        return prev;
      });
    }
    gridCacheValid.current = false;
    stateRef.current.phase = 0.0;
    stateRef.current.scanX = 0.0;
    showToastMsg(mode === "12lead" ? "Standard 12-Lead Diagnostic Layout" : "Focused Single Trace View");
  };

  const toggleTheme = () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const nextTheme = currentTheme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", nextTheme);
    localStorage.setItem("ecg-theme", nextTheme);

    if (nextTheme === "light" && !stripMode) {
      setStripMode(true);
    }
    gridCacheValid.current = false;
    showToastMsg(nextTheme === "dark" ? "Dark System Selected" : "Light Mode Activated");
  };

  const toggleComparisonModeState = () => {
    if (viewMode !== "single") {
      setViewModeState("single");
    }
    setComparisonMode((prev) => !prev);
    gridCacheValid.current = false;
    stateRef.current.phase = 0.0;
    stateRef.current.scanX = 0.0;
    showToastMsg(!comparisonMode ? "Split-Screen Comparison Enabled" : "Standard View Restored");
  };

  const toggleStripModeState = () => {
    setStripMode((prev) => !prev);
    gridCacheValid.current = false;
    stateRef.current.phase = 0.0;
    stateRef.current.scanX = 0.0;
    showToastMsg(!stripMode ? "Grid Paper Layout Activated" : "Classic Medical Monitor Active");
  };

  const resetSettings = () => {
    setHeartRate(72);
    setAmplitude(1.0);
    setSpeed(25);
    setNoise(0);
    setCurrentRhythm("nsr");
    setCurrentLead("II");
    setZoom(1.0);
    setEffectIntensity(0.0);
    setManualMode(false);
    setComparisonMode(false);
    setRealistic(false);
    setSoundOn(false);

    setWaveParams({
      pAmp: 0.12,
      pDur: 0.10,
      prInt: 0.19,
      qrsAmp: 1.00,
      qrsDur: 0.06,
      jNotch: 0.00,
      stElev: 0.00,
      stDur: 0.12,
      stSlope: 0,
      tAmp: 0.22,
      tDur: 0.19,
      tShape: 1,
      uAmp: 0.00,
      uDur: 0.10
    });

    gridCacheValid.current = false;
    stateRef.current.phase = 0.0;
    stateRef.current.scanX = 0.0;
    stateRef.current.beatIndex = 0;
    showToastMsg("System parameters reset to defaults");
  };

  const startCalibration = () => {
    const canvasObj = canvasRef.current;
    if (!canvasObj) return;
    const ctx = canvasObj.getContext("2d");
    if (!ctx) return;

    const colors = getThemeColors(
      document.documentElement.getAttribute("data-theme") !== "light",
      stripMode,
      colorScheme
    );
    const W = lastDimensions.current.W;
    const H = lastDimensions.current.H;

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);

    const displayDuration = 10 / zoom;
    const pixelsPerMM = W / (speed * displayDuration);
    const pixelsPerMv = 10 * pixelsPerMM;
    const centerY = H / 2;
    const pulseWidth = speed * pixelsPerMM * 0.2;

    ctx.strokeStyle = colors.trace;
    ctx.lineWidth = colors.lineWidth;
    ctx.beginPath();
    ctx.moveTo(20, centerY);
    ctx.lineTo(20, centerY - pixelsPerMv);
    ctx.lineTo(20 + pulseWidth, centerY - pixelsPerMv);
    ctx.lineTo(20 + pulseWidth, centerY);
    ctx.stroke();

    ctx.fillStyle = colors.label;
    ctx.font = "12px monospace";
    ctx.fillText("1 mV Calibration", 22, centerY - pixelsPerMv - 8);
    ctx.fillText(speed + " mm/s", 22, centerY + 20);

    setPaused(true);
    setTimeout(() => {
      setPaused(false);
      gridCacheValid.current = false;
    }, 3000);

    showToastMsg("Generating calibration pulse (1.0 mV)");
  };

  const simulateArrest = () => {
    selectRhythm("vtach");
    setTimeout(() => selectRhythm("vfib"), 3000);
    setTimeout(() => selectRhythm("asystole"), 7000);
    setTimeout(() => showToastMsg("Cardiac flatline reached"), 10000);
    showToastMsg("Initiating standard cardiac arrest sequence");
  };

  // ── Sidebar Drag Resizing functionality ──
  const sidebarIsDragging = useRef<boolean>(false);

  const startDragging = (e: React.MouseEvent | React.TouchEvent) => {
    sidebarIsDragging.current = true;
    document.body.classList.add("resizing");
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarIsDragging.current) return;
      const bodyWidth = document.body.clientWidth;
      const newWidth = bodyWidth - e.clientX;
      if (newWidth >= 280 && newWidth <= 600) {
        setSidebarWidth(newWidth);
        gridCacheValid.current = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!sidebarIsDragging.current || e.touches.length < 1) return;
      const bodyWidth = document.body.clientWidth;
      const newWidth = bodyWidth - e.touches[0].clientX;
      if (newWidth >= 280 && newWidth <= 600) {
        setSidebarWidth(newWidth);
        gridCacheValid.current = false;
      }
    };

    const handleMouseUp = () => {
      if (sidebarIsDragging.current) {
        sidebarIsDragging.current = false;
        document.body.classList.remove("resizing");
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchend", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchend", handleMouseUp);
    };
  }, []);

  // ── PNG captures ──
  const takeSnapshot = () => {
    const canvasObj = canvasRef.current;
    if (!canvasObj) return;
    const dataUrl = canvasObj.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = "ecg-capture-" + getImpureTimestamp() + ".png";
    link.href = dataUrl;
    link.click();
    showToastMsg("PNG captured successfully");
  };

  // ── PDF exporter vector preview ──
  const openPdfExport = () => {
    setPdfOpen(true);
    setTimeout(() => {
      generatePdfPreview();
    }, 120);
  };

  const closePdfExport = () => {
    setPdfOpen(false);
  };

  const generatePdfPreview = () => {
    const pdfCanvas = pdfCanvasRef.current;
    if (!pdfCanvas) return;
    const pdfCtx = pdfCanvas.getContext("2d");
    if (!pdfCtx) return;

    const rhythmObj = RHYTHMS.find((r) => r.id === currentRhythm);
    const rhythmName = manualMode ? "Custom Manual Wave" : rhythmObj ? rhythmObj.name : currentRhythm;
    const bpm = Math.round(heartRate);
    const mm2px = 300 / 25.4; // standard 300 DPI scaling

    if (viewMode === "12lead") {
      const pw = Math.round(297 * mm2px);
      const ph = Math.round(210 * mm2px);
      pdfCanvas.width = pw;
      pdfCanvas.height = ph;
      pdfCanvas.style.maxHeight = "56vh";

      pdfCtx.fillStyle = "#FFFFFF";
      pdfCtx.fillRect(0, 0, pw, ph);

      // Header title
      pdfCtx.fillStyle = "#111";
      pdfCtx.font = "bold 24px monospace";
      pdfCtx.fillText("12-LEAD DIAGNOSTIC ECG REPORT", 8 * mm2px, 12 * mm2px);

      pdfCtx.font = "14px monospace";
      pdfCtx.fillStyle = "#333";
      pdfCtx.fillText(
        `Rhythm: ${rhythmName}   HR: ${bpm} bpm   Speed: ${speed}mm/s   Gain: 10mm/mV   Date: ${new Date().toLocaleString()}`,
        8 * mm2px,
        18 * mm2px
      );

      // Grid Layout 3x4
      const marginL = 8 * mm2px;
      const headerH = 26 * mm2px;
      const footerH = 8 * mm2px;
      const contentW = pw - marginL - (8 * mm2px);
      const contentH = ph - headerH - footerH;
      const colW = contentW / 4;
      const rhythmH = 22 * mm2px;
      const gridH = contentH - rhythmH - 1 * mm2px;
      const rowH = gridH / 3;

      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          const lead = LAYOUT_12[row][col];
          const cx = marginL + col * colW;
          const cy = headerH + row * rowH;

          pdfCtx.fillStyle = "#FFF5F5";
          pdfCtx.fillRect(cx, cy, colW, rowH);

          // Grid lines drawing
          const minorStep = mm2px;
          const majorStep = mm2px * 5;

          pdfCtx.save();
          pdfCtx.beginPath();
          pdfCtx.rect(cx, cy, colW, rowH);
          pdfCtx.clip();

          pdfCtx.strokeStyle = "rgba(230,50,50,0.20)";
          pdfCtx.lineWidth = 0.6;
          pdfCtx.beginPath();
          for (let gx = cx; gx <= cx + colW; gx += minorStep) {
            pdfCtx.moveTo(gx, cy); pdfCtx.lineTo(gx, cy + rowH);
          }
          for (let gy = cy; gy <= cy + rowH; gy += minorStep) {
            pdfCtx.moveTo(cx, gy); pdfCtx.lineTo(cx + colW, gy);
          }
          pdfCtx.stroke();

          pdfCtx.strokeStyle = "rgba(230,50,50,0.50)";
          pdfCtx.lineWidth = 1.1;
          pdfCtx.beginPath();
          for (let gx = cx; gx <= cx + colW; gx += majorStep) {
            pdfCtx.moveTo(gx, cy); pdfCtx.lineTo(gx, cy + rowH);
          }
          for (let gy = cy; gy <= cy + rowH; gy += majorStep) {
            pdfCtx.moveTo(cx, gy); pdfCtx.lineTo(cx + colW, gy);
          }
          pdfCtx.stroke();
          pdfCtx.restore();

          // Render waveform inside cell
          const pps = speed * mm2px;
          const yScale = 10 * mm2px;
          const bps = heartRate > 0 ? heartRate / 60 : 1;
          const cycleDur = 1 / bps;
          const cellCenterY = cy + rowH / 2;

          let xStart = cx;
          if (col === 0) {
            // Add initial calibration pulse
            const pulseW = 5 * mm2px;
            const pulseH = 10 * mm2px;
            pdfCtx.strokeStyle = "#000";
            pdfCtx.lineWidth = Math.max(1.5, mm2px * 0.18);
            pdfCtx.beginPath();
            pdfCtx.moveTo(cx, cellCenterY);
            pdfCtx.lineTo(cx, cellCenterY - pulseH);
            pdfCtx.lineTo(cx + pulseW, cellCenterY - pulseH);
            pdfCtx.lineTo(cx + pulseW, cellCenterY);
            pdfCtx.stroke();
            xStart = cx + pulseW + mm2px;
          }

          const drawW = cx + colW - xStart;
          pdfCtx.strokeStyle = "#000";
          pdfCtx.lineWidth = Math.max(1.5, mm2px * 0.19);
          pdfCtx.beginPath();

          let first = true;
          const leadSignalArray = mode === "database" ? getRecordSignalForLead(recordSignals, lead) : null;
          if (mode === "database" && recordSignals && leadSignalArray) {
            const signalArray = leadSignalArray;
            const tStart = col * 2.5;
            const tEnd = (col + 1) * 2.5;
            const startSample = Math.floor((tStart / 10.0) * (signalArray.length - 1));
            const endSample = Math.ceil((tEnd / 10.0) * (signalArray.length - 1));
            const safeEnd = Math.min(signalArray.length - 1, endSample);
            
            for (let i = startSample; i <= safeEnd; i++) {
              const t = (i / (signalArray.length - 1)) * 10.0;
              const cellFrac = (t - tStart) / 2.5;
              const px = cellFrac * colW;
              const val = signalArray[i] * amplitude;
              const cx2 = xStart + px;
              const cy2 = cellCenterY - val * yScale;
              
              if (first) {
                pdfCtx.moveTo(cx2, cy2);
                first = false;
              } else {
                pdfCtx.lineTo(cx2, cy2);
              }
            }
          } else {
            for (let px = 0; px <= drawW; px += 0.5) {
              const t = px / pps;
              const beatI = Math.floor(t / cycleDur);
              const phase = (t % cycleDur) / cycleDur;

              let val = getWaveformForBeatIndex(
                phase,
                lead,
                beatI,
                currentRhythm,
                effectIntensity,
                heartRate,
                amplitude,
                noise,
                realistic,
                manualMode,
                waveParams
              );

              const cx2 = xStart + px;
              const cy2 = cellCenterY - val * yScale;
              if (first) {
                pdfCtx.moveTo(cx2, cy2);
                first = false;
              } else {
                pdfCtx.lineTo(cx2, cy2);
              }
            }
          }
          pdfCtx.stroke();

          // Lead Name
          pdfCtx.fillStyle = "#000";
          pdfCtx.font = "bold 13px monospace";
          pdfCtx.fillText(lead, cx + 5, cy + 15);

          // Border around cell
          pdfCtx.strokeStyle = "rgba(0,0,0,0.4)";
          pdfCtx.lineWidth = 1.0;
          pdfCtx.strokeRect(cx, cy, colW, rowH);
        }
      }

      // Continuous rhythm strip (Lead II) on bottom
      const rsY = headerH + gridH + 1 * mm2px;
      const rsX = marginL;
      const rsW = contentW;
      pdfCtx.fillStyle = "#FFF5F5";
      pdfCtx.fillRect(rsX, rsY, rsW, rhythmH);

      // Grid strip
      pdfCtx.save();
      pdfCtx.beginPath();
      pdfCtx.rect(rsX, rsY, rsW, rhythmH);
      pdfCtx.clip();

      const minorStep = mm2px;
      const majorStep = mm2px * 5;
      pdfCtx.strokeStyle = "rgba(230,50,50,0.20)";
      pdfCtx.lineWidth = 0.6;
      pdfCtx.beginPath();
      for (let gx = rsX; gx <= rsX + rsW; gx += minorStep) {
        pdfCtx.moveTo(gx, rsY); pdfCtx.lineTo(gx, rsY + rhythmH);
      }
      for (let gy = rsY; gy <= rsY + rhythmH; gy += minorStep) {
        pdfCtx.moveTo(rsX, gy); pdfCtx.lineTo(rsX + rsW, gy);
      }
      pdfCtx.stroke();

      pdfCtx.strokeStyle = "rgba(230,50,50,0.50)";
      pdfCtx.lineWidth = 1.1;
      pdfCtx.beginPath();
      for (let gx = rsX; gx <= rsX + rsW; gx += majorStep) {
        pdfCtx.moveTo(gx, rsY); pdfCtx.lineTo(gx, rsY + rhythmH);
      }
      for (let gy = rsY; gy <= rsY + rhythmH; gy += majorStep) {
        pdfCtx.moveTo(rsX, gy); pdfCtx.lineTo(rsX + rsW, gy);
      }
      pdfCtx.stroke();
      pdfCtx.restore();

      // Plot sweep
      const pps = speed * mm2px;
      const yScale = 10 * mm2px;
      const bps = heartRate > 0 ? heartRate / 60 : 1;
      const cycleDur = 1 / bps;
      const rCenterY = rsY + rhythmH / 2;

      pdfCtx.strokeStyle = "#000";
      pdfCtx.lineWidth = Math.max(1.5, mm2px * 0.19);
      pdfCtx.beginPath();
      let firstR = true;
      const iiSignalArray = mode === "database" ? getRecordSignalForLead(recordSignals, "II") : null;
      if (mode === "database" && recordSignals && iiSignalArray) {
        const signalArray = iiSignalArray;
        for (let i = 0; i < signalArray.length; i++) {
          const absFrac = i / (signalArray.length - 1);
          let px = absFrac * rsW;

          const val = signalArray[i] * amplitude;
          const cx2 = rsX + px;
          const cy2 = rCenterY - val * yScale;
          
          if (firstR) {
            pdfCtx.moveTo(cx2, cy2);
            firstR = false;
          } else {
            pdfCtx.lineTo(cx2, cy2);
          }
        }
      } else {
        for (let px = 0; px <= rsW; px += 0.5) {
          const t = px / pps;
          const beatI = Math.floor(t / cycleDur);
          const phase = (t % cycleDur) / cycleDur;

          let val = getWaveformForBeatIndex(
            phase,
            "II",
            beatI,
            currentRhythm,
            effectIntensity,
            heartRate,
            amplitude,
            noise,
            realistic,
            manualMode,
            waveParams
          );

          const cx2 = rsX + px;
          const cy2 = rCenterY - val * yScale;
          if (firstR) {
            pdfCtx.moveTo(cx2, cy2);
            firstR = false;
          } else {
            pdfCtx.lineTo(cx2, cy2);
          }
        }
      }
      pdfCtx.stroke();

      // Border continuous
      pdfCtx.strokeStyle = "rgba(0,0,0,0.4)";
      pdfCtx.lineWidth = 1.0;
      pdfCtx.strokeRect(rsX, rsY, rsW, rhythmH);

      pdfCtx.fillStyle = "#000";
      pdfCtx.font = "bold 13px monospace";
      pdfCtx.fillText("II — Rhythm Strip Continuous", rsX + 5, rsY + 15);

    } else {
      // Single view portrait
      const sw = Math.round(210 * mm2px);
      const sh = Math.round(297 * mm2px);
      pdfCanvas.width = sw;
      pdfCanvas.height = sh;
      pdfCanvas.style.maxHeight = "56vh";

      pdfCtx.fillStyle = "#FFFFFF";
      pdfCtx.fillRect(0, 0, sw, sh);

      pdfCtx.fillStyle = "#111";
      pdfCtx.font = "bold 24px monospace";
      pdfCtx.fillText(`ECG INDIVIDUAL LEAD TRACING — Lead ${currentLead}`, 10 * mm2px, 15 * mm2px);

      pdfCtx.font = "14px monospace";
      pdfCtx.fillStyle = "#444";
      pdfCtx.fillText(
        `Rhythm: ${rhythmName}   HR: ${bpm} bpm   Speed: ${speed}mm/s   Gain: 10mm/mV`,
        10 * mm2px,
        22 * mm2px
      );

      // Draw 3 sequential strips of same lead
      const marginL = 10 * mm2px;
      const contentW = sw - marginL - marginL;
      const stripTop = 30 * mm2px;
      const stripH = 45 * mm2px;
      const stripGap = 5 * mm2px;

      for (let s = 0; s < 3; s++) {
        const sy = stripTop + s * (stripH + stripGap);

        pdfCtx.fillStyle = "#FFF5F5";
        pdfCtx.fillRect(marginL, sy, contentW, stripH);

        // draw grid
        pdfCtx.save();
        pdfCtx.beginPath();
        pdfCtx.rect(marginL, sy, contentW, stripH);
        pdfCtx.clip();

        const minorStep = mm2px;
        const majorStep = mm2px * 5;

        pdfCtx.strokeStyle = "rgba(230, 50, 50, 0.20)";
        pdfCtx.lineWidth = 0.6;
        pdfCtx.beginPath();
        for (let gx = marginL; gx <= marginL + contentW; gx += minorStep) {
          pdfCtx.moveTo(gx, sy); pdfCtx.lineTo(gx, sy + stripH);
        }
        for (let gy = sy; gy <= sy + stripH; gy += minorStep) {
          pdfCtx.moveTo(marginL, gy); pdfCtx.lineTo(marginL + contentW, gy);
        }
        pdfCtx.stroke();

        pdfCtx.strokeStyle = "rgba(230, 50, 50, 0.50)";
        pdfCtx.lineWidth = 1.1;
        pdfCtx.beginPath();
        for (let gx = marginL; gx <= marginL + contentW; gx += majorStep) {
          pdfCtx.moveTo(gx, sy); pdfCtx.lineTo(gx, sy + stripH);
        }
        for (let gy = sy; gy <= sy + stripH; gy += majorStep) {
          pdfCtx.moveTo(marginL, gy); pdfCtx.lineTo(marginL + contentW, gy);
        }
        pdfCtx.stroke();
        pdfCtx.restore();

        // Waveform sequential offset
        const pps = speed * mm2px;
        const yScale = 10 * mm2px;
        const bps = heartRate > 0 ? heartRate / 60 : 1;
        const cycleDur = 1 / bps;
        const cellCenterY = sy + stripH / 2;

        const durationPerStripSec = contentW / pps;
        const phaseOffset = (s * durationPerStripSec * bps) % 1;

        pdfCtx.strokeStyle = "#000";
        pdfCtx.lineWidth = Math.max(1.5, mm2px * 0.19);
        pdfCtx.beginPath();

        let first = true;
        const currentLeadSignalArray = mode === "database" ? getRecordSignalForLead(recordSignals, currentLead) : null;
        if (mode === "database" && recordSignals && currentLeadSignalArray) {
          const signalArray = currentLeadSignalArray;
          const startSample = Math.floor((s / 3) * signalArray.length);
          const endSample = Math.min(signalArray.length - 1, Math.ceil(((s + 1) / 3) * signalArray.length));
          
          for (let i = startSample; i <= endSample; i++) {
            const fractionInStrip = (i - startSample) / (endSample - startSample);
            const px = fractionInStrip * contentW;
            const val = signalArray[i] * amplitude;
            const cx2 = marginL + px;
            const cy2 = cellCenterY - val * yScale;
            
            if (first) {
              pdfCtx.moveTo(cx2, cy2);
              first = false;
            } else {
              pdfCtx.lineTo(cx2, cy2);
            }
          }
        } else {
          for (let px = 0; px <= contentW; px += 0.5) {
            const t = px / pps;
            const phaseSec = t * bps + phaseOffset;
            const beatI = Math.floor(phaseSec);
            const phase = ((phaseSec % 1) + 1) % 1;

            let val = getWaveformForBeatIndex(
              phase,
              currentLead,
              beatI,
              currentRhythm,
              effectIntensity,
              heartRate,
              amplitude,
              noise,
              realistic,
              manualMode,
              waveParams
            );

            const cx2 = marginL + px;
            const cy2 = cellCenterY - val * yScale;
            if (first) {
              pdfCtx.moveTo(cx2, cy2);
              first = false;
            } else {
              pdfCtx.lineTo(cx2, cy2);
            }
          }
        }
        pdfCtx.stroke();

        // Border
        pdfCtx.strokeStyle = "rgba(0,0,0,0.4)";
        pdfCtx.lineWidth = 1.0;
        pdfCtx.strokeRect(marginL, sy, contentW, stripH);

        pdfCtx.fillStyle = "#000";
        pdfCtx.font = "bold 13px monospace";
        pdfCtx.fillText(`Strip Section ${s + 1}/3`, marginL + 5, sy + 15);
      }
    }
  };

  const loadJsPdf = () => {
    return new Promise<void>((resolve, reject) => {
      if ((window as any).jspdf) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  const downloadPdf = async () => {
    try {
      showToastMsg("Generating print report...");
      await loadJsPdf();
      const { jsPDF } = (window as any).jspdf;
      const isLandscape = viewMode === "12lead";

      const pdf = new jsPDF({
        orientation: isLandscape ? "landscape" : "portrait",
        unit: "mm",
        format: "a4"
      });

      const pdfCanvas = pdfCanvasRef.current;
      if (!pdfCanvas) return;
      const imgData = pdfCanvas.toDataURL("image/jpeg", 0.96);

      if (isLandscape) {
        pdf.addImage(imgData, "JPEG", 0, 0, 297, 210);
      } else {
        pdf.addImage(imgData, "JPEG", 0, 0, 210, 297);
      }

      pdf.save(`ecg-report-${viewMode === "12lead" ? "12lead" : currentLead}-${getImpureTimestamp()}.pdf`);
      showToastMsg("PDF downloaded successfully");
      closePdfExport();
    } catch (e) {
      console.error(e);
      showToastMsg("Export failed. Please check browser permissions.");
    }
  };

  // ── Mouse wheel scroll zoom listener ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      adjustZoom(dir);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard keys bindings matches standard monitor consoles ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key.toLowerCase()) {
        case " ":
          e.preventDefault();
          setPaused((prev) => !prev);
          break;
        case "s":
          takeSnapshot();
          break;
        case "p":
          openPdfExport();
          break;
        case "r":
          resetSettings();
          break;
        case "o":
          toggleStripModeState();
          break;
        case "l":
          setViewModeState(viewMode === "single" ? "12lead" : "single");
          break;
        case "escape":
          closePdfExport();
          break;
        case "+":
        case "=":
          adjustZoom(1);
          break;
        case "-":
        case "_":
          adjustZoom(-1);
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, zoom, currentLead, currentRhythm, stripMode, paused]);

  const activeIntensityConfig = getIntensityConfig(currentRhythm);
  const activeIntensityPct = Math.round(effectIntensity * 100);
  const activeIntensityStage = activeIntensityConfig.stages.find(
    (stage) => activeIntensityPct >= stage.range[0] && activeIntensityPct <= stage.range[1]
  ) || activeIntensityConfig.stages[activeIntensityConfig.stages.length - 1];
  const rhythmValidation = useMemo(
    () => validateRhythmProfile(currentRhythm, effectIntensity),
    [currentRhythm, effectIntensity]
  );
  const leadValidation = useMemo(
    () => validateRhythmAllLeads(currentRhythm, effectIntensity),
    [currentRhythm, effectIntensity]
  );
  const hasLeadRules = leadValidation.checkedLeads > 0;

  return (
    <div className="ecg-body-wrap" suppressHydrationWarning>
      {/* FontAwesome integration */}
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA=="
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
      />

      {/* TOPBAR NAVIGATION BAR */}
      <div className="topbar">
        <div className="topbar-title">
          <span className="ecg-icon">
            <i className="fa-solid fa-heart-pulse"></i>
          </span>
          PTB-XL clinical ECG Explorer
        </div>

        <div className="topbar-actions">
          {/* Main Mode segment switcher */}
          <div className="view-toggle" style={{ marginRight: "0.25rem" }}>
            <button
              className={`view-toggle-btn ${mode === "database" ? "active" : ""}`}
              onClick={() => {
                setMode("database");
                setActiveTab("db-explorer");
                showToastMsg("Clinical database Explorer activated");
              }}
              title="Explore raw sqlite clinical dataset signals"
            >
              Clinical DB
            </button>
            <button
              className={`view-toggle-btn ${mode === "simulation" ? "active" : ""}`}
              onClick={() => {
                setMode("simulation");
                setActiveTab("rhythms");
                showToastMsg("Continuous Math Simulator activated");
              }}
              title="Generate synthetic cardiac waveforms"
            >
              Simulator
            </button>
          </div>

          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === "single" ? "active" : ""}`}
              onClick={() => setViewModeState("single")}
            >
              Single
            </button>
            <button
              className={`view-toggle-btn ${viewMode === "12lead" ? "active" : ""}`}
              onClick={() => setViewModeState("12lead")}
            >
              12-Lead
            </button>
          </div>

          <button className="topbar-btn" onClick={() => adjustZoom(-1)} title="Zoom Out">
            <i className="fa-solid fa-magnifying-glass-minus"></i>
          </button>
          <button className="topbar-btn" onClick={() => adjustZoom(1)} title="Zoom In">
            <i className="fa-solid fa-magnifying-glass-plus"></i>
          </button>
          <button
            className={`topbar-btn ${paused ? "active-toggle" : ""}`}
            onClick={() => setPaused(!paused)}
            title={paused ? "Resume tracing" : "Pause tracing"}
          >
            {paused ? <i className="fa-solid fa-play"></i> : <i className="fa-solid fa-pause"></i>}
          </button>
          <button className="topbar-btn" onClick={takeSnapshot} title="Capture PNG snap">
            <i className="fa-solid fa-camera"></i>
          </button>
          <button className="topbar-btn" onClick={openPdfExport} title="Generate PDF Document">
            <i className="fa-solid fa-file-pdf"></i>
          </button>
          <button
            className={`topbar-btn ${stripMode ? "active-toggle" : ""}`}
            onClick={toggleStripModeState}
            title="Grid paper theme Toggle"
          >
            <i className="fa-solid fa-grip-lines"></i>
          </button>
          <button className="topbar-btn" onClick={toggleTheme} title="Toggle Day/Night mode Theme">
            <i className="fa-solid fa-sun"></i>
          </button>
        </div>
      </div>

      {/* CORE CONTAINER ASPECT */}
      <div className="app-layout">
        {/* VIEW SCREEN VISUAL CANVAS ZONE */}
        <div className="ecg-display" id="ecg-display" ref={containerRef}>
          <canvas id="ecg-canvas" ref={canvasRef}></canvas>

          {viewMode === "single" && (
            <div className="lead-label" id="lead-label">
              {currentLead}
            </div>
          )}

          <div className="lead-info" id="lead-info">
            {speed}mm/s &middot; 10mm/mV {zoom !== 1.0 && ` &middot; ${zoom.toFixed(2)}x`}
          </div>

          {viewMode === "12lead" && (
            <div className="view-indicator">
              12-LEAD &middot; 4×3 + Rhythm Strip &middot; {speed}mm/s &middot; 10mm/mV
            </div>
          )}

          {zoom !== 1.0 && (
            <div className="zoom-badge">
              Zoom {zoom.toFixed(2)}x
            </div>
          )}

          <div className="hr-display">
            <span
              className="hr-icon"
              style={{
                animationDuration: heartRate > 0 ? `${60 / heartRate}s` : "2s"
              }}
            >
              <i className="fa-solid fa-heart"></i>
            </span>
            <span className="hr-value">{heartRate > 0 ? Math.round(heartRate) : "---"}</span>
            <span className="hr-unit">bpm</span>
          </div>

          <div
            className={`rhythm-badge ${
              mode === "database"
                ? (selectedRecord?.superclass === "NORM" ? "normal" : "abnormal")
                : (manualMode ? "abnormal" : RHYTHMS.find((r) => r.id === currentRhythm)?.tagClass || "")
            }`}
          >
            {mode === "database"
              ? (selectedRecord ? `Patient ID #${selectedRecord.patient_id} · ${selectedRecord.superclass} (${SCP_DESCRIPTIONS[selectedRecord.superclass] || 'Diagnostic Abnormality'})` : "No Record Loaded")
              : (manualMode ? "Custom Wave Synthesizer" : RHYTHMS.find((r) => r.id === currentRhythm)?.name || currentRhythm.toUpperCase())
            }
          </div>
        </div>

        {/* DRAGGABLE BAR DIVIDER */}
        <div className="sidebar-resizer" id="sidebar-resizer" onMouseDown={startDragging} onTouchStart={startDragging}></div>

        {/* SIDE BAR CONTROLS PANEL */}
        <div className="control-panel" style={{ width: `${sidebarWidth}px` }}>
          <div className="tab-nav">
            {mode === "database" ? (
              <>
                <button
                  className={`tab-btn ${activeTab === "db-explorer" ? "active" : ""}`}
                  onClick={() => setActiveTab("db-explorer")}
                >
                  Records DB
                </button>
                {viewMode === "single" && (
                <button
                  className={`tab-btn ${activeTab === "db-leads" ? "active" : ""}`}
                  onClick={() => setActiveTab("db-leads")}
                >
                  Leads
                </button>
                )}
                <button
                  className={`tab-btn ${activeTab === "db-diagnostic" ? "active" : ""}`}
                  onClick={() => setActiveTab("db-diagnostic")}
                >
                  Diagnostics
                </button>
                {isDevEnvironment && (
                  <button
                    className={`tab-btn ${activeTab === "db-setup" ? "active" : ""}`}
                    onClick={() => setActiveTab("db-setup")}
                  >
                    DB Setup
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  className={`tab-btn ${activeTab === "rhythms" ? "active" : ""}`}
                  onClick={() => setActiveTab("rhythms")}
                >
                  Rhythms
                </button>
                {viewMode === "single" && (
                <button
                  className={`tab-btn ${activeTab === "leads" ? "active" : ""}`}
                  onClick={() => setActiveTab("leads")}
                >
                  Leads
                </button>
                )}
                <button
                  className={`tab-btn ${activeTab === "customwave" ? "active" : ""}`}
                  onClick={() => setActiveTab("customwave")}
                >
                  Wave Builder
                </button>
                <button
                  className={`tab-btn ${activeTab === "actions" ? "active" : ""}`}
                  onClick={() => setActiveTab("actions")}
                >
                  Actions
                </button>
              </>
            )}
          </div>

          <div className="tab-container-scroller">
            {/* CLINICAL DB RECORDS EXPLORER */}
            {mode === "database" && (
              <>
                {/* RECORDS EXPLORER TAB */}
                <div className={`tab-content ${activeTab === "db-explorer" ? "active" : ""}`} id="tab-db-explorer">
                  <div className="wave-customizer">

                    <div className="toggle-row">
                      <div>
                        <div className="tr-label">DB Visual Smoothing</div>
                        <div className="tr-desc">
                          {dbVisualSmoothing ? "Cubic display interpolation is on" : "Raw linear interpolation is shown"}
                          {recordSignals ? ` · Loop: ${dbLoopWindow.source === "rpeak" ? "beat-aligned" : "full record"}` : ""}
                        </div>
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={dbVisualSmoothing}
                          onChange={(e) => setDbVisualSmoothing(e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>

                    {/* Search box controls */}
                    <div className="db-search-container">
                      <input
                        type="text"
                        className="db-search-input"
                        placeholder="Search by ID, diagnosis (Inferior MI), code (LBBB)..."
                        value={searchQuery}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSearchQuery(val);
                          setDbOffset(0);
                          // Debounced auto-search after 400ms of inactivity
                          if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                          searchDebounceRef.current = setTimeout(() => {
                            fetchRecords(val, superclassFilter, 0);
                          }, 400);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setDbOffset(0);
                            fetchRecords(searchQuery, superclassFilter, 0);
                          }
                        }}
                      />
                      <button
                        className="db-search-btn"
                        onClick={() => {
                          setDbOffset(0);
                          fetchRecords(searchQuery, superclassFilter, 0);
                        }}
                      >
                        <i className="fa-solid fa-magnifying-glass"></i>
                      </button>
                    </div>

                    {/* Superclass Filter Chips */}
                    <div className="db-filter-chips">
                      {[
                        { key: "ALL", label: "All", chipClass: "" },
                        { key: "NORM", label: "NORM", chipClass: "chip-norm" },
                        { key: "MI",   label: "MI",   chipClass: "chip-mi" },
                        { key: "CD",   label: "CD",   chipClass: "chip-cd" },
                        { key: "HYP",  label: "HYP",  chipClass: "chip-hyp" },
                        { key: "STTC", label: "STTC", chipClass: "chip-sttc" },
                      ].map(({ key, label, chipClass }) => (
                        <button
                          key={key}
                          className={`db-filter-chip ${chipClass} ${superclassFilter === key ? "active" : ""}`}
                          onClick={() => {
                            setSuperclassFilter(key);
                            setDbOffset(0);
                            fetchRecords(searchQuery, key, 0);
                          }}
                        >
                          {label}
                          {key !== "ALL" && dbClassCounts[key] != null && (
                            <span style={{ marginLeft: "0.3rem", opacity: 0.7, fontWeight: 400 }}>
                              {dbClassCounts[key]}
                            </span>
                          )}
                          {key === "ALL" && (
                            <span style={{ marginLeft: "0.3rem", opacity: 0.7, fontWeight: 400 }}>
                              {Object.values(dbClassCounts).reduce((a, b) => a + b, 0) || ""}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Loading indicator */}
                    {recordsLoading && (
                      <div className="py-8 flex flex-col items-center justify-center gap-2">
                        <div className="animate-spin text-accent text-lg"><i className="fa-solid fa-spinner"></i></div>
                        <span className="text-xs text-muted">Retrieving matching records...</span>
                      </div>
                    )}

                    {/* Records List - continuous scroll */}
                    <div className="flex flex-col gap-1.5 min-h-0 pr-1 overflow-y-auto flex-1" style={{ height: "100%", maxHeight: "calc(100vh - 260px)" }}
                      onScroll={(e) => {
                        const el = e.currentTarget;
                        if (el.scrollHeight - el.scrollTop - el.clientHeight < 100 && !fetchLock.current && dbRecords.length >= dbLimit) {
                          fetchLock.current = true;
                          setDbOffset(prev => prev + dbLimit);
                        }
                      }}
                    >
                      {recordsLoading && dbRecords.length === 0 && (
                        <div className="py-8 flex flex-col items-center justify-center gap-2">
                          <div className="animate-spin text-accent text-lg"><i className="fa-solid fa-spinner"></i></div>
                          <span className="text-xs text-muted">Retrieving matching records...</span>
                        </div>
                      )}
                      {!recordsLoading && dbRecords.length === 0 ? (
                        <div className="db-empty-state">
                          No matching records found. Try searching &quot;Inferior MI&quot;, &quot;LBBB&quot;, or use the category chips above.
                        </div>
                      ) : (
                        dbRecords.map((record) => {
                          const isSelected = selectedRecord?.ecg_id === record.ecg_id;
                          const isNorm = record.superclass === "NORM";
                          const sc = (record.superclass || "").toLowerCase();
                          const scClass = isNorm ? "norm" : sc === "mi" ? "mi" : sc === "cd" ? "cd" : sc === "hyp" ? "hyp" : "sttc";
                          return (
                            <div
                              key={record.ecg_id}
                              className={`db-record-card ${scClass} ${isSelected ? "selected" : ""}`}
                              onClick={() => selectRecordItem(record)}
                            >
                              <div className="flex items-start justify-between w-full mb-1">
                                <div className="flex items-center gap-2">
                                  <div style={{ width: "20px", textAlign: "center" }}>
                                    <i className={`fa-solid ${isNorm ? "fa-heart-circle-check" : "fa-heart-circle-exclamation"}`} style={{ color: isNorm ? "var(--correct)" : "var(--wrong)", fontSize: "13px" }}></i>
                                  </div>
                                  <div>
                                    <div className="db-record-id">Record #{record.ecg_id}</div>
                                    <div className="db-record-patient">Patient #{record.patient_id}</div>
                                  </div>
                                </div>
                                <span className={`db-record-superclass ${scClass}`}>
                                  {record.superclass}
                                </span>
                              </div>
                              <div className="db-record-detail">
                                <span><i className="fa-regular fa-calendar"></i>{record.age || "N/A"}y</span>
                                <span><i className="fa-regular fa-user"></i>{record.sex === 0 ? "Male" : "Female"}</span>
                                <span><i className="fa-solid fa-ruler"></i>{record.height ? `${record.height}cm` : "N/A"}</span>
                                <span><i className="fa-solid fa-weight-scale"></i>{record.weight ? `${record.weight}kg` : "N/A"}</span>
                              </div>
                              {record.scp_codes && (
                                <div className="db-record-scp">
                                  SCP: {Object.keys(parseScpCodes(record.scp_codes)).slice(0, 3).join(", ")}{Object.keys(parseScpCodes(record.scp_codes)).length > 3 ? "..." : ""}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                      {recordsLoading && dbRecords.length > 0 && (
                        <div className="py-3 text-center text-xs text-muted">
                          <i className="fa-solid fa-spinner animate-spin mr-1"></i> Loading more...
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* LEADS SELECTION TAB (same as simulator leads tab) */}
                <div className={`tab-content ${activeTab === "db-leads" ? "active" : ""}`} id="tab-db-leads">
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.6rem" }}>
                    Select the displayed single lead for the active trace. In 12-lead mode, all leads are shown simultaneously.
                  </div>
                  <div className="lead-tabs">
                    {LEADS.map((l) => {
                      let tabClass = "lead-tab";
                      if (l === currentLead) tabClass += " active";
                      return (
                        <button
                          key={l}
                          className={tabClass}
                          onClick={() => selectLead(l)}
                          title={"Switch to lead " + l}
                        >
                          {l}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* DIAGNOSTICS DETAILED SUMMARY TAB */}
                <div className={`tab-content ${activeTab === "db-diagnostic" ? "active" : ""} animate-fade-in`} id="tab-db-diagnostic">
                  {!selectedRecord ? (
                    <div className="py-8 text-center text-xs text-muted">
                      Select an ECG clinical record from the database to view diagnostics.
                    </div>
                  ) : (
                    <div className="wave-customizer">
                      {/* Findings Banner */}
                      <div className="diag-banner" style={{ borderLeft: `4px solid ${
                        selectedRecord.superclass === "NORM" ? "var(--correct)"
                        : selectedRecord.superclass === "MI" ? "var(--wrong)"
                        : selectedRecord.superclass === "CD" ? "var(--rhythm-metabolic)"
                        : selectedRecord.superclass === "HYP" ? "var(--rhythm-block)"
                        : "var(--rhythm-ischemia)"
                      }` }}>
                        <div className="diag-banner-row">
                          <div>
                            <div className="diag-banner-title">Record #{selectedRecord.ecg_id}</div>
                            <div className="diag-banner-sub">Patient #{selectedRecord.patient_id}</div>
                          </div>
                          <span className={`diag-banner-tag ${selectedRecord.superclass === "NORM" ? "norm" : selectedRecord.superclass === "MI" ? "mi" : selectedRecord.superclass === "CD" ? "cd" : selectedRecord.superclass === "HYP" ? "hyp" : "sttc"}`}>
                            {selectedRecord.superclass}
                          </span>
                        </div>
                      </div>

                      {/* Sub-tab Navigation Buttons */}
                      <div className="diag-subnav">
                        <button className={`diag-subnav-btn ${diagSubTab === "overview" ? "active" : ""}`} onClick={() => setDiagSubTab("overview")}>
                          <i className="fa-solid fa-clipboard-list"></i> Overview
                        </button>
                        <button className={`diag-subnav-btn ${diagSubTab === "peaks" ? "active" : ""}`} onClick={() => setDiagSubTab("peaks")}>
                          <i className="fa-solid fa-heart-pulse"></i> Peaks
                        </button>
                        <button className={`diag-subnav-btn ${diagSubTab === "length" ? "active" : ""}`} onClick={() => setDiagSubTab("length")}>
                          <i className="fa-solid fa-ruler"></i> Info
                        </button>
                      </div>

                      {/* SUBTAB 1: CLINICAL OVERVIEW */}
                      {diagSubTab === "overview" && (() => {
                        const parsedCodes = parseScpCodes(selectedRecord.scp_codes);
                        const overallSeverity = getOverallSeverity(parsedCodes);
                        const verdictSummary = getVerdictSummary(selectedRecord.superclass, overallSeverity, parsedCodes);
                        const verdictMeta = SEVERITY_META[overallSeverity];
                        const axisInfo = getHeartAxisInterpretation(selectedRecord.heart_axis);

                        // Sort findings: critical → severe → moderate → mild → normal, then by probability desc
                        const sortedFindings = Object.entries(parsedCodes).sort(([codeA, probA], [codeB, probB]) => {
                          const sevA = SCP_INFO[codeA]?.severity || "normal";
                          const sevB = SCP_INFO[codeB]?.severity || "normal";
                          const sevDiff = (SEVERITY_ORDER[sevA] ?? 4) - (SEVERITY_ORDER[sevB] ?? 4);
                          if (sevDiff !== 0) return sevDiff;
                          return (probB as number) - (probA as number);
                        });

                        return (
                          <div className="flex flex-col gap-3 animate-fade-in">

                            {/* ── 1. Overall Assessment Verdict ── */}
                            <div className={`diag-verdict sev-${overallSeverity}`}>
                              <div className="diag-verdict-icon">
                                <i className={verdictMeta.icon}></i>
                              </div>
                              <div className="diag-verdict-body">
                                <div className="diag-verdict-title">
                                  {verdictMeta.label} — {SUPERCLASS_INFO[selectedRecord.superclass]?.label || selectedRecord.superclass}
                                </div>
                                <div className="diag-verdict-summary">{verdictSummary}</div>
                              </div>
                            </div>

                            {/* ── 2. Key Findings (SCP Code Cards) ── */}
                            {sortedFindings.length > 0 && (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.1rem" }}>
                                  <i className="fa-solid fa-magnifying-glass-chart" style={{ marginRight: "0.35rem" }}></i>
                                  Findings · {sortedFindings.length} diagnostic code{sortedFindings.length !== 1 ? "s" : ""}
                                </div>

                                {sortedFindings.map(([code, value]) => {
                                  const prob = typeof value === "number" ? Math.round(value) : 100;
                                  const info = SCP_INFO[code];
                                  const sev = info?.severity || "normal";
                                  const isExpanded = expandedScpTip === code;

                                  if (!info) {
                                    // Fallback for unknown codes
                                    return (
                                      <div key={code} className="diag-finding-card sev-mild">
                                        <div className="diag-finding-main">
                                          <div className="diag-finding-top">
                                            <div className="diag-finding-left">
                                              <div className="diag-finding-code-row">
                                                <span className="diag-finding-code">{code}</span>
                                              </div>
                                              <div className="diag-finding-name">{code} — Clinical Code</div>
                                              <div className="diag-finding-simple">SCP diagnostic code recorded in this ECG. No additional description available.</div>
                                            </div>
                                            <div className="diag-finding-prob-col">
                                              <span className="diag-finding-prob-num">{prob}%</span>
                                              <span className="diag-finding-prob-label">confidence</span>
                                            </div>
                                          </div>
                                          <div className="diag-finding-bar-wrap">
                                            <div className="diag-finding-bar-fill" style={{ width: `${prob}%` }}></div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div key={code} className={`diag-finding-card sev-${sev}`}>
                                      <div className="diag-finding-main">
                                        <div className="diag-finding-top">
                                          <div className="diag-finding-left">
                                            <div className="diag-finding-code-row">
                                              <span className="diag-finding-code">{code}</span>
                                              <span className={`diag-severity-pill sev-${sev}`}>
                                                <i className={SEVERITY_META[sev]?.icon} style={{ marginRight: "0.25rem", fontSize: "0.5rem" }}></i>
                                                {SEVERITY_META[sev]?.label}
                                              </span>
                                            </div>
                                            <div className="diag-finding-name">
                                              <i className={`${info.icon}`} style={{ marginRight: "0.4rem", fontSize: "0.75rem", opacity: 0.8 }}></i>
                                              {info.name}
                                            </div>
                                            <div className="diag-finding-simple">{info.simple}</div>
                                          </div>
                                          <div className="diag-finding-prob-col">
                                            <span className="diag-finding-prob-num">{prob}%</span>
                                            <span className="diag-finding-prob-label">confidence</span>
                                          </div>
                                        </div>
                                        <div className="diag-finding-bar-wrap">
                                          <div className="diag-finding-bar-fill" style={{ width: `${prob}%` }}></div>
                                        </div>
                                      </div>

                                      {/* Teaching tip toggle */}
                                      <button
                                        className={`diag-finding-tip-toggle ${isExpanded ? "open" : ""}`}
                                        onClick={() => setExpandedScpTip(isExpanded ? null : code)}
                                      >
                                        <span><i className="fa-solid fa-graduation-cap" style={{ marginRight: "0.35rem" }}></i>What to look for on the ECG</span>
                                        <i className="fa-solid fa-chevron-down"></i>
                                      </button>

                                      {isExpanded && (
                                        <div className="diag-finding-tip-body">
                                          {info.tip}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* ── 3. Heart Axis ── */}
                            <div className="diag-axis-card">
                              <div className="diag-axis-icon"><i className="fa-solid fa-compass"></i></div>
                              <div className="diag-axis-content">
                                <div className="diag-axis-label" style={{ color: axisInfo.color }}>
                                  <i className="fa-solid fa-arrows-to-dot" style={{ marginRight: "0.4rem", fontSize: "0.7rem" }}></i>
                                  Heart Axis: {axisInfo.label}
                                </div>
                                <div className="diag-axis-desc">{axisInfo.desc}</div>
                              </div>
                              {selectedRecord.pacemaker === 1 && (
                                <div className="diag-pacemaker-badge">
                                  <i className="fa-solid fa-bolt"></i> Pacemaker
                                </div>
                              )}
                            </div>

                            {/* ── 4. Clinical Report with Translation ── */}
                            {selectedRecord.report && (
                              <div className="diag-report-section">
                                <div className="diag-report-header">
                                  <div className="diag-report-header-title">
                                    <i className="fa-solid fa-file-medical"></i>
                                    Original Clinical Notes
                                  </div>
                                  {translationState.status === "translated" && (
                                    <span className="diag-lang-badge">{translationState.source.toUpperCase()} → EN</span>
                                  )}
                                </div>
                                <div className="diag-report-original">
                                  {selectedRecord.report}
                                </div>

                                {translationState.status === "loading" ? (
                                  <div className="diag-translation-body">
                                    <div className="diag-translation-item">
                                      <div className="diag-translation-dot"></div>
                                      <div className="diag-translation-text">
                                        <i className="fa-solid fa-spinner animate-spin" style={{ marginRight: "0.35rem" }}></i>
                                        Translating clinical notes to English...
                                      </div>
                                    </div>
                                  </div>
                                ) : translationState.status === "translated" ? (
                                  <>
                                    <div className="diag-translation-label">
                                      <i className="fa-solid fa-language"></i>
                                      English Translation · {translationState.provider}
                                    </div>
                                    <div className="diag-translation-body">
                                      <div className="diag-translation-item">
                                        <div className="diag-translation-dot"></div>
                                        <div className="diag-translation-text">
                                          {translationState.translatedText}
                                        </div>
                                      </div>
                                    </div>
                                  </>
                                ) : translationState.status === "error" ? (
                                  <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.65rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: "0.35rem" }}></i>
                                    Translation unavailable, showing original notes.
                                  </div>
                                ) : (
                                  <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.65rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                                    <i className="fa-solid fa-circle-info" style={{ marginRight: "0.35rem" }}></i>
                                    Report is already in English — no translation needed.
                                  </div>
                                )}
                              </div>
                            )}

                            {/* ── 5. Infarction Stadium ── */}
                            {(selectedRecord.infarction_stadium1 || selectedRecord.infarction_stadium2) && (
                              <div className="diag-infarct-timeline">
                                <div className="diag-infarct-header">
                                  <i className="fa-solid fa-layer-group"></i>
                                  Myocardial Infarction Timeline
                                </div>
                                {selectedRecord.infarction_stadium1 && (
                                  <div className="diag-infarct-stage">
                                    <div className="diag-infarct-stage-title">Primary Stage</div>
                                    <div className="diag-infarct-stage-raw">{selectedRecord.infarction_stadium1}</div>
                                    <div className="diag-infarct-stage-desc">
                                      {getInfarctionStadiumLabel(selectedRecord.infarction_stadium1)}
                                    </div>
                                  </div>
                                )}
                                {selectedRecord.infarction_stadium2 && (
                                  <div className="diag-infarct-stage">
                                    <div className="diag-infarct-stage-title">Secondary Stage</div>
                                    <div className="diag-infarct-stage-raw" style={{ color: "var(--accent)" }}>
                                      {selectedRecord.infarction_stadium2}
                                    </div>
                                    <div className="diag-infarct-stage-desc">
                                      {getInfarctionStadiumLabel(selectedRecord.infarction_stadium2)}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                          </div>
                        );
                      })()}

                      {/* SUBTAB 2: PEAK DETECTION & ANALYSIS */}
                      {diagSubTab === "peaks" && (
                        <div className="flex flex-col gap-3 animate-fade-in">
                          {signalsLoading ? (
                            <div className="db-loading-spinner">
                              <i className="fa-solid fa-spinner"></i>
                              <span>Analyzing waveform peaks...</span>
                            </div>
                          ) : !peaksAnalysis ? (
                            <div className="db-empty-state">
                              Could not load trace waveforms to perform peak detection.
                            </div>
                          ) : (
                            <>
                              {/* R-Peak Stats Grid */}
                              <div className="diag-peaks-grid">
                                <div className="diag-peak-stat">
                                  <div className="diag-peak-stat-label">Heart Rate</div>
                                  <div className="diag-peak-stat-value hr">{peaksAnalysis.calculatedBPM}<span className="diag-peak-stat-unit">bpm</span></div>
                                </div>
                                <div className="diag-peak-stat">
                                  <div className="diag-peak-stat-label">R-Peaks</div>
                                  <div className="diag-peak-stat-value">{peaksAnalysis.peaksCount}<span className="diag-peak-stat-unit">beats</span></div>
                                </div>
                                <div className="diag-peak-stat">
                                  <div className="diag-peak-stat-label" title="Standard Deviation of NN Intervals">SDNN</div>
                                  <div className="diag-peak-stat-value hrv">{peaksAnalysis.sdnn}<span className="diag-peak-stat-unit">ms</span></div>
                                </div>
                                <div className="diag-peak-stat">
                                  <div className="diag-peak-stat-label" title="Root Mean Square of Successive Differences">RMSSD</div>
                                  <div className="diag-peak-stat-value hrv">{peaksAnalysis.rmssd}<span className="diag-peak-stat-unit">ms</span></div>
                                </div>
                              </div>

                              {/* HRV Clinical Interpretation */}
                              <div className="diag-hrv-interp">
                                <div className="diag-hrv-interp-title">Clinical Interpretation</div>
                                {peaksAnalysis.sdnn < 30 ? (
                                  <span><i className="fa-solid fa-circle-exclamation" style={{color:"var(--rhythm-metabolic)"}}></i> HRV depressed ({peaksAnalysis.sdnn}ms), indicating possible autonomic distress.</span>
                                ) : (
                                  <span><i className="fa-solid fa-circle-check" style={{color:"var(--rhythm-normal)"}}></i> Normal autonomic modulation ({peaksAnalysis.sdnn}ms SDNN).</span>
                                )}
                              </div>

                              {/* R-Peaks Timings List */}
                              <div className="diag-rpeak-table">
                                <div className="diag-rpeak-table-header">
                                  <span><i className="fa-solid fa-list-ol"></i> R-Peaks (Lead {currentLead})</span>
                                </div>
                                <div className="diag-rpeak-table-scroll">
                                  <table>
                                    <thead>
                                      <tr><th>Beat</th><th>Time</th><th style={{textAlign:"right"}}>Amp (mV)</th></tr>
                                    </thead>
                                    <tbody>
                                      {peaksAnalysis.peaksInfo.map((p: any, idx: number) => (
                                        <tr key={idx}>
                                          <td>#{idx + 1}</td>
                                          <td>{p.time.toFixed(3)}s</td>
                                          <td className="text-right" style={p.value > 0.6 ? {color:"var(--rhythm-normal)",fontWeight:700} : {}}>{p.value.toFixed(3)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* SUBTAB 3: RECORD METADATA & PHYSICAL INFO */}
                      {diagSubTab === "length" && (
                        <div className="flex flex-col gap-3 animate-fade-in">
                          {/* Physical Demographics & BMI */}
                          <div className="diag-meta-section">
                            <div className="diag-meta-section-header">
                              <i className="fa-solid fa-user-doctor"></i> Physical Demographics
                            </div>
                            <div className="diag-meta-grid">
                              <div className="diag-meta-field">
                                <span className="diag-meta-field-label">Age / Sex</span>
                                <span className="diag-meta-field-value">{selectedRecord.age || "?"} yr · {selectedRecord.sex === 0 ? "Male" : "Female"}</span>
                              </div>
                              <div className="diag-meta-field">
                                <span className="diag-meta-field-label">Physical Frame</span>
                                <span className="diag-meta-field-value">{selectedRecord.height ? `${selectedRecord.height}cm` : "N/A"} · {selectedRecord.weight ? `${selectedRecord.weight}kg` : "N/A"}</span>
                              </div>
                            </div>
                            
                            {/* BMI */}
                            {selectedRecord.height && selectedRecord.weight ? (() => {
                              const bmiVal = Number((selectedRecord.weight / ((selectedRecord.height/100) ** 2)).toFixed(1));
                              let cat = "Normal", color = "var(--correct)";
                              if (bmiVal < 18.5) { cat = "Underweight"; color = "var(--accent)"; }
                              else if (bmiVal >= 25 && bmiVal < 30) { cat = "Overweight"; color = "var(--accent)"; }
                              else if (bmiVal >= 30) { cat = "Obese"; color = "var(--wrong)"; }
                              return (
                                <div className="diag-bmi-row">
                                  <div className="diag-bmi-info">
                                    <span className="diag-bmi-label">BMI</span>
                                    <span className="diag-bmi-value">{bmiVal} <span>kg/m²</span></span>
                                  </div>
                                  <span className="diag-bmi-category" style={{color, border:`1px solid ${color}40`, background:`${color}15`}}>{cat}</span>
                                </div>
                              );
                            })() : (
                              <div style={{paddingTop:"0.4rem",borderTop:"1px solid var(--border)",fontSize:"0.6rem",color:"var(--text-muted)",marginTop:"0.4rem"}}>Height or weight missing.</div>
                            )}
                          </div>

                          {/* Technical Waveform Stats */}
                          <div className="diag-meta-section">
                            <div className="diag-meta-section-header">
                              <i className="fa-solid fa-wave-square"></i> Signal Properties
                            </div>
                            <div className="diag-props-table">
                              <div className="diag-prop-row"><span className="diag-prop-label">Duration</span><span className="diag-prop-value">10.0s</span></div>
                              <div className="diag-prop-row"><span className="diag-prop-label">Sampling</span><span className="diag-prop-value">500 Hz</span></div>
                              <div className="diag-prop-row"><span className="diag-prop-label">Samples</span><span className="diag-prop-value">5,000 / lead</span></div>
                              <div className="diag-prop-row"><span className="diag-prop-label">Channels</span><span className="diag-prop-value">12 Leads</span></div>
                            </div>
                          </div>

                          {/* Admin Metadata */}
                          <div className="diag-meta-section">
                            <div className="diag-meta-section-header">
                              <i className="fa-solid fa-database"></i> Registry Metadata
                            </div>
                            <div className="diag-registry-row"><span className="diag-registry-label">Date</span><span className="diag-registry-value">{selectedRecord.recording_date ? selectedRecord.recording_date.replace("T"," ") : "N/A"}</span></div>
                            <div className="diag-registry-row"><span className="diag-registry-label">Device</span><span className="diag-registry-value">{selectedRecord.device || "Schiller"}</span></div>
                            <div className="diag-registry-row"><span className="diag-registry-label">Axis</span><span className="diag-registry-value">{selectedRecord.heart_axis || "NORMAL"}</span></div>
                            <div className="diag-registry-row"><span className="diag-registry-label">Pacemaker</span><span className="diag-registry-value" style={{color: selectedRecord.pacemaker === 1 ? "var(--rhythm-normal)" : "var(--text-muted)"}}>{selectedRecord.pacemaker === 1 ? "Active" : "None"}</span></div>
                            <div className="diag-registry-row"><span className="diag-registry-label">Cardiologist</span><span className="diag-registry-value">#{selectedRecord.validated_by || "0"}</span></div>
                            <div className="diag-registry-row"><span className="diag-registry-label">Nurse</span><span className="diag-registry-value">#{selectedRecord.nurse || "0"}</span></div>
                            <div className="diag-registry-row"><span className="diag-registry-label">Site</span><span className="diag-registry-value">#{selectedRecord.site || "0"}</span></div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* DATABASE ENGINE SEEDER SETUP TAB */}
                <div className={`tab-content ${activeTab === "db-setup" ? "active" : ""} animate-fade-in`} id="tab-db-setup">
                  <div className="db-setup-section">
                    {/* Status Card */}
                    <div className="db-setup-card">
                      <div className="db-setup-status-row">
                        <div>
                          <div className="db-setup-status-label">Database Status</div>
                          <div className="db-setup-status-desc">{dbStatus === "seeded" ? "Engine ready with records" : "No records loaded"}</div>
                        </div>
                        <span className={`db-setup-status-badge ${dbStatus === "seeded" ? "seeded" : "unseeded"}`}>
                          {dbStatus === "seeded" ? "SEEDED" : "EMPTY"}
                        </span>
                      </div>
                    </div>

                    {/* Config Card */}
                    <div className="db-setup-card">
                      <div style={{fontSize:"0.7rem",fontWeight:700,marginBottom:"0.4rem",color:"var(--accent)"}}>Pull Configuration</div>
                      <div className="toggle-row">
                        <div>
                          <div className="tr-label">Dataset Mode</div>
                          <div className="tr-desc">Controls record count & signals</div>
                        </div>
                        <select className="db-setup-select" value={pullMode} onChange={(e) => {
                          const val = e.target.value;
                          setPullMode(val);
                          if (val === "metadata_only" || val === "full_force") setPullCount(21837);
                          else setPullCount(36);
                        }} disabled={seedingActive}>
                          <option value="metadata_only">Online (Metadata)</option>
                          <option value="partial">Partial + Signals</option>
                          <option value="full_force">Full + Signals</option>
                        </select>
                      </div>
                      <div className="toggle-row">
                        <div>
                          <div className="tr-label">Max Records</div>
                          <div className="tr-desc">Upper count to retrieve</div>
                        </div>
                        <input className="db-setup-number" type="number" value={pullCount} onChange={(e) => setPullCount(Number(e.target.value))} min={36} step={36} disabled={seedingActive} />
                      </div>
                      <div className="toggle-row" style={{borderTop:"1px solid var(--border)",marginTop:"0.3rem",paddingTop:"0.5rem"}}>
                        <div>
                          <div className="tr-label">Overwrite</div>
                          <div className="tr-desc">Clear before re-import</div>
                        </div>
                        <label className="toggle-switch">
                          <input type="checkbox" checked={overwriteDb} onChange={(e) => setOverwriteDb(e.target.checked)} />
                          <span className="toggle-slider"></span>
                        </label>
                      </div>
                    </div>

                    {/* Progress */}
                    {seedingActive && (
                      <div className="db-setup-card">
                        <div className="db-setup-progress">
                          <div className="db-setup-progress-header">
                            <span><i className="fa-solid fa-download"></i> Downloading...</span>
                            <span>{downloadProgress}/{downloadTotal}</span>
                          </div>
                          <div className="db-setup-progress-bar">
                            <div className="db-setup-progress-fill" style={{width:`${downloadTotal > 0 ? (downloadProgress/downloadTotal)*100 : 5}%`}}></div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="db-setup-card">
                      <button className="btn-action primary disabled:opacity-50" onClick={triggerDbSeeding} disabled={seedingActive}>
                        <i className={`fa-solid fa-database ${seedingActive ? "animate-bounce" : ""}`}></i>
                        {seedingActive ? " Seeding..." : " Seed / Update Database"}
                      </button>
                      {dbSeeded && !seedingActive && (
                        <button className="btn-action danger mt-2" onClick={async () => {
                          setOverwriteDb(true); setSeedingActive(true); setDbStatus("running"); setDbProgress("Clearing & re-importing..."); setDownloadProgress(0); setDownloadTotal(pullCount);
                          try {
                            const res = await fetch("/api/setup", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({pullConfig:{mode:pullMode,count:pullCount}, overwrite:true}) });
                            const data = await res.json();
                            if (data.seeded) { setDbSeeded(true); setSeedingActive(false); setOverwriteDb(false); setDownloadProgress(pullCount); fetchRecords(); showToastMsg("Re-imported successfully!"); }
                          } catch { setDbStatus("failed"); setDbProgress("Failed."); setSeedingActive(false); }
                        }}>
                          <i className="fa-solid fa-trash-can"></i> Clear & Re-Import
                        </button>
                      )}
                    </div>

                    {/* Engine Status */}
                    {dbProgress && (
                      <div className="db-setup-engine-status">
                        <span className="db-setup-engine-status-title">Engine Output</span>
                        {dbProgress}
                      </div>
                    )}
                  </div>
                </div>


              </>
            )}

            {/* RHYTHMS TAB */}
            <div className={`tab-content ${activeTab === "rhythms" ? "active" : ""}`} id="tab-rhythms">
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                Select clinical rhythm profile. Classification accordions can expand/collapse.
              </div>

              <div className="rhythm-scroll-box">
                {RHYTHM_CLASSIFICATIONS.map((cat) => {
                  const isExpanded = expandedCategory === cat.id;
                  return (
                    <div className={`rhythm-category ${isExpanded ? "expanded" : ""}`} key={cat.id} id={cat.id}>
                      <button
                        className={`rhythm-category-header cat-${cat.id.replace("cat_", "")}`}
                        onClick={() => setExpandedCategory(isExpanded ? "" : cat.id)}
                      >
                        <span>{cat.category}</span>
                        <span className="rhythm-category-icon">
                          <i className="fa-solid fa-chevron-right"></i>
                        </span>
                      </button>

                      <div className="rhythm-category-content">
                        {cat.rhythms.map((r) => {
                          const isSelected = r.id === currentRhythm && !manualMode;
                          const iconClass = ICONS[r.id] || "fa-solid fa-heart-pulse";
                          return (
                            <div
                              key={r.id}
                              className={`rhythm-card ${isSelected ? "selected" : ""}`}
                              onClick={() => selectRhythm(r.id)}
                            >
                              <div className="rc-icon">
                                <i className={iconClass}></i>
                              </div>
                              <div className="rc-name">{r.name}</div>
                              <span className={`rc-tag ${r.tagClass}`}>{r.tag}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* PROGRESSIVE PATHOLOGY PANEL */}
              <div className="intensity-panel mt-3">
                <div className="intensity-panel-header">
                  <div>
                    <span className="intensity-label">Pathology Intensity</span>
                    <div className="intensity-stage-name">{activeIntensityStage.name}</div>
                  </div>
                  <span className="intensity-badge">{activeIntensityPct}%</span>
                </div>

                <div className="intensity-desc">{activeIntensityStage.desc}</div>

                <div className={`rhythm-validation-card ${rhythmValidation.status}`}>
                  <div className="validation-header">
                    <span>
                      <i className={rhythmValidation.status === "validated" ? "fa-solid fa-circle-check" : "fa-solid fa-triangle-exclamation"}></i>
                      Accuracy checks
                    </span>
                    <span>{rhythmValidation.targetHeartRate > 0 ? `${rhythmValidation.targetHeartRate} bpm` : "No organized HR"}</span>
                  </div>
                  <div className="validation-check-list">
                    {rhythmValidation.checks.map((check) => (
                      <div className={`validation-check ${check.passed ? "passed" : "warning"}`} key={check.label}>
                        <i className={check.passed ? "fa-solid fa-check" : "fa-solid fa-triangle-exclamation"}></i>
                        <div>
                          <span>{check.label}</span>
                          <p>{check.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {currentRhythm.startsWith("stemi_") && (
                  <div className="stemi-territory mt-2">
                    <span className="stemi-terr-label">ST Elevation:</span>
                    <span className="stemi-terr-culprit">
                      {INTENSITY_STAGES[currentRhythm]?.culpritLeads?.join(", ")}
                    </span>
                    <span className="stemi-terr-sep">|</span>
                    <span className="stemi-terr-label">Reciprocal:</span>
                    <span className="stemi-terr-reciprocal">
                      {INTENSITY_STAGES[currentRhythm]?.reciprocalLeads?.join(", ")}
                    </span>
                  </div>
                )}

                {/* 12-LEAD MORPHOLOGY VALIDATION GRID */}
                {hasLeadRules && (
                  <div className="lead-valid-section">
                    <div className="lead-valid-header">
                      <span>
                        <i className="fa-solid fa-grid-4"></i>
                        12-Lead Morphology
                      </span>
                      <span className={leadValidation.allPassed ? "lv-status pass" : "lv-status warn"}>
                        {leadValidation.passedLeads}/{leadValidation.checkedLeads} checked
                      </span>
                    </div>
                    <div className="lead-valid-grid">
                      {leadValidation.results.map((r) => {
                        const isChecked = r.tag !== "—";
                        const cellClass = !isChecked
                          ? "lv-cell neutral"
                          : r.passed
                          ? "lv-cell pass"
                          : "lv-cell fail";
                        return (
                          <div key={r.lead} className={cellClass} title={r.detail}>
                            <span className="lv-lead">{r.lead}</span>
                            <span className="lv-tag">{r.tag}</span>
                            {isChecked && (
                              <i
                                className={
                                  r.passed
                                    ? "fa-solid fa-circle-check lv-icon"
                                    : "fa-solid fa-circle-xmark lv-icon"
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {!leadValidation.allPassed && (
                      <div className="lead-valid-failures">
                        {leadValidation.results
                          .filter((r) => !r.passed && r.tag !== "—")
                          .map((r) => (
                            <div className="lv-failure-row" key={r.lead}>
                              <span className="lv-fail-lead">{r.lead}</span>
                              <span className="lv-fail-detail">{r.detail}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="intensity-track mt-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={activeIntensityPct}
                    onChange={(e) => handleIntensityChange(e.target.value)}
                    style={{ "--intensity-progress": `${activeIntensityPct}%` } as React.CSSProperties}
                    aria-label="Pathology intensity"
                  />
                </div>

                <div className="intensity-markers">
                  <span>Normal</span>
                  <span>Mild</span>
                  <span>Moderate</span>
                  <span>Severe</span>
                  <span>Critical</span>
                </div>

                <div className="intensity-stage-dots mt-2">
                  {activeIntensityConfig.stages.map((stg) => {
                    const isCurrent =
                      effectIntensity * 100 >= stg.range[0] &&
                      effectIntensity * 100 <= stg.range[1];
                    const midPoint = (stg.range[0] + stg.range[1]) / 2;
                    return (
                      <button
                        type="button"
                        key={stg.name}
                        className={`intensity-dot ${isCurrent ? "active" : ""}`}
                        onClick={() => handleIntensityChange(midPoint.toString())}
                      >
                        {stg.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* LEADS TAB */}
            <div className={`tab-content ${activeTab === "leads" ? "active" : ""}`} id="tab-leads">
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.6rem" }}>
                Tap a lead to display in Single lead mode. Under 12-lead mode, all lines plot together dynamically.
              </div>

              <div className="lead-tabs">
                {LEADS.map((l) => {
                  const isStemi = currentRhythm.startsWith("stemi_");
                  const isCulprit = isStemi && INTENSITY_STAGES[currentRhythm]?.culpritLeads?.includes(l);
                  const isReciprocal = isStemi && INTENSITY_STAGES[currentRhythm]?.reciprocalLeads?.includes(l);

                  let tabClass = "lead-tab";
                  if (l === currentLead) tabClass += " active";
                  if (isCulprit) tabClass += " lead-culprit";
                  if (isReciprocal) tabClass += " lead-reciprocal";

                  return (
                    <button
                      key={l}
                      className={tabClass}
                      onClick={() => selectLead(l)}
                      title={isCulprit ? "Culprit Elevation Lead" : isReciprocal ? "Reciprocal ST Depression" : l}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* WAVE BUILDER MANUAL CUSTOMIZER */}
            <div className={`tab-content ${activeTab === "customwave" ? "active" : ""}`} id="tab-customwave">
              <div className="wave-customizer">
                {/* ── Always-visible basic sim controls ── */}
                <div className="param-grid border-b border-gray-700 pb-3" style={{ marginBottom: "1.0rem", paddingBottom: "1.0rem" }}>
                  <div className="slider-group">
                    <div className="slider-label">
                      <span>Heart Rate</span>
                      <span className="slider-val">{heartRate} bpm</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="220"
                      value={heartRate}
                      onChange={(e) => setHeartRate(parseInt(e.target.value))}
                    />
                  </div>

                  <div className="slider-group">
                    <div className="slider-label">
                      <span>Waveform Scale (Gain)</span>
                      <span className="slider-val">{amplitude}x</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="200"
                      value={Math.round(amplitude * 100)}
                      onChange={(e) => setAmplitude(parseInt(e.target.value) / 100)}
                    />
                  </div>

                  <div className="slider-group">
                    <div className="slider-label">
                      <span>Sweep Speed</span>
                      <span className="slider-val">{speed} mm/s</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="50"
                      step="5"
                      value={speed}
                      onChange={(e) => {
                        setSpeed(parseInt(e.target.value));
                        gridCacheValid.current = false;
                      }}
                    />
                  </div>

                  <div className="slider-group">
                    <div className="slider-label">
                      <span>Somatic Noise</span>
                      <span className="slider-val">{noise}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={noise}
                      onChange={(e) => setNoise(parseInt(e.target.value))}
                    />
                  </div>

                  <div className="slider-group">
                    <div className="slider-label">
                      <span>Interface Zoom</span>
                      <span className="slider-val">{zoom.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="500"
                      step="10"
                      value={Math.round(zoom * 100)}
                      onChange={(e) => {
                        setZoom(parseInt(e.target.value) / 100);
                        gridCacheValid.current = false;
                      }}
                    />
                  </div>

                  <div className="toggle-row">
                    <div>
                      <div className="tr-label">Trace Color Scheme</div>
                      <div className="tr-desc">Monitor display style</div>
                    </div>
                    <select
                      style={{ background: "var(--surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.2rem 0.4rem", fontSize: "0.72rem" }}
                      value={colorScheme}
                      onChange={(e) => {
                        setColorScheme(e.target.value);
                        gridCacheValid.current = false;
                        showToastMsg("Color scheme: " + e.target.value.toUpperCase());
                      }}
                    >
                      <option value="ge">GE Healthcare (green)</option>
                      <option value="philips">Philips (amber)</option>
                      <option value="mortara">Mortara (white)</option>
                      <option value="nihon">Nihon Kohden (cyan)</option>
                      <option value="draeger">Dräger (blue)</option>
                    </select>
                  </div>

                  <div className="toggle-row">
                    <div>
                      <div className="tr-label">Realistic Simulation</div>
                      <div className="tr-desc">Adds baseline wander &amp; muscle drift</div>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={realistic}
                        onChange={(e) => setRealistic(e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="toggle-row">
                    <div>
                      <div className="tr-label">Grid Overlay</div>
                      <div className="tr-desc">Show millimeter reference lines</div>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={showGrid}
                        onChange={(e) => {
                          setShowGrid(e.target.checked);
                          gridCacheValid.current = false;
                        }}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="toggle-row">
                    <div>
                      <div className="tr-label">QRS Beep Sound</div>
                      <div className="tr-desc">Oscillator beep tone on R-peak detection</div>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={soundOn}
                        onChange={(e) => setSoundOn(e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                </div>

                {/* ── Manual wave customizer (unlock for full parametric control) ── */}
                <div className="manual-banner">
                  <div>
                    <div className="manual-banner-text">Custom Wave Designer</div>
                    <div className="manual-banner-desc">Unlock advanced parametric waveform construction.</div>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={manualMode}
                      onChange={(e) => toggleManualModeState(e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div id="wave-builder-content" style={{ display: manualMode ? "block" : "none" }}>
                  {/* Calculated Parametrics Monitor Panel */}
                  <div className="manual-params-panel visible mb-4" style={{ marginBottom: "1.5rem" }}>
                    <div className="mpp-title">
                      <i className="fa-solid fa-chart-bar"></i> Active Waveform Parameters
                    </div>
                    <div className="mpp-row">
                      <span className="mpp-param">P Amplitude</span>
                      <span className="mpp-val">{waveParams.pAmp.toFixed(3)} mV</span>
                    </div>
                    <div className="mpp-row">
                      <span className="mpp-param">P Duration</span>
                      <span className="mpp-val">{waveParams.pDur.toFixed(3)} s</span>
                    </div>
                    <div className="mpp-row">
                      <span className="mpp-param">PR Interval</span>
                      <span className="mpp-val">{waveParams.prInt.toFixed(3)} s</span>
                    </div>
                    <div className="mpp-row">
                      <span className="mpp-param">QRS Amplitude</span>
                      <span className="mpp-val">{waveParams.qrsAmp.toFixed(3)} mV</span>
                    </div>
                    <div className="mpp-row">
                      <span className="mpp-param">QRS Duration</span>
                      <span className="mpp-val">{waveParams.qrsDur.toFixed(3)} s</span>
                    </div>
                    <div className="mpp-row">
                      <span className="mpp-param">ST Elevation</span>
                      <span className="mpp-val">
                        {(waveParams.stElev >= 0 ? "+" : "") + waveParams.stElev.toFixed(3)} mV
                      </span>
                    </div>
                    <div className="mpp-row">
                      <span className="mpp-param">T Amplitude</span>
                      <span className="mpp-val">{waveParams.tAmp.toFixed(3)} mV</span>
                    </div>
                    <div className="mpp-row">
                      <span className="mpp-param">T Duration</span>
                      <span className="mpp-val">{waveParams.tDur.toFixed(3)} s</span>
                    </div>
                    <div className="mpp-row">
                      <span className="mpp-param">J-Notch (Osborn)</span>
                      <span className="mpp-val">{waveParams.jNotch.toFixed(3)} mV</span>
                    </div>
                    <div className="mpp-row">
                      <span className="mpp-param">U Amplitude</span>
                      <span className="mpp-val">{waveParams.uAmp.toFixed(3)} mV</span>
                    </div>
                  </div>

                  <div className="manual-controls">
                    <div className="param-grid">
                      {/* P WAVE CONTROL */}
                      <div className="param-card">
                        <div className="param-card-title">P Wave (Atrial)</div>
                        <div className="slider-group">
                          <div className="slider-label"><span>P Amplitude</span><span className="slider-val">{(waveParams.pAmp).toFixed(2)} mV</span></div>
                          <input
                            type="range"
                            min="-50"
                            max="100"
                            value={Math.round(waveParams.pAmp * 100)}
                            onChange={(e) => updateManualWaveParam("pAmp", e.target.value as any)}
                          />
                        </div>
                        <div className="slider-group">
                          <div className="slider-label"><span>P Duration</span><span className="slider-val">{(waveParams.pDur).toFixed(2)} s</span></div>
                          <input
                            type="range"
                            min="30"
                            max="250"
                            value={Math.round(waveParams.pDur * 1000)}
                            onChange={(e) => updateManualWaveParam("pDur", e.target.value as any)}
                          />
                        </div>
                        <div className="slider-group">
                          <div className="slider-label"><span>PR Interval</span><span className="slider-val">{(waveParams.prInt).toFixed(2)} s</span></div>
                          <input
                            type="range"
                            min="80"
                            max="400"
                            value={Math.round(waveParams.prInt * 1000)}
                            onChange={(e) => updateManualWaveParam("prInt", e.target.value as any)}
                          />
                        </div>
                      </div>

                      {/* QRS WAVE CONTROL */}
                      <div className="param-card">
                        <div className="param-card-title">QRS Complex (Ventricular)</div>
                        <div className="slider-group">
                          <div className="slider-label"><span>QRS Amplitude</span><span className="slider-val">{(waveParams.qrsAmp).toFixed(2)} mV</span></div>
                          <input
                            type="range"
                            min="10"
                            max="250"
                            value={Math.round(waveParams.qrsAmp * 100)}
                            onChange={(e) => updateManualWaveParam("qrsAmp", e.target.value as any)}
                          />
                        </div>
                        <div className="slider-group">
                          <div className="slider-label"><span>QRS Width</span><span className="slider-val">{(waveParams.qrsDur).toFixed(2)} s</span></div>
                          <input
                            type="range"
                            min="30"
                            max="250"
                            value={Math.round(waveParams.qrsDur * 1000)}
                            onChange={(e) => updateManualWaveParam("qrsDur", e.target.value as any)}
                          />
                        </div>
                        <div className="slider-group">
                          <div className="slider-label"><span>Osborn J-Wave Notch</span><span className="slider-val">{(waveParams.jNotch).toFixed(2)} mV</span></div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={Math.round(waveParams.jNotch * 100)}
                            onChange={(e) => updateManualWaveParam("jNotch", e.target.value as any)}
                          />
                        </div>
                      </div>

                      {/* ST & T WAVE CONTROL */}
                      <div className="param-card">
                        <div className="param-card-title">ST Segment &amp; T Wave</div>
                        <div className="slider-group">
                          <div className="slider-label"><span>ST Elevation / Depr.</span><span className="slider-val">{(waveParams.stElev).toFixed(2)} mV</span></div>
                          <input
                            type="range"
                            min="-100"
                            max="100"
                            value={Math.round(waveParams.stElev * 100)}
                            onChange={(e) => updateManualWaveParam("stElev", e.target.value as any)}
                          />
                        </div>
                        <div className="slider-group">
                          <div className="slider-label"><span>ST Duration</span><span className="slider-val">{(waveParams.stDur).toFixed(2)} s</span></div>
                          <input
                            type="range"
                            min="40"
                            max="300"
                            value={Math.round(waveParams.stDur * 1000)}
                            onChange={(e) => updateManualWaveParam("stDur", e.target.value as any)}
                          />
                        </div>
                        <div className="slider-group">
                          <div className="slider-label"><span>ST Slope Shape</span><span className="slider-val">
                            {waveParams.stSlope === -1
                              ? "Sagging"
                              : waveParams.stSlope === 0
                              ? "Horizontal"
                              : waveParams.stSlope === 1
                              ? "Concave"
                              : "Convex"}
                          </span></div>
                          <input
                            type="range"
                            min="-1"
                            max="2"
                            value={waveParams.stSlope}
                            onChange={(e) => updateManualWaveParam("stSlope", e.target.value as any)}
                          />
                        </div>
                        <div className="slider-group">
                          <div className="slider-label"><span>T Amplitude</span><span className="slider-val">{(waveParams.tAmp).toFixed(2)} mV</span></div>
                          <input
                            type="range"
                            min="-100"
                            max="150"
                            value={Math.round(waveParams.tAmp * 100)}
                            onChange={(e) => updateManualWaveParam("tAmp", e.target.value as any)}
                          />
                        </div>
                        <div className="slider-group">
                          <div className="slider-label"><span>T Duration</span><span className="slider-val">{(waveParams.tDur).toFixed(2)} s</span></div>
                          <input
                            type="range"
                            min="80"
                            max="400"
                            value={Math.round(waveParams.tDur * 1000)}
                            onChange={(e) => updateManualWaveParam("tDur", e.target.value as any)}
                          />
                        </div>
                        <div className="slider-group">
                          <div className="slider-label"><span>T Wave Shape</span><span className="slider-val">
                            {waveParams.tShape === 1 ? "Symmetric" : "Biphasic"}
                          </span></div>
                          <input
                            type="range"
                            min="1"
                            max="2"
                            value={waveParams.tShape}
                            onChange={(e) => updateManualWaveParam("tShape", e.target.value as any)}
                          />
                        </div>
                      </div>

                      {/* U WAVE CONTROL */}
                      <div className="param-card">
                        <div className="param-card-title">U Wave (Afterpotential)</div>
                        <div className="slider-group">
                          <div className="slider-label"><span>U Amplitude</span><span className="slider-val">{(waveParams.uAmp).toFixed(2)} mV</span></div>
                          <input
                            type="range"
                            min="0"
                            max="50"
                            value={Math.round(waveParams.uAmp * 100)}
                            onChange={(e) => updateManualWaveParam("uAmp", e.target.value as any)}
                          />
                        </div>
                        <div className="slider-group">
                          <div className="slider-label"><span>U Duration</span><span className="slider-val">{(waveParams.uDur).toFixed(2)} s</span></div>
                          <input
                            type="range"
                            min="40"
                            max="250"
                            value={Math.round(waveParams.uDur * 1000)}
                            onChange={(e) => updateManualWaveParam("uDur", e.target.value as any)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ACTIONS TAB */}
            <div className={`tab-content ${activeTab === "actions" ? "active" : ""} gap-4 flex flex-col`} id="tab-actions">
              <div className="action-row">
                <button className="btn-action primary" onClick={openPdfExport}>
                  <i className="fa-solid fa-file-pdf"></i> Generate & Export PDF
                </button>
              </div>
              <div className="action-row flex gap-2">
                <button className="btn-action" onClick={takeSnapshot}>
                  <i className="fa-solid fa-camera"></i> Capture PNG
                </button>
                <button className="btn-action" onClick={resetSettings}>
                  <i className="fa-solid fa-rotate-left"></i> Factory Reset
                </button>
              </div>
              <div className="action-row flex gap-2">
                <button className="btn-action" onClick={startCalibration}>
                  <i className="fa-solid fa-caret-up"></i> Calibrate (1mV)
                </button>
                <button
                  className={`btn-action ${comparisonMode ? "primary" : ""}`}
                  onClick={toggleComparisonModeState}
                >
                  <i className="fa-solid fa-columns"></i> Compare with NSR
                </button>
              </div>
              <div className="action-row mt-2">
                <button className="btn-action danger" onClick={simulateArrest}>
                  <i className="fa-solid fa-skull-crossbones"></i> Arrest Sequence
                </button>
              </div>

              {/* Physiology manual info guides */}
              <div style={{ marginTop: "0.8rem", padding: "0.75rem", background: "var(--surface2)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, marginBottom: "0.4rem", color: "var(--accent)" }}>
                  Physiological Guide
                </div>
                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", lineHeight: 1.55 }}>
                  <div>
                    <i className="fa-solid fa-circle text-[4px] align-middle mr-2"></i>
                    <b>Millimeter scale:</b> 1 large block (5 mm) = 0.2 s time / 0.5 mV voltage. 1 mm grid lines represent 0.04 s and 0.1 mV.
                  </div>
                  <div className="mt-1">
                    <i className="fa-solid fa-circle text-[4px] align-middle mr-2"></i>
                    <b>Diagnostic Layout:</b> Standard 12-lead ECG format showing all leads simultaneously with calibration pulses.
                  </div>
                  <div className="mt-1">
                    <i className="fa-solid fa-circle text-[4px] align-middle mr-2"></i>
                    <b>Interactive gestures:</b> Swipe or drag horizontally to slide leads in single-lead mode, use scroll wheels or pinches to adjust grid zoom.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TOAST SYSTEM POPUPS */}
      <div className={`toast ${toastShow ? "show" : ""}`}>{toastMsg}</div>

      {/* PDF PRINT REPORT PREVIEW OVERLAY */}
      {pdfOpen && (
        <div className="pdf-overlay open">
          <div className="pdf-preview">
            <div className="pdf-header">
              <h3>
                <i className="fa-solid fa-file-pdf"></i> Diagnostic ECG PDF Report Preview
              </h3>
              <button className="topbar-btn" onClick={closePdfExport}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="pdf-body">
              <div className="pdf-meta">
                <div className="meta-item">
                  <div className="meta-label">Rhythm</div>
                  <div className="meta-value">
                    {mode === "database"
                      ? (selectedRecord ? `Patient ID #${selectedRecord.patient_id} · ${selectedRecord.superclass} (${selectedRecord.class_explanation || 'ECG Clinical Recording'})` : "No Record Loaded")
                      : (manualMode
                        ? "Custom Manual Wave"
                        : RHYTHMS.find((r) => r.id === currentRhythm)?.name || currentRhythm)
                    }
                  </div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">Heart Rate</div>
                  <div className="meta-value">{Math.round(heartRate)} bpm</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">Paper Speed</div>
                  <div className="meta-value">{speed} mm/s</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">Gain</div>
                  <div className="meta-value">10 mm/mV</div>
                </div>
                <div className="meta-item">
                  <div className="meta-label">View Mode</div>
                  <div className="meta-value">{viewMode === "12lead" ? "12-Lead" : `Single Lead: ${currentLead}`}</div>
                </div>
              </div>
              <canvas ref={pdfCanvasRef}></canvas>
            </div>
            <div className="pdf-footer">
              <button className="btn-action" onClick={closePdfExport}>
                Cancel
              </button>
              <button className="btn-action primary" onClick={downloadPdf}>
                <i className="fa-solid fa-download"></i> Download Print Document
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
