/**
 * TypeScript port of middleware/suspense.py — close-call suspense engine.
 *
 * When the outcome of a spin is already decided but the cabinet reels are still
 * turning, the engine has a window to sell the almost-win. The frontend fires
 * one pre-resolution probe carrying the pending outcome plus the reel stop
 * schedule; this module decides whether the result is worth teasing and returns
 * a timed cue ladder anchored to the reel stop boundaries.
 */

import type { Cue, CloseCall, LightPattern } from "@/app/lib/api";

import { drought_tier } from "./mood";
import { tempo_bpm_scale, type SessionState } from "./session";

// Symbol classes used to classify a pending outcome.
export const SCATTER_SYMBOLS: ReadonlySet<string> = new Set(["⭐"]);
export const PREMIUM_SYMBOLS: ReadonlySet<string> = new Set(["7", "💎"]);

// Reel stop schedule assumed when the client does not send one. Mirrors the
// cabinet simulator: 900ms base plus a 750ms stagger per reel.
export const DEFAULT_REEL_STOP_MS: readonly number[] = [900, 1650, 2400, 3150, 3900];

export const MAX_REEL_STOP_MS = 15000;
export const MAX_SYMBOLS = 5;

// Heartbeat ladder. Each rung is a tighter pulse and a harder light pattern.
export const BASE_BPM: Record<number, number> = { 1: 66.0, 2: 84.0, 3: 96.0 };
export const STEPS: Record<number, number> = { 1: 4, 2: 5, 3: 5 };
export const BPM_STEP_RATIO = 0.2;
export const BASE_VOLUME = 0.28;
export const VOLUME_STEP = 0.07;
export const MAX_VOLUME = 0.6;
export const MAX_BPM = 150.0;

// Light patterns escalate in step with the heartbeat.
export const LIGHT_LADDER: readonly LightPattern[] = [
  "breathe",
  "pulse",
  "flash-soft",
  "flash-hard",
  "flash-strobe",
];

export const RELEASE_LIGHT: LightPattern = "flare";
export const RELEASE_INTENSITY: Record<number, number> = { 1: 0.45, 2: 0.65, 3: 0.85 };

// --- suspense fatigue policy -------------------------------------------
//
// A pulse that fires on every tease trains players to ignore it. Severity-
// scaled refractory window plus a rolling per-minute budget.
export const SUSPENSE_REFRACTORY_S: Record<number, number> = { 1: 15.0, 2: 10.0, 3: 5.0 };
export const SUSPENSE_BUDGET_WINDOW_S = 60.0;
export const SUSPENSE_BUDGET_MAX = 3;

// --- cross-state fusion ------------------------------------------------
export const FUSION_BPM_STEP = 0.05;
export const FUSION_VOLUME_STEP: Record<string, number> = {
  none: 0.0,
  mild: 0.03,
  deep: 0.06,
  severe: 0.09,
};
const TIER_INDEX: Record<string, number> = { none: 0, mild: 1, deep: 2, severe: 3 };

/** Fatigue gate for a pending tease: True when the seat may get a ladder. */
export function suspense_allowed(
  state: SessionState,
  severityIn: number,
  now: number,
): [boolean, string] {
  const severity = Math.max(1, Math.min(3, severityIn));
  const required = SUSPENSE_REFRACTORY_S[severity];
  if (state.last_suspense_at !== null) {
    const since = now - state.last_suspense_at;
    if (since < required) {
      return [
        false,
        `refractory holds: ${(required - since).toFixed(1)}s of ${required.toFixed(0)}s cooldown remains for severity ${severity}`,
      ];
    }
  }
  const recent = state.suspense_times.filter((t) => now - t <= SUSPENSE_BUDGET_WINDOW_S);
  if (recent.length >= SUSPENSE_BUDGET_MAX) {
    return [
      false,
      `tease budget spent: ${recent.length} ladders in the last ${SUSPENSE_BUDGET_WINDOW_S.toFixed(0)}s`,
    ];
  }
  return [true, ""];
}

/** Mood x suspense fusion: rewrite (or drop) a tease by player context. */
export function fuse_close_call(
  signal: CloseCallSignal,
  state: SessionState,
): [CloseCallSignal | null, string] {
  const tier = drought_tier(state.losing_streak);
  let severity = signal.severity;
  let note = "";

  if (tier !== "none" && severity < 3) {
    severity = severity + 1;
    note = `drought-fused ${signal.severity}->${severity}`;
  }

  if (state.tempo === "rapid" && severity <= 1 && tier === "none") {
    return [null, "rapid tempo leaves no window for a weak tease"];
  }

  if (severity !== signal.severity) {
    signal = makeCloseCallSignal(signal.kind, severity, signal.label, signal.detail, signal.symbols);
  }
  return [signal, note];
}

