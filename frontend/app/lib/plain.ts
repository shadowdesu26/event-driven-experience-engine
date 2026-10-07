/**
 * Plain if/else baseline — what the game plays like with NO Experience Engine.
 *
 * This is the A/B comparison pole for the engine toggle: a hardcoded lookup of
 * "which result → which fixed video" plus one fixed beep per outcome class.
 * No player history, no pacing, no close-call suspense, no streaks, no
 * session state — every trigger of the same event type produces exactly the
 * same presentation, forever.
 */
import { type EventType, type GripEventPayload, type GripResponse } from "@/app/lib/api";

/** Fixed if/else allocation ladder, evaluated top-down like a plain handler. */
export function plainDirective(payload: {
  event_type: EventType;
  bet_amount?: number;
  win_amount?: number;
}): GripResponse {
  const bet = payload.bet_amount ?? 25;
  const win = payload.win_amount ?? 0;
  const multiplier = bet > 0 ? win / bet : 0;
  const type = payload.event_type;

  let asset_path: string;
  let volume: number;
  let ui_pulse: GripResponse["ui_pulse"];
  let message: string;

  if (type === "JACKPOT") {
    asset_path = "/wuxia/wuxia_jackpot.mp4";
    volume = 1.0;
    ui_pulse = "full";
    message = "Plain mapping: JACKPOT -> jackpot clip, always.";
  } else if (type === "BIG_WIN") {
    asset_path = "/wuxia/wuxia_big_win.mp4";
    volume = 0.8;
    ui_pulse = "strong";
    message = "Plain mapping: BIG_WIN -> big-win clip, always.";
  } else if (type === "BONUS_TRIGGER") {
    asset_path = "/wuxia/wuxia_bonus_trigger.mp4";
    volume = 0.75;
    ui_pulse = "strong";
    message = "Plain mapping: BONUS_TRIGGER -> bonus clip, always.";
  } else if (type === "WIN_STREAK") {
    asset_path = "/wuxia/wuxia_win_streak.mp4";
    volume = 1.0;
    ui_pulse = "full";
    message = "Plain mapping: WIN_STREAK -> streak clip, always.";
  } else if (type === "NEAR_WIN") {
    asset_path = "/wuxia/wuxia_near_win.mp4";
    volume = 0.55;
    ui_pulse = "subtle";
    message = "Plain mapping: NEAR_WIN -> near-win clip, always.";
  } else if (type === "SPIN_RESULT") {
    asset_path = "/wuxia/wuxia_spin_result.mp4";
    volume = 0.35;
    ui_pulse = "none";
    message = "Plain mapping: SPIN_RESULT -> standard clip, always.";
  } else if (type === "NO_WIN") {
    asset_path = "/wuxia/WUXIA_NO_WIN.mp4";
    volume = 0.3;
    ui_pulse = "none";
    message = "Plain mapping: NO_WIN -> no-win clip, always.";
  } else {
    asset_path = "/wuxia/wuxia_game_start.mp4";
    volume = 0.4;
    ui_pulse = "subtle";
    message = "Plain mapping: GAME_START -> opening clip, always.";
  }

  return {
    event_type: type,
    action: "play",
    asset_path,
    asset_type: "video",
    soundtrack_path: "",
    ui_pulse,
    volume,
    win_multiplier: Math.round(multiplier * 100) / 100,
    message,
    phase: "play",
    tempo: "steady",
    cadence_ms: 0,
    losing_streak: 0,
    win_streak: 0,
    drought_tier: "none",
    cues: [],
    light_program: {
      pattern: "none",
      period_ms: 0,
      color: "amber",
      intensity: 0,
      temperament: "warm",
    },
    close_call: null,
    suspense_asset_path: "",
    suspense_total_ms: 0,
    session_id: "",
  };
}

/** The plain player only ever has two canned sounds: win jingle and loss buzz. */
export function plainStingDirection(eventType: EventType): "win" | "loss" {
  if (
    eventType === "BIG_WIN" ||
    eventType === "JACKPOT" ||
    eventType === "BONUS_TRIGGER" ||
    eventType === "WIN_STREAK" ||
    eventType === "SPIN_RESULT"
  ) {
    return "win";
  }
  return "loss";
}
