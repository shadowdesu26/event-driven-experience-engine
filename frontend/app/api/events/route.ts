/** Enum helper so clients stay in sync with supported events — mirrors /api/events. */

import { NextResponse } from "next/server";

import { EVENT_ASSET_MAP } from "../_engine/router";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    events: Object.keys(EVENT_ASSET_MAP),
    spin_phases: ["reels_spinning", "resolved"],
    tempos: ["rapid", "steady", "deliberate"],
    audio_profiles: ["punchy", "standard", "consoling"],
    light_patterns: [
      "none",
      "breathe",
      "pulse",
      "flash-soft",
      "flash-hard",
      "flash-strobe",
      "flare",
    ],
  });
}