export interface CloseCallSignal {
  kind: string;
  severity: number;
  label: string;
  detail: string;
  symbols: string[];

  as_dict(): CloseCall;
}

export function makeCloseCallSignal(
  kind: string,
  severity: number,
  label: string,
  detail: string,
  symbols: string[],
): CloseCallSignal {
  return {
    kind,
    severity,
    label,
    detail,
    symbols,
    as_dict() {
      return {
        kind: this.kind,
        severity: this.severity,
        label: this.label,
        detail: this.detail,
        symbols: [...this.symbols],
      };
    },
  };
}

function clean_symbols(symbols: string[] | null | undefined): string[] {
  return (symbols ?? []).slice(0, MAX_SYMBOLS);
}

/** Most common symbol across the leading reels, and how many hold it. */
function leading_lock_count(symbols: string[]): [string | null, number] {
  if (!symbols.length) return [null, 0];
  const leading = symbols.slice(0, -1);
  const counts = new Map<string, number>();
  for (const symbol of leading) {
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  // max() over insertion order: the first symbol to reach the top count wins,
  // matching Python's dict-ordering tie-break.
  let best: string | null = null;
  let bestCount = 0;
  counts.forEach((count, symbol) => {
    if (count > bestCount) {
      best = symbol;
      bestCount = count;
    }
  });
  return [best, bestCount];
}

export function detect_close_call(
  symbols: string[] | null | undefined,
  event_type?: string | null,
  _win_amount = 0.0,
  _bet_amount = 0.0,
): CloseCallSignal | null {
  // Checked most-specific first so a genuine near miss is never reported as a
  // jackpot tease.
  const board = clean_symbols(symbols);
  if (!board.length) return null;

  const [locked, lock_count] = leading_lock_count(board);
  const final_differs = board.length >= MAX_SYMBOLS && board[board.length - 1] !== locked;

  // 1. Near miss: leading reels lock, final reel misses.
  if (locked !== null && lock_count >= 3 && final_differs) {
    const premium = PREMIUM_SYMBOLS.has(locked);
    const severity = premium ? 2 : 1;
    const kind = premium ? "near_miss" : "weak_tease";
    const label = premium
      ? `${lock_count}x premium ${locked} locked, final reel misses`
      : `${lock_count}x ${locked} on the leading reels`;
    return makeCloseCallSignal(kind, severity, "CLOSE CALL", label, board);
  }

  // 2. Jackpot / premium tease.
  const premium_count = board.filter((s) => PREMIUM_SYMBOLS.has(s)).length;
  if (premium_count >= 4) {
    return makeCloseCallSignal(
      "jackpot_tease",
      3,
      "JACKPOT TEASE",
      `${premium_count} premium symbols on the line`,
      board,
    );
  }

  // 3. Scatter tease: bonus symbols landed before the final reel stopped.
  const scatter_count = board.filter((s) => SCATTER_SYMBOLS.has(s)).length;
  if (scatter_count >= 2) {
    return makeCloseCallSignal(
      "scatter_tease",
      scatter_count >= 3 ? 3 : 2,
      "BONUS TEASE",
      `${scatter_count} scatter symbols already on the line`,
      board,
    );
  }

  // 4. An explicit NEAR_WIN classification is a close call by definition.
  if (event_type === "NEAR_WIN") {
    return makeCloseCallSignal(
      "near_miss",
      2,
      "CLOSE CALL",
      "near-win classified by the game",
      board,
    );
  }

  return null;
}

export function sanitize_reel_stops(reel_stop_ms: number[] | null | undefined): number[] {
  if (!reel_stop_ms || !reel_stop_ms.length) return [...DEFAULT_REEL_STOP_MS];
  const stops = Array.from(
    new Set(
      reel_stop_ms
        .filter((v) => typeof v === "number" && Number.isFinite(v) && 0 < v && v <= MAX_REEL_STOP_MS)
        .map((v) => Math.trunc(v)),
    ),
  ).sort((a, b) => a - b);
  if (stops.length < 2) return [...DEFAULT_REEL_STOP_MS];
  return stops;
}

export function bpm_to_period_ms(bpm: number): number {
  if (bpm <= 0) return 0;
  return Math.max(80, Math.round(60_000.0 / bpm));
}

const TEMPERAMENT_COLORS: Record<string, string> = {
  warm: "amber",
  cool: "sky",
  hushed: "indigo",
};

function temperament_color(temperament: string): string {
  return TEMPERAMENT_COLORS[temperament] ?? "amber";
}

export interface SuspenseProgram {
  close_call: CloseCall;
  cues: Cue[];
  light_program: {
    pattern: LightPattern;
    period_ms: number;
    color: string;
    intensity: number;
    temperament: "warm" | "cool" | "hushed";
  };
  duration_scale: number;
  total_ms: number;
}

/** Round to n decimals, mirroring Python's round(). */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function build_suspense_program(
  signal: CloseCallSignal,
  reel_stop_ms: number[] | null | undefined,
  tempo = "steady",
  lightTemperament = "warm",
  duration_scale = 1.0,
  drought_tier_name = "none",
  post_win_cooldown = false,
): SuspenseProgram {
  // The ladder is anchored to the reel stop boundaries: the first heartbeat
  // fires before any reel stops, each subsequent rung lands on a reel stop, and
  // the final rung releases on the last reel.
  const stops = sanitize_reel_stops(reel_stop_ms);
  const severity = Math.max(1, Math.min(3, signal.severity));
  const steps = STEPS[severity];

  // Mood fusion: a drought tightens the pulse and lifts the entry volume
  // (suppressed during the post-win comfort window).
  const tier_index = TIER_INDEX[drought_tier_name] ?? 0;
  const bpm_boost = 1.0 + FUSION_BPM_STEP * tier_index;
  const volume_boost = post_win_cooldown ? 0.0 : (FUSION_VOLUME_STEP[drought_tier_name] ?? 0.0);

  const bpm_base = BASE_BPM[severity] * tempo_bpm_scale(tempo as Parameters<typeof tempo_bpm_scale>[0]) * bpm_boost;
  const base_volume = BASE_VOLUME + volume_boost;

  const cues: Cue[] = [];

  // Opening heartbeat, before the first reel stops.
  cues.push({
    at_ms: 0,
    kind: "heartbeat",
    bpm: round(Math.min(bpm_base, MAX_BPM), 1),
    light: LIGHT_LADDER[0],
    light_intensity: round(0.2 + 0.1 * severity, 2),
    volume: round(base_volume, 2),
    note: `${signal.label} detected — suspense armed while reels turn`,
  });

  // One rung per leading reel stop, tightening as the final reel approaches.
  for (let index = 1; index < steps; index++) {
    const stop = stops[Math.min(index, stops.length - 1)];
    const rung = Math.min(index, LIGHT_LADDER.length - 1);
    const bpm = Math.min(bpm_base * (1.0 + BPM_STEP_RATIO * index), MAX_BPM);
    cues.push({
      at_ms: stop,
      kind: "heartbeat",
      bpm: round(bpm, 1),
      light: LIGHT_LADDER[rung],
      light_intensity: round(Math.min(0.25 + 0.15 * index, 0.95), 2),
      volume: round(Math.min(base_volume + VOLUME_STEP * index, MAX_VOLUME), 2),
      note: `Reel ${Math.min(index + 1, stops.length)} stops — pulse tightens`,
    });
  }

  // Release on the final reel stop; the resolved directive takes over here.
  const terminal = cues[cues.length - 1];
  const release_at = stops[stops.length - 1];
  cues.push({
    at_ms: release_at,
    kind: "release",
    bpm: 0.0,
    light: RELEASE_LIGHT,
    light_intensity: RELEASE_INTENSITY[severity],
    volume: 0.0,
    note: "Final reel stops — heartbeat released",
  });

  const light_program = {
    pattern: terminal.light,
    period_ms: bpm_to_period_ms(terminal.bpm),
    color: temperament_color(lightTemperament),
    intensity: terminal.light_intensity,
    temperament: lightTemperament as "warm" | "cool" | "hushed",
  };

  return {
    close_call: signal.as_dict(),
    cues,
    light_program,
    duration_scale,
    total_ms: Math.trunc(release_at),
  };
}

/** Events that are never worth a suspense tease. */
export function is_teasable_event(event_type: string | null | undefined): boolean {
  return event_type !== "NO_WIN" && event_type !== "GAME_START";
}
