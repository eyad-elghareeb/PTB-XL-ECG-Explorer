/**
 * Build-time script that extracts records and SCP statements from the SQLite
 * database into static JSON files. These JSON files are then served by the API
 * routes on Vercel, avoiding the need to load sql.js (WASM) and a 15MB DB
 * file at runtime.
 *
 * Usage: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/extract-data.ts
 * Or as part of the build pipeline.
 */

import fs from "fs";
import path from "path";

async function main() {
  console.log("📦 Extracting data from ptbxl.db into static JSON files...");

  // Dynamically import sql.js (only used at build time)
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();

  const dbPath = path.resolve(process.cwd(), "ptbxl.db");
  if (!fs.existsSync(dbPath)) {
    console.log("❌ ptbxl.db not found at", dbPath);
    console.log("   Skipping data extraction — API will use sql.js fallback.");
    return;
  }

  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);

  const outputDir = path.resolve(process.cwd(), "public", "data");
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Extract SCP statements
  console.log("   Extracting scp_statements...");
  const scpResult = db.exec("SELECT code, description, superclass, subclass FROM scp_statements");
  const scpStatements: Record<string, any> = {};
  if (scpResult.length > 0) {
    const { columns, values } = scpResult[0];
    for (const row of values) {
      const obj: Record<string, any> = {};
      columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });
      scpStatements[obj.code] = obj;
    }
  }
  fs.writeFileSync(
    path.join(outputDir, "scp_statements.json"),
    JSON.stringify(scpStatements)
  );
  console.log(`   ✅ ${Object.keys(scpStatements).length} SCP statements saved`);

  // 2. Extract all records (metadata only, no signals)
  console.log("   Extracting records...");
  const recordsResult = db.exec("SELECT * FROM records ORDER BY ecg_id ASC");
  const records: any[] = [];
  if (recordsResult.length > 0) {
    const { columns, values } = recordsResult[0];
    for (const row of values) {
      const obj: Record<string, any> = {};
      columns.forEach((col: string, i: number) => {
        const val = row[i];
        // Parse stored JSON strings back to objects
        if (col === "scp_codes" || col === "patient_metadata") {
          try {
            obj[col] = JSON.parse(val as string);
          } catch {
            obj[col] = val;
          }
        } else {
          obj[col] = val;
        }
      });
      records.push(obj);
    }
  }
  fs.writeFileSync(path.join(outputDir, "records.json"), JSON.stringify(records));
  console.log(`   ✅ ${records.length} records saved`);

  // 3. Extract class counts
  console.log("   Computing class counts...");
  const countsResult = db.exec("SELECT superclass, COUNT(*) as count FROM records GROUP BY superclass");
  const classCounts: Record<string, number> = {};
  if (countsResult.length > 0) {
    const { columns, values } = countsResult[0];
    for (const row of values) {
      const superclass = row[0] as string;
      const count = Number(row[1]);
      classCounts[superclass] = count;
    }
  }
  fs.writeFileSync(
    path.join(outputDir, "classCounts.json"),
    JSON.stringify(classCounts)
  );
  console.log(`   ✅ Class counts saved:`, classCounts);

  // 4. Create a database metadata index
  const dbInfo = {
    totalRecords: records.length,
    totalScpStatements: Object.keys(scpStatements).length,
    classCounts,
    extractedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(outputDir, "db_info.json"),
    JSON.stringify(dbInfo)
  );

  db.close();
  console.log("✅ Data extraction complete! Files saved to:", outputDir);
}

main().catch((err) => {
  console.error("❌ Data extraction failed:", err);
  process.exit(1);
});