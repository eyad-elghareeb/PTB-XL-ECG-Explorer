import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const db = getDB();
  const idStr = params.id;
  const ecg_id = parseInt(idStr);

  if (isNaN(ecg_id)) {
    return NextResponse.json({ error: "Invalid record ID" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const frequency = parseInt(searchParams.get("frequency") || "100") === 500 ? 500 : 100;

  try {
    // 1. Fetch record metadata
    const record = db.prepare("SELECT * FROM records WHERE ecg_id = ?").get(ecg_id);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    // 2. Fetch signal data at requested frequency
    let signalRow = db.prepare("SELECT data FROM signals WHERE ecg_id = ? AND frequency = ?").get(ecg_id, frequency);
    
    // Fallback if requested frequency is not found
    if (!signalRow) {
      const altFreq = frequency === 100 ? 500 : 100;
      signalRow = db.prepare("SELECT data FROM signals WHERE ecg_id = ? AND frequency = ?").get(ecg_id, altFreq);
      if (signalRow) {
        console.warn(`ECG ID ${ecg_id}: standard frequency ${frequency}Hz was not seeded, falling back to ${altFreq}Hz`);
      }
    }

    if (!signalRow) {
      return NextResponse.json({
        error: "Waveform data not found in signals archive"
      }, { status: 404 });
    }

    const data = JSON.parse(signalRow.data);

    return NextResponse.json({
      ecg_id,
      patient_id: record.patient_id,
      age: record.age,
      sex: record.sex,
      superclass: record.superclass,
      scp_codes: JSON.parse(record.scp_codes),
      frequency,
      signals: data
    });

  } catch (err: any) {
    console.error(`API fetch error for record ID ${ecg_id}:`, err);
    return NextResponse.json({ error: "Waveform indexing pipeline error" }, { status: 500 });
  }
}
