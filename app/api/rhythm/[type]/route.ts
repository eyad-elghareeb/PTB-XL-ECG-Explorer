import { NextRequest, NextResponse } from "next/server";
import { getDB, queryAll } from "@/lib/db";

export async function GET(req: NextRequest, props: { params: Promise<{ type: string }> }) {
  const params = await props.params;
  const db = await getDB();
  const rawType = params.type.toUpperCase();

  // Map user-friendly category handles to database superclasses
  let superclass = "NORM";
  switch (rawType) {
    case "NORM":
    case "NORMAL":
      superclass = "NORM";
      break;
    case "MI":
    case "ISCHEMIA":
    case "INFARCT":
    case "INFARCTION":
      superclass = "MI";
      break;
    case "CD":
    case "CONDUCTION":
    case "BLOCKS":
    case "ARRHYTHMIA":
      superclass = "CD";
      break;
    case "HYP":
    case "HYPERTROPHY":
      superclass = "HYP";
      break;
    case "STTC":
    case "REPOLARIZATION":
      superclass = "STTC";
      break;
    default:
      superclass = rawType;
      break;
  }

  try {
    const records = queryAll(db, `
      SELECT * FROM records 
      WHERE superclass = ? 
      ORDER BY ecg_id ASC
    `, [superclass]);

    return NextResponse.json({
      type: superclass,
      count: records.length,
      records
    });
  } catch (err: any) {
    console.error(`API rhythm list failure for type ${superclass}:`, err);
    return NextResponse.json({ error: "Failed to list records for selected pathology category" }, { status: 500 });
  }
}