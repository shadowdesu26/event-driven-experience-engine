/** Every tracked pacing session — QA readout, mirrors /api/sessions. */

import { NextResponse } from "next/server";

import { list_sessions } from "../_engine/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ sessions: list_sessions() });
}
