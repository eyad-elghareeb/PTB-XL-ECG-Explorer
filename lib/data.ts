/**
 * Hybrid data access layer.
 * - On Vercel (production): reads from pre-extracted JSON files in public/data/
 * - On dev (localhost): uses sql.js for full database access
 * 
 * This avoids WASM/sql.js cold-start issues on serverless runtimes.
 */

import fs from "fs";
import path from "path";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isVercel(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;
}

function getDataDir(): string {
  return path.resolve(process.cwd(), "public", "data");
}

function readJSON<T>(filename: string): T | null {
  try {
    const p = path.join(getDataDir(), filename);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
    }
  } catch {
    // ignore
  }
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SCPStatement {
  code: string;
  description: string;
  superclass: string;
  subclass: string;
}

export interface RecordRow {
  ecg_id: number;
  patient_id: number;
  age: number | null;
  sex: number | null;
  filename_lr: string;
  filename_hr: string;
  superclass: string;
  scp_codes: any;
  patient_metadata: any;
  height: number | null;
  weight: number | null;
  report: string | null;
  recording_date: string | null;
  heart_axis: string | null;
  pacemaker: number | null;
  device: string | null;
  nurse: string | null;
  site: string | null;
  validated_by: string | null;
  infarction_stadium1: string | null;
  infarction_stadium2: string | null;
  [key: string]: any;
}

// ── Static JSON-backed queries (Vercel) ───────────────────────────────────────

let cachedRecords: RecordRow[] | null = null;
let cachedScpStatements: SCPStatement[] | null = null;
let cachedClassCounts: Record<string, number> | null = null;
let cachedSearchIndex: Record<string, any> | null = null;

function loadAllRecords(): RecordRow[] {
  if (!cachedRecords) {
    cachedRecords = readJSON<RecordRow[]>("records.json") || [];
  }
  return cachedRecords;
}

function loadScpStatements(): SCPStatement[] {
  if (!cachedScpStatements) {
    cachedScpStatements = readJSON<SCPStatement[]>("scp_statements.json") || [];
  }
  return cachedScpStatements;
}

function loadClassCounts(): Record<string, number> {
  if (!cachedClassCounts) {
    cachedClassCounts = readJSON<Record<string, number>>("classCounts.json") || {};
  }
  return cachedClassCounts;
}

function loadSearchIndex(): Record<string, any> {
  if (!cachedSearchIndex) {
    cachedSearchIndex = readJSON<Record<string, any>>("searchIndex.json") || {};
  }
  return cachedSearchIndex;
}

/**
 * Return pre-computed JSON data is available (Vercel).
 * Falls back to sql.js only on dev.
 */
export function getStaticDataAvailable(): boolean {
  const recordsPath = path.join(getDataDir(), "records.json");
  return fs.existsSync(recordsPath);
}

// ── Fuzzy Matching Helpers ────────────────────────────────────────────────────

/** Levenshtein edit distance between two strings (bails early if > maxDist) */
function editDistance(a: string, b: string, maxDist = 3): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[b.length];
}

/**
 * Returns true if `word` fuzzy-matches any token in `text`.
 * Exact substring match is tried first for speed.
 * For words ≥ 4 chars, tolerates 1 edit; ≥ 6 chars, tolerates 2 edits.
 */
export function fuzzyMatchWord(word: string, text: string): boolean {
  if (!word || !text) return false;
  if (text.includes(word)) return true;
  if (word.length < 4) return false;
  const maxDist = word.length >= 6 ? 2 : 1;
  const tokens = text.split(/[\s,\-\/\(\)]+/);
  for (const token of tokens) {
    if (Math.abs(token.length - word.length) <= maxDist &&
        editDistance(word, token, maxDist) <= maxDist) {
      return true;
    }
  }
  return false;
}

/**
 * Find SCP codes whose code, description, subclass, or superclass fuzzy-matches
 * any of the given search words.
 */
export function findFuzzyMatchingCodes(words: string[]): Set<string> {
  const stmts = loadScpStatements();
  const matched = new Set<string>();
  for (const stmt of stmts) {
    const targets = [
      stmt.code.toLowerCase(),
      stmt.description.toLowerCase(),
      stmt.subclass.toLowerCase(),
      stmt.superclass.toLowerCase(),
    ];
    for (const word of words) {
      if (targets.some((t) => fuzzyMatchWord(word, t))) {
        matched.add(stmt.code);
        break;
      }
    }
  }
  return matched;
}

// ── Query Helpers ─────────────────────────────────────────────────────────────

export interface QueryResult {
  records: RecordRow[];
  classCounts: Record<string, number>;
}

export function queryRecords(params: {
  superclass?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}): QueryResult {
  const allRecords = loadAllRecords();
  let filtered = allRecords;

  // Filter by superclass
  if (params.superclass && params.superclass !== "ALL") {
    filtered = filtered.filter((r) => r.superclass === params.superclass);
  }

  // Filter by search query
  if (params.search) {
    const words = params.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      const matchingCodes = findFuzzyMatchingCodes(words);
      const searchIndex = loadSearchIndex();

      filtered = filtered.filter((rec) => {
        const searchEntry = searchIndex[rec.ecg_id];
        if (!searchEntry) return false;
        const searchText = searchEntry.searchText || "";
        const scpCodes = typeof rec.scp_codes === "object" ? Object.keys(rec.scp_codes) : [];

        return words.every((word) => {
          // Check search text (exact + fuzzy on tokens)
          if (searchText.includes(word)) return true;
          if (word.length >= 4 && fuzzyMatchWord(word, searchText)) return true;
          // Check SCP codes (exact)
          for (const code of scpCodes) {
            if (code.toLowerCase().includes(word)) return true;
          }
          // Check matching SCP codes (exact + fuzzy)
          for (const matchCode of matchingCodes) {
            if (scpCodes.includes(matchCode)) return true;
          }
          return false;
        });
      });
    }
  }

  // Apply pagination
  const limit = Math.min(100, params.limit || 40);
  const offset = params.offset || 0;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    records: paginated,
    classCounts: loadClassCounts(),
  };
}

export function queryRecordById(ecgId: number): RecordRow | null {
  const allRecords = loadAllRecords();
  // Binary search on sorted array by ecg_id
  let lo = 0;
  let hi = allRecords.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midId = allRecords[mid].ecg_id;
    if (midId === ecgId) return allRecords[mid];
    if (midId < ecgId) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

export function queryRecordsBySuperclass(superclass: string): RecordRow[] {
  return loadAllRecords().filter((r) => r.superclass === superclass);
}

export function getClassCounts(): Record<string, number> {
  return loadClassCounts();
}

export function getDbInfo(): any {
  return readJSON<any>("db_info.json") || null;
}