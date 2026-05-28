// ════════════════════════════════════════════════════════════════
// CLINICAL RHYTHMS & INTENSITY DATA CONFIGURATIONS
// ════════════════════════════════════════════════════════════════

export interface RhythmItem {
  id: string;
  name: string;
  tag: string;
  tagClass: string;
}

export interface RhythmCategory {
  category: string;
  id: string;
  rhythms: RhythmItem[];
}

export const RHYTHM_CLASSIFICATIONS: RhythmCategory[] = [
  {
    category: "Normal / Baseline",
    id: "cat_normal",
    rhythms: [
      { id: 'nsr',      name: 'Normal Sinus Rhythm',      tag: 'Normal',    tagClass: '' },
      { id: 'earlyrepo',name: 'Early Repolarization',     tag: 'Normal',    tagClass: '' },
    ]
  },
  {
    category: "Atrial Rhythms & Blocks",
    id: "cat_atrial",
    rhythms: [
      { id: 'st',       name: 'Sinus Tachycardia',        tag: 'Fast',      tagClass: 'abnormal' },
      { id: 'sb',       name: 'Sinus Bradycardia',        tag: 'Slow',      tagClass: 'abnormal' },
      { id: 'afib',     name: 'Atrial Fibrillation',      tag: 'Irregular', tagClass: 'abnormal' },
      { id: 'aflutter', name: 'Atrial Flutter',           tag: 'Flutter',   tagClass: 'abnormal' },
      { id: 'svt',      name: 'SVT',                      tag: 'Fast',      tagClass: 'abnormal' },
      { id: 'avb1',     name: 'AV Block 1°',              tag: 'Abnormal',  tagClass: 'abnormal' },
      { id: 'avb2mob1', name: 'AV Block 2° Mobitz I',    tag: 'Abnormal',  tagClass: 'abnormal' },
      { id: 'avb2mob2', name: 'AV Block 2° Mobitz II',   tag: 'Critical',  tagClass: 'critical' },
      { id: 'avb3',     name: 'AV Block 3° (Complete)',   tag: 'Critical',  tagClass: 'critical' },
    ]
  },
  {
    category: "Ventricular Rhythms",
    id: "cat_vent",
    rhythms: [
      { id: 'vtach',    name: 'Ventricular Tachycardia',  tag: 'Critical',  tagClass: 'critical' },
      { id: 'vfib',     name: 'Ventricular Fibrillation', tag: 'Critical',  tagClass: 'critical' },
      { id: 'pvc',      name: 'PVC (Trigeminy)',           tag: 'Ectopic',   tagClass: 'abnormal' },
    ]
  },
  {
    category: "Conduction & Metabolic Blocks",
    id: "cat_cond",
    rhythms: [
      { id: 'lbbb',     name: 'LBBB',                     tag: 'Block',     tagClass: 'abnormal' },
      { id: 'rbbb',     name: 'RBBB',                     tag: 'Block',     tagClass: 'abnormal' },
      { id: 'wpw',      name: 'WPW Syndrome',             tag: 'Pre-ex',    tagClass: 'abnormal' },
      { id: 'longqt',   name: 'Long QT Syndrome',         tag: 'QTc',       tagClass: 'abnormal' },
      { id: 'brugada',  name: 'Brugada Syndrome',         tag: 'Critical',  tagClass: 'critical' },
      { id: 'hyperk',   name: 'Hyperkalemia',             tag: 'Metabolic', tagClass: 'critical' },
      { id: 'hypokalemia',name: 'Hypokalemia',            tag: 'Metabolic', tagClass: 'abnormal' },
      { id: 'hypothermia',name: 'Hypothermia (Osborn)',   tag: 'Critical',  tagClass: 'critical' },
    ]
  },
  {
    category: "Ischemia & Inflammatory",
    id: "cat_ischemia",
    rhythms: [
      { id: 'stemi_ant',    name: 'Anterior STEMI (LAD)',       tag: 'Infarct',   tagClass: 'critical' },
      { id: 'stemi_inf',    name: 'Inferior STEMI (RCA)',       tag: 'Infarct',   tagClass: 'critical' },
      { id: 'stemi_lat',    name: 'Lateral STEMI (LCx)',        tag: 'Infarct',   tagClass: 'critical' },
      { id: 'stemi_antlat', name: 'Anterolateral STEMI',        tag: 'Infarct',   tagClass: 'critical' },
      { id: 'stemi_inflat', name: 'Inferolateral STEMI',        tag: 'Infarct',   tagClass: 'critical' },
      { id: 'stemi_rv',     name: 'Right Ventricular STEMI',    tag: 'Infarct',   tagClass: 'critical' },
      { id: 'pwmi',         name: 'Posterior Wall MI',          tag: 'Infarct',   tagClass: 'critical' },
      { id: 'pericarditis', name: 'Acute Pericarditis',         tag: 'Inflame',   tagClass: 'abnormal' },
      { id: 'digoxin',      name: 'Digoxin Sag Segment',        tag: 'Effect',    tagClass: 'abnormal' },
      { id: 'wellens',      name: 'Wellens Syndrome',           tag: 'Critical',  tagClass: 'critical' },
      { id: 'dewinter',     name: 'De Winter T Waves',          tag: 'Critical',  tagClass: 'critical' },
      { id: 'pe',           name: 'Pulmonary Embolism',         tag: 'Critical',  tagClass: 'critical' },
    ]
  },
  {
    category: "Hypertrophy & Enlargement",
    id: "cat_hypertrophy",
    rhythms: [
      { id: 'lvh',      name: 'Left Ventricular Hypertrophy', tag: 'LVH',      tagClass: 'abnormal' },
      { id: 'rvh',      name: 'Right Ventricular Hypertrophy',tag: 'RVH',      tagClass: 'abnormal' },
      { id: 'bve',      name: 'Biventricular Enlargement',    tag: 'BVE',      tagClass: 'abnormal' },
      { id: 'lah',      name: 'Left Atrial Enlargement',      tag: 'LAH',      tagClass: 'abnormal' },
      { id: 'rah',      name: 'Right Atrial Enlargement',     tag: 'RAH',      tagClass: 'abnormal' },
      { id: 'lafb',     name: 'LAFB',                         tag: 'Block',     tagClass: 'abnormal' },
      { id: 'lpfb',     name: 'LPFB',                         tag: 'Block',     tagClass: 'abnormal' },
    ]
  },
  {
    category: "Cardiac Emergency / Arrest",
    id: "cat_emergency",
    rhythms: [
      { id: 'pea',      name: 'PEA (Electromechanical)',  tag: 'Arrest',    tagClass: 'critical' },
      { id: 'asystole', name: 'Asystole (Flatline)',      tag: 'Arrest',    tagClass: 'critical' },
    ]
  }
];

