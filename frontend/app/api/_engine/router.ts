/**
 * TypeScript port of middleware/router.py — the contextual allocation pipeline.
 *
 * Ordered stages, each handing a strictly richer directive to the next:
 *
 * 1. session.ingest — fold this spin into the player's pacing history.
 * 2. suspense.evaluate — for a pre-resolution probe, decide whether the pending
 *    outcome is a close call worth teasing while the reels turn.
 * 3. allocate — win/bet multiplier drives the celebration tier, volume and
 *    pulse; under-classed payouts escalate; a live high-tier streak overrides.
 * 4. mood.apply — player speed and losing streak shape the audio envelope, the
 *    background bed, and the cabinet lighting.
 * 5. finalize — stamp the pacing and suspense fields onto the directive.
 */

import type {
  AudioProfileSpec,
  CloseCall,
  Cue,
  DirectivePhase,
  EventType,
  LightPattern,
  LightProgram,
  SpinPhase,
} from "@/app/lib/api";

import { resolve_asset, resolve_bed_asset, resolve_suspense_asset, safe_theme } from "./assets";
import {
  apply_pacing,
  audio_profile,
  bed_volume,
  drought_tier,
  light_temperament,
  pacing_rationale,
  type AudioProfile,
} from "./mood";
import { HIGH_TIER_EVENTS, get_session, parse_timestamp, type SessionState } from "./session";
import {
  build_suspense_program,
  detect_close_call,
  fuse_close_call,
  is_teasable_event,
  sanitize_reel_stops,
  suspense_allowed,
} from "./suspense";

// Under-classed events that escalate to the big-win celebration tier when the
// payout crosses BIG_WIN_THRESHOLD (Win/Bet). Identity events keep their own
// asset family and only scale intensity.
export const ESCALATION_POOL: readonly string[] = ["SPIN_RESULT", "NO_WIN", "NEAR_WIN"];
export const BIG_WIN_THRESHOLD = 10.0;
export const JACKPOT_VOLUME_THRESHOLD = 50.0;

// High-tier wins required before the streak celebration takes over.
export const WIN_STREAK_THRESHOLD = 2;

// Priority asset returned when a high-tier event lands on an active streak.
export const WIN_STREAK_OVERRIDE = {
  asset_path: "/wuxia/wuxia_win_streak.mp4",
  asset_type: "video" as const,
  soundtrack_path: "/audio/win_streak.wav",
  ui_pulse: "full" as const,
  message: "STATE OVERRIDE: Win Streak detected! Priority celebration allocated.",
};

export const EVENT_ASSET_MAP: Record<
  string,
  {
    asset_path: string;
    asset_type: "video";
    soundtrack_path: string;
    ui_pulse: "none" | "subtle" | "strong" | "full";
    message: string;
  }
> = {
  GAME_START: {
    asset_path: "/wuxia/wuxia_game_start.mp4",
    asset_type: "video",
    soundtrack_path: "/audio/ambient.wav",
    ui_pulse: "subtle",
    message: "Opening sequence: enter the Wuxia world.",
  },
  SPIN_RESULT: {
    asset_path: "/wuxia/wuxia_spin_result.mp4",
    asset_type: "video",
    soundtrack_path: "/audio/spin_reel.wav",
    ui_pulse: "none",
    message: "Standard spin result reel.",
  },
  NO_WIN: {
    asset_path: "/wuxia/WUXIA_NO_WIN.mp4",
    asset_type: "video",
    soundtrack_path: "/audio/dead_spin.wav",
    ui_pulse: "none",
    message: "Dead spin: blade finds no mark. Pacing audio allocated.",
  },
  NEAR_WIN: {
    asset_path: "/wuxia/wuxia_near_win.mp4",
    asset_type: "video",
    soundtrack_path: "/audio/tension.wav",
    ui_pulse: "subtle",
    message: "Near-win tension beat: blade glances the edge.",
  },
  BONUS_TRIGGER: {
    asset_path: "/wuxia/wuxia_bonus_trigger.mp4",
    asset_type: "video",
    soundtrack_path: "/audio/celebration.wav",
    ui_pulse: "strong",
    message: "Bonus round triggered: hidden sect revealed.",
  },
  BIG_WIN: {
    asset_path: "/wuxia/wuxia_big_win.mp4",
    asset_type: "video",
    soundtrack_path: "/audio/celebration.wav",
    ui_pulse: "strong",
    message: "Big win celebration: master bestows the prize.",
  },
  JACKPOT: {
    asset_path: "/wuxia/wuxia_jackpot.mp4",
    asset_type: "video",
    soundtrack_path: "/audio/jackpot.wav",
    ui_pulse: "full",
    message: "Jackpot finale: dragon descends.",
  },
};

