export interface RepresentativeRecord {
  ecg_id: number;
  superclass: string;
  label: string;
}

const REPRESENTATIVE_IDS: Record<string, RepresentativeRecord> = {
  nsr:         { ecg_id: 1,     superclass: "NORM", label: "Normal Sinus Rhythm" },
  st:          { ecg_id: 12767, superclass: "STTC", label: "Sinus Tachycardia" },
  afib:        { ecg_id: 351,   superclass: "CD",   label: "Atrial Fibrillation" },
  aflutter:    { ecg_id: 17,    superclass: "CD",   label: "Atrial Flutter" },
  svt:         { ecg_id: 1299,  superclass: "CD",   label: "PSVT" },
  avb1:        { ecg_id: 1135,  superclass: "CD",   label: "First-Degree AV Block" },
  avb2mob1:    { ecg_id: 14009, superclass: "CD",   label: "Mobitz I AV Block" },
  avb2mob2:    { ecg_id: 14009, superclass: "CD",   label: "Mobitz II AV Block" },
  avb3:        { ecg_id: 10505, superclass: "CD",   label: "Complete AV Block" },
  pvc:         { ecg_id: 4463,  superclass: "STTC", label: "PVC" },
  lbbb:        { ecg_id: 180,   superclass: "CD",   label: "LBBB" },
  rbbb:        { ecg_id: 195,   superclass: "CD",   label: "RBBB" },
  wpw:         { ecg_id: 461,   superclass: "CD",   label: "WPW Syndrome" },
  longqt:      { ecg_id: 320,   superclass: "STTC", label: "Long QT Syndrome" },
  hyperk:      { ecg_id: 3456,  superclass: "STTC", label: "Hyperkalemia" },
  hypokalemia: { ecg_id: 16101, superclass: "STTC", label: "Hypokalemia" },
  lvh:         { ecg_id: 30,    superclass: "HYP",  label: "Left Ventricular Hypertrophy" },
  rvh:         { ecg_id: 2417,  superclass: "HYP",  label: "Right Ventricular Hypertrophy" },
  lah:         { ecg_id: 3483,  superclass: "STTC", label: "Left Atrial Enlargement" },
  rah:         { ecg_id: 1228,  superclass: "STTC", label: "Right Atrial Enlargement" },
  lafb:        { ecg_id: 41,    superclass: "CD",   label: "Left Anterior Fascicular Block" },
  lpfb:        { ecg_id: 32,    superclass: "CD",   label: "Left Posterior Fascicular Block" },
  digoxin:     { ecg_id: 1065,  superclass: "STTC", label: "Digoxin Effect" },
  stemi_ant:   { ecg_id: 177,   superclass: "MI",   label: "Anterior STEMI" },
  stemi_inf:   { ecg_id: 139,   superclass: "MI",   label: "Inferior STEMI" },
  stemi_lat:   { ecg_id: 4712,  superclass: "MI",   label: "Lateral STEMI" },
  stemi_antlat:{ ecg_id: 2448,  superclass: "MI",   label: "Anterolateral STEMI" },
  stemi_inflat:{ ecg_id: 514,   superclass: "MI",   label: "Inferolateral STEMI" },
  pwmi:        { ecg_id: 7244,  superclass: "MI",   label: "Posterior Wall MI" },
};

export function getRepresentativeId(rhythmId: string): RepresentativeRecord | null {
  return REPRESENTATIVE_IDS[rhythmId] ?? null;
}
