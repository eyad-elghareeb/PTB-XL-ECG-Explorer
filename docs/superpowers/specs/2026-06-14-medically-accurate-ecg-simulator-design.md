# Medically Accurate 12-Lead ECG Simulator — Design Spec

**Date:** 2026-06-14
**Branch:** `simulator/revamp`
**Status:** Approved

## Problem

The current simulator (`lib/ecg-math.ts`) uses the NeuroKit2/McSharry ECGSYN 5-Gaussian model. This cannot structurally represent the morphologies that define the most important teaching rhythms:

- **RBBB** rsR' in V1 (three separate QRS deflections)
- **LBBB** notched M-pattern in V5/V6 (two R peaks, no septal Q)
- **WPW** delta wave (a slurred upstroke fused into QRS onset)
- **Brugada** coved ST (a convex hump descending into negative T)
- **STEMI** tombstone (ST segment fused into a massive T, no isoelectric gap)
- Asymmetric T inversion, Osborn J-waves, prominent U waves

Amplitude/width tweaks on 5 Gaussians produce waveforms that look superficially plausible but fail the diagnostic criteria when measured.

The validator (`lib/ecg-validate.ts`) compounds the problem: it uses phase-window averaging (mean value in 35–50% of cycle as "ST") instead of measuring J-point elevation, QRS duration via derivative, or PR interval via P-onset. A passing validator does not mean the waveform is medically accurate.

## Goal

A **trustable learning tool**: every one of the 36 retained rhythms, at clinically-relevant intensities, must produce a 12-lead waveform whose measured intervals and amplitudes satisfy published diagnostic criteria. Completion is gated by a standalone validator script that measures the synthesized waveform and exits non-zero on any criterion failure.

## Non-goals

- No new rhythms beyond the existing 36.
- No changes to `app/page.tsx` (the renderer stays on the same `getWaveformForBeatIndex` / `buildAllLeadLUTs` / `sampleLeadLUT` / `addTraceNoise` contract).
- No database-mode changes.
- No new UI, no new state variables.

## Architecture

### 1. New synthesis engine — piecewise analytic segments

A beat is a sum of time-anchored wave segments, each with an explicit shape:

```typescript
interface WaveSegment {
  shape: 'gaussian' | 'cosine_bell' | 'triangle' | 'ramp_up' | 'ramp_down' | 'sine_half';
  centerMs: number;      // relative to R-peak at t=0
  leftWidthMs: number;   // rise time (asymmetry)
  rightWidthMs: number;  // fall time (asymmetry — T needs this)
  amplitudeMv: number;   // signed
}
```

Each shape is a normalized basis function with peak=1 at `centerMs`, evaluated by interpolating the appropriate formula across `[center-leftWidth, center+rightWidth]` and zero elsewhere. `gaussian` is symmetric; `triangle`/`cosine_bell` allow asymmetric left/right widths; `ramp_up` is the delta-wave basis (linear rise then drop).

### 2. Per-lead baseline normal beat

The 8 independent leads (I, II, V1, V2, V3, V4, V5, V6) each get a baseline normal-adult segment list calibrated to textbook amplitudes and timings:

- P wave: 0.1–0.15 mV, 80–110 ms, centered ~−160 ms
- Q wave: small septal Q in lateral leads, ~20 ms
- R wave: lead-dependent (V4/V5 tallest ~1.5–2.0 mV, V1 small ~0.3 mV)
- S wave: dominant in V1/V2 (~1.2–1.8 mV), small in lateral
- T wave: 0.2–0.5 mV upright, asymmetric (slower downslope)
- All intervals: PR 140–160 ms, QRS 80–100 ms, QT 350–400 ms at 72 bpm

The 4 dependent leads (III, aVR, aVL, aVF) are computed from I and II via Einthoven and Goldberger equations — preserving the existing `DEPENDENT_LEADS` contract.

### 3. Pathology templates — `(intensity) → LeadOverrides`

Each of the 36 rhythms supplies a `template(intensity)` function returning per-lead overrides (segment additions, replacements, amplitude/width multipliers, P suppression, etc.). Templates compose on top of the baseline, so NSR-with-LVH-voltage is just an LVH template that widens R amplitudes in lateral leads and deepens S in V1/V2.

Beat-sequencing pathologies (afib, aflutter, all AV blocks, PVC, VT, VFib, asystole, PEA) are handled at the beat-sequencer layer in `getWaveformForBeatIndex`:

