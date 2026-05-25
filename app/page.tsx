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

function getRecordSignalForLead(signals: any, leadName: string): number[] | null {
  if (!signals || !leadName) return null;
  if (Array.isArray(signals[leadName])) return signals[leadName];
  
  const lowerName = leadName.toLowerCase();
  for (const key of Object.keys(signals)) {
    if (key.toLowerCase() === lowerName) {
      if (Array.isArray(signals[key])) return signals[key];
    }
  }
  
  const mappings: Record<string, string> = {
    avr: "AVR", avl: "AVL", avf: "AVF",
    "aVR": "AVR", "aVL": "AVL", "aVF": "AVF",
    "AVR": "aVR", "AVL": "aVL", "AVF": "aVF"
  };
  const targetKey = mappings[leadName] || mappings[lowerName];
  if (targetKey && Array.isArray(signals[targetKey])) {
    return signals[targetKey];
  }
  return null;
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

export default function ECGSimulatorPage() {
  // ── Mode selection (clinical db vs mathematical simulator) ──
  const [mode, setMode] = useState<string>("database"); // "database" or "simulation"

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<string>("db-explorer");

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
  const [selectedFreq, setSelectedFreq] = useState<number>(100);

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
    frequency: 100,
    timeElapsed: 0.0
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
    selectedFreq
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

  async function fetchRecords(searchStr = searchQuery, filterStr = superclassFilter, currentOffset = dbOffset) {
    try {
      setRecordsLoading(true);
      const url = `/api/records?superclass=${filterStr}&limit=${dbLimit}&offset=${currentOffset}&search=${encodeURIComponent(searchStr)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.records) {
        setDbRecords(data.records);
        setDbClassCounts(data.classCounts || {});
        
        // Auto-select first matching record if none selected or if selected is stale
        if (data.records.length > 0) {
          const alreadySelectedIdx = data.records.findIndex((r: any) => selectedRecord && r.ecg_id === selectedRecord.ecg_id);
          if (alreadySelectedIdx < 0) {
            selectRecordItem(data.records[0]);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch records:", err);
    } finally {
      setRecordsLoading(false);
    }
  }

  async function selectRecordItem(record: any, freq = selectedFreq) {
    setSelectedRecord(record);
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
      const res = await fetch("/api/setup", { method: "POST" });
      const data = await res.json();
      if (data.seeded) {
        setDbSeeded(true);
        setSeedingActive(false);
        fetchRecords();
        showToastMsg("Clinical database successfully seeded!");
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
        fetchRecords(searchQuery, superclassFilter, dbOffset);
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
        const dbSignalArray = state.mode === "database" ? getRecordSignalForLead(state.signals, state.currentLead) : null;
        if (state.mode === "database" && state.signals && dbSignalArray) {
          const signalArray = dbSignalArray;
          if (!state.paused) {
            const pixelsThisFrame = pixelsPerSec * dt;
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
                const percent_x = x / W;
                let sampleIdx = Math.floor(percent_x * signalArray.length);
                sampleIdx = Math.min(signalArray.length - 1, Math.max(0, sampleIdx));

                let val = signalArray[sampleIdx] * state.amplitude;
                if (state.noise > 0) {
                  val = addTraceNoise(val, sampleIdx * 0.05, 0, state.noise, state.realistic, state.heartRate);
                }

                // ER R-peak sound beeping
                const currentSampleVal = signalArray[sampleIdx];
                const threshold = 0.55;
                if (currentSampleVal > threshold && !state.rPeakDetected) {
                  state.rPeakDetected = true;
                  if (state.soundOn) playBeep();
                } else if (currentSampleVal < 0.15) {
                  state.rPeakDetected = false;
                }

                const yi = centerY - val * pixelsPerMv;
                if (state.sweepBuf && state.sweepWritten) {
                  state.sweepBuf[xi] = yi;
                  state.sweepWritten[xi] = 1;
                }
              }
            }
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
            state.phase += dt * 0.1;
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
                const steps = Math.ceil(cellW);
                for (let px = 0; px <= steps; px += 1) {
                  const cellFrac = px / cellW;
                  // Scroll the 10-second segment smoothly over time
                  const elapsedOffset = (state.timeElapsed || 0) * 0.10;
                  const absFrac = ((col + cellFrac) / numCols + elapsedOffset) % 1.0;
                  let sampleIdx = Math.floor(absFrac * leadSignal.length);
                  sampleIdx = Math.min(leadSignal.length - 1, Math.max(0, sampleIdx));

                  let val = leadSignal[sampleIdx] * state.amplitude;
                  if (state.noise > 0) {
                    val = addTraceNoise(val, sampleIdx * 0.05, 0, state.noise, state.realistic, state.heartRate);
                  }

                  const xCoord = cx + px;
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
            for (let px = 0; px <= W; px += 1) {
              const absFrac = (px / W + (state.timeElapsed || 0) * 0.10) % 1.0;
              let sampleIdx = Math.floor(absFrac * iiSignal.length);
              sampleIdx = Math.min(iiSignal.length - 1, Math.max(0, sampleIdx));

              let val = iiSignal[sampleIdx] * state.amplitude;
              if (state.noise > 0) {
                val = addTraceNoise(val, sampleIdx * 0.05, 0, state.noise, state.realistic, state.heartRate);
              }

              const yCoord = rhythmY - val * pixelsPerMv;
              if (firstR) {
                ctx.moveTo(px, yCoord);
                firstR = false;
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
          if (mode === "database" && recordSignals && recordSignals[lead]) {
            const signalArray = recordSignals[lead];
            for (let px = 0; px <= drawW; px += 0.5) {
              const cellFrac = px / drawW;
              const absFrac = (col + cellFrac) / 4;
              let sampleIdx = Math.floor(absFrac * signalArray.length);
              sampleIdx = Math.min(signalArray.length - 1, Math.max(0, sampleIdx));

              const val = signalArray[sampleIdx] * amplitude;
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
      if (mode === "database" && recordSignals && recordSignals["II"]) {
        const signalArray = recordSignals["II"];
        for (let px = 0; px <= rsW; px += 0.5) {
          const absFrac = px / rsW;
          let sampleIdx = Math.floor(absFrac * signalArray.length);
          sampleIdx = Math.min(signalArray.length - 1, Math.max(0, sampleIdx));

          const val = signalArray[sampleIdx] * amplitude;
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
        if (mode === "database" && recordSignals && recordSignals[currentLead]) {
          const signalArray = recordSignals[currentLead];
          for (let px = 0; px <= contentW; px += 0.5) {
            const fractionInStrip = px / contentW;
            const globalTimeFraction = (s + fractionInStrip) / 3;
            let sampleIdx = Math.floor(globalTimeFraction * signalArray.length);
            sampleIdx = Math.min(signalArray.length - 1, Math.max(0, sampleIdx));

            const val = signalArray[sampleIdx] * amplitude;
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
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                    Browse PTB-XL records clinical dataset from SQLite database engine.
                  </div>

                  {/* Search box controls */}
                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      className="flex-1 px-3 py-1.5 text-xs rounded border border-border bg-surface text-foreground placeholder-muted outline-none focus:border-accent"
                      placeholder="Search ID, NORM, MI, CD..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
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

                  {/* Frequency controls */}
                  <div className="mb-3 p-2 bg-surface2 rounded border border-border flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">Sampling Freq:</span>
                    <select
                      className="text-xs px-2 py-1 rounded border border-border bg-surface text-foreground outline-none cursor-pointer"
                      value={selectedFreq}
                      onChange={(e) => {
                        const freqValue = parseInt(e.target.value, 10);
                        setSelectedFreq(freqValue);
                        showToastMsg(`Switched sampling resolution to ${freqValue}Hz`);
                      }}
                    >
                      <option value={500}>500 Hz (Raw / Resampled)</option>
                      <option value={100}>100 Hz (Downsampled)</option>
                    </select>
                  </div>

                  {/* Loading indicator */}
                  {recordsLoading && (
                    <div className="py-8 flex flex-col items-center justify-center gap-2">
                      <div className="animate-spin text-accent text-lg"><i className="fa-solid fa-spinner"></i></div>
                      <span className="text-xs text-muted">Retrieving matching records...</span>
                    </div>
                  )}

                  {/* Records List */}
                  {!recordsLoading && (
                    <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto pr-1">
                      {dbRecords.length === 0 ? (
                        <div className="py-8 text-center text-xs text-muted">
                          No matching records found. Try &quot;NORM&quot; or &quot;MI&quot;.
                        </div>
                      ) : (
                        dbRecords.map((record) => {
                          const isSelected = selectedRecord?.ecg_id === record.ecg_id;
                          return (
                            <div
                              key={record.ecg_id}
                              className={`p-3 rounded border transition-all cursor-pointer flex flex-col gap-1.5 ${
                                isSelected
                                  ? "bg-accent bg-opacity-10 border-accent"
                                  : "bg-surface hover:border-gray-500 border-border"
                              }`}
                              onClick={() => selectRecordItem(record)}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-foreground">ECG Record #{record.ecg_id}</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    record.superclass === "NORM"
                                      ? "bg-emerald-500 bg-opacity-20 text-emerald-400"
                                      : "bg-rose-500 bg-opacity-20 text-rose-400"
                                  }`}
                                >
                                  {record.superclass}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                                <div>Patient ID: <span className="text-foreground">#{record.patient_id}</span></div>
                                <div>Age/Sex: <span className="text-foreground">{record.age || "N/A"}/{record.sex === 0 ? "M" : "F"}</span></div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* Pagination control */}
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
                    <button
                      className="px-2 py-1 text-xs rounded border border-border text-foreground hover:bg-surface disabled:opacity-40"
                      disabled={dbOffset === 0}
                      onClick={() => {
                        const nextOffset = Math.max(0, dbOffset - dbLimit);
                        setDbOffset(nextOffset);
                        fetchRecords(searchQuery, superclassFilter, nextOffset);
                      }}
                    >
                      <i className="fa-solid fa-chevron-left mr-1"></i> Prev
                    </button>
                    <span className="text-xs text-muted">Page {Math.floor(dbOffset / dbLimit) + 1}</span>
                    <button
                      className="px-2 py-1 text-xs rounded border border-border text-foreground hover:bg-surface disabled:opacity-40"
                      disabled={dbRecords.length < dbLimit}
                      onClick={() => {
                        const nextOffset = dbOffset + dbLimit;
                        setDbOffset(nextOffset);
                        fetchRecords(searchQuery, superclassFilter, nextOffset);
                      }}
                    >
                      Next <i className="fa-solid fa-chevron-right ml-1"></i>
                    </button>
                  </div>
                </div>

                {/* DIAGNOSTICS DETAILED SUMMARY TAB */}
                <div className={`tab-content ${activeTab === "db-diagnostic" ? "active" : ""}`} id="tab-db-diagnostic">
                  {!selectedRecord ? (
                    <div className="py-8 text-center text-xs text-muted">
                      Select an ECG clinical record from the database to view diagnostics.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="p-3 bg-surface2 rounded border border-border font-sans">
                        <div className="text-xs font-bold text-accent mb-1 uppercase tracking-wider">CLINICAL DIAGNOSIS SUPERCLASS</div>
                        <div className="text-sm font-semibold text-foreground mb-1">
                          {selectedRecord.superclass} &mdash; {SCP_DESCRIPTIONS[selectedRecord.superclass] || "Abnormality detected"}
                        </div>
                        <div className="text-xs text-muted-foreground leading-relaxed">
                          {selectedRecord.class_explanation || "No explanation provided for this patient group."}
                        </div>
                      </div>

                      <div className="p-3 bg-surface2 rounded border border-border font-sans">
                        <div className="text-xs font-bold text-accent mb-1.5 uppercase tracking-wider">PATIENT PROFILE METADATA</div>
                        <div className="flex flex-col gap-1 text-xs">
                          <div className="flex justify-between py-1 border-b border-border border-opacity-50">
                            <span className="text-muted">Patient ID</span>
                            <span className="text-foreground font-semibold">#{selectedRecord.patient_id}</span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-border border-opacity-50">
                            <span className="text-muted">Age / Sex</span>
                            <span className="text-foreground font-semibold">{selectedRecord.age || "Unknown"} years / {selectedRecord.sex === 0 ? "Male" : "Female"}</span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-border border-opacity-50">
                            <span className="text-muted">Chest Pain Type</span>
                            <span className="text-foreground font-semibold">{selectedRecord.chest_pain_type === 0 ? "Asymptomatic" : selectedRecord.chest_pain_type === 1 ? "Atypical Angina" : "Non-Anginal"}</span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-border border-opacity-50">
                            <span className="text-muted">Recorded Medication</span>
                            <span className="text-foreground font-semibold">{selectedRecord.medication_history ? selectedRecord.medication_history : "None on file"}</span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-border border-opacity-50">
                            <span className="text-muted">Recording Height/Weight</span>
                            <span className="text-semibold text-foreground">{selectedRecord.height ? `${selectedRecord.height} cm` : "N/A"}/{selectedRecord.weight ? `${selectedRecord.weight} kg` : "N/A"}</span>
                          </div>
                        </div>
                      </div>

                      <div className="p-3 bg-surface2 rounded border border-border font-sans">
                        <div className="text-xs font-bold text-accent mb-1 uppercase tracking-wider font-sans">SECONDARY STRATIFIED CODES</div>
                        <div className="text-xs text-muted-foreground font-mono leading-relaxed bg-surface p-2 rounded max-h-[140px] overflow-y-auto">
                          {selectedRecord.scp_codes ? (
                            Object.entries(JSON.parse(selectedRecord.scp_codes)).map(([code, value]) => (
                              <div key={code} className="flex justify-between pb-1 mb-1 border-b border-border border-opacity-30">
                                <span className="text-semibold text-accent font-sans">{code}</span>
                                <span className="text-foreground">{String(value)}</span>
                              </div>
                            ))
                          ) : (
                            <span>No secondary SCP metadata</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* DATABASE ENGINE SEEDER SETUP TAB */}
                <div className={`tab-content ${activeTab === "db-setup" ? "active" : ""}`} id="tab-db-setup">
                  <div className="flex flex-col gap-3 font-sans">
                    <div className="p-3 bg-surface2 rounded border border-border text-center font-sans">
                      <div className="text-[10px] text-muted font-bold tracking-wider mb-1 uppercase">DATABASE STATUS</div>
                      <div className={`text-base font-extrabold ${dbStatus === "seeded" ? "text-emerald-400" : "text-amber-400"}`}>
                        {dbStatus === "seeded" ? "ACTIVE & SEEDED" : "NOT CONFIGURED"}
                      </div>
                      <div className="text-[12px] text-foreground mt-1">
                        SQLite Engine contains {dbStatus === "seeded" ? "36" : "0"} PTB-XL records trace datasets setup.
                      </div>
                    </div>

                    <div className="p-3 bg-surface2 rounded border border-border font-sans">
                      <div className="text-xs font-bold text-accent mb-2 uppercase tracking-wider">INITIALIZATION & SEEDING</div>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                        The clinical SQLite engine reads records pre-extracted from the PTB-XL diagnostic database. Trigger initial seed if empty.
                      </p>

                      {dbProgress && (
                        <div className="mb-3 p-2 bg-surface text-[10px] text-accent font-mono rounded border border-border break-words">
                          <span className="text-[9px] text-muted block uppercase font-bold tracking-wider mb-0.5">Engine Status Output</span>
                          {dbProgress}
                        </div>
                      )}

                      <button
                        className="w-full py-2 bg-accent text-accent-foreground text-xs font-semibold rounded hover:bg-opacity-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                        onClick={triggerDbSeeding}
                        disabled={seedingActive}
                      >
                        <i className={`fa-solid fa-database ${seedingActive ? "animate-bounce" : ""}`}></i> {seedingActive ? "Seeding Archive..." : "Re-trigger SQLite DB Seed"}
                      </button>
                    </div>

                    <div className="p-3 bg-surface2 rounded border border-border font-sans">
                      <div className="text-xs font-bold text-accent mb-1.5 uppercase tracking-wider font-sans">INTEGRATION COMPULSORIES</div>
                      <ul className="text-[11px] text-muted-foreground list-disc pl-4 flex flex-col gap-1 leading-relaxed">
                        <li><b>Data Scope:</b> Standard full 12-leads clinical database datasets.</li>
                        <li><b>Wave Resolution:</b> original recordings preserved up to 500 samples/sec per lead trace.</li>
                      </ul>
                    </div>
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
