import { getDB, queryAll, queryOne, queryRun, queryTransaction } from "./db";

interface LeadHeader {
  filename: string;
  format: string;
  gain: number;
  baseline: number;
  leadName: string;
}

export interface SeedProgress {
  status: "idle" | "downloading_scp" | "downloading_csv" | "processing_metadata" | "downloading_signals" | "complete" | "error";
  message: string;
  count?: number;
  total?: number;
}

// Custom CSV Parser
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes; // Toggle quote state
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseHeader(headerText: string): { numLeads: number; rate: number; numSamples: number; leads: LeadHeader[] } {
  const lines = headerText.split(/\r?\n/).filter(line => line.trim().length > 0 && !line.startsWith("#"));
  if (lines.length === 0) {
    throw new Error("Empty header file");
  }
  
  const firstLineParts = lines[0].trim().split(/\s+/);
  const numLeads = parseInt(firstLineParts[1]) || 12;
  const rate = parseInt(firstLineParts[2]) || 100;
  const numSamples = parseInt(firstLineParts[3]) || 1000;

  const leads: LeadHeader[] = [];
  for (let i = 1; i <= Math.min(numLeads, lines.length - 1); i++) {
    const parts = lines[i].trim().split(/\s+/);
    const filename = parts[0];
    const format = parts[1];
    const gainPart = parts[2] || "1000";
    const gain = parseFloat(gainPart.split("/")[0]) || 1000.0;
    const baseline = parseInt(parts[4]) || 0;
    const leadName = parts[parts.length - 1];
    leads.push({ filename, format, gain, baseline, leadName });
  }

  return { numLeads, rate, numSamples, leads };
}

export function parseBinarySignals(buffer: Buffer, info: { numLeads: number; numSamples: number; leads: LeadHeader[] }): Record<string, number[]> {
  const signals: Record<string, number[]> = {};
  
  info.leads.forEach(lead => {
    signals[lead.leadName] = [];
  });

  const numLeads = info.numLeads;
  const numSamples = info.numSamples;

  for (let s = 0; s < numSamples; s++) {
    for (let l = 0; l < numLeads; l++) {
      const lead = info.leads[l];
      const byteOffset = (s * numLeads + l) * 2;
      
      if (byteOffset + 1 < buffer.length) {
        const rawValue = buffer.readInt16LE(byteOffset);
        const valueInMv = (rawValue - lead.baseline) / lead.gain;
        signals[lead.leadName].push(Number(valueInMv.toFixed(4)));
      } else {
        signals[lead.leadName].push(0.0);
      }
    }
  }

  return signals;
}

export interface PullConfig {
  mode: string;
  count?: number;
  overwrite?: boolean;
}