export const NOOP_RESPONSE = {
  action: "noop" as const,
  asset_path: "",
  asset_type: "none" as const,
  soundtrack_path: "",
  ui_pulse: "none" as const,
  message: "No media mapped for this event.",
};

// Base playback volume per event tier; big-win tiers scale with the multiplier.
export const BASE_VOLUMES: Record<string, number> = {
  GAME_START: 0.4,
  SPIN_RESULT: 0.35,
  NO_WIN: 0.3,
  NEAR_WIN: 0.55,
  BONUS_TRIGGER: 0.75,
  BIG_WIN: 0.8,
  JACKPOT: 1.0,
};

// Cabinet lighting translation. ui_pulse picks the resting intensity and
// pattern; player tempo then tightens or stretches the flash period.
export const PULSE_INTENSITY: Record<string, number> = {
  none: 0.0,
  subtle: 0.25,
  strong: 0.6,
  full: 0.9,
};
export const PULSE_PATTERN: Record<string, LightPattern> = {
  none: "none",
  subtle: "breathe",
  strong: "pulse",
  flash: "flash-soft",
  full: "flash-soft",
};
export const PULSE_ORDER: readonly string[] = ["none", "subtle", "strong", "full"];
export const TEMPERAMENT_COLORS: Record<string, string> = {
  warm: "amber",
  cool: "sky",
  hushed: "indigo",
};

// A fast player's cabinet flashes tighter; a slow player's breathes longer.
export const BASE_FLASH_PERIOD_MS = 900;
export const TEMPO_FLASH_FACTOR: Record<string, number> = {
  rapid: 0.72,
  steady: 1.0,
  deliberate: 1.35,
};

// Losing-streak depth at which the cabinet pulse steps down a notch.
export const DROUGHT_DOWNGRADE_TIERS: ReadonlySet<string> = new Set(["deep", "severe"]);

export const DEFAULT_BET = 25.0;

/** Normalized view of an inbound event, legacy string form included. */
interface Spin {
  event_type: string;
  theme: string;
  game_id: string;
  session_id: string | null;
  bet: number;
  win: number;
  symbols: string[] | null;
  spin_phase: string;
  reel_stop_ms: number[] | null;
  timestamp: string | null;
}

