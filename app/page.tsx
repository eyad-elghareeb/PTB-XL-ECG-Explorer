"use client";

import React, { useState, useEffect, useRef } from "react";
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
  LEAD_TARGET_AMPLITUDE
} from "../lib/ecg-rhythms";
import {
  getWaveformForBeatIndex,
  buildAllLeadLUTs,
  sampleLeadLUT,
  addTraceNoise
} from "../lib/ecg-math";

function getImpureTimestamp(): string {
  if (typeof window !== "undefined") {
    return String(Math.floor(window.performance.now() + Date.now()));
  }
  return "0";
}

function getRecordSignalForLead(signals: any, leadName: string, applyFilter: boolean = false): number[] | null {
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
  
  if (!targetArr) return null;
  
  if (applyFilter) {
    const out = new Array(targetArr.length);
    for (let i = 0; i < targetArr.length; i++) {
      if (i < 2 || i > targetArr.length - 3) {
        out[i] = targetArr[i]; // Preserve original boundary samples
      } else {
        // Savitzky-Golay 5-point quadratic smoothing
        out[i] = (-3 * targetArr[i - 2] + 12 * targetArr[i - 1] + 17 * targetArr[i] + 12 * targetArr[i + 1] - 3 * targetArr[i + 2]) / 35;
      }
    }
    return out;
  }
  return targetArr;
}