export async function seedDatabase(pullConfig: PullConfig, onProgress?: (progress: SeedProgress) => void) {
  const db = await getDB();
  const physioNetBase = "https://physionet.org/files/ptb-xl/1.0.1/";

  try {
    // -------------------------------------------------------------
    // Step 0: Clear DB if overwrite is true
    // -------------------------------------------------------------
    if (pullConfig.overwrite) {
      if (onProgress) {
        onProgress({ status: "processing_metadata", message: "Clearing existing records for fresh import..." });
      }
      db.run("DELETE FROM records");
      db.run("DELETE FROM signals");
      db.run("DELETE FROM scp_statements");
    }

    // -------------------------------------------------------------
    // Step 1: Seed SCP Statements
    // -------------------------------------------------------------
    if (onProgress) {
      onProgress({ status: "downloading_scp", message: "Fetching clinical statement abbreviations..." });
    }

    const scpRes = await fetch(`${physioNetBase}scp_statements.csv`);
    if (!scpRes.ok) {
      throw new Error(`Failed to fetch scp_statements.csv: ${scpRes.statusText}`);
    }
    const scpText = await scpRes.text();
    const scpLines = scpText.split(/\r?\n/).filter(line => line.trim().length > 0);
    
    // Parse scp statements
    const scpHeader = parseCSVLine(scpLines[0]);
    const valCodeIdx = scpHeader.indexOf("") === -1 ? 0 : scpHeader.indexOf(""); // It could be index 0
    const descIdx = scpHeader.findIndex(h => h.toLowerCase().includes("desc")) || 1;
    const classIdx = scpHeader.findIndex(h => h.toLowerCase() === "class") || 2;
    const superclassIdx = scpHeader.findIndex(h => h.toLowerCase().includes("superclass")) || 3;
    const subclassIdx = scpHeader.findIndex(h => h.toLowerCase().includes("subclass")) || 4;

    const insertScp = db.prepare(`
      INSERT OR REPLACE INTO scp_statements (code, description, superclass, subclass)
      VALUES (?, ?, ?, ?)
    `);

    queryTransaction(db, () => {
      for (let i = 1; i < scpLines.length; i++) {
        const cols = parseCSVLine(scpLines[i]);
        if (cols.length < 2) continue;
        const code = cols[valCodeIdx] || cols[0];
        const desc = cols[descIdx] || "";
        const subclass = cols[subclassIdx] || "";
        const superclass = cols[superclassIdx] || "";
        insertScp.bind([code, desc, superclass, subclass]);
        insertScp.step();
        insertScp.reset();
      }
    });

    insertScp.free();

    // -------------------------------------------------------------
    // Step 2: Seed PTB-XL Metadata and CSV
    // -------------------------------------------------------------
    if (onProgress) {
      onProgress({ status: "downloading_csv", message: "Downloading main patient annotation registry (6.6MB)..." });
    }

    const dbRes = await fetch(`${physioNetBase}ptbxl_database.csv`);
    if (!dbRes.ok) {
      throw new Error(`Failed to fetch ptbxl_database.csv: ${dbRes.statusText}`);
    }
    const dbText = await dbRes.text();
    const dbLines = dbText.split(/\r?\n/).filter(line => line.trim().length > 0);

    if (onProgress) {
      onProgress({ status: "processing_metadata", message: "Filtering patients by diagnostic group..." });
    }

    const dbHeader = parseCSVLine(dbLines[0]);
    const ecgIdIdx = dbHeader.indexOf("ecg_id");
    const patientIdIdx = dbHeader.indexOf("patient_id");
    const ageIdx = dbHeader.indexOf("age");
    const sexIdx = dbHeader.indexOf("sex");
    const filenameLrIdx = dbHeader.indexOf("filename_lr");
    const filenameHrIdx = dbHeader.indexOf("filename_hr");
    const scpCodesIdx = dbHeader.indexOf("scp_codes");
    const heightIdx = dbHeader.indexOf("height");
    const weightIdx = dbHeader.indexOf("weight");
    const nurseIdx = dbHeader.indexOf("nurse");
    const siteIdx = dbHeader.indexOf("site");
    const deviceIdx = dbHeader.indexOf("device");
    const recordingDateIdx = dbHeader.indexOf("recording_date");
    const reportIdx = dbHeader.indexOf("report");
    const heartAxisIdx = dbHeader.indexOf("heart_axis");
    const infarctionStadium1Idx = dbHeader.indexOf("infarction_stadium1");
    const infarctionStadium2Idx = dbHeader.indexOf("infarction_stadium2");
    const validatedByIdx = dbHeader.indexOf("validated_by");
    const pacemakerIdx = dbHeader.indexOf("pacemaker");

    // Group candidates by superclass from scp_codes dictionary
    const categories: Record<string, string[]> = {
      NORM: [],
      MI: [],
      CD: [],
      HYP: [],
      STTC: []
    };

    const recordRows: Record<number, any> = {};

    for (let i = 1; i < dbLines.length; i++) {
      const cols = parseCSVLine(dbLines[i]);
      if (cols.length < scpCodesIdx) continue;

      const ecgId = parseInt(cols[ecgIdIdx]);
      const patientId = parseInt(cols[patientIdIdx]);
      const ageStr = cols[ageIdx];
      const age = ageStr ? Math.round(parseFloat(ageStr)) : 60;
      const sex = cols[sexIdx] === "1" ? 1 : 0; // standard binary
      const filenameLr = cols[filenameLrIdx];
      const filenameHr = cols[filenameHrIdx];
      const scpCodesStr = cols[scpCodesIdx];

      const heightVal = heightIdx !== -1 ? cols[heightIdx] : "";
      const weightVal = weightIdx !== -1 ? cols[weightIdx] : "";
      const pacemakerVal = pacemakerIdx !== -1 ? cols[pacemakerIdx] : "";

      const height = heightVal && !isNaN(parseFloat(heightVal)) ? Math.round(parseFloat(heightVal)) : null;
      const weight = weightVal && !isNaN(parseFloat(weightVal)) ? Math.round(parseFloat(weightVal)) : null;
      const nurse = nurseIdx !== -1 ? cols[nurseIdx] || null : null;
      const site = siteIdx !== -1 ? cols[siteIdx] || null : null;
      const device = deviceIdx !== -1 ? cols[deviceIdx] || null : null;
      const recordingDate = recordingDateIdx !== -1 ? cols[recordingDateIdx] || null : null;
      const report = reportIdx !== -1 ? cols[reportIdx] || null : null;
      const heartAxis = heartAxisIdx !== -1 ? cols[heartAxisIdx] || null : null;
      const infarctionStadium1 = infarctionStadium1Idx !== -1 ? cols[infarctionStadium1Idx] || null : null;
      const infarctionStadium2 = infarctionStadium2Idx !== -1 ? cols[infarctionStadium2Idx] || null : null;
      const validatedBy = validatedByIdx !== -1 ? cols[validatedByIdx] || null : null;
      const pacemaker = pacemakerVal === "true" || pacemakerVal === "1" ? 1 : 0;

      // Clean python dict braces to parse as JSON easily helper
      // Python: "{'NORM': 100.0, 'CLBBB': 50.0}"
      // JSON: '{"NORM": 100.0, "CLBBB": 50.0}'
      let cleanScp = scpCodesStr.replace(/'/g, '"');
      let scpDict: Record<string, number> = {};
      try {
        scpDict = JSON.parse(cleanScp);
      } catch (e) {
        // Fallback split parsing
        const matches = cleanScp.match(/"([^"]+)":\s*([\d.]+)/g);
        if (matches) {
          matches.forEach(m => {
            const parts = m.split(":");
            const k = parts[0].replace(/"/g, "").trim();
            const v = parseFloat(parts[1]);
            scpDict[k] = v;
          });
        }
      }

      // Check primary diagnosis (largest likelihood)
      let primaryCode = "";
      let maxLikelihood = -1;
      for (const [code, likelihood] of Object.entries(scpDict)) {
        if (likelihood > maxLikelihood) {
          maxLikelihood = likelihood;
          primaryCode = code;
        }
      }

      // Identify major clinical category group from primary code
      // Common mapping:
      let group = "NORM";
      if (primaryCode === "NORM") {
        group = "NORM";
      } else if (["IMI", "AMI", "ALMI", "ASMI", "LMI", "PMI", "INFT", "ANFT", "LAT", "WALL"].some(x => primaryCode.includes(x))) {
        group = "MI";
      } else if (["LBBB", "RBBB", "AVB", "WPW", "LAFB", "LPFB", "SVT", "AFIB", "AFLT"].some(x => primaryCode.includes(x))) {
        group = "CD";
      } else if (["LVH", "RVH", "RVH_LAE", "LVH_LAE", "LAH", "RAH"].some(x => primaryCode.includes(x))) {
        group = "HYP";
      } else if (["STTC", "T_INV", "T_PEK", "T_FLT", "NST_"].some(x => primaryCode.includes(x))) {
        group = "STTC";
      } else {
        // Fallback to scp mappings
        if (scpDict["NORM"] && scpDict["NORM"] > 50) {
          group = "NORM";
        } else {
          group = "STTC";
        }
      }

      categories[group].push(ecgId.toString());
      recordRows[ecgId] = {
        ecgId,
        patientId,
        age,
        sex,
        filenameLr,
        filenameHr,
        superclass: group,
        scpCodes: JSON.stringify(scpDict),
        height,
        weight,
        nurse,
        site,
        device,
        recordingDate,
        report,
        heartAxis,
        infarctionStadium1,
        infarctionStadium2,
        validatedBy,
        pacemaker
      };
    }

    // -------------------------------------------------------------
    // Step 3: Insert all metadata for all 21,837 parsed records first
    // -------------------------------------------------------------
    if (onProgress) {
      onProgress({ status: "processing_metadata", message: "Saving all 21,837 patient records to database metadata..." });
    }

    const allRecordIds = Object.keys(recordRows).map(id => parseInt(id)).sort((a, b) => a - b);
    const insertRecord = db.prepare(`
      INSERT OR REPLACE INTO records (
        ecg_id, patient_id, age, sex, filename_lr, filename_hr, superclass, scp_codes, patient_metadata,
        height, weight, report, recording_date, heart_axis, pacemaker, device, nurse, site, validated_by, infarction_stadium1, infarction_stadium2
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    queryTransaction(db, () => {
      for (const ecgId of allRecordIds) {
        const meta = recordRows[ecgId];
        if (!meta) continue;
        insertRecord.bind([
          meta.ecgId,
          meta.patientId,
          meta.age,
          meta.sex,
          meta.filenameLr,
          meta.filenameHr,
          meta.superclass,
          meta.scpCodes,
          JSON.stringify({
            scp_primary_group: meta.superclass,
            rec_id_number: ecgId,
            strat_fold: 10,
            height: meta.height,
            weight: meta.weight,
            report: meta.report,
            recording_date: meta.recordingDate,
            heart_axis: meta.heartAxis,
            pacemaker: meta.pacemaker,
            device: meta.device,
            nurse: meta.nurse,
            site: meta.site,
            validated_by: meta.validatedBy,
            infarction_stadium1: meta.infarctionStadium1,
            infarction_stadium2: meta.infarctionStadium2
          }),
          meta.height,
          meta.weight,
          meta.report,
          meta.recordingDate,
          meta.heartAxis,
          meta.pacemaker,
          meta.device,
          meta.nurse,
          meta.site,
          meta.validatedBy,
          meta.infarctionStadium1,
          meta.infarctionStadium2
        ]);
        insertRecord.step();
        insertRecord.reset();
      }
    });

    insertRecord.free();

    // -------------------------------------------------------------
    // Step 4: Handle Online Mode (Metadata Only) vs Offline Mode
    // -------------------------------------------------------------
    if (pullConfig.mode === "metadata_only" || pullConfig.mode === "online") {
      if (onProgress) {
        onProgress({
          status: "complete",
          message: "Online mode initialized successfully! All 21,837 metadata records seeded. Waveforms will fetch on-demand.",
          count: allRecordIds.length,
          total: allRecordIds.length
        });
      }
      return;
    }

    // Offline mode: Determine subset of signals to download/cache
    const selectedIds: number[] = [];
    
    if (pullConfig.mode === "full" || pullConfig.mode === "full_force") {
      const totalRequested = pullConfig.count || 1000; // default to a safe limit for full local download
      let count = 0;
      for (const [group, idsForGroup] of Object.entries(categories)) {
        for (let i = 0; i < idsForGroup.length; i++) {
          if (count >= totalRequested) break;
          selectedIds.push(parseInt(idsForGroup[i]));
          count++;
        }
        if (count >= totalRequested) break;
      }
    } else {
      // Partial / preview mode
      const multiplier = (pullConfig.count && pullConfig.count > 36) ? Math.floor(pullConfig.count / 36) : 1;
      const targetCounts: Record<string, number> = {
        NORM: 8 * multiplier,
        MI: 8 * multiplier,
        CD: 8 * multiplier,
        HYP: 6 * multiplier,
        STTC: 6 * multiplier
      };

      for (const [group, targetCount] of Object.entries(targetCounts)) {
        const idsForGroup = categories[group] || [];
        for (let i = 0; i < Math.min(targetCount, idsForGroup.length); i++) {
          selectedIds.push(parseInt(idsForGroup[i]));
        }
      }
    }

    if (onProgress) {
      onProgress({
        status: "downloading_signals",
        message: "Fetching digital signal binary waveforms (500Hz only)...",
        count: 0,
        total: selectedIds.length
      });
    }

    let completed = 0;
    const insertSignal = db.prepare(`
      INSERT OR REPLACE INTO signals (ecg_id, frequency, data)
      VALUES (?, 500, ?)
    `);

    // Download and parse `.hea` and `.dat` files for each selected patient record
    for (const ecgId of selectedIds) {
      const meta = recordRows[ecgId];
      if (!meta) continue;

      if (onProgress) {
        onProgress({
          status: "downloading_signals",
          message: `Ingesting 500Hz signals for patient ECG-ID ${ecgId}...`,
          count: completed + 1,
          total: selectedIds.length
        });
      }

      try {
        // Process 500Hz Signal only (100Hz removed)
        const hrHeaUrl = `${physioNetBase}${meta.filenameHr}.hea`;
        const hrDatUrl = `${physioNetBase}${meta.filenameHr}.dat`;

        const hrHeaRes = await fetch(hrHeaUrl);
        const hrDatRes = await fetch(hrDatUrl);

        if (hrHeaRes.ok && hrDatRes.ok) {
          const heaText = await hrHeaRes.text();
          const datBufArr = await hrDatRes.arrayBuffer();
          const datBuf = Buffer.from(datBufArr);

          const headerInfo = parseHeader(heaText);
          const signals500 = parseBinarySignals(datBuf, headerInfo);

          insertSignal.bind([ecgId, JSON.stringify(signals500)]);
          insertSignal.step();
          insertSignal.reset();
        }

        completed++;
      } catch (err) {
        console.error(`Error processing ECG Record ${ecgId}:`, err);
        // Continue to other records so we don't break the full chain
      }
    }

    insertSignal.free();

    if (onProgress) {
      onProgress({ status: "complete", message: "PTB-XL ECG Seed Database Initialized successfully!", count: completed, total: selectedIds.length });
    }

  } catch (error: any) {
    console.error("General error database seeder:", error);
    if (onProgress) {
      onProgress({ status: "error", message: `Seeder Failure: ${error?.message || error}` });
    }
  }
}