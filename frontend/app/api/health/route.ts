/** Built-in engine health check — mirrors middleware/main.py /api/health. */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "experience-engine-middleware",
    version: "0.4.0",
  });
}
