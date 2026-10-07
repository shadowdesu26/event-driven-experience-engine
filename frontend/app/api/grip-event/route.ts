/**
 * Built-in Experience Engine endpoint for the online demo (Netlify).
 *
 * Mirrors middleware/main.py: accepts a simulated GRIP event payload and
 * returns the allocation directive — including the timed suspense program and
 * the adaptive pacing — using the TypeScript port in `_engine/`.
 *
 * In local development `next.config.ts` rewrites /api/* to the Python
 * middleware instead, so this handler only serves when no ENGINE_URL is set
 * (production builds and local `next start` without the env var).
 */

import { NextResponse } from "next/server";

import { EVENT_TYPES, type EventType } from "@/app/lib/api";
import { route_event, type EngineEvent } from "../_engine/router";

export const dynamic = "force-dynamic";

const WIN_LEVELS = new Set(["NONE", "LOW", "MEDIUM", "HIGH", "JACKPOT"]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map((v) => String(v)) : null;
}

function numList(value: unknown): number[] | null {
  return Array.isArray(value) ? value.map((v) => (typeof v === "number" ? v : NaN)).filter(Number.isFinite) : null;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const eventType = str(body.event_type) ?? "";
  if (!(EVENT_TYPES as readonly string[]).includes(eventType)) {
    return NextResponse.json(
      { detail: `event_type must be one of: ${EVENT_TYPES.join(", ")}` },
      { status: 422 },
    );
  }

  const spin_phase = body.spin_phase === "reels_spinning" ? "reels_spinning" : "resolved";
  const win_level_raw = str(body.win_level);

  const event: EngineEvent = {
    event_type: eventType as EventType,
    game_id: str(body.game_id) ?? "SLOT-WUXIA-01",
    theme: str(body.theme) ?? "wuxia",
    bet_amount: num(body.bet_amount, 25.0),
    win_amount: num(body.win_amount, 0.0),
    win_level: win_level_raw && WIN_LEVELS.has(win_level_raw) ? win_level_raw : "NONE",
    symbols: strList(body.symbols),
    event_id: str(body.event_id),
    timestamp: str(body.timestamp),
    session_id: str(body.session_id),
    spin_phase: spin_phase as "reels_spinning" | "resolved",
    reel_stop_ms: numList(body.reel_stop_ms),
  };

  const routed = route_event(event);
  const message = `${routed.message as string} [event_id=${event.event_id ?? crypto.randomUUID()} t=${event.timestamp ?? new Date().toISOString()}]`;

  return NextResponse.json({
    event_type: routed.event_type,
    action: routed.action,
    asset_path: routed.asset_path,
    asset_type: routed.asset_type,
    soundtrack_path: routed.soundtrack_path ?? "",
    ui_pulse: routed.ui_pulse ?? "none",
    volume: routed.volume ?? 0.7,
    win_multiplier: routed.win_multiplier ?? 0.0,
    message,
    phase: routed.phase ?? "play",
    audio: routed.audio ?? {
      name: "standard",
      duration_scale: 1.0,
      attack_ms: 8,
      tail: true,
      lowpass_hz: null,
      volume_scale: 1.0,
      bed_synth: "soft_pad",
    },
    bedtrack_path: routed.bedtrack_path ?? "",
    bedtrack_volume: routed.bedtrack_volume ?? 0.0,
    tempo: routed.tempo ?? "steady",
    cadence_ms: routed.cadence_ms ?? 0.0,
    losing_streak: routed.losing_streak ?? 0,
    win_streak: routed.win_streak ?? 0,
    drought_tier: routed.drought_tier ?? "none",
    cues: routed.cues ?? [],
    light_program: routed.light_program ?? {
      pattern: "none",
      period_ms: 0,
      color: "amber",
      intensity: 0.0,
      temperament: "warm",
    },
    close_call: routed.close_call ?? null,
    suspense_asset_path: routed.suspense_asset_path ?? "",
    suspense_total_ms: routed.suspense_total_ms ?? 0,
    session_id: routed.session_id ?? "",
  });
}
