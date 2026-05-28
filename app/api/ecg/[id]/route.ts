import { NextRequest, NextResponse } from "next/server";
import { getStaticDataAvailable, queryRecordById } from "@/lib/data";
import { getDB, queryOne } from "@/lib/db";
import { parseHeader, parseBinarySignals } from "@/lib/seed";

function isVercel(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const idStr = params.id;
  const ecg_id = parseInt(idStr);

  if (isNaN(ecg_id)) {
    return NextResponse.json({ error: "Invalid record ID" }, { status: 400 });
  }

  try {
    let record: any = null;

    // On Vercel: get metadata from pre-extracted JSON data
    if (isVercel() && getStaticDataAvailable()) {
      record = queryRecordById(ecg_id);
    } else {
      // Local dev: use sql.js with the live SQLite database
      const db = await getDB();
      record = queryOne(db, "SELECT * FROM records WHERE ecg_id = ?", [ecg_id]);
    }

    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    // Fetch signal data on-the-fly from PhysioNet (works for both Vercel and local dev)
    const physioNetBase = "https://physionet.org/files/ptb-xl/1.0.1/";
    const filenameHr = record.filename_hr || record.filename_hr;
    const hrHeaUrl = `${physioNetBase}${filenameHr}.hea`;
    const hrDatUrl = `${physioNetBase}${filenameHr}.dat`;

    const [heaRes, datRes] = await Promise.all([
      fetch(hrHeaUrl),
      fetch(hrDatUrl)
    ]);

    if (!heaRes.ok || !datRes.ok) {
      console.error(`PhysioNet download failure for ECG ID ${ecg_id}: HEA: ${heaRes.status}, DAT: ${datRes.status}`);
      return NextResponse.json({
        error: "Waveform data not found on PhysioNet"
      }, { status: 404 });
    }

    const heaText = await heaRes.text();
    const datBufArr = await datRes.arrayBuffer();
    const datBuf = Buffer.from(datBufArr);

    const headerInfo = parseHeader(heaText);
    const data = parseBinarySignals(datBuf, headerInfo);

    // In local dev, try to cache in the database for faster subsequent loads
    if (!isVercel()) {
      try {
        const db = await getDB();
        const insertSignal = db.prepare(`
          INSERT OR REPLACE INTO signals (ecg_id, frequency, data)
          VALUES (?, 500, ?)
        `);
        insertSignal.bind([ecg_id, JSON.stringify(data)]);
        insertSignal.step();
        insertSignal.free();
      } catch (dbErr) {
        // Write failure, ignore
      }
    }

    // Normalize scp_codes: might already be an object (from data.ts) or a JSON string (from db.ts)
    let scpCodes = record.scp_codes;
    if (typeof scpCodes === "string") {
      try { scpCodes = JSON.parse(scpCodes); } catch { /* keep as string */ }
    }

    return NextResponse.json({
      ecg_id,
      patient_id: record.patient_id,
      age: record.age,
      sex: record.sex,
      superclass: record.superclass,
      scp_codes: scpCodes,
      height: record.height,
      weight: record.weight,
      report: record.report,
      recording_date: record.recording_date,
      heart_axis: record.heart_axis,
      pacemaker: record.pacemaker,
      device: record.device,
      nurse: record.nurse,
      site: record.site,
      validated_by: record.validated_by,
      infarction_stadium1: record.infarction_stadium1,
      infarction_stadium2: record.infarction_stadium2,
      frequency: 500,
      signals: data
    });

  } catch (err: any) {
    console.error(`API fetch error for record ID ${ecg_id}:`, err);
    return NextResponse.json({ error: "Waveform indexing pipeline error" }, { status: 500 });
  }
}
