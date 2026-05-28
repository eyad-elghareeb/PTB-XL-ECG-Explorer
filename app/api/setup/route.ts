import { NextRequest, NextResponse } from "next/server";
import { getStaticDataAvailable, getDbInfo } from "@/lib/data";
import { getDB, isDatabaseSeeded } from "@/lib/db";
import { seedDatabase, SeedProgress } from "@/lib/seed";

function isVercel(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;
}

// Global memory cache to track progress across page loads
let globalProgress: SeedProgress = {
  status: "idle",
  message: "Database check pending..."
};

let activePromise: Promise<void> | null = null;

export async function GET(req: NextRequest) {
  // On Vercel: check if static JSON data is available (pre-extracted at build time)
  if (isVercel()) {
    if (getStaticDataAvailable()) {
      const info = getDbInfo();
      return NextResponse.json({
        seeded: true,
        status: "complete",
        message: `Database pre-populated at build time with ${info?.totalRecords || "all"} clinical records.`,
        dbInfo: info
      });
    }
    // Static data not available — shouldn't happen if build ran correctly
    return NextResponse.json({
      seeded: false,
      progress: { status: "error", message: "Static data files not found. The build may have failed to extract data." }
    });
  }

  // Local dev: check sql.js database
  if (activePromise) {
    return NextResponse.json({
      seeded: false,
      progress: globalProgress
    });
  }

  const seeded = await isDatabaseSeeded();
  
  if (seeded) {
    return NextResponse.json({
      seeded: true,
      status: "complete",
      message: "Database already populated with clinical records."
    });
  }

  return NextResponse.json({
    seeded: false,
    progress: globalProgress
  });
}

export async function POST(req: NextRequest) {
  // On Vercel: seeding via sql.js is not supported — data comes from build-time extraction
  if (isVercel()) {
    if (getStaticDataAvailable()) {
      return NextResponse.json({
        seeded: true,
        status: "complete",
        message: "Data is pre-extracted at build time on Vercel. No runtime seeding needed."
      });
    }
    return NextResponse.json({
      seeded: false,
      progress: { status: "error", message: "Static data not available. Re-deploy to trigger build-time extraction." }
    });
  }

  // Local dev: allow runtime seeding
  let pullConfig = { mode: "metadata_only", count: 21837 };
  let overwrite = false;
  try {
    const body = await req.json();
    if (body.pullConfig) {
      pullConfig = body.pullConfig;
    }
    if (body.overwrite) {
      overwrite = body.overwrite;
    }
  } catch(e) {
    // default to partial
  }

  const seeded = await isDatabaseSeeded();
  if (seeded && !overwrite && pullConfig.mode !== "full_force") {
    return NextResponse.json({
      seeded: true,
      status: "complete",
      message: "Database is already seeded with clinical data."
    });
  }

  if (activePromise) {
    return NextResponse.json({
      seeded: false,
      progress: globalProgress,
      message: "An ingestion build is already running."
    });
  }

  // Trigger seeding asynchronously (so response is sent quickly to the client and we can poll progress)
  globalProgress = {
    status: "downloading_scp",
    message: "Triggering PTB-XL+ database seeding pipeline..."
  };

  activePromise = (async () => {
    try {
      await seedDatabase({ ...pullConfig, overwrite }, (p) => {
        globalProgress = p;
      });
    } catch (err: any) {
      console.error("Setup API seeder error:", err);
      globalProgress = {
        status: "error",
        message: err?.message || "Failed during signal compilation."
      };
    } finally {
      activePromise = null;
    }
  })();

  return NextResponse.json({
    seeded: false,
    progress: globalProgress,
    message: "Ingestion pipeline launched successfully!"
  });
}