- **afib**: suppress P, add fibrillatory noise baseline, irregular RR
- **aflutter**: 300/min sawtooth summed onto QRS, AV block governs ventricular response
- **AVB 1°**: constant prolonged PR
- **AVB 2° Mobitz I**: progressive PR lengthening across beats, then P-only beat
- **AVB 2° Mobitz II**: constant PR, sudden dropped QRS (P-only beat), wide QRS at high intensity
- **AVB 3°**: two independent beat clocks (atrial P's + ventricular escape)
- **PVC trigeminy**: every 3rd beat uses a wide ectopic segment set
- **VT**: wide ventricular segment set, no P, polymorphic twist at high intensity
- **VFib/asystole/PEA**: direct noise synthesis (already correct)

### 4. Measurement-based validator

`lib/ecg-measure.ts` samples the synthesized cycle at ≥1000 points and computes:

| Measurement | Method |
|---|---|
| PR interval | P-onset (derivative crosses threshold) to QRS-onset |
| QRS duration | QRS-onset to J-point (derivative returns to baseline) |
| QT / QTc | J-point to T-end (derivative returns to baseline post-T); Bazett correction |
| ST elevation | Deviation at J+60 ms from TP baseline, per lead |
| R/S amplitude | Extrema in QRS window |
| T amplitude & polarity | Peak in T window, signed |
| Frontal axis | Net QRS area in I vs aVF |
| Voltage criteria | Sokolov-Lyon: SV1 + RV5 in mm |

`lib/ecg-validate.ts` then applies criteria at the intensity stage where each pathology is fully expressed. Examples:

- **LBBB**: QRS ≥ 120 ms, broad notched R in V5/V6 (two local maxima), QS/rS in V1, no septal Q in I/V5/V6, ST/T discordance
- **RBBB**: QRS ≥ 120 ms, rsR' in V1 (R' > initial r), wide S in I/V5/V6, T inversion in V1
- **LVH**: Sokolov-Lyon SV1 + RV5 > 35 mm + lateral ST/T strain
- **RVH**: R/S ratio in V1 > 1, right-axis, RV strain
- **WPW**: PR < 120 ms, QRS > 100 ms, delta-wave upstroke (early-QRS derivative below threshold)
- **STEMI** (each territory): ST elevation ≥ 1 mm limb / ≥ 1.5 mm precordial in ≥ 2 contiguous culprit leads + reciprocal depression in ≥ 1 reciprocal lead
- **Brugada Type 1** (at intensity ≥ 0.6): coved ST ≥ 2 mm in V1/V2 + negative T
- **Hyperkalemia**: peaked narrow T (amp/width ratio), P loss at high intensity
- **Long QT**: QTc > 440 ms
- **Hypokalemia**: prominent U + ST depression
- **AV blocks**: measured PR progression / dropped-beat pattern
- **Wellens**: deep/biphasic T inversion in V2–V3 with preserved R
- **De Winter**: upsloping ST depression + tall T in precordials
- **PE**: S1Q3T3 tendency, sinus tachy, anterior T changes

## Files

| File | Change | Purpose |
|---|---|---|
| `lib/ecg-model.ts` | NEW | `WaveSegment`, shape functions, `composeBeat`, per-lead baseline |
| `lib/ecg-pathologies.ts` | NEW | 36 templates: `(intensity) → LeadOverrides` |
| `lib/ecg-math.ts` | REWRITE | Beat sequencer, `getWaveformForBeatIndex` (same signature), LUT, noise — thin layer over ecg-model |
| `lib/ecg-measure.ts` | NEW | Cycle delineation + interval/amplitude measurement |
| `lib/ecg-validate.ts` | REWRITE | Criteria-based checks using ecg-measure |
| `lib/ecg-rhythms.ts` | EDIT | Keep catalog/UI metadata (RHYTHM_CLASSIFICATIONS, ICONS, INTENSITY_STAGES stages, rhythmRates, LAYOUT_12, LEADS, validateRhythmProfile); replace `params()` with `template` refs; keep public types |
| `app/page.tsx` | UNCHANGED | Drop-in contract |
| `scripts/validate-ecg.mjs` | NEW | Standalone runner; validates all 36 rhythms × all stages; exits non-zero on failure |
| `package.json` | EDIT | Add `"validate": "node scripts/validate-ecg.mjs"` |

## Contract preservation

`app/page.tsx` calls (signatures unchanged):

- `getWaveformForBeatIndex(phase, lead, beatIndex, rhythm, intensity, bpm, amplitude, noise, realistic, manualMode, waveParams): number`
- `buildAllLeadLUTs(rhythm, lead, intensity, amplitude, bpm, manualMode, waveParams): void`
- `sampleLeadLUT(lead, phase, rhythm, intensity, bpm, manualMode, waveParams): number`
- `addTraceNoise(val, phase, timeSeed, noiseLevelPct, realistic, bpm): number`
- `validateRhythmAllLeads(rhythmId, intensity): LeadValidationSummary`
- `validateRhythmProfile(rhythmId, intensity): RhythmValidationSummary`
- All catalog exports (`RHYTHM_CLASSIFICATIONS`, `RHYTHMS`, `ICONS`, `INTENSITY_STAGES`, `rhythmRates`, `LAYOUT_12`, `LEADS`, `BEAT_AWARE_RHYTHMS`, `LEAD_AWARE_RHYTHMS`, `LEAD_TARGET_AMPLITUDE`) keep the same shape.

## Completion gate

The `npm run validate` script is the evidence. It must:
1. Run every rhythm at every intensity stage (sample ≥ 3 intensities per stage).
2. Apply every applicable criterion.
3. Report 0 failures.
4. Exit non-zero on any failure (so the harness can detect it).

Work is complete only when `npm run validate` exits clean AND `npm run lint` passes AND `npm run build` succeeds.

## Manual mode

The `manualMode` / `waveParams` path (the Wave Builder customizer tab) is preserved. `waveParams` maps to a segment list through a fixed adapter, so users still see the same sliders control the same waveform.
