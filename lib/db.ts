import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Locate the SQLite database file in the root configuration
const DB_PATH = path.resolve(process.cwd(), "ptbxl.db");

let dbInstance: any = null;

export function getDB() {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = new Database(DB_PATH);
  
  // Enable WAL mode for high performance
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("synchronous = NORMAL");

  // Create tables if they do not exist
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS scp_statements (
      code TEXT PRIMARY KEY,
      description TEXT,
      superclass TEXT,
      subclass TEXT
    );

    CREATE TABLE IF NOT EXISTS records (
      ecg_id INTEGER PRIMARY KEY,
      patient_id INTEGER,
      age INTEGER,
      sex INTEGER, -- 0 for Female, 1 for Male
      filename_lr TEXT,
      filename_hr TEXT,
      superclass TEXT,
      scp_codes TEXT, -- JSON string
      patient_metadata TEXT -- JSON string for other patient details
    );

    CREATE TABLE IF NOT EXISTS signals (
      ecg_id INTEGER,
      frequency INTEGER, -- 100 or 500
      data TEXT, -- JSON string mapping lead names to arrays of numbers
      PRIMARY KEY (ecg_id, frequency)
    );
  `);

  return dbInstance;
}

export function isDatabaseSeeded(): boolean {
  const db = getDB();
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM records").get();
    return row.count > 0;
  } catch (err) {
    return false;
  }
}
