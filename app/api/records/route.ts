import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDB();
  const { searchParams } = new URL(req.url);

  const superclass = searchParams.get("superclass");
  const search = searchParams.get("search");
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "40"));
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    let query = "SELECT * FROM records";
    const params: any[] = [];
    const whereClauses: string[] = [];

    if (superclass && superclass !== "ALL") {
      whereClauses.push("superclass = ?");
      params.push(superclass);
    }

    if (search) {
      whereClauses.push("(ecg_id LIKE ? OR patient_id LIKE ? OR scp_codes LIKE ?)");
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    if (whereClauses.length > 0) {
      query += " WHERE " + whereClauses.join(" AND ");
    }

    query += " ORDER BY ecg_id ASC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const records = db.prepare(query).all(...params);

    // Get separate breakdown of counts per superclass
    const counts = db.prepare(`
      SELECT superclass, COUNT(*) as count 
      FROM records 
      GROUP BY superclass
    `).all();

    // Map counts array to an object e.g. { NORM: 8, MI: 8, ... }
    const classCounts: Record<string, number> = {};
    counts.forEach((c: any) => {
      classCounts[c.superclass] = c.count;
    });

    return NextResponse.json({
      records,
      classCounts
    });
  } catch (err: any) {
    console.error("API /api/records failure:", err);
    return NextResponse.json({ error: "Failed to fetch clinical records from database" }, { status: 500 });
  }
}
