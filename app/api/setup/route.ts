import { NextRequest, NextResponse } from "next/server";
import { getDB, isDatabaseSeeded } from "@/lib/db";
import { seedDatabase, SeedProgress } from "@/lib/seed";

// Global memory cache to track progress across page loads
let globalProgress: SeedProgress = {
  status: "idle",
  message: "Database check pending..."
};

let activePromise: Promise<void> | null = null;

export async function GET(req: NextRequest) {
  const seeded = isDatabaseSeeded();
  
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
  const seeded = isDatabaseSeeded();
  if (seeded) {
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
    message: "Triggering PTB-XL database seeding pipeline..."
  };

  activePromise = (async () => {
    try {
      await seedDatabase((p) => {
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
