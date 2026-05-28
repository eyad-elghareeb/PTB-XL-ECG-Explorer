import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from "sql.js";
import fs from "fs";
import path from "path";

// Locate the SQLite database file in the root configuration
const DB_PATH = path.resolve(process.cwd(), "ptbxl.db");

let dbInstance: SqlJsDatabase | null = null;
let initPromise: Promise<SqlJsDatabase> | null = null;
let SQL: SqlJsStatic | null = null;

export async function getDB(): Promise<SqlJsDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    SQL = await initSqlJs();

    // Check if the database file exists
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      dbInstance = new SQL.Database(buffer);
    } else {
      // Create a fresh in-memory database
      dbInstance = new SQL.Database();
    }

    // Performance pragmas for in-memory database
    dbInstance.run("PRAGMA journal_mode = MEMORY");
    dbInstance.run("PRAGMA synchronous = OFF");

    // Create tables if they do not exist
    dbInstance.run(`
      CREATE TABLE IF NOT EXISTS scp_statements (
        code TEXT PRIMARY KEY,
        description TEXT,
        superclass TEXT,
        subclass TEXT
      );
    `);

    dbInstance.run(`
      CREATE TABLE IF NOT EXISTS records (
        ecg_id INTEGER PRIMARY KEY,
        patient_id INTEGER,
        age INTEGER,
        sex INTEGER,
        filename_lr TEXT,
        filename_hr TEXT,
        superclass TEXT,
        scp_codes TEXT,
        patient_metadata TEXT,
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
    `);

    dbInstance.run(`
      CREATE TABLE IF NOT EXISTS signals (
        ecg_id INTEGER,
        frequency INTEGER,
        data TEXT,
        PRIMARY KEY (ecg_id, frequency)
      );
    `);

    // Check and upgrade schema for existing databases
    try {
      const columns = dbInstance.exec("PRAGMA table_info(records)");
      const columnNames = columns[0]?.values.map((c: any) => c[1]) || [];
      const requiredColumns: { name: string; type: string }[] = [
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
        { name: "infarction_stadium2", type: "TEXT" },
      ];

      for (const col of requiredColumns) {
        if (!columnNames.includes(col.name)) {
          dbInstance.run(`ALTER TABLE records ADD COLUMN ${col.name} ${col.type}`);
        }
      }
    } catch (err) {
      console.error("Failed to run database schema upgrades:", err);
    }

    return dbInstance;
  })();

  return initPromise;
}

export async function isDatabaseSeeded(): Promise<boolean> {
  try {
    const db = await getDB();
    const result = db.exec("SELECT COUNT(*) as count FROM records");
    const count = Number(result[0]?.values[0]?.[0] || 0);
    return count > 0;
  } catch (err) {
    return false;
  }
}

// ── sql.js helper functions to mimic better-sqlite3 interface ──────────────

/** Run a query and return all rows as objects (replaces db.prepare(sql).all(...)) */
export function queryAll(db: SqlJsDatabase, sql: string, params: any[] = []): any[] {
  if (params.length === 0 && !sql.includes("?")) {
    const result = db.exec(sql);
    if (result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map((row: any[]) => {
      const obj: Record<string, any> = {};
      columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  // Parameterized query - use prepared statement
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/** Run a query and return the first row as an object (replaces db.prepare(sql).get(...)) */
export function queryOne(db: SqlJsDatabase, sql: string, params: any[] = []): any | null {
  if (params.length === 0 && !sql.includes("?")) {
    const result = db.exec(sql);
    if (result.length === 0) return null;
    const { columns, values } = result[0];
    if (values.length === 0) return null;
    const obj: Record<string, any> = {};
    columns.forEach((col: string, i: number) => {
      obj[col] = values[0][i];
    });
    return obj;
  }

  // Parameterized query - use prepared statement
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row: any = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

/** Execute a statement with optional params (replaces db.prepare(sql).run(...)) */
export function queryRun(db: SqlJsDatabase, sql: string, params: any[] = []): void {
  if (params.length > 0 || sql.includes("?")) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
  } else {
    db.run(sql);
  }
}

/** Execute multiple statements in a transaction */
export function queryTransaction(db: SqlJsDatabase, fn: () => void): void {
  db.run("BEGIN TRANSACTION");
  try {
    fn();
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
}