export const RHYTHMS: RhythmItem[] = RHYTHM_CLASSIFICATIONS.flatMap(c => c.rhythms);

export const ICONS: Record<string, string> = {
  nsr: "fa-solid fa-heart-pulse",
  st: "fa-solid fa-bolt-lightning",
  sb: "fa-solid fa-circle-info",
  afib: "fa-solid fa-wave-square",
  aflutter: "fa-solid fa-water",
  svt: "fa-solid fa-arrows-up-down",
  vtach: "fa-solid fa-bolt",
  vfib: "fa-solid fa-hurricane",
  pea: "fa-solid fa-bullseye",
  asystole: "fa-solid fa-minus",
  pvc: "fa-solid fa-chart-line",
  lbbb: "fa-solid fa-code-branch",
  rbbb: "fa-solid fa-code-branch",
  stemi_ant: "fa-solid fa-triangle-exclamation",
  stemi_inf: "fa-solid fa-triangle-exclamation",
  stemi_lat: "fa-solid fa-triangle-exclamation",
  stemi_antlat: "fa-solid fa-triangle-exclamation",
  stemi_inflat: "fa-solid fa-triangle-exclamation",
  stemi_rv: "fa-solid fa-triangle-exclamation",
  pwmi: "fa-solid fa-arrows-left-right",
  hyperk: "fa-solid fa-diamond",
  lvh: "fa-solid fa-weight-hanging",
  rvh: "fa-solid fa-weight-hanging",
  bve: "fa-solid fa-maximize",
  lah: "fa-solid fa-p",
  rah: "fa-solid fa-p",
  wpw: "fa-solid fa-bolt",
  longqt: "fa-solid fa-arrows-left-right",
  pericarditis: "fa-solid fa-heart-crack",
  hypokalemia: "fa-solid fa-arrow-trend-down",
  digoxin: "fa-solid fa-prescription-bottle",
  earlyrepo: "fa-solid fa-arrow-up",
  avb1: "fa-solid fa-link-slash",
  avb2mob1: "fa-solid fa-link-slash",
  avb2mob2: "fa-solid fa-link-slash",
  avb3: "fa-solid fa-link-slash",
  brugada: "fa-solid fa-mountain",
  hypothermia: "fa-solid fa-snowflake",
  wellens: "fa-solid fa-arrows-spin",
  dewinter: "fa-solid fa-arrow-up-right-dots",
  pe: "fa-solid fa-shield-virus",
  lafb: "fa-solid fa-compass",
  lpfb: "fa-solid fa-compass"
};

export interface Stage {
  name: string;
  range: [number, number];
  desc: string;
}

export interface IntensityConfig {
  stages: Stage[];
  defaultIntensity: number;
  hrMod?: (i: number) => number;
  culpritLeads?: string[];
  reciprocalLeads?: string[];
  params: (i: number) => any;
}