/** What the route handler builds from a parsed GRIP payload before normalize. */
export interface EngineEvent {
  event_type: EventType;
  game_id?: string | null;
  theme?: string | null;
  bet_amount?: number | null;
  win_amount?: number | null;
  win_level?: string | null;
  symbols?: string[] | null;
  event_id?: string | null;
  timestamp?: string | null;
  session_id?: string | null;
  spin_phase?: SpinPhase | null;
  reel_stop_ms?: number[] | null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Render a list the way Python's f-string would (`['a', 'b']`). */
function python_list_repr(items: string[] | null | undefined): string {
  if (!items) return "None";
  return `[${items.map((s) => `'${s}'`).join(", ")}]`;
}

function normalize(event: EngineEvent | EventType | string): Spin {
  if (typeof event === "string") {
    return {
      event_type: event,
      theme: "wuxia",
      game_id: "SLOT-WUXIA-01",
      session_id: null,
      bet: DEFAULT_BET,
      win: 0.0,
      symbols: null,
      spin_phase: "resolved",
      reel_stop_ms: null,
      timestamp: null,
    };
  }
  return {
    event_type: event.event_type,
    theme: safe_theme(event.theme),
    game_id: event.game_id ?? "SLOT-WUXIA-01",
    session_id: event.session_id ?? null,
    bet: event.bet_amount || DEFAULT_BET,
    win: event.win_amount || 0.0,
    symbols: event.symbols ?? null,
    spin_phase: event.spin_phase ?? "resolved",
    reel_stop_ms: event.reel_stop_ms ?? null,
    timestamp: event.timestamp ?? null,
  };
}

export function compute_multiplier(win: number, bet: number): number {
  // Payout relative to bet (Win/Bet), guarded against zero/negative bets.
  return round(win / Math.max(bet, 1.0), 2);
}

export function big_win_volume(multiplier: number): number {
  // 0.80 base, 0.90 at 25x, 1.00 at 50x+.
  if (multiplier >= JACKPOT_VOLUME_THRESHOLD) return 1.0;
  if (multiplier >= 25) return 0.9;
  return 0.8;
}

export function compute_volume(event_type: string, multiplier: number, win = 0.0): number {
  if (event_type === "WIN_STREAK") return 1.0;
  if (event_type === "BIG_WIN") return big_win_volume(multiplier);
  let volume = BASE_VOLUMES[event_type] ?? 0.5;
  if (event_type === "SPIN_RESULT" && win > 0) volume = 0.5;
  return round(Math.min(1.0, Math.max(0.0, volume)), 2);
}

function is_win(event_type: string, win: number, escalated: boolean): boolean {
  if (win > 0 || escalated) return true;
  return HIGH_TIER_EVENTS.includes(event_type) || event_type === "WIN_STREAK";
}

function drought_adjusted_pulse(pulse: string, state: SessionState): string {
  // Never upgrades: a deep drought must never make a dead spin louder than a
  // win, so the ladder only ever clamps downward.
  if (!DROUGHT_DOWNGRADE_TIERS.has(drought_tier(state.losing_streak))) return pulse;
  const index = PULSE_ORDER.indexOf(pulse) >= 0 ? PULSE_ORDER.indexOf(pulse) : 0;
  return PULSE_ORDER[Math.max(0, index - 1)];
}

function light_program(pulse: string, tempo: string, temperament: string): LightProgram {
  // Translate the resolved pulse into a sustained cabinet lighting program.
  const pattern = PULSE_PATTERN[pulse] ?? "none";
  let period = 0;
  if (pattern !== "none") {
    period = Math.trunc(BASE_FLASH_PERIOD_MS * (TEMPO_FLASH_FACTOR[tempo] ?? 1.0));
  }
  return {
    pattern,
    period_ms: period,
    color: TEMPERAMENT_COLORS[temperament] ?? "amber",
    intensity: PULSE_INTENSITY[pulse] ?? 0.0,
    temperament: (temperament as LightProgram["temperament"]) ?? "warm",
  };
}

function finalize(
  directive: Record<string, unknown>,
  spin: Spin,
  state: SessionState,
  phase: DirectivePhase,
  released: Record<string, unknown> | null,
): Record<string, unknown> {
  // Apply player-speed and losing-streak pacing to an allocated directive.
  const profile = audio_profile(state.tempo, state.losing_streak);
  const temperament = light_temperament(state.losing_streak);

  const is_paying = spin.win > 0 || HIGH_TIER_EVENTS.includes(spin.event_type);
  let pulse = (directive.ui_pulse as string) ?? "none";
  if (!is_paying) pulse = drought_adjusted_pulse(pulse, state);

  directive.ui_pulse = pulse;
  directive.phase = phase;
  // Win prominence: a paying spin is never attenuated by its pacing profile.
  // The consoling envelope softens drought spins; the moment the spin pays,
  // its volume floor returns to standard so a big win after a long losing
  // streak still lands loudly (punchy's slight boost for rapid players stays).
  let volume_scale = profile.volume_scale;
  if (is_paying) {
    volume_scale = Math.max(1.0, volume_scale);
  }
  directive.volume = round(
    Math.min(1.0, Math.max(0.0, ((directive.volume as number) ?? 0.0) * volume_scale)),
    2,
  );

  const pacing = apply_pacing(state);
  directive.audio = pacing.audio;
  directive.bedtrack_path = resolve_bed_asset(spin.theme);
  directive.bedtrack_volume = bed_volume(state);
  directive.tempo = state.tempo;
  directive.cadence_ms = pacing.cadence_ms;
  directive.losing_streak = state.losing_streak;
  directive.win_streak = state.win_streak;
  directive.drought_tier = drought_tier(state.losing_streak);
  directive.light_program = light_program(pulse, state.tempo, temperament);
  directive.session_id = state.session_id;

  if (released) {
    directive.close_call = released.close_call ?? null;
    directive.suspense_total_ms = (released.total_ms as number) ?? 0;
  }
  directive.cues = directive.cues ?? [];
  directive.close_call = directive.close_call ?? null;
  directive.suspense_asset_path = directive.suspense_asset_path ?? "";
  directive.suspense_total_ms = directive.suspense_total_ms ?? 0;

  const rationale = pacing_rationale(state, profile);
  if (rationale) {
    directive.message = `${directive.message as string} Pacing: ${rationale}.`;
  }
  return directive;
}

function route_probe(spin: Spin, state: SessionState): Record<string, unknown> {
  // Answer a pre-resolution probe: hold the presentation and build suspense.
  // Streak and cadence state are deliberately untouched — the spin has not
  // resolved yet, so counting it here would double-count every spin.
  const multiplier = compute_multiplier(spin.win, spin.bet);
  const pacing = apply_pacing(state);

  const directive: Record<string, unknown> = {
    event_type: spin.event_type,
    action: "noop",
    asset_path: "",
    asset_type: "none",
    soundtrack_path: "",
    ui_pulse: "none",
    volume: 0.0,
    win_multiplier: multiplier,
    audio: pacing.audio,
    bedtrack_path: resolve_bed_asset(spin.theme),
    bedtrack_volume: bed_volume(state),
    tempo: state.tempo,
    cadence_ms: pacing.cadence_ms,
    losing_streak: state.losing_streak,
    win_streak: state.win_streak,
    drought_tier: drought_tier(state.losing_streak),
    session_id: state.session_id,
    cues: [],
    close_call: null,
    suspense_asset_path: "",
    suspense_total_ms: 0,
  };

  let signal: ReturnType<typeof detect_close_call> = null;
  let fusion_note = "";
  if (is_teasable_event(spin.event_type)) {
    signal = detect_close_call(spin.symbols, spin.event_type, spin.win, spin.bet);
    if (signal !== null) {
      const [fused, note] = fuse_close_call(signal, state);
      signal = fused;
      fusion_note = note;
      if (signal === null) {
        // Fusion dropped the tease outright (e.g. a weak tease under a rapid
        // tempo). Say why instead of emitting an empty program.
        directive.phase = "idle";
        directive.light_program = light_program(
          "none",
          state.tempo,
          light_temperament(state.losing_streak),
        );
        directive.message =
          "Probe: weak tease skipped — rapid tempo leaves no window while the reels race. No suspense allocated.";
        return directive;
      }

      // Fatigue gate: a seat that was just teased must rest (severity-scaled
      // refractory + rolling per-minute budget).
      const [allowed, fatigue_note] = suspense_allowed(state, signal.severity, Date.now() / 1000);
      if (!allowed) {
        directive.phase = "idle";
        directive.light_program = light_program(
          "none",
          state.tempo,
          light_temperament(state.losing_streak),
        );
        directive.message = `Probe: tease denied (${fatigue_note}). No suspense allocated.`;
        return directive;
      }
    }
  }

  if (signal === null) {
    // Not worth teasing. Say so explicitly rather than emitting an empty
    // program the client would have to special-case.
    directive.phase = "idle";
    directive.light_program = light_program("none", state.tempo, light_temperament(state.losing_streak));
    directive.message = "Probe: no close call on the line. No suspense allocated.";
    return directive;
  }

  const profile = audio_profile(state.tempo, state.losing_streak);
  const tier = drought_tier(state.losing_streak);
  const program = build_suspense_program(
    signal,
    sanitize_reel_stops(spin.reel_stop_ms),
    state.tempo,
    light_temperament(state.losing_streak),
    profile.duration_scale,
    tier,
    state.cooldown_spins > 0,
  );
  state.open_suspense(program as unknown as Record<string, unknown>);

  const stops = sanitize_reel_stops(spin.reel_stop_ms);
  directive.phase = "suspend";
  directive.cues = program.cues;
  directive.light_program = program.light_program;
  directive.close_call = program.close_call;
  directive.suspense_asset_path = resolve_suspense_asset(
    spin.theme,
    EVENT_ASSET_MAP.NEAR_WIN.asset_path,
  );
  directive.suspense_total_ms = program.total_ms;
  directive.message =
    `SUSPENSE ARMED (${signal.label}): ${signal.detail}. ` +
    `Heartbeat ${Math.round(program.cues[0].bpm)}->` +
    `${Math.round(program.cues[program.cues.length - 2].bpm)} bpm across ` +
    `${stops.length} reel stops, lights escalate to ${program.light_program.pattern}, ` +
    `release at ${program.total_ms}ms.`;
  if (fusion_note) {
    directive.message += ` [${fusion_note}]`;
  }
  return directive;
}

function allocate(
  spin: Spin,
  multiplier: number,
  is_high_tier: boolean,
  escalated: boolean,
  state: SessionState,
): Record<string, unknown> {
  // Core asset allocation: tier, streak override, escalation, volume, pulse.
  const event_type = spin.event_type;

  if (event_type === "WIN_STREAK") {
    return {
      event_type,
      action: "play",
      ...WIN_STREAK_OVERRIDE,
      volume: 1.0,
      win_multiplier: multiplier,
    };
  }

  if ((is_high_tier || escalated) && state.win_streak >= WIN_STREAK_THRESHOLD) {
    return {
      event_type,
      action: "play",
      ...WIN_STREAK_OVERRIDE,
      volume: 1.0,
      win_multiplier: multiplier,
      message: `STATE OVERRIDE: ${state.win_streak} consecutive high-tier wins! Priority celebration allocated.`,
    };
  }

  if (escalated) {
    const directive: Record<string, unknown> = { ...EVENT_ASSET_MAP.BIG_WIN };
    directive.asset_path = resolve_asset(
      spin.theme,
      "BIG_WIN",
      multiplier,
      EVENT_ASSET_MAP.BIG_WIN.asset_path,
    );
    directive.ui_pulse = multiplier < 25 ? "strong" : "full";
    directive.volume = big_win_volume(multiplier);
    directive.message =
      `Escalated ${event_type}: payout ${spin.win.toFixed(0)} credits (${multiplier.toFixed(1)}x bet ` +
      `>= ${BIG_WIN_THRESHOLD.toFixed(0)}x). Big-win celebration tier allocated.`;
    return { event_type, action: "play", ...directive, win_multiplier: multiplier };
  }

  const base = EVENT_ASSET_MAP[event_type];
  if (!base) {
    return {
      event_type,
      ...NOOP_RESPONSE,
      volume: 0.0,
      win_multiplier: multiplier,
    };
  }

  // Dynamic allocation refinement based on player result.
  const directive: Record<string, unknown> = { ...base };
  directive.asset_path = resolve_asset(spin.theme, event_type, multiplier, base.asset_path);
  directive.volume = compute_volume(event_type, multiplier, spin.win);
  if (event_type === "BIG_WIN") {
    directive.message =
      `Big Win allocated: Payout ${spin.win.toFixed(0)} credits (${multiplier.toFixed(1)}x bet). ` +
      `High-energy celebration and soundtrack triggered.`;
    directive.ui_pulse = multiplier < 25 ? "strong" : "full";
  } else if (event_type === "NEAR_WIN") {
    const sym_text = spin.symbols ? ` on ${python_list_repr(spin.symbols)}` : "";
    directive.message =
      `Near-Win recognized${sym_text}: 4-symbol lock. ` +
      `Tension riser and subtle pulse allocated.`;
    directive.ui_pulse = "subtle";
  } else if (event_type === "SPIN_RESULT") {
    if (spin.win > 0) {
      directive.soundtrack_path = "/audio/win_chime.wav";
      directive.ui_pulse = "subtle";
      directive.message =
        `Payline match: ${spin.win.toFixed(0)} credits awarded. Reward audio allocated.`;
    } else {
      directive.message = "Reels stopped: standard spin result recorded.";
    }
  } else if (event_type === "JACKPOT") {
    directive.message =
      `MEGA JACKPOT finale (${(spin.win || 2500).toFixed(0)} credits)! ` +
      `Dragon descent and grand fanfare allocated.`;
  }

  return { event_type, action: "play", ...directive, win_multiplier: multiplier };
}

function route_resolved(spin: Spin, state: SessionState): Record<string, unknown> {
  // Allocate for a landed outcome and advance all pacing state.
  const multiplier = compute_multiplier(spin.win, spin.bet);
  const is_high_tier = HIGH_TIER_EVENTS.includes(spin.event_type);
  const escalated =
    !is_high_tier &&
    ESCALATION_POOL.includes(spin.event_type) &&
    spin.win > 0 &&
    multiplier >= BIG_WIN_THRESHOLD;

  state.ingest(
    spin.event_type,
    is_win(spin.event_type, spin.win, escalated),
    is_high_tier || escalated,
    parse_timestamp(spin.timestamp),
  );
  const released = state.consume_suspense() as Record<string, unknown> | null;

  const directive = allocate(spin, multiplier, is_high_tier, escalated, state);
  return finalize(directive, spin, state, released ? "release" : "play", released);
}

export function route_event(event: EngineEvent | EventType | string): Record<string, unknown> {
  const spin = normalize(event);
  const state = get_session(spin.game_id, spin.session_id);

  if (spin.spin_phase === "reels_spinning") {
    return route_probe(spin, state);
  }
  return route_resolved(spin, state);
}

// Type re-exports keep the route handler's imports tidy.
export type { AudioProfile, AudioProfileSpec, CloseCall, Cue, EventType, SpinPhase };
