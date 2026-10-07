/**
 * TypeScript port of middleware/session.py — per-session experience state.
 *
 * Everything the engine decides about *pacing* is temporal, not per-event: how
 * fast the player is spinning, how long they have been losing, whether the last
 * spin was already teased as a close call. State is keyed by
 * (game_id, session_id) so two browser tabs never bleed streaks into each other.
 *
 * Cadence is measured **only** from resolved-phase events. A reels_spinning
 * probe and the resolved call that follows it describe one physical spin, so
 * counting both would report a machine-gun cadence for every cabinet.
 *
 * NOTE: this port exists so the online demo can run the engine server-side
 * without a separate Python host. The Python middleware in `middleware/` stays
 * the reference implementation for local development.
 */

export type TempoName = "rapid" | "steady" | "deliberate";

// High-tier winning events that feed the consecutive-win streak state machine.
export const HIGH_TIER_EVENTS: readonly string[] = ["BIG_WIN", "JACKPOT", "BONUS_TRIGGER"];

// Session-opening event: hard reset rather than a win/loss transition.
export const RESET_EVENTS: readonly string[] = ["GAME_START"];

// Tempo bands over the smoothed inter-spin interval, in milliseconds.
export const TEMPO_RAPID_MAX_MS = 2200.0;
export const TEMPO_DELIBERATE_MIN_MS = 4500.0;
export const DEFAULT_TEMPO: TempoName = "steady";

// Weight given to the newest interval in the cadence moving average.
export const CADENCE_EWMA_ALPHA = 0.4;

// Spins after a win during which the drought bed stays suppressed.
export const BED_COOLDOWN_SPINS = 2;

// Clamp a single observed interval. Guards against client clock jumps and
// against a client that reuses one timestamp for a burst of events.
export const MIN_INTERVAL_MS = 250.0;
export const MAX_INTERVAL_MS = 600_000.0;

export interface SuspenseProgram {
  [key: string]: unknown;
}

export class SessionState {
  game_id: string;
  session_id: string;
  win_streak = 0;
  losing_streak = 0;
  spin_count = 0;
  cooldown_spins = 0;
  cadence_ewma_ms: number | null = null;
  tempo: TempoName = DEFAULT_TEMPO;
  /** POSIX seconds, mirroring time.time() in the Python engine. */
  last_event_at: number | null = null;
  last_suspense_at: number | null = null;
  pending_suspense: SuspenseProgram | null = null;
  // Rolling timestamps of armed suspense ladders, for the tease-budget policy.
  suspense_times: number[] = [];

  constructor(game_id: string, session_id: string) {
    this.game_id = game_id;
    this.session_id = session_id;
  }

  get interval_ms(): number | null {
    return this.cadence_ewma_ms;
  }

  reset(): void {
    this.win_streak = 0;
    this.losing_streak = 0;
    this.spin_count = 0;
    this.cooldown_spins = 0;
    this.cadence_ewma_ms = null;
    this.tempo = DEFAULT_TEMPO;
    this.last_event_at = null;
    this.last_suspense_at = null;
    this.pending_suspense = null;
    this.suspense_times = [];
  }

  as_dict(): Record<string, unknown> {
    return {
      game_id: this.game_id,
      session_id: this.session_id,
      win_streak: this.win_streak,
      losing_streak: this.losing_streak,
      spin_count: this.spin_count,
      cooldown_spins: this.cooldown_spins,
      cadence_ewma_ms:
        this.cadence_ewma_ms !== null ? Math.round(this.cadence_ewma_ms * 10) / 10 : null,
      tempo: this.tempo,
      suspense_pending: this.pending_suspense !== null,
    };
  }

  // -- transitions -----------------------------------------------------

  open_suspense(program: SuspenseProgram): void {
    const now = Date.now() / 1000;
    this.pending_suspense = program;
    this.last_suspense_at = now;
    // Keep only the recent window; the budget policies prune off it.
    this.suspense_times = this.suspense_times.filter((t) => now - t <= 120.0);
    this.suspense_times.push(now);
  }

  consume_suspense(): SuspenseProgram | null {
    const program = this.pending_suspense;
    this.pending_suspense = null;
    return program;
  }

  ingest(
    event_type: string,
    is_win: boolean,
    is_high_tier: boolean,
    timestamp: number | null,
  ): void {
    const now = timestamp !== null ? timestamp : Date.now() / 1000;

    if (RESET_EVENTS.includes(event_type)) {
      this.reset();
      this.spin_count = 1;
      return;
    }

    if (this.last_event_at !== null) {
      const observed_ms = (now - this.last_event_at) * 1000.0;
      if (MIN_INTERVAL_MS <= observed_ms && observed_ms <= MAX_INTERVAL_MS) {
        if (this.cadence_ewma_ms === null) {
          this.cadence_ewma_ms = observed_ms;
        } else {
          const alpha = CADENCE_EWMA_ALPHA;
          this.cadence_ewma_ms = alpha * observed_ms + (1.0 - alpha) * this.cadence_ewma_ms;
        }
        this.tempo = classify_tempo(this.cadence_ewma_ms);
      }
    }

    this.last_event_at = now;
    this.spin_count += 1;

    this.win_streak = is_high_tier ? this.win_streak + 1 : 0;

    if (is_win) {
      this.losing_streak = 0;
      this.cooldown_spins = BED_COOLDOWN_SPINS;
    } else {
      this.losing_streak += 1;
      if (this.cooldown_spins > 0) {
        this.cooldown_spins -= 1;
      }
    }
  }
}

const _SESSIONS = new Map<string, SessionState>();

export const DEFAULT_SESSION_ID = "default";

export function session_key(game_id: string, session_id: string | null | undefined): [string, string] {
  const seat = (session_id ?? DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID;
  return [game_id || "SLOT-WUXIA-01", seat];
}

export function get_session(game_id: string, session_id?: string | null): SessionState {
  const key = session_key(game_id, session_id);
  let state = _SESSIONS.get(key[0] + "\u0000" + key[1]);
  if (!state) {
    state = new SessionState(key[0], key[1]);
    _SESSIONS.set(key[0] + "\u0000" + key[1], state);
  }
  return state;
}

export function reset_session(game_id: string, session_id?: string | null): SessionState {
  const state = get_session(game_id, session_id);
  state.reset();
  return state;
}

export function list_sessions(): Record<string, unknown>[] {
  return Array.from(_SESSIONS.values(), (state) => state.as_dict());
}

/** Parse an ISO-8601 timestamp into POSIX seconds, or null if unusable. */
export function parse_timestamp(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Date.parse(raw.trim());
  if (Number.isNaN(parsed)) return null;
  return parsed / 1000;
}

export function classify_tempo(interval_ms: number | null): TempoName {
  if (interval_ms === null) return DEFAULT_TEMPO;
  if (interval_ms < TEMPO_RAPID_MAX_MS) return "rapid";
  if (interval_ms > TEMPO_DELIBERATE_MIN_MS) return "deliberate";
  return "steady";
}

/** Heartbeat rate multiplier for a tempo band. */
export function tempo_bpm_scale(tempo: TempoName): number {
  return { rapid: 1.12, steady: 1.0, deliberate: 0.92 }[tempo] ?? 1.0;
}
