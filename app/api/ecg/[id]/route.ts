import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { parseHeader, parseBinarySignals } from "@/lib/seed";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const db = getDB();
  const idStr = params.id;
  const ecg_id = parseInt(idStr);

  if (isNaN(ecg_id)) {
    return NextResponse.json({ error: "Invalid record ID" }, { status: 400 });
  }

  try {
    // 1. Fetch record metadata
    const record = db.prepare("SELECT * FROM records WHERE ecg_id = ?").get(ecg_id);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    // 2. Fetch signal data at standard 500Hz frequency
    let signalRow = db.prepare("SELECT data FROM signals WHERE ecg_id = ? AND frequency = 500").get(ecg_id);
    
    let data: any = null;

    if (signalRow) {
      data = JSON.parse(signalRow.data);
    } else {
      // Fetch on-the-fly from PhysioNet!
      const physioNetBase = "https://physionet.org/files/ptb-xl/1.0.1/";
      const hrHeaUrl = `${physioNetBase}${record.filename_hr}.hea`;
      const hrDatUrl = `${physioNetBase}${record.filename_hr}.dat`;

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
      data = parseBinarySignals(datBuf, headerInfo);

      // Attempt to cache in local database (will fail silently if database is read-only)
      try {
        const insertSignal = db.prepare(`
          INSERT OR REPLACE INTO signals (ecg_id, frequency, data)
          VALUES (?, 500, ?)
        `);
        insertSignal.run(ecg_id, JSON.stringify(data));
      } catch (dbErr) {
        // Read-only database or write failure, ignore
      }
    }

    return NextResponse.json({
      ecg_id,
      patient_id: record.patient_id,
      age: record.age,
      sex: record.sex,
      superclass: record.superclass,
      scp_codes: JSON.parse(record.scp_codes),
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
