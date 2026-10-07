/**
 * One session's tempo, streaks, and cadence — mirrors /api/session/{game_id}.
 * GET creates the bucket on first read; DELETE resets it (QA / seat change).
 */

import { NextResponse, type NextRequest } from "next/server";

import { get_session, reset_session } from "../../_engine/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ gameId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { gameId } = await ctx.params;
  const session_id = request.nextUrl.searchParams.get("session_id");
  const state = get_session(gameId, session_id);
  return NextResponse.json({ session: state.as_dict() });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { gameId } = await ctx.params;
  const session_id = request.nextUrl.searchParams.get("session_id");
  const state = reset_session(gameId, session_id);
  return NextResponse.json({ status: "reset", session: state.as_dict() });
}
