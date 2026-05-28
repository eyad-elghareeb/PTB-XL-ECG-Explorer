/**
 * Build-time script: extracts SQLite data into static JSON files in public/data/
 * This avoids loading sql.js WASM + 15MB database on Vercel serverless.
 * 
 * Run via: node scripts/extract-data.js
 */
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("📦 Extracting data from ptbxl.db into static JSON files...");

  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();

  const dbPath = path.resolve(process.cwd(), "ptbxl.db");
  if (!fs.existsSync(dbPath)) {
    console.log("❌ ptbxl.db not found at", dbPath);
    process.exit(1);
  }

  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  const outputDir = path.resolve(process.cwd(), "public", "data");
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Extract SCP statements as flat array
  console.log("   Extracting scp_statements...");
  const scpResult = db.exec("SELECT code, description, superclass, subclass FROM scp_statements");
  const scpStatements = [];
  if (scpResult.length > 0) {
    const { columns, values } = scpResult[0];
    const colIdx = columns.reduce((acc, col, i) => { acc[col] = i; return acc; }, {});
    for (const row of values) {
      scpStatements.push({
        code: row[colIdx["code"]],
        description: row[colIdx["description"]],
        superclass: row[colIdx["superclass"]],
        subclass: row[colIdx["subclass"]]
      });
    }
  }
  fs.writeFileSync(path.join(outputDir, "scp_statements.json"), JSON.stringify(scpStatements));
  console.log(`   ✅ ${scpStatements.length} SCP statements saved`);

  // 2. Extract all records
  console.log("   Extracting records...");
  const recordsResult = db.exec("SELECT * FROM records ORDER BY ecg_id ASC");
  const records = [];
  if (recordsResult.length > 0) {
    const { columns, values } = recordsResult[0];
    const colIdx = columns.reduce((acc, col, i) => { acc[col] = i; return acc; }, {});
    for (const row of values) {
      const obj = {};
      columns.forEach((col) => {
        let val = row[colIdx[col]];
        if ((col === "scp_codes" || col === "patient_metadata") && typeof val === "string") {
          try { val = JSON.parse(val); } catch {}
        }
        obj[col] = val;
      });
      records.push(obj);
    }
  }
  fs.writeFileSync(path.join(outputDir, "records.json"), JSON.stringify(records));
  console.log(`   ✅ ${records.length} records saved`);

  // 3. Build search index for fast lookups
  console.log("   Building search index...");
  const searchIndex = {};
  for (const rec of records) {
    const ecgId = rec["ecg_id"];
    const report = (rec["report"] || "").toLowerCase();
    const stadium1 = (rec["infarction_stadium1"] || "").toLowerCase();
    const stadium2 = (rec["infarction_stadium2"] || "").toLowerCase();
    const superclass = (rec["superclass"] || "").toLowerCase();
    searchIndex[ecgId] = {
      ecg_id: ecgId,
      patient_id: rec["patient_id"],
      superclass: superclass,
      searchText: `${ecgId} ${rec["patient_id"]} ${report} ${stadium1} ${stadium2}`,
    };
  }
  fs.writeFileSync(path.join(outputDir, "searchIndex.json"), JSON.stringify(searchIndex));
  console.log(`   ✅ Search index built for ${Object.keys(searchIndex).length} records`);

  // 4. Extract class counts
  console.log("   Computing class counts...");
  const classCounts = {};
  for (const rec of records) {
    const sc = rec["superclass"] || "UNKNOWN";
    classCounts[sc] = (classCounts[sc] || 0) + 1;
  }
  fs.writeFileSync(path.join(outputDir, "classCounts.json"), JSON.stringify(classCounts));
  console.log(`   ✅ Class counts saved`);

  db.close();
  
  const totalSize = fs.statSync(path.join(outputDir, "records.json")).size / 1024 / 1024;
  console.log(`✅ Data extraction complete! Total size: ${totalSize.toFixed(1)}MB`);
  console.log(`   Files saved to: ${outputDir}`);
}

main().catch((err) => {
  console.error("❌ Data extraction failed:", err);
  process.exit(1);
});