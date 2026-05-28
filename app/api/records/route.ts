import { NextRequest, NextResponse } from "next/server";
import { getStaticDataAvailable, queryRecords } from "@/lib/data";
import { getDB, queryAll } from "@/lib/db";

function isVercel(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const superclass = searchParams.get("superclass");
  const search = searchParams.get("search");
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "40"));
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // On Vercel: use pre-extracted JSON data (fast, no WASM cold-start)
    if (isVercel() && getStaticDataAvailable()) {
      const result = queryRecords({ superclass, search, limit, offset });
      return NextResponse.json(result);
    }

    // Local dev fallback: use sql.js with the live SQLite database
    const db = await getDB();

    // Build query with parameters
    let query = "SELECT * FROM records";
    const params: any[] = [];
    const whereClauses: string[] = [];

    if (superclass && superclass !== "ALL") {
      whereClauses.push("superclass = ?");
      params.push(superclass);
    }

    if (search) {
      const words = search.trim().split(/\s+/).filter(w => w.length > 0);
      if (words.length > 0) {
        const matchingCodesSet = new Set<string>();
        for (const word of words) {
          const term = `%${word}%`;
          try {
            const codes = queryAll(db,
              "SELECT code FROM scp_statements WHERE code LIKE ? OR description LIKE ? OR subclass LIKE ? OR superclass LIKE ?",
              [term, term, term, term]
            );
            codes.forEach((row: any) => matchingCodesSet.add(row.code));
          } catch (e) {
            console.error("Failed to query scp_statements:", e);
          }
        }
        const matchingCodes = Array.from(matchingCodesSet);

        const wordClauses: string[] = [];
        for (const word of words) {
          const term = `%${word}%`;
          const clauses = [
            "ecg_id LIKE ?",
            "patient_id LIKE ?",
            "report LIKE ?",
            "infarction_stadium1 LIKE ?",
            "infarction_stadium2 LIKE ?"
          ];
          params.push(term, term, term, term, term);

          matchingCodes.forEach(code => {
            clauses.push("scp_codes LIKE ?");
            params.push(`%"${code}"%`);
          });

          wordClauses.push("(" + clauses.join(" OR ") + ")");
        }

        whereClauses.push("(" + wordClauses.join(" AND ") + ")");
      }
    }

    if (whereClauses.length > 0) {
      query += " WHERE " + whereClauses.join(" AND ");
    }

    query += " ORDER BY ecg_id ASC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const records = queryAll(db, query, params);

    // Get separate breakdown of counts per superclass
    const counts = queryAll(db, `
      SELECT superclass, COUNT(*) as count 
      FROM records 
      GROUP BY superclass
    `);

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