export const INTENSITY_STAGES: Record<string, IntensityConfig> = {
  // Default fallback for rhythms without pathological progression
  _default: {
    stages: [
      { name: 'Standard', range: [0, 100], desc: 'Rhythm displayed at standard settings — no pathological progression available.' }
    ],
    defaultIntensity: 0,
    hrMod: (i) => 72,
    params: () => ({ pAmp: 0.12, pDur: 0.10, prInt: 0.19, qrsAmp: 1.0, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.22, tDur: 0.19, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  nsr: {
    stages: [
      { name: 'Baseline', range: [0, 100], desc: 'Normal sinus rhythm at all intensity levels — no pathological progression.' }
    ],
    defaultIntensity: 0,
    hrMod: () => 72,
    params: () => ({ pAmp: 0.12, pDur: 0.10, prInt: 0.19, qrsAmp: 1.0, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.22, tDur: 0.19, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  earlyrepo: {
    stages: [
      { name: 'Subtle J-point', range: [0, 25], desc: 'Mild J-point elevation with concave ST. Benign early repolarization pattern.' },
      { name: 'Prominent J-wave', range: [25, 55], desc: 'J-wave notch at QRS terminal ("fishhook" pattern), concave ST elevation, tall T waves.' },
      { name: 'Marked ST Elevation', range: [55, 100], desc: 'Prominent concave ST elevation with tall peaked T. Must differentiate from STEMI/Pericarditis.' }
    ],
    defaultIntensity: 0.35,
    hrMod: (i) => 65 - 5 * i,
    params: (i) => ({ pAmp: 0.12, pDur: 0.10, prInt: 0.19, qrsAmp: 1.0, qrsDur: 0.06, stElev: 0.05 + 0.15*i, stDur: 0.12, stSlope: 1, tAmp: 0.22 + 0.18*i, tDur: 0.19, tShape: 1, jNotch: 0.05 + 0.12*i, uAmp: 0, uDur: 0.10 })
  },
  st: {
    stages: [
      { name: 'Mild Tachy', range: [0, 25], desc: 'Slight rate increase (100-120 bpm). P waves more prominent from sympathetic tone.' },
      { name: 'Moderate Tachy', range: [25, 55], desc: 'HR 120-160 bpm. PR shortens, T flattens. P may merge with preceding T at high rates.' },
      { name: 'Severe Tachy', range: [55, 100], desc: 'HR >160 bpm. Short diastole, P-T fusion, decreased filling time, risk of ischemia.' }
    ],
    defaultIntensity: 0.4,
    hrMod: (i) => 100 + 120 * i,
    params: (i) => ({ pAmp: 0.12 + 0.06*i, pDur: 0.09, prInt: 0.19 - 0.04*i, qrsAmp: 1.0, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.22 - 0.08*i, tDur: 0.17 - 0.05*i, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  sb: {
    stages: [
      { name: 'Mild Brady', range: [0, 25], desc: 'HR 50-60 bpm. Slight P prominence, normal PR, increased vagal tone.' },
      { name: 'Moderate Brady', range: [25, 55], desc: 'HR 40-50 bpm. Prolonged PR, prominent P and T waves from enhanced diastolic filling.' },
      { name: 'Severe Brady', range: [55, 100], desc: 'HR <40 bpm. Very prolonged PR, tall T waves, risk of escape rhythms and hypotension.' }
    ],
    defaultIntensity: 0.4,
    hrMod: (i) => 60 - 20 * i,
    params: (i) => ({ pAmp: 0.12 + 0.04*i, pDur: 0.096 + 0.02*i, prInt: 0.19 + 0.02*i, qrsAmp: 1.0, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.22 + 0.08*i, tDur: 0.24, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  afib: {
    stages: [
      { name: 'Fine Fibrillation', range: [0, 25], desc: 'Subtle fibrillatory baseline, irregular R-R intervals, no P waves. Controlled rate.' },
      { name: 'Coarse Fibrillation', range: [25, 55], desc: 'More chaotic fibrillatory waves, irregular ventricular response, T wave flattening.' },
      { name: 'Uncontrolled AFib', range: [55, 100], desc: 'Large chaotic baseline, highly irregular R-R, risk of thromboembolism and hemodynamic compromise.' }
    ],
    defaultIntensity: 0.4,
    hrMod: (i) => 80 + 40 * i,
    params: (i) => ({ pAmp: 0, pDur: 0, prInt: 0, qrsAmp: 0.9, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.22 - 0.08*i, tDur: 0.19, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  aflutter: {
    stages: [
      { name: 'Typical Flutter', range: [0, 25], desc: 'Sawtooth flutter waves ~300/min, regular ventricular response (2:1 or 3:1 block).' },
      { name: 'Variable Block', range: [25, 55], desc: 'More prominent flutter waves, variable AV block, irregular ventricular response.' },
      { name: 'High-Grade Block', range: [55, 100], desc: 'Very large flutter waves, high-degree AV block, slow ventricular response, hemodynamic risk.' }
    ],
    defaultIntensity: 0.4,
    hrMod: (i) => 75 + 20 * i,
    params: (i) => ({ pAmp: 0, pDur: 0, prInt: 0, qrsAmp: 0.85, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.13 - 0.05*i, tDur: 0.19, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  svt: {
    stages: [
      { name: 'SVT Onset', range: [0, 25], desc: 'Narrow QRS tachycardia ~160 bpm, retrograde P may be hidden in QRS.' },
      { name: 'Sustained SVT', range: [25, 55], desc: 'Rate >180 bpm, retrograde P visible after QRS, shortened RP interval, T wave changes.' },
      { name: 'SVT with Compromise', range: [55, 100], desc: 'Rate >200 bpm, hemodynamic instability, decreased coronary perfusion, risk of ischemia.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 150 + 60 * i,
    params: (i) => ({ pAmp: -0.06*i, pDur: 0.04, prInt: 0.06, qrsAmp: 0.85, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.15 - 0.06*i, tDur: 0.14, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  avb1: {
    stages: [
      { name: 'Borderline PR', range: [0, 25], desc: 'PR 200-240ms, just above normal limit (200ms). Constant PR, 1:1 conduction, every P followed by QRS. Usually benign.' },
      { name: 'Prolonged PR', range: [25, 55], desc: 'PR 240-320ms. Constant but markedly prolonged PR interval. 1:1 conduction maintained. May progress to higher-degree block.' },
      { name: 'Extreme 1st Degree', range: [55, 100], desc: 'PR >320ms. Severe constant PR prolongation, pseudo-pacemaker syndrome from AV dyssynchrony. Risk of progression to 2nd degree block.' }
    ],
    defaultIntensity: 0.4,
    hrMod: (i) => 65 - 10 * i,
    params: (i) => ({ pAmp: 0.12, pDur: 0.10, prInt: 0.20 + 0.20*i, qrsAmp: 1.0, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.22, tDur: 0.19, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  avb2mob1: {
    stages: [
      { name: 'Mild Wenckebach', range: [0, 25], desc: '5:4 conduction. Progressive PR prolongation with decreasing increments → 1 dropped QRS per cycle. R-R intervals shorten before the pause. Classic group beating.' },
      { name: 'Moderate Wenckebach', range: [25, 55], desc: '4:3 conduction. Shorter Wenckebach cycles, more frequent dropped beats. PR prolongation more pronounced, R-R shortening clearly visible. AV nodal block (narrow QRS).' },
      { name: 'Severe Wenckebach', range: [55, 100], desc: '3:2 conduction. Every 3rd beat dropped, near-transition to higher-degree block.' }
    ],
    defaultIntensity: 0.4,
    hrMod: (i) => 68 - 12 * i,
    params: (i) => ({ pAmp: 0.12, pDur: 0.10, prInt: 0.20 + 0.15*i, qrsAmp: 1.0, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.22, tDur: 0.19, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  avb2mob2: {
    stages: [
      { name: 'Infrequent Drops', range: [0, 25], desc: 'Constant PR interval with sudden dropped QRS every 4th-5th beat. Wide QRS (infranodal block with BBB). No PR prolongation before drops.' },
      { name: 'Frequent Drops', range: [25, 55], desc: 'More frequent dropped beats (every 3rd). Constant PR, wide QRS. Infranodal site makes atropine ineffective. High risk of progression to complete heart block.' },
      { name: '2:1 Block', range: [55, 100], desc: '2:1 conduction — every other P wave blocked. Wide QRS suggests infranodal (Mobitz II). Pacemaker mandatory.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 60 - 15 * i,
    params: (i) => ({ pAmp: 0.12, pDur: 0.10, prInt: 0.19 + 0.04*i, qrsAmp: 0.9 - 0.15*i, qrsDur: 0.06 + 0.04*i, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.20 - 0.05*i, tDur: 0.19, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  avb3: {
    stages: [
      { name: 'Junctional Escape', range: [0, 25], desc: 'Complete AV dissociation. P waves and QRS independent, P waves march through QRS. Junctional escape 40-60 bpm, narrow QRS. Atrial rate > ventricular rate.' },
      { name: 'Slow Junctional/ Ventricular', range: [25, 55], desc: 'Slower escape 30-40 bpm, QRS widening. AV dissociation clearly visible — P-P and R-R regular but unrelated.' },
      { name: 'Idioventricular/Asystole Risk', range: [55, 100], desc: 'Very slow idioventricular escape <30 bpm, wide bizarre QRS, low amplitude. Unstable rhythm, imminent asystole.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 50 - 25 * i,
    params: (i) => ({ pAmp: 0.12 + 0.04*i, pDur: 0.10, prInt: 0, qrsAmp: 0.8 - 0.3*i, qrsDur: 0.12 + 0.08*i, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.15*i, tDur: 0.20, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  vtach: {
    stages: [
      { name: 'Monomorphic VT', range: [0, 25], desc: 'Regular wide QRS tachycardia ~160 bpm, uniform morphology, AV dissociation.' },
      { name: 'Polymorphic VT', range: [25, 55], desc: 'Varying QRS morphology, rate increasing, hemodynamic instability developing.' },
      { name: 'VT Degenerating', range: [55, 100], desc: 'Very rapid polymorphic VT, pulseless likely, imminent degeneration to VFib.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 140 + 60 * i,
    params: (i) => ({ pAmp: 0, pDur: 0, prInt: 0, qrsAmp: 0.5 + 0.7*i, qrsDur: 0.08 + 0.12*i, stElev: 0, stDur: 0, stSlope: 0, tAmp: -0.3 - 0.3*i, tDur: 0.20, tShape: 2, jNotch: 0, uAmp: 0, uDur: 0 })
  },
  vfib: {
    stages: [
      { name: 'Coarse VFib', range: [0, 25], desc: 'High-amplitude chaotic waveform, potentially shockable, best chance of defibrillation success.' },
      { name: 'Intermediate VFib', range: [25, 55], desc: 'Decreasing amplitude, irregular chaotic rhythm, diminishing defibrillation success.' },
      { name: 'Fine VFib / Near Asystole', range: [55, 100], desc: 'Low-amplitude fine fibrillation can be difficult to distinguish from asystole.' }
    ],
    defaultIntensity: 0.3,
    hrMod: () => 0,
    params: (i) => ({ pAmp: 0, pDur: 0, prInt: 0, qrsAmp: 0.5 - 0.35*i, qrsDur: 0, stElev: 0, stDur: 0, stSlope: 0, tAmp: 0, tDur: 0, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0 })
  },
  pvc: {
    stages: [
      { name: 'Occasional PVC', range: [0, 25], desc: 'Trigeminy pattern (every 3rd beat). Wide bizarre QRS ≥120ms, no preceding P wave, full compensatory pause, discordant ST-T.' },
      { name: 'Frequent PVCs', range: [25, 55], desc: 'Wider QRS (>140ms), taller amplitude, deeper discordant T wave. More pronounced compensatory pause. May show multiform morphology.' },
      { name: 'R-on-T PVC', range: [55, 100], desc: 'Very wide QRS (>160ms) landing on T wave of preceding beat, R-on-T phenomenon.' }
    ],
    defaultIntensity: 0.4,
    hrMod: () => 75,
    params: (i) => ({ pAmp: 0.12, pDur: 0.10, prInt: 0.19, qrsAmp: 0.7 + 0.8*i, qrsDur: 0.12 + 0.08*i, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: -0.3 - 0.3*i, tDur: 0.24 + 0.08*i, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  lbbb: {
    stages: [
      { name: 'Incomplete LBBB', range: [0, 25], desc: 'QRS slightly widened (100-120ms), subtle M-pattern in lateral leads, small notch.' },
      { name: 'Complete LBBB', range: [25, 55], desc: 'QRS >120ms, broad notched R in I/V5/V6, deep S in V1, no septal Q waves.' },
      { name: 'Severe LBBB', range: [55, 100], desc: 'Very wide QRS >180ms, pronounced M-pattern, marked ST-T discordance, significant conduction delay.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 78 - 10 * i,
    params: (i) => ({ pAmp: 0.08, pDur: 0.10, prInt: 0.19, qrsAmp: 1.0, qrsDur: 0.10 + 0.10*i, stElev: 0, stDur: 0.14, stSlope: 0, tAmp: -0.22 - 0.10*i, tDur: 0.20, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  rbbb: {
    stages: [
      { name: 'Incomplete RBBB', range: [0, 25], desc: 'rsR\' pattern in V1, QRS 100-120ms, small r\' wave, mild terminal delay.' },
      { name: 'Complete RBBB', range: [25, 55], desc: 'Prominent R\' in V1 ("rabbit ears"), QRS >120ms, wide S in I/V6, terminal R in aVR.' },
      { name: 'Severe RBBB', range: [55, 100], desc: 'Very wide QRS, dominant R\' in V1, deep slurred S in lateral leads, severe conduction delay.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 76 - 8 * i,
    params: (i) => ({ pAmp: 0.08, pDur: 0.10, prInt: 0.19, qrsAmp: 1.0, qrsDur: 0.10 + 0.06*i, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.18 - 0.06*i, tDur: 0.18, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  wpw: {
    stages: [
      { name: 'Minimal Pre-excitation', range: [0, 25], desc: 'Subtle delta wave, PR near normal, minimal QRS widening, intermittent pattern.' },
      { name: 'Manifest WPW', range: [25, 55], desc: 'Short PR <120ms, prominent delta wave slurring QRS upstroke, widened QRS >100ms.' },
      { name: 'Marked Pre-excitation', range: [55, 100], desc: 'Very short PR, large delta wave, wide QRS >140ms, ST-T discordance, SVT risk.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 80 + 20 * i,
    params: (i) => ({ pAmp: 0.12, pDur: 0.09, prInt: 0.12 - 0.04*i, qrsAmp: 1.0, qrsDur: 0.06 + 0.08*i, stElev: 0, stDur: 0.10, stSlope: 0, tAmp: -0.20*i, tDur: 0.18, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  longqt: {
    stages: [
      { name: 'Borderline QTc', range: [0, 25], desc: 'QTc 450-480ms, subtle T wave notching, minimal U wave, low arrhythmia risk.' },
      { name: 'Prolonged QTc', range: [25, 55], desc: 'QTc 480-520ms, bifid T wave, prominent U wave, notched T, moderate TdP risk.' },
      { name: 'Markedly Prolonged QTc', range: [55, 100], desc: 'QTc >520ms, biphasic T, T-U fusion, very high TdP risk, life-threatening.' }
    ],
    defaultIntensity: 0.5,
    hrMod: () => 72,
    params: (i) => ({ pAmp: 0.12, pDur: 0.10, prInt: 0.19, qrsAmp: 1.0, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0.22, tDur: 0.19 + 0.20*i, tShape: i > 0.6 ? 2 : 1, jNotch: 0, uAmp: 0.06*Math.min(1, i*2), uDur: 0.12 })
  },
  brugada: {
    stages: [
      { name: 'Type 3 / Nondiagnostic', range: [0, 30], desc: 'Saddle-back or coved-appearing right precordial ST elevation below diagnostic thresholds.' },
      { name: 'Type 2 Saddleback', range: [30, 60], desc: 'Saddleback Brugada pattern in V1-V2. Suspicious pattern.' },
      { name: 'Type 1 Coved', range: [60, 100], desc: 'Coved ST elevation >=2mm in V1-V2/V3 with descending ST segment and negative T wave; diagnostic.' }
    ],
    defaultIntensity: 0.6,
    hrMod: (i) => 70 - 5 * i,
    params: (i) => ({ pAmp: 0.08, pDur: 0.10, prInt: 0.19, qrsAmp: 1.0, qrsDur: 0.06, stElev: 0.15 + 0.55*i, stDur: 0.14, stSlope: 2, tAmp: i > 0.5 ? -0.15*i : 0.15*(1-i), tDur: 0.17, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  hyperk: {
    stages: [
      { name: 'Early ECG Change', range: [0, 25], desc: 'Tall, narrow, symmetric peaked T waves with shortened repolarization.' },
      { name: 'Conduction Delay', range: [25, 50], desc: 'P wave flattening, PR prolongation, ST depression, and early QRS widening.' },
      { name: 'Severe Hyperkalemia Pattern', range: [50, 75], desc: 'Loss of visible P waves with marked QRS widening and QRS-T merging.' },
      { name: 'Sine Wave / Arrest Risk', range: [75, 100], desc: 'Sine-wave morphology with risk of ventricular fibrillation or asystole.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 68 - 25 * i,
    params: (i) => {
      const pAmp = 0.12 * Math.max(0, 1 - i * 2.2);
      const qrsW = 0.06 + 0.20 * Math.min(1, i * 1.8);
      const tAmp = 0.22 + 0.55 * Math.min(1, i * 3);
      const tNarrow = Math.max(0.06, 0.19 - 0.13 * Math.min(1, i * 2.5));
      return { pAmp, pDur: 0.096 + 0.04*Math.min(1,i*2), prInt: 0.192 + 0.12*Math.min(1,i*2.5), qrsAmp: 1.0 - 0.3*Math.min(1,i*2), qrsDur: qrsW, stElev: -0.04*Math.min(1,i*2), stDur: 0.06, stSlope: 0, tAmp, tDur: tNarrow, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 };
    }
  },
  hypokalemia: {
    stages: [
      { name: 'K+ 3.0-3.5', range: [0, 25], desc: 'T wave flattening with a small U wave, a common early ECG pattern.' },
      { name: 'K+ 2.5-3.0', range: [25, 55], desc: 'Prominent U wave, ST depression, T-U fusion beginning, P wave increases.' },
      { name: 'K+ <2.5', range: [55, 100], desc: 'T-U merge into single broad wave, QRS widening, prominent P, ventricular ectopy risk.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 85 + 10 * i,
    params: (i) => {
      const tAmp = 0.22 * Math.max(0, 1 - i * 1.8);
      const uAmp = 0.04 + 0.32 * i;
      return { pAmp: 0.12 + 0.10*i, pDur: 0.096 + 0.02*i, prInt: 0.19, qrsAmp: 0.92, qrsDur: 0.060 + 0.040*Math.max(0, (i-0.6)/0.4), stElev: -0.06*Math.min(1,i*2), stDur: 0.12, stSlope: 0, tAmp, tDur: 0.15, tShape: 1, jNotch: 0, uAmp, uDur: 0.12 + 0.10*i };
    }
  },
  hypothermia: {
    stages: [
      { name: '35°C Mild', range: [0, 25], desc: 'Bradycardia, small J-wave (Osborn wave) appears at QRS-ST junction.' },
      { name: '32°C Moderate', range: [25, 50], desc: 'Growing Osborn waves, PR/QRS/QT all prolonged, shivering artifact possible.' },
      { name: '30°C Severe', range: [50, 75], desc: 'Large Osborn waves, marked interval prolongation, atrial arrhythmias common.' },
      { name: '<28°C Critical', range: [75, 100], desc: 'Giant J-waves, severe bradycardia, VFib risk extremely high, life-threatening.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 50 - 30 * i,
    params: (i) => {
      const jAmp = 0.08 + 0.55 * i;
      return { pAmp: 0.12 - 0.04*i, pDur: 0.096 + 0.04*i, prInt: 0.19 + 0.05*i, qrsAmp: 1.0, qrsDur: 0.06 + 0.04*i, stElev: 0.05*i, stDur: 0.10 + 0.15*i*0.3, stSlope: 0, tAmp: 0.22 - 0.30*i, tDur: 0.19 + 0.15*i, tShape: 1, jNotch: jAmp, uAmp: 0, uDur: 0.10 };
    }
  },
  stemi_ant: {
    stages: [
      { name: 'Hyperacute T (V1-V4)', range: [0, 25], desc: 'Very tall peaked T waves in V1-V4, earliest sign of LAD occlusion.' },
      { name: 'ST Elevation (Anterior)', range: [25, 50], desc: 'Progressive ST elevation V1-V4 with convex morphology, loss of R wave.' },
      { name: 'Tombstone ST (Anterior)', range: [50, 75], desc: 'Tombstone/convex ST elevation V1-V4, Q waves forming. High-risk anterior MI.' },
      { name: 'Evolved Anterior MI', range: [75, 100], desc: 'Q waves established in V1-V4, ST resolving, T wave inversion (evolving MI).' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 88 + 15 * i,
    culpritLeads: ['V1','V2','V3','V4'],
    reciprocalLeads: ['II','III','aVF'],
    params: (i) => {
      const stElev = 0.12 + 0.48 * i;
      const tHyper = Math.max(0, 1 - i * 1.8) * 0.35;
      return { pAmp: 0.10 * Math.max(0.92, 1 - 0.08 * i), pDur: 0.096, prInt: 0.19, qrsAmp: 0.8, qrsDur: 0.06, stElev, stDur: 0.19, stSlope: i > 0.65 ? 2 : (i > 0.35 ? 0 : 1), tAmp: tHyper - 0.20 * Math.max(0, (i-0.5)/0.5), tDur: 0.18, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 };
    }
  },
  stemi_inf: {
    stages: [
      { name: 'Hyperacute T (II,III,aVF)', range: [0, 25], desc: 'Tall peaked T waves in inferior leads (II, III, aVF), earliest RCA occlusion sign.' },
      { name: 'ST Elevation (Inferior)', range: [25, 50], desc: 'Progressive ST elevation in II, III, aVF with convex morphology. Reciprocal ST depression in I, aVL.' },
      { name: 'Tombstone ST (Inferior)', range: [50, 75], desc: 'Marked ST elevation II, III, aVF, Q waves forming inferiorly. Prominent reciprocal depression.' },
      { name: 'Evolved Inferior MI', range: [75, 100], desc: 'Pathologic Q waves in II, III, aVF, ST resolving, T inverting inferiorly.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 72 - 8 * i,
    culpritLeads: ['II','III','aVF'],
    reciprocalLeads: ['I','aVL'],
    params: (i) => {
      const stElev = 0.12 + 0.42 * i;
      const tHyper = Math.max(0, 1 - i * 1.8) * 0.35;
      return { pAmp: 0.10 * Math.max(0.92, 1 - 0.08 * i), pDur: 0.096, prInt: 0.19, qrsAmp: 0.75, qrsDur: 0.06, stElev, stDur: 0.19, stSlope: i > 0.65 ? 2 : (i > 0.35 ? 0 : 1), tAmp: tHyper - 0.20 * Math.max(0, (i-0.5)/0.5), tDur: 0.18, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 };
    }
  },
  stemi_lat: {
    stages: [
      { name: 'Hyperacute T (I,aVL,V5,V6)', range: [0, 25], desc: 'Tall peaked T waves in lateral leads (I, aVL, V5, V6), earliest LCx occlusion sign.' },
      { name: 'ST Elevation (Lateral)', range: [25, 50], desc: 'Progressive ST elevation I, aVL, V5, V6.' },
      { name: 'Tombstone ST (Lateral)', range: [50, 75], desc: 'Marked ST elevation lateral leads, Q waves forming.' },
      { name: 'Evolved Lateral MI', range: [75, 100], desc: 'Pathologic Q waves I, aVL, V5-V6, ST resolving, T wave inversion laterally.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 90 + 12 * i,
    culpritLeads: ['I','aVL','V5','V6'],
    reciprocalLeads: ['V1','V2','V3'],
    params: (i) => {
      const stElev = 0.10 + 0.40 * i;
      const tHyper = Math.max(0, 1 - i * 1.8) * 0.35;
      return { pAmp: 0.10 * Math.max(0.92, 1 - 0.08 * i), pDur: 0.096, prInt: 0.19, qrsAmp: 0.75, qrsDur: 0.06, stElev, stDur: 0.19, stSlope: i > 0.65 ? 2 : (i > 0.35 ? 0 : 1), tAmp: tHyper - 0.20 * Math.max(0, (i-0.5)/0.5), tDur: 0.18, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 };
    }
  },
  stemi_antlat: {
    stages: [
      { name: 'Hyperacute T (V1-V6,I,aVL)', range: [0, 25], desc: 'Very tall peaked T waves across anterior and lateral leads. Proximal LAD occlusion.' },
      { name: 'ST Elevation (Anterolateral)', range: [25, 50], desc: 'Progressive ST elevation V1-V6, I, aVL. Reciprocal ST depression II, III, aVF.' },
      { name: 'Tombstone ST (Anterolateral)', range: [50, 75], desc: 'Massive ST elevation V1-V6, I, aVL. Poor R wave progression, Q waves forming.' },
      { name: 'Evolved Anterolateral MI', range: [75, 100], desc: 'Extensive Q waves V1-V6, I, aVL. ST resolving, T inverting.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 92 + 18 * i,
    culpritLeads: ['V1','V2','V3','V4','V5','V6','I','aVL'],
    reciprocalLeads: ['II','III','aVF'],
    params: (i) => {
      const stElev = 0.14 + 0.52 * i;
      const tHyper = Math.max(0, 1 - i * 1.8) * 0.40;
      return { pAmp: 0.10 * Math.max(0.90, 1 - 0.10 * i), pDur: 0.096, prInt: 0.19, qrsAmp: 0.8, qrsDur: 0.06, stElev, stDur: 0.19, stSlope: i > 0.65 ? 2 : (i > 0.35 ? 0 : 1), tAmp: tHyper - 0.22 * Math.max(0, (i-0.5)/0.5), tDur: 0.18, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 };
    }
  },
  stemi_inflat: {
    stages: [
      { name: 'Hyperacute T (Inf+Lat)', range: [0, 25], desc: 'Tall peaked T waves in II, III, aVF and V5, V6. RCA or LCx occlusion.' },
      { name: 'ST Elevation (Inferolateral)', range: [25, 50], desc: 'Progressive ST elevation II, III, aVF, V5, V6. Reciprocal ST depression I, aVL, V1-V2.' },
      { name: 'Tombstone ST (Inferolateral)', range: [50, 75], desc: 'Marked ST elevation inferior and lateral leads, Q waves forming.' },
      { name: 'Evolved Inferolateral MI', range: [75, 100], desc: 'Q waves II, III, aVF, V5-V6, ST resolving, T inverting.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 70 - 5 * i,
    culpritLeads: ['II','III','aVF','V5','V6'],
    reciprocalLeads: ['I','aVL','V1','V2'],
    params: (i) => {
      const stElev = 0.12 + 0.44 * i;
      const tHyper = Math.max(0, 1 - i * 1.8) * 0.35;
      return { pAmp: 0.10 * Math.max(0.92, 1 - 0.08 * i), pDur: 0.096, prInt: 0.19, qrsAmp: 0.75, qrsDur: 0.06, stElev, stDur: 0.19, stSlope: i > 0.65 ? 2 : (i > 0.35 ? 0 : 1), tAmp: tHyper - 0.20 * Math.max(0, (i-0.5)/0.5), tDur: 0.18, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 };
    }
  },
  stemi_rv: {
    stages: [
      { name: 'Hyperacute T (V1,V4R)', range: [0, 25], desc: 'Tall peaked T waves in V1 and right-sided leads (V4R). RCA proximal occlusion.' },
      { name: 'ST Elevation (RV)', range: [25, 50], desc: 'ST elevation in V4R is most supportive; V1 elevation can raise suspicion.' },
      { name: 'Tombstone ST (RV)', range: [50, 75], desc: 'Marked ST elevation V1, V4R pattern. Right ventricular dilation, possible cardiogenic shock.' },
      { name: 'Evolved RV MI', range: [75, 100], desc: 'ST resolution in V1, Q waves in right-sided leads.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 68 - 5 * i,
    culpritLeads: ['V1'],
    reciprocalLeads: ['I','aVL','V5','V6'],
    params: (i) => {
      const stElev = 0.10 + 0.38 * i;
      const tHyper = Math.max(0, 1 - i * 1.8) * 0.30;
      return { pAmp: 0.10 * Math.max(0.92, 1 - 0.08 * i), pDur: 0.096, prInt: 0.19, qrsAmp: 0.70, qrsDur: 0.06, stElev, stDur: 0.19, stSlope: i > 0.65 ? 2 : (i > 0.35 ? 0 : 1), tAmp: tHyper - 0.18 * Math.max(0, (i-0.5)/0.5), tDur: 0.18, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 };
    }
  },
  pwmi: {
    stages: [
      { name: 'Early Reciprocal', range: [0, 25], desc: 'Subtle ST depression in V1-V3, slight R wave prominence.' },
      { name: 'Established', range: [25, 55], desc: 'Horizontal ST depression V1-V3, tall R wave, tall upright T.' },
      { name: 'Severe Posterior', range: [55, 100], desc: 'Deep ST depression, very tall R in V1-V2, prominent upright T.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 82 + 10 * i,
    params: (i) => ({ pAmp: 0.10, pDur: 0.096, prInt: 0.19, qrsAmp: 0.55 + 0.45*i, qrsDur: 0.072, stElev: -0.15 - 0.25*i, stDur: 0.19, stSlope: -1, tAmp: 0.18 + 0.22*i, tDur: 0.20, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  pericarditis: {
    stages: [
      { name: 'Stage I Early', range: [0, 30], desc: 'Diffuse concave (saddle-shaped) ST elevation with PR depression.' },
      { name: 'Stage II Evolving', range: [30, 60], desc: 'ST elevation resolving, PR depression persisting in most leads, T wave flattening.' },
      { name: 'Stage III Late', range: [60, 100], desc: 'T wave inversion develops, ST normalisation, PR depression may normalise.' }
    ],
    defaultIntensity: 0.4,
    hrMod: (i) => 90 + 10 * i,
    params: (i) => {
      const tInvert = Math.max(0, (i - 0.65) / 0.35);
      return { pAmp: 0.12, pDur: 0.096, prInt: 0.19, qrsAmp: 1.0, qrsDur: 0.06, stElev: 0.10 + 0.20*i, stDur: 0.26, stSlope: 1, tAmp: 0.18 - 0.36*tInvert, tDur: 0.20, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 };
    }
  },
  digoxin: {
    stages: [
      { name: 'Digoxin Effect', range: [0, 25], desc: 'Characteristic sagging ST depression ("reverse tick") with possible mild PR prolongation.' },
      { name: 'Marked Digoxin Effect', range: [25, 55], desc: 'More pronounced scooped ST depression, flattened T waves.' },
      { name: 'Possible Toxicity Pattern', range: [55, 100], desc: 'Severe scooped ST depression with arrhythmia risk.' }
    ],
    defaultIntensity: 0.4,
    hrMod: (i) => 70 - 10 * i,
    params: (i) => ({ pAmp: 0.12, pDur: 0.096, prInt: 0.19 + 0.03*i, qrsAmp: 1.0, qrsDur: 0.06, stElev: -(0.12 + 0.18*i), stDur: 0.16, stSlope: -1, tAmp: 0.08 - 0.06*i, tDur: 0.12, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  pea: {
    stages: [
      { name: 'Organized Electrical Activity', range: [0, 30], desc: 'Organized QRS complexes are visible; PEA is a clinical diagnosis.' },
      { name: 'Low-Output PEA Pattern', range: [30, 60], desc: 'Slower, lower-amplitude organized electrical activity; correlate with pulse check.' },
      { name: 'Pre-Asystole Pattern', range: [60, 100], desc: 'Minimal organized electrical activity with very low amplitude, approaching asystole.' }
    ],
    defaultIntensity: 0.5,
    hrMod: (i) => 40 - 30 * i,
    params: (i) => ({ pAmp: 0, pDur: 0, prInt: 0, qrsAmp: 0.4 - 0.35*i, qrsDur: 0.06, stElev: 0, stDur: 0.12, stSlope: 0, tAmp: 0, tDur: 0.19, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0.10 })
  },
  asystole: {
    stages: [
      { name: 'Near-Flatline', range: [0, 40], desc: 'Minimal residual artifact, essentially flatline.' },
      { name: 'Flatline', range: [40, 100], desc: 'Complete absence of electrical activity. Confirm with 2 leads. Begin CPR immediately.' }
    ],
    defaultIntensity: 0.8,
    hrMod: () => 0,
    params: (i) => ({ pAmp: 0, pDur: 0, prInt: 0, qrsAmp: 0, qrsDur: 0, stElev: 0, stDur: 0, stSlope: 0, tAmp: 0, tDur: 0, tShape: 1, jNotch: 0, uAmp: 0, uDur: 0 })
  }
};

export const rhythmRates: Record<string, number> = {
  nsr:72, st:130, sb:45, afib:95, aflutter:85, svt:180,
  vtach:160, vfib:0, pea:40, asystole:0, pvc:75,
  lbbb:78, rbbb:76, stemi_ant:88, stemi_inf:85, stemi_lat:90, stemi_antlat:92, stemi_inflat:82, stemi_rv:78, pwmi:82, hyperk:68,
  lvh:72, rvh:72, bve:72, lah:72, rah:72,
  wpw:80, longqt:72, pericarditis:90, hypokalemia:85,
  digoxin:70, earlyrepo:65, avb1:65, avb2mob1:68, avb2mob2:60, avb3:40,
  brugada:70, hypothermia:45,
  wellens:65, dewinter:95, pe:115, lafb:72, lpfb:72,
};

export const LAYOUT_12 = [
  ['I',   'aVR', 'V1', 'V4'],
  ['II',  'aVL', 'V2', 'V5'],
  ['III', 'aVF', 'V3', 'V6'],
];
export const RHYTHM_LEAD = 'II';
export const LEADS = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6'];
export const BEAT_AWARE_RHYTHMS = new Set(['afib', 'pvc', 'avb2mob1', 'avb2mob2', 'avb3']);
export const LEAD_AWARE_RHYTHMS = new Set(['lbbb', 'rbbb', 'brugada', 'pwmi', 'pericarditis', 'lvh', 'rvh', 'bve', 'lah', 'rah']);

export const DEPENDENT_LEADS: Record<string, (I: number, II: number) => number> = {
  'III': (I, II) => II - I,
  'aVR': (I, II) => -0.5 * (I + II),
  'aVL': (I, II) => I - 0.5 * II,
  'aVF': (I, II) => II - 0.5 * I
};

export const NK_GAMMA: Record<string, number[]> = {
  //                    P      Q      R      S      T
  'I':   [ 1.00,  0.40,  1.00,  0.20,  1.00],
  'II':  [ 1.10,  0.20,  1.30,  0.10,  1.20],
  'V1':  [ 0.60,  0.00,  0.15,  1.50, -0.60],
  'V2':  [ 0.70,  0.00,  0.30,  2.00,  0.80],
  'V3':  [ 0.80,  0.30,  0.70,  1.50,  1.00],
  'V4':  [ 0.90,  0.50,  1.20,  0.50,  1.10],
  'V5':  [ 1.00,  0.60,  1.40,  0.20,  1.20],
  'V6':  [ 0.90,  0.50,  1.10,  0.10,  1.00],
};

export const LEAD_TARGET_AMPLITUDE: Record<string, number> = {
  'I':   1.10,
  'II':  1.60,
  'V1':  1.20,
  'V2':  1.80,
  'V3':  2.20,
  'V4':  2.00,
  'V5':  1.80,
  'V6':  1.30
};

export const BASELINE_TI = [-70, -15, 0, 15, 100];
export const BASELINE_AI = [0.15, -0.05, 1.0, -0.075, 0.4];
export const BASELINE_BI = [0.20, 0.1, 0.1, 0.1, 0.4];
export const WAVEFORM_LUT_SIZE = 4096;
export const ODE_DAMPING = 0.85;