const SCP_DESCRIPTIONS: Record<string, string> = {
  NORM: "Normal ECG",
  AMI: "Anterior Myocardial Infarction",
  IPMI: "Inferoposterolateral Myocardial Infarction",
  ASMI: "Anterosubendocardial Myocardial Infarction",
  IMI: "Inferior Myocardial Infarction",
  LMI: "Lateral Myocardial Infarction",
  ALMI: "Anterolateral Myocardial Infarction",
  INJAS: "Injury Anteroseptal",
  ISC_: "Ischemia",
  ISCAN: "Ischemia Anterior",
  ISCI: "Ischemia Inferior",
  ISCL: "Ischemia Lateral",
  ISCAS: "Ischemia Anteroseptal",
  ISCALL: "Ischemia Anterolateral",
  IVCD: "Incomplete Ventricular Conduction Delay",
  LAFB: "Left Anterior Fascicular Block",
  LBBB: "Left Bundle Branch Block",
  RBBB: "Right Bundle Branch Block",
  IRBBB: "Incomplete Right Bundle Branch Block",
  "1AVB": "First-degree AV Block",
  CLBBB: "Complete Left Bundle Branch Block",
  CRBBB: "Complete Right Bundle Branch Block",
  PAC: "Premature Atrial Contraction",
  PVC: "Premature Ventricular Contraction",
  LVH: "Left Ventricular Hypertrophy",
  RVH: "Right Ventricular Hypertrophy",
  LAE: "Left Atrial Enlargement",
  RAE: "Right Atrial Enlargement",
  STTC: "ST/T Change",
  STTY: "ST-T nonspecific changes",
  STE_: "ST Elevation",
  STD_: "ST Depression",
  TAB_: "T wave abnormality",
  TINV: "T wave inversion",
  LVOLT: "Low Voltage",
  SVTAC: "Supraventricular Tachycardia",
  AFIB: "Atrial Fibrillation",
  AFLT: "Atrial Flutter",
  SARRH: "Sinus Arrhythmia",
  SBRAD: "Sinus Bradycardia",
  STACH: "Sinus Tachycardia"
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
  const signalArray = getRecordSignalForLead(signals, leadName, false);
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

export default function ECGSimulatorPage() {
  // ── Mode selection (clinical db vs mathematical simulator) ──
  const [mode, setMode] = useState<string>("database"); // "database" or "simulation"

  // ── Database pulling config ──
  const [pullMode, setPullMode] = useState<string>("metadata_only");
  const [pullCount, setPullCount] = useState<number>(21837);
  const [filterSignal, setFilterSignal] = useState<boolean>(false);

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<string>("db-explorer");
  const [diagSubTab, setDiagSubTab] = useState<"overview" | "peaks" | "length">("overview");

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
    filterSignal: false,
    timeElapsed: 0.0,
    // 12-lead scrolling offset for database mode
    scrollOffset: 0.0,
    activeTab: "db-explorer",
    diagSubTab: "overview",
    peaksAnalysis: null as any | null
  });

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
    stateRef.current.filterSignal = filterSignal;
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
    filterSignal,
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
        bg: "#FFE4B5",
        trace: "#111111",
        gridMinor: "rgba(255,140,0,0.25)",
        gridMajor: "rgba(255,100,0,0.50)",
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
            state.scrollOffset = (state.scrollOffset || 0) + dt;
            if (state.scrollOffset >= 10.0) state.scrollOffset -= 10.0;
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
          const dbSignalArray = getRecordSignalForLead(state.signals, state.currentLead, state.filterSignal);
          if (dbSignalArray) {
            ctx.beginPath();
            let first = true;
            const signalLen = dbSignalArray.length;
            const signalFreq = (signalLen - 1) / 10.0;
            const drawSteps = Math.max(Math.ceil(W), Math.ceil(displayDuration * signalFreq));
            
            let prevIdx = -1;
            for (let i = 0; i <= drawSteps; i++) {
              const norm = i / drawSteps;
              const px = norm * W;
              const t = norm * displayDuration;
              
              let signalT = t + (state.scrollOffset || 0);
              signalT = ((signalT % 10.0) + 10.0) % 10.0;
              const floatIdx = (signalT / 10.0) * (signalLen - 1);
              const idx0 = Math.floor(floatIdx);
              const idx1 = Math.min(signalLen - 1, idx0 + 1);
              const frac = floatIdx - idx0;
              const val0 = dbSignalArray[idx0];
              const val1 = dbSignalArray[idx1];
              let val = (val0 * (1 - frac) + val1 * frac) * state.amplitude;

              if (state.noise > 0) {
                val = addTraceNoise(val, px * 0.05, 0, state.noise, state.realistic, state.heartRate);
              }
              
              const yCoord = centerY - val * pixelsPerMv;
              if (first) {
                ctx.moveTo(px, yCoord);
                first = false;
              } else {
                if (prevIdx !== -1 && Math.abs(idx0 - prevIdx) > signalLen / 2) {
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
              
              ctx.save();
              analysis.peaksInfo.forEach((peak: any) => {
                let diffT = peak.time - scroll;
                diffT = ((diffT % 10.0) + 10.0) % 10.0;
                
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
              const currentSampleIdx = Math.floor(((state.scrollOffset || 0) / 10.0) * (signalLen - 1));
              const currentSampleVal = dbSignalArray[currentSampleIdx];
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
            // Advance scroll offset for continuous 12-lead scrolling
            // Real-world speed: scroll through the full 10s signal in 10 real seconds
            state.scrollOffset += dt * 1.0 * state.zoom;
            if (state.scrollOffset >= 10.0) {
              state.scrollOffset -= 10.0;
            }
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

              const leadSignal = getRecordSignalForLead(state.signals, lead, state.filterSignal);
              if (leadSignal) {
                ctx.beginPath();
                let first = true;
                const signalLen = leadSignal.length;
                const signalFreq = (signalLen - 1) / 10.0;
                const drawSteps = Math.max(Math.ceil(cellW), Math.ceil(cellDuration * signalFreq));
                
                let prevIdx = -1;
                for (let px = 0; px <= drawSteps; px++) {
                  const frac = px / drawSteps;
                  const t = (col + frac) * cellDuration;
                  // Apply scrollOffset and wrap around 10s signal duration
                  let signalT = t + state.scrollOffset;
                  signalT = ((signalT % 10.0) + 10.0) % 10.0;
                  const floatIdx = (signalT / 10.0) * (signalLen - 1);
                  const idx0 = Math.floor(floatIdx);
                  const idx1 = Math.min(signalLen - 1, idx0 + 1);
                  const fracIdx = floatIdx - idx0;
                  const val0 = leadSignal[idx0];
                  const val1 = leadSignal[idx1];
                  let val = (val0 * (1 - fracIdx) + val1 * fracIdx) * state.amplitude;

                  if (state.noise > 0) {
                    val = addTraceNoise(val, idx0 * 0.05, 0, state.noise, state.realistic, state.heartRate);
                  }

                  const xCoord = cx + (frac * cellW);
                  const yCoord = centerYLocal - val * pixelsPerMv;
                  if (first) {
                    ctx.moveTo(xCoord, yCoord);
                    first = false;
                  } else {
                    if (prevIdx !== -1 && Math.abs(idx0 - prevIdx) > signalLen / 2) {
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

          const iiSignal = getRecordSignalForLead(state.signals, "II", state.filterSignal);
          if (iiSignal) {
            ctx.beginPath();
            let firstR = true;
            const iiLen = iiSignal.length;
            const signalFreq = (iiLen - 1) / 10.0;
            const drawSteps = Math.max(Math.ceil(W), Math.ceil(totalDuration * signalFreq));
            let prevRIdx = -1;
            for (let i = 0; i <= drawSteps; i++) {
              const norm = i / drawSteps;
              const px = norm * W;
              // Time position along the visible strip
              const t = norm * totalDuration;
              // Apply scrollOffset to get position in the 10s signal
              let signalT = t + state.scrollOffset;
              signalT = ((signalT % 10.0) + 10.0) % 10.0;
              const floatIdx = (signalT / 10.0) * (iiLen - 1);
              const idx0 = Math.floor(floatIdx);
              const idx1 = Math.min(iiLen - 1, idx0 + 1);
              const fracR = floatIdx - idx0;
              const val0 = iiSignal[idx0];
              const val1 = iiSignal[idx1];
              let val = (val0 * (1 - fracR) + val1 * fracR) * state.amplitude;

              if (state.noise > 0) {
                val = addTraceNoise(val, px * 0.05, 0, state.noise, state.realistic, state.heartRate);
              }

              const yCoord = rhythmY - val * pixelsPerMv;
              if (firstR) {
                ctx.moveTo(px, yCoord);
                firstR = false;
              } else {
                if (prevRIdx !== -1 && Math.abs(idx0 - prevRIdx) > iiLen / 2) {
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
    showToastMsg(!stripMode ? "Orange Strip Layout Activated" : "Classic Medical Monitor Active");
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

          pdfCtx.fillStyle = "#FFF8EE";
          pdfCtx.fillRect(cx, cy, colW, rowH);

          // Grid lines drawing
          const minorStep = mm2px;
          const majorStep = mm2px * 5;

          pdfCtx.save();
          pdfCtx.beginPath();
          pdfCtx.rect(cx, cy, colW, rowH);
          pdfCtx.clip();

          pdfCtx.strokeStyle = "rgba(255,140,0,0.22)";
          pdfCtx.lineWidth = 0.6;
          pdfCtx.beginPath();
          for (let gx = cx; gx <= cx + colW; gx += minorStep) {
            pdfCtx.moveTo(gx, cy); pdfCtx.lineTo(gx, cy + rowH);
          }
          for (let gy = cy; gy <= cy + rowH; gy += minorStep) {
            pdfCtx.moveTo(cx, gy); pdfCtx.lineTo(cx + colW, gy);
          }
          pdfCtx.stroke();

          pdfCtx.strokeStyle = "rgba(255,100,0,0.42)";
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
          const leadSignalArray = mode === "database" ? getRecordSignalForLead(recordSignals, lead, filterSignal) : null;
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
      pdfCtx.fillStyle = "#FFF8EE";
      pdfCtx.fillRect(rsX, rsY, rsW, rhythmH);

      // Grid strip
      pdfCtx.save();
      pdfCtx.beginPath();
      pdfCtx.rect(rsX, rsY, rsW, rhythmH);
      pdfCtx.clip();

      const minorStep = mm2px;
      const majorStep = mm2px * 5;
      pdfCtx.strokeStyle = "rgba(255,140,0,0.22)";
      pdfCtx.lineWidth = 0.6;
      pdfCtx.beginPath();
      for (let gx = rsX; gx <= rsX + rsW; gx += minorStep) {
        pdfCtx.moveTo(gx, rsY); pdfCtx.lineTo(gx, rsY + rhythmH);
      }
      for (let gy = rsY; gy <= rsY + rhythmH; gy += minorStep) {
        pdfCtx.moveTo(rsX, gy); pdfCtx.lineTo(rsX + rsW, gy);
      }
      pdfCtx.stroke();

      pdfCtx.strokeStyle = "rgba(255,100,0,0.42)";
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
      const iiSignalArray = mode === "database" ? getRecordSignalForLead(recordSignals, "II", filterSignal) : null;
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

        pdfCtx.fillStyle = "#FFF8EE";
        pdfCtx.fillRect(marginL, sy, contentW, stripH);

        // draw grid
        pdfCtx.save();
        pdfCtx.beginPath();
        pdfCtx.rect(marginL, sy, contentW, stripH);
        pdfCtx.clip();

        const minorStep = mm2px;
        const majorStep = mm2px * 5;

        pdfCtx.strokeStyle = "rgba(255,140,0,0.22)";
        pdfCtx.lineWidth = 0.6;
        pdfCtx.beginPath();
        for (let gx = marginL; gx <= marginL + contentW; gx += minorStep) {
          pdfCtx.moveTo(gx, sy); pdfCtx.lineTo(gx, sy + stripH);
        }
        for (let gy = sy; gy <= sy + stripH; gy += minorStep) {
          pdfCtx.moveTo(marginL, gy); pdfCtx.lineTo(marginL + contentW, gy);
        }
        pdfCtx.stroke();

        pdfCtx.strokeStyle = "rgba(255,100,0,0.42)";
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
        const currentLeadSignalArray = mode === "database" ? getRecordSignalForLead(recordSignals, currentLead, filterSignal) : null;
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
        <Link href="/" className="hub-back-btn">
          <i className="fa-solid fa-arrow-left"></i>
          Back to Hub
        </Link>
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
            title="Orange millimetre paper theme Toggle"
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
                <button
                  className={`tab-btn ${activeTab === "db-leads" ? "active" : ""}`}
                  onClick={() => setActiveTab("db-leads")}
                >
                  Leads
                </button>
                <button
                  className={`tab-btn ${activeTab === "db-diagnostic" ? "active" : ""}`}
                  onClick={() => setActiveTab("db-diagnostic")}
                >
                  Diagnostics
                </button>
                <button
                  className={`tab-btn ${activeTab === "db-setup" ? "active" : ""}`}
                  onClick={() => setActiveTab("db-setup")}
                >
                  DB Setup
                </button>
              </>
            ) : (
              <>
                <button
                  className={`tab-btn ${activeTab === "rhythms" ? "active" : ""}`}
                  onClick={() => setActiveTab("rhythms")}
                >
                  Rhythms
                </button>
                <button
                  className={`tab-btn ${activeTab === "leads" ? "active" : ""}`}
                  onClick={() => setActiveTab("leads")}
                >
                  Leads
                </button>
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
                    <div className="manual-banner" style={{ display: "block" }}>
                      <div className="manual-banner-text">Database Explorer</div>
                      <div className="manual-banner-desc">Browse clinical PTB-XL+ records.</div>
                    </div>

                    <div className="param-grid pb-3 mb-3" style={{ marginBottom: "1.0rem", paddingBottom: "1.0rem" }}>
                      <div className="toggle-row">
                        <div>
                          <div className="tr-label">Sampling Frequency</div>
                          <div className="tr-desc">High resolution raw signal</div>
                        </div>
                        <div className="text-xs font-bold text-accent">500 Hz</div>
                      </div>

                      <div className="toggle-row">
                        <div>
                          <div className="tr-label">Smooth Filter</div>
                          <div className="tr-desc">Savitzky-Golay smoothing preserving peaks</div>
                        </div>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={filterSignal}
                            onChange={(e) => setFilterSignal(e.target.checked)}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                      </div>
                    </div>

                    {/* Search box controls */}
                    <div className="flex gap-2 mb-3">
                      <input
                        type="text"
                        className="flex-1 px-3 py-1.5 text-xs rounded border border-border bg-surface text-foreground placeholder-muted outline-none focus:border-accent"
                        placeholder="Search ID, NORM, MI, CD..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setDbOffset(0);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setDbOffset(0);
                            fetchRecords(searchQuery, superclassFilter, 0);
                          }
                        }}
                      />
                      <button
                        className="px-3 py-1.5 bg-accent text-accent-foreground text-xs font-semibold rounded hover:bg-opacity-90 transition-colors"
                        onClick={() => {
                          setDbOffset(0);
                          fetchRecords(searchQuery, superclassFilter, 0);
                        }}
                      >
                        <i className="fa-solid fa-magnifying-glass"></i>
                      </button>
                    </div>

                    {/* Loading indicator */}
                    {recordsLoading && (
                      <div className="py-8 flex flex-col items-center justify-center gap-2">
                        <div className="animate-spin text-accent text-lg"><i className="fa-solid fa-spinner"></i></div>
                        <span className="text-xs text-muted">Retrieving matching records...</span>
                      </div>
                    )}

                    {/* Records List - continuous scroll */}
                    <div className="flex flex-col gap-1.5 min-h-0 pr-1 overflow-y-auto flex-1" style={{ height: "100%", maxHeight: "calc(100vh - 350px)" }}
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
                        <div className="py-8 text-center text-xs text-muted">
                          No matching records found. Try "NORM" or "MI".
                        </div>
                      ) : (
                        dbRecords.map((record) => {
                          const isSelected = selectedRecord?.ecg_id === record.ecg_id;
                          const isNorm = record.superclass === "NORM";
                          return (
                            <div
                              key={record.ecg_id}
                              className={`rhythm-card ${isSelected ? "selected" : ""}`}
                              onClick={() => selectRecordItem(record)}
                              style={{ padding: "10px 12px", minHeight: "82px", borderLeft: isSelected ? `3px solid ${isNorm ? "var(--correct)" : "var(--wrong)"}` : "3px solid transparent", transition: "all 0.15s ease", cursor: "pointer" }}
                            >
                              <div className="flex items-start justify-between w-full" style={{ marginBottom: "6px" }}>
                                <div className="flex items-center gap-2">
                                  <div className="rc-icon" style={{ width: "22px", textAlign: "center" }}>
                                    <i className={`fa-solid ${isNorm ? "fa-heart-circle-check" : "fa-heart-circle-exclamation"}`} style={{ color: isNorm ? "var(--correct)" : "var(--wrong)", fontSize: "14px" }}></i>
                                  </div>
                                  <div>
                                    <div className="rc-name" style={{ fontSize: "0.75rem", fontWeight: 700, lineHeight: 1.2 }}>Record #{record.ecg_id}</div>
                                    <div className="text-[9px] text-muted" style={{ lineHeight: 1.2 }}>
                                      Patient #{record.patient_id}
                                    </div>
                                  </div>
                                </div>
                                <span className={`rc-tag ${!isNorm ? "abnormal" : ""}`} style={{ fontSize: "9px", padding: "1px 6px" }}>
                                  {record.superclass}
                                </span>
                              </div>
                              <div className="flex gap-3 text-[9px] text-muted-foreground" style={{ borderTop: "1px solid var(--border)", paddingTop: "5px" }}>
                                <span><i className="fa-regular fa-calendar mr-1"></i>{record.age || "N/A"}y</span>
                                <span><i className="fa-regular fa-user mr-1"></i>{record.sex === 0 ? "Male" : "Female"}</span>
                                <span><i className="fa-solid fa-ruler mr-1"></i>{record.height ? `${record.height}cm` : "N/A"}</span>
                                <span><i className="fa-solid fa-weight-scale mr-1"></i>{record.weight ? `${record.weight}kg` : "N/A"}</span>
                              </div>
                              {record.scp_codes && (
                                <div className="text-[8px] text-muted mt-1 truncate" style={{ borderTop: "1px solid var(--border)", paddingTop: "3px" }}>
                                  SCP: {Object.keys(JSON.parse(record.scp_codes)).slice(0, 3).join(", ")}{Object.keys(JSON.parse(record.scp_codes)).length > 3 ? "..." : ""}
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
                  <div className="mt-4 param-grid">
                    <div className="toggle-row">
                      <div>
                        <div className="tr-label">Smooth Filter</div>
                        <div className="tr-desc">Savitzky-Golay smoothing preserving peaks</div>
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={filterSignal}
                          onChange={(e) => setFilterSignal(e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                    <div className="toggle-row">
                      <div>
                        <div className="tr-label">Sampling Frequency</div>
                        <div className="tr-desc">High resolution trace data</div>
                      </div>
                      <div className="text-xs font-bold text-accent">500 Hz</div>
                    </div>
                  </div>
                </div>

                {/* DIAGNOSTICS DETAILED SUMMARY TAB */}
                <div className={`tab-content ${activeTab === "db-diagnostic" ? "active" : ""}`} id="tab-db-diagnostic">
                  {!selectedRecord ? (
                    <div className="py-8 text-center text-xs text-muted">
                      Select an ECG clinical record from the database to view diagnostics.
                    </div>
                  ) : (
                    <div className="wave-customizer">
                      {/* Findings Banner */}
                      <div 
                        className="manual-banner" 
                        style={{ 
                          display: "block", 
                          marginBottom: "0.8rem",
                          borderLeft: `4px solid ${
                            selectedRecord.superclass === "NORM"
                              ? "var(--correct)"
                              : selectedRecord.superclass === "MI"
                              ? "var(--wrong)"
                              : selectedRecord.superclass === "CD"
                              ? "var(--rhythm-metabolic)"
                              : selectedRecord.superclass === "HYP"
                              ? "var(--rhythm-block)"
                              : "var(--rhythm-ischemia)"
                          }`
                        }}
                      >
                        <div className="manual-banner-text flex justify-between items-center w-full">
                          <span>Superclass: {selectedRecord.superclass}</span>
                          <span 
                            className={`rc-tag ${selectedRecord.superclass !== "NORM" ? "abnormal" : ""}`}
                            style={{ fontSize: "9px", padding: "1px 6px" }}
                          >
                            {SCP_DESCRIPTIONS[selectedRecord.superclass] || "Abnormality"}
                          </span>
                        </div>
                        <div className="manual-banner-desc mt-1 text-[10px] text-muted-foreground opacity-90 font-mono">
                          Record #{selectedRecord.ecg_id} &middot; Patient #{selectedRecord.patient_id}
                        </div>
                      </div>

                      {/* Sub-tab Navigation Buttons */}
                      <div className="flex bg-surface2 border border-border rounded-lg p-0.5 mb-3" style={{ background: "rgba(0,0,0,0.2)" }}>
                        <button
                          className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                            diagSubTab === "overview"
                              ? "bg-accent text-white shadow-sm"
                              : "text-muted hover:text-foreground"
                          }`}
                          onClick={() => setDiagSubTab("overview")}
                        >
                          Overview
                        </button>
                        <button
                          className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all flex items-center justify-center gap-1 ${
                            diagSubTab === "peaks"
                              ? "bg-accent text-white shadow-sm"
                              : "text-muted hover:text-foreground"
                          }`}
                          onClick={() => setDiagSubTab("peaks")}
                        >
                          <i className="fa-solid fa-heart-pulse text-[9px] animate-pulse"></i> Peaks
                        </button>
                        <button
                          className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                            diagSubTab === "length"
                              ? "bg-accent text-white shadow-sm"
                              : "text-muted hover:text-foreground"
                          }`}
                          onClick={() => setDiagSubTab("length")}
                        >
                          Length & Info
                        </button>
                      </div>

                      {/* SUBTAB 1: CLINICAL OVERVIEW */}
                      {diagSubTab === "overview" && (
                        <div className="flex flex-col gap-3 animate-fade-in">
                          {/* Clinical Report Card */}
                          <div className="param-card">
                            <div className="param-card-title flex items-center gap-1">
                              <i className="fa-solid fa-clipboard-question"></i> Clinical Report Summary
                            </div>
                            <div className="text-[11px] text-foreground leading-relaxed bg-surface2 p-3 rounded-lg border border-border font-sans italic">
                              "{selectedRecord.report || "No summary report text is cataloged in the database for this record."}"
                            </div>
                          </div>

                          {/* SCP Statement Table */}
                          {selectedRecord.scp_codes && (
                            <div className="bg-surface2 p-3 rounded-lg border border-border">
                              <div className="text-[10px] text-accent font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
                                <i className="fa-solid fa-book-medical"></i> Diagnostic SCP Codes Breakdown
                              </div>
                              <div className="flex flex-col gap-2 max-h-[140px] overflow-y-auto pr-1">
                                {Object.entries(JSON.parse(selectedRecord.scp_codes)).map(([code, value]) => {
                                  const desc = SCP_DESCRIPTIONS[code] || "Associated clinical condition";
                                  const prob = typeof value === "number" ? Math.round(value) : 100;
                                  return (
                                    <div key={code} className="flex flex-col gap-1 pb-2 border-b border-border border-opacity-30 last:border-0 last:pb-0">
                                      <div className="flex justify-between items-baseline text-[10px]">
                                        <span className="font-bold text-accent">{code} <span className="font-normal text-muted-foreground">- {desc}</span></span>
                                        <span className="font-mono text-foreground font-semibold">{prob}%</span>
                                      </div>
                                      <div className="h-1 bg-surface rounded-full overflow-hidden">
                                        <div className="h-full bg-accent" style={{ width: `${prob}%` }}></div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Infarction Stadium Details */}
                          {(selectedRecord.infarction_stadium1 || selectedRecord.infarction_stadium2) && (
                            <div className="param-card">
                              <div className="param-card-title flex items-center gap-1">
                                <i className="fa-solid fa-layer-group"></i> Myocardial Infarction Stadium
                              </div>
                              <div className="flex flex-col gap-2 p-2 bg-surface2 rounded-lg border border-border">
                                {selectedRecord.infarction_stadium1 && (
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted text-[10px]">Primary Infarct Stadium:</span>
                                    <span className="font-semibold text-wrong bg-wrong bg-opacity-10 px-2 py-0.5 rounded text-[9px] uppercase font-mono border border-wrong border-opacity-20">{selectedRecord.infarction_stadium1}</span>
                                  </div>
                                )}
                                {selectedRecord.infarction_stadium2 && (
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted text-[10px]">Secondary Infarct Stadium:</span>
                                    <span className="font-semibold text-accent bg-accent bg-opacity-10 px-2 py-0.5 rounded text-[9px] uppercase font-mono border border-accent border-opacity-20">{selectedRecord.infarction_stadium2}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* SUBTAB 2: PEAK DETECTION & ANALYSIS */}
                      {diagSubTab === "peaks" && (
                        <div className="flex flex-col gap-3 animate-fade-in">
                          {signalsLoading ? (
                            <div className="py-8 flex flex-col items-center justify-center gap-2">
                              <div className="animate-spin text-accent text-lg"><i className="fa-solid fa-spinner"></i></div>
                              <span className="text-xs text-muted">Analyzing waveform peaks...</span>
                            </div>
                          ) : !peaksAnalysis ? (
                            <div className="py-6 text-center text-xs text-muted">
                              Could not load trace waveforms to perform peak detection. Verify signal cache.
                            </div>
                          ) : (
                            <>
                              {/* R-Peak Stats Grid */}
                              <div className="grid grid-cols-2 gap-2">
                                <div className="bg-surface2 p-2 rounded-lg border border-border flex flex-col items-center justify-center text-center">
                                  <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Calculated Heart Rate</div>
                                  <div className="text-lg font-extrabold text-accent flex items-baseline gap-1">
                                    <i className="fa-solid fa-heart-pulse text-xs animate-bounce text-red-500"></i>
                                    {peaksAnalysis.calculatedBPM}
                                    <span className="text-[9px] font-normal text-muted-foreground font-sans">bpm</span>
                                  </div>
                                </div>
                                <div className="bg-surface2 p-2 rounded-lg border border-border flex flex-col items-center justify-center text-center">
                                  <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Total R-Peaks</div>
                                  <div className="text-lg font-extrabold text-accent">
                                    {peaksAnalysis.peaksCount}
                                    <span className="text-[9px] font-normal text-muted-foreground font-sans ml-1">beats</span>
                                  </div>
                                </div>
                                <div className="bg-surface2 p-2 rounded-lg border border-border flex flex-col items-center justify-center text-center">
                                  <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5" title="Standard Deviation of Normal-to-Normal Intervals">HRV Index (SDNN)</div>
                                  <div className="text-lg font-extrabold text-correct">
                                    {peaksAnalysis.sdnn}
                                    <span className="text-[9px] font-normal text-muted-foreground font-sans ml-1">ms</span>
                                  </div>
                                </div>
                                <div className="bg-surface2 p-2 rounded-lg border border-border flex flex-col items-center justify-center text-center">
                                  <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5" title="Root Mean Square of Successive Differences">Vagal Index (RMSSD)</div>
                                  <div className="text-lg font-extrabold text-correct">
                                    {peaksAnalysis.rmssd}
                                    <span className="text-[9px] font-normal text-muted-foreground font-sans ml-1">ms</span>
                                  </div>
                                </div>
                              </div>

                              {/* HRV Clinical Interpretation */}
                              <div className="bg-surface2 p-2.5 rounded-lg border border-border text-[9px] leading-relaxed text-muted-foreground">
                                <span className="font-bold text-foreground uppercase tracking-wider block mb-1">Clinical Interpretation Summary</span>
                                {peaksAnalysis.sdnn < 30 ? (
                                  <span><i className="fa-solid fa-circle-exclamation text-amber-500 mr-1"></i> HRV indices are depressed ({peaksAnalysis.sdnn}ms), which can indicate systemic autonomic distress or autonomic neuropathy under clinical settings.</span>
                                ) : (
                                  <span><i className="fa-solid fa-circle-check text-emerald-500 mr-1"></i> Autonomic cardiac modulation is healthy and normal ({peaksAnalysis.sdnn}ms SDNN, {peaksAnalysis.rmssd}ms RMSSD parasympathetic index).</span>
                                )}
                              </div>

                              {/* R-Peaks Timings List */}
                              <div className="bg-surface2 p-3 rounded-lg border border-border">
                                <div className="text-[10px] text-accent font-bold uppercase tracking-wider mb-2 flex justify-between items-center">
                                  <span><i className="fa-solid fa-list-ol mr-1"></i> R-Peak Timeline (Lead {currentLead})</span>
                                  <span className="text-[8px] text-muted font-normal lowercase">visual markers active on grid</span>
                                </div>
                                <div className="overflow-y-auto max-h-[140px] pr-1">
                                  <table className="w-full text-[10px] font-mono">
                                    <thead>
                                      <tr className="border-b border-border border-opacity-40 text-[9px] text-muted-foreground text-left">
                                        <th className="pb-1.5 font-bold">Beat</th>
                                        <th className="pb-1.5 font-bold">Timestamp</th>
                                        <th className="pb-1.5 font-bold text-right">R-Amp (mV)</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {peaksAnalysis.peaksInfo.map((p: any, idx: number) => {
                                        return (
                                          <tr key={idx} className="border-b border-border border-opacity-20 last:border-0 hover:bg-surface py-1">
                                            <td className="py-1">#{idx + 1}</td>
                                            <td className="py-1">{p.time.toFixed(3)} s</td>
                                            <td className={`py-1 text-right font-semibold ${p.value > 0.6 ? "text-emerald-400" : "text-foreground"}`}>
                                              {p.value.toFixed(3)}
                                            </td>
                                          </tr>
                                        );
                                      })}
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
                          <div className="bg-surface2 p-3 rounded-lg border border-border">
                            <div className="text-[10px] text-accent font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1">
                              <i className="fa-solid fa-user-doctor"></i> Physical Characteristics & BMI
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                              <div className="flex flex-col">
                                <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Age / Sex</span>
                                <span className="font-semibold">{selectedRecord.age || "Unknown"} yr &middot; {selectedRecord.sex === 0 ? "Male" : "Female"}</span>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Physical Frame</span>
                                <span className="font-semibold">{selectedRecord.height ? `${selectedRecord.height} cm` : "N/A"} &middot; {selectedRecord.weight ? `${selectedRecord.weight} kg` : "N/A"}</span>
                              </div>
                            </div>
                            
                            {/* Dynamic BMI Gauge */}
                            {selectedRecord.height && selectedRecord.weight ? (() => {
                              const heightM = selectedRecord.height / 100;
                              const bmiVal = Number((selectedRecord.weight / (heightM * heightM)).toFixed(1));
                              let cat = "Normal";
                              let color = "var(--correct)";
                              if (bmiVal < 18.5) { cat = "Underweight"; color = "var(--accent)"; }
                              else if (bmiVal >= 25 && bmiVal < 30) { cat = "Overweight"; color = "var(--accent)"; }
                              else if (bmiVal >= 30) { cat = "Obese"; color = "var(--wrong)"; }
                              
                              return (
                                <div className="border-t border-border border-opacity-40 pt-2.5 flex justify-between items-center">
                                  <div className="flex flex-col">
                                    <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Body Mass Index (BMI)</span>
                                    <span className="font-mono text-sm font-extrabold">{bmiVal} <span className="text-[9px] font-normal text-muted-foreground font-sans">kg/m²</span></span>
                                  </div>
                                  <span 
                                    className="px-2 py-0.5 rounded text-[9px] font-bold uppercase border"
                                    style={{ color, borderColor: `${color}40`, backgroundColor: `${color}10` }}
                                  >
                                    {cat}
                                  </span>
                                </div>
                              );
                            })() : (
                              <div className="border-t border-border border-opacity-40 pt-2 text-[10px] text-muted">
                                Height or weight missing. Cannot calculate Body Mass Index.
                              </div>
                            )}
                          </div>

                          {/* Technical Waveform Stats */}
                          <div className="bg-surface2 p-3 rounded-lg border border-border">
                            <div className="text-[10px] text-accent font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
                              <i className="fa-solid fa-wave-square"></i> Waveform & Signal Properties
                            </div>
                            <div className="flex flex-col gap-1.5 text-[10px] font-mono">
                              <div className="flex justify-between py-0.5 border-b border-border border-opacity-20">
                                <span className="text-muted-foreground">ECG Duration</span>
                                <span className="font-semibold text-foreground">10.0 seconds</span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-border border-opacity-20">
                                <span className="text-muted-foreground">Sampling Rate</span>
                                <span className="font-semibold text-foreground">500 Hz</span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-border border-opacity-20">
                                <span className="text-muted-foreground">Raw Data Points</span>
                                <span className="font-semibold text-foreground">5,000 samples / lead</span>
                              </div>
                              <div className="flex justify-between py-0.5">
                                <span className="text-muted-foreground">Channel Setup</span>
                                <span className="font-semibold text-foreground">12 Leads (Standard)</span>
                              </div>
                            </div>
                          </div>

                          {/* Complete Administrative Database Fields */}
                          <div className="bg-surface2 p-3 rounded-lg border border-border">
                            <div className="text-[10px] text-accent font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
                              <i className="fa-solid fa-database"></i> Clinical Registry Database Metadata
                            </div>
                            <div className="flex flex-col gap-1.5 text-[10px] font-mono">
                              <div className="flex justify-between py-0.5 border-b border-border border-opacity-20">
                                <span className="text-muted-foreground">Recording Date</span>
                                <span className="font-semibold text-foreground">{selectedRecord.recording_date ? selectedRecord.recording_date.replace("T", " ") : "N/A"}</span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-border border-opacity-20">
                                <span className="text-muted-foreground">Device / Model</span>
                                <span className="font-semibold text-foreground truncate max-w-[150px]">{selectedRecord.device || "Schiller System"}</span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-border border-opacity-20">
                                <span className="text-muted-foreground">Electrical Axis</span>
                                <span className="font-semibold text-foreground flex items-center gap-1">
                                  {selectedRecord.heart_axis || "NORMAL"}
                                  <span className="text-[8px] text-muted-foreground font-normal font-sans">
                                    ({selectedRecord.heart_axis === "LAD" ? "Left Dev" : selectedRecord.heart_axis === "RAD" ? "Right Dev" : "Normal"})
                                  </span>
                                </span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-border border-opacity-20">
                                <span className="text-muted-foreground">Pacemaker State</span>
                                <span className={`font-bold px-1.5 py-0.2 rounded text-[8px] uppercase border ${
                                  selectedRecord.pacemaker === 1 
                                    ? "text-emerald-400 bg-emerald-500 bg-opacity-10 border-emerald-500 border-opacity-20" 
                                    : "text-muted-foreground bg-surface border-border border-opacity-40"
                                }`}>
                                  {selectedRecord.pacemaker === 1 ? "Active" : "None"}
                                </span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-border border-opacity-20">
                                <span className="text-muted-foreground">validated Cardiologist</span>
                                <span className="font-semibold text-foreground">MD-Cardio #{selectedRecord.validated_by || "0"}</span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-border border-opacity-20">
                                <span className="text-muted-foreground">Nurse Technician</span>
                                <span className="font-semibold text-foreground">Nurse #{selectedRecord.nurse || "0"}</span>
                              </div>
                              <div className="flex justify-between py-0.5">
                                <span className="text-muted-foreground">Recording Site ID</span>
                                <span className="font-semibold text-foreground">Site #{selectedRecord.site || "0"}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                    {/* DATABASE ENGINE SEEDER SETUP TAB */}
                <div className={`tab-content ${activeTab === "db-setup" ? "active" : ""}`} id="tab-db-setup">
                  <div className="wave-customizer">
                    <div className="manual-banner" style={{ display: "block" }}>
                      <div className="manual-banner-text">Database Setup</div>
                      <div className="manual-banner-desc">Manage the local PTB-XL+ 1.0.1 SQLite engine.</div>
                    </div>

                    <div className="param-grid pb-3 mb-3" style={{ marginBottom: "1.5rem", paddingBottom: "1.0rem" }}>
                      <div className="toggle-row">
                        <div>
                          <div className="tr-label">DATABASE STATUS</div>
                          <div className="tr-desc">Engine contains {dbStatus === "seeded" ? "active" : "0"} records</div>
                        </div>
                        <div className={`text-xs font-bold ${dbStatus === "seeded" ? "text-emerald-400" : "text-amber-400"}`}>
                          {dbStatus === "seeded" ? "ACTIVE & SEEDED" : "NOT CONFIGURED"}
                        </div>
                      </div>

                      <div className="toggle-row">
                        <div>
                          <div className="tr-label">Dataset Depth</div>
                          <div className="tr-desc">Select how many records to fetch</div>
                        </div>
                        <select 
                          className="bg-surface2 text-foreground border border-border rounded px-2 py-1 text-xs outline-none"
                          value={pullMode}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPullMode(val);
                            if (val === "metadata_only") setPullCount(21837);
                            else if (val === "full_force") setPullCount(21837);
                            else setPullCount(36);
                          }}
                          disabled={seedingActive}
                        >
                          <option value="metadata_only">Online Mode (Metadata Only - Recommended)</option>
                          <option value="partial">Local Mode (Partial + Signals cached)</option>
                          <option value="full_force">Local Mode (Full + Signals cached)</option>
                        </select>
                      </div>

                      <div className="toggle-row">
                        <div>
                          <div className="tr-label">Maximum Records</div>
                          <div className="tr-desc">Approximate count to retrieve</div>
                        </div>
                        <input
                          type="number"
                          className="bg-surface2 text-foreground border border-border rounded px-2 py-1 text-xs outline-none w-24 text-right"
                          value={pullCount}
                          onChange={(e) => setPullCount(Number(e.target.value))}
                          min={36}
                          step={36}
                          disabled={seedingActive}
                        />
                      </div>

                      {/* Overwrite existing data toggle */}
                      <div className="toggle-row" style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                        <div>
                          <div className="tr-label">Overwrite Existing Data</div>
                          <div className="tr-desc">Clear and re-import all records</div>
                        </div>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={overwriteDb}
                            onChange={(e) => setOverwriteDb(e.target.checked)}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                      </div>
                    </div>

                    {/* Download progress bar */}
                    {seedingActive && (
                      <div className="mt-2 mb-3">
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-muted)", marginBottom: "4px" }}>
                          <span><i className="fa-solid fa-download mr-1"></i> Downloading...</span>
                          <span>{downloadProgress}/{downloadTotal}</span>
                        </div>
                        <div style={{ height: "6px", background: "var(--border)", borderRadius: "3px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${downloadTotal > 0 ? (downloadProgress / downloadTotal) * 100 : 5}%`, background: "var(--accent)", borderRadius: "3px", transition: "width 0.3s ease" }}></div>
                        </div>
                      </div>
                    )}

                    <div className="action-row flex flex-col gap-2">
                      <button
                        className="btn-action primary disabled:opacity-50 flex items-center justify-center gap-1.5"
                        onClick={triggerDbSeeding}
                        disabled={seedingActive}
                      >
                        <i className={`fa-solid fa-database ${seedingActive ? "animate-bounce" : ""}`}></i> 
                        {seedingActive ? " Seeding Archive..." : " Re-trigger SQLite DB Seed"}
                      </button>

                      {dbSeeded && !seedingActive && (
                        <button
                          className="btn-action danger disabled:opacity-50 flex items-center justify-center gap-1.5 mt-1"
                          onClick={async () => {
                            setOverwriteDb(true);
                            setSeedingActive(true);
                            setDbStatus("running");
                            setDbProgress("Clearing existing database and re-importing...");
                            setDownloadProgress(0);
                            setDownloadTotal(pullCount);
                            try {
                              const res = await fetch("/api/setup", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ pullConfig: { mode: pullMode, count: pullCount }, overwrite: true })
                              });
                              const data = await res.json();
                              if (data.seeded) {
                                setDbSeeded(true);
                                setSeedingActive(false);
                                setOverwriteDb(false);
                                setDownloadProgress(pullCount);
                                fetchRecords();
                                showToastMsg("Database cleared and re-seeded successfully!");
                              }
                            } catch {
                              setDbStatus("failed");
                              setDbProgress("Failed to clear and re-import.");
                              setSeedingActive(false);
                            }
                          }}
                        >
                          <i className="fa-solid fa-trash-can"></i> Clear & Re-Import All Records
                        </button>
                      )}
                    </div>

                    {dbProgress && (
                      <div className="mt-3 p-2 bg-surface2 text-[10px] text-accent font-mono rounded border border-border break-words">
                        <span className="text-[9px] text-muted block uppercase font-bold tracking-wider mb-0.5">Engine Status Output</span>
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
                  <span className="intensity-label">Pathology Intensity</span>
                  <span className="intensity-badge">
                    {INTENSITY_STAGES[currentRhythm] ? Math.round(effectIntensity * 100) + "%" : "0%"}
                  </span>
                </div>

                <div className="intensity-desc">
                  {INTENSITY_STAGES[currentRhythm]
                    ? (INTENSITY_STAGES[currentRhythm].stages.find(
                        (s) =>
                          effectIntensity * 100 >= s.range[0] &&
                          effectIntensity * 100 <= s.range[1]
                      )?.desc || "Select intensity range")
                    : "Select a rhythm to activate the progressive pathology slider."}
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

                <div className="intensity-track mt-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    disabled={!INTENSITY_STAGES[currentRhythm]}
                    value={INTENSITY_STAGES[currentRhythm] ? Math.round(effectIntensity * 100) : 0}
                    onChange={(e) => handleIntensityChange(e.target.value)}
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
                  {INTENSITY_STAGES[currentRhythm] && INTENSITY_STAGES[currentRhythm].stages.map((stg) => {
                    const isCurrent =
                      effectIntensity * 100 >= stg.range[0] &&
                      effectIntensity * 100 <= stg.range[1];
                    const midPoint = (stg.range[0] + stg.range[1]) / 2;
                    return (
                      <span
                        key={stg.name}
                        className={`intensity-dot ${isCurrent ? "active" : ""}`}
                        onClick={() => handleIntensityChange(midPoint.toString())}
                      >
                        {stg.name}
                      </span>
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
                <div className="manual-banner">
                  <div>
                    <div className="manual-banner-text">Activate Custom Wave Design</div>
                    <div className="manual-banner-desc">Unlock advanced parameters and manual waveform construction.</div>
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
                  {/* Params Section */}
                  <div className="param-grid border-b border-gray-700 pb-3 mb-3" style={{ marginBottom: "1.5rem", paddingBottom: "1.0rem" }}>
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
                        <div className="tr-label">Realistic Simulation</div>
                        <div className="tr-desc">Adds baseline wander & muscle drift</div>
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
