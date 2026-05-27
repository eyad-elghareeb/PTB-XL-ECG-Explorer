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
      patient_metadata TEXT, -- JSON string for other patient details
      height INTEGER,
      weight INTEGER,
      report TEXT,
      recording_date TEXT,
      heart_axis TEXT,
      pacemaker INTEGER,
      device TEXT,
      nurse TEXT,
      site TEXT,
      validated_by TEXT,
      infarction_stadium1 TEXT,
      infarction_stadium2 TEXT
    );

    CREATE TABLE IF NOT EXISTS signals (
      ecg_id INTEGER,
      frequency INTEGER, -- 100 or 500
      data TEXT, -- JSON string mapping lead names to arrays of numbers
      PRIMARY KEY (ecg_id, frequency)
    );
  `);

  // Check and upgrade schema for existing databases
  try {
    const columns = dbInstance.pragma("table_info(records)").map((c: any) => c.name);
    const requiredColumns = [
      { name: "height", type: "INTEGER" },
      { name: "weight", type: "INTEGER" },
      { name: "report", type: "TEXT" },
      { name: "recording_date", type: "TEXT" },
      { name: "heart_axis", type: "TEXT" },
      { name: "pacemaker", type: "INTEGER" },
      { name: "device", type: "TEXT" },
      { name: "nurse", type: "TEXT" },
      { name: "site", type: "TEXT" },
      { name: "validated_by", type: "TEXT" },
      { name: "infarction_stadium1", type: "TEXT" },
      { name: "infarction_stadium2", type: "TEXT" }
    ];

    for (const col of requiredColumns) {
      if (!columns.includes(col.name)) {
        dbInstance.exec(`ALTER TABLE records ADD COLUMN ${col.name} ${col.type}`);
      }
    }
  } catch (err) {
    console.error("Failed to run database schema upgrades:", err);
  }

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
