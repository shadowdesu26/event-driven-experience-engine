export const EVENT_TYPES = [
  "GAME_START",
  "SPIN_RESULT",
  "NO_WIN",
  "NEAR_WIN",
  "BONUS_TRIGGER",
  "BIG_WIN",
  "JACKPOT",
  "WIN_STREAK",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Where in the spin lifecycle the event was emitted. */
export type SpinPhase = "reels_spinning" | "resolved";

/** Smoothed player spin cadence band, decided by the middleware. */
export type Tempo = "rapid" | "steady" | "deliberate";

export type AudioProfileName = "punchy" | "standard" | "consoling";

export type DroughtTier = "none" | "mild" | "deep" | "severe";

export type CueKind = "heartbeat" | "release";

export type LightPattern =
  | "none"
  | "breathe"
  | "pulse"
  | "flash-soft"
  | "flash-hard"
  | "flash-strobe"
  | "flare";

export type LightTemperament = "warm" | "cool" | "hushed";

export type DirectivePhase = "play" | "suspend" | "release" | "idle";

export interface Cue {
  /** Offset from the start of the suspense window. */
  at_ms: number;
  kind: CueKind;
  /** Heartbeat rate held until the next cue. */
  bpm: number;
  light: LightPattern;
  light_intensity: number;
  volume: number;
  note: string;
}

export interface LightProgram {
  pattern: LightPattern;
  /** Flash period in ms; 0 means steady. */
  period_ms: number;
  color: string;
  intensity: number;
  temperament: LightTemperament;
}

export interface AudioProfileSpec {
  /** punchy = clipped and short (fast players); consoling = soft and long (drought). */
  name: AudioProfileName;
  duration_scale: number;
  attack_ms: number;
  /** False clips voices so fast spins do not stack into mud. */
  tail: boolean;
  lowpass_hz: number | null;
  volume_scale: number;
  bed_synth: string;
}

export interface CloseCall {
  kind: string;
  severity: number;
  label: string;
  detail: string;
  symbols: string[];
}

export interface GripEventPayload {
  event_type: EventType;
  game_id?: string;
  theme?: string;
  bet_amount?: number;
  win_amount?: number;
  win_level?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "JACKPOT";
  symbols?: string[];
  event_id: string;
  timestamp: string;
  /** Isolates pacing state (cadence, streaks) per player seat. */
  session_id?: string;
  /** "reels_spinning" is a pre-resolution probe; "resolved" carries the landed outcome. */
  spin_phase?: SpinPhase;
  /** Cabinet reel stop offsets in ms; anchors the suspense ladder to real beats. */
  reel_stop_ms?: number[];
}

export interface GripResponse {
  event_type: EventType;
  action: "play" | "noop";
  asset_path: string;
  asset_type: "video" | "audio" | "none";
  soundtrack_path?: string;
  ui_pulse?: "none" | "subtle" | "strong" | "full";
  volume?: number;
  win_multiplier?: number;
  message: string;

  /** "suspend" holds the presentation for a suspense probe; "release" ends one. */
  phase?: DirectivePhase;
  audio?: AudioProfileSpec;
  /** Background music bed; empty means synthesize a soft pad. */
  bedtrack_path?: string;
  /** Encouraging bed level during a losing streak. */
  bedtrack_volume?: number;
  tempo?: Tempo;
  /** Smoothed ms between spins; 0 until two spins land. */
  cadence_ms?: number;
  losing_streak?: number;
  win_streak?: number;
  drought_tier?: DroughtTier;

  /** Timed suspense program; empty unless a close call was detected. */
  cues?: Cue[];
  light_program?: LightProgram;
  close_call?: CloseCall | null;
  suspense_asset_path?: string;
  suspense_total_ms?: number;

  session_id?: string;
}

export interface PostGripEventResult {
  payload: GripEventPayload;
  response: GripResponse;
}

export type GripEventInput = EventType | (Partial<GripEventPayload> & { event_type: EventType });

/** Default envelope used before the middleware has sent an audio profile. */
export const DEFAULT_AUDIO_PROFILE: AudioProfileSpec = {
  name: "standard",
  duration_scale: 1,
  attack_ms: 8,
  tail: true,
  lowpass_hz: null,
  volume_scale: 1,
  bed_synth: "soft_pad",
};

export const DEFAULT_LIGHT_PROGRAM: LightProgram = {
  pattern: "none",
  period_ms: 0,
  color: "amber",
  intensity: 0,
  temperament: "warm",
};

export async function postGripEvent(eventInput: GripEventInput): Promise<PostGripEventResult> {
  const isString = typeof eventInput === "string";
  const eventType = isString ? eventInput : eventInput.event_type;

  const payload: GripEventPayload = {
    game_id: "SLOT-WUXIA-01",
    theme: "wuxia",
    bet_amount: 25,
    win_amount: 0,
    win_level: "NONE",
    spin_phase: "resolved",
    ...(isString ? {} : eventInput),
    event_type: eventType,
    event_id: (!isString && eventInput.event_id) ? eventInput.event_id : crypto.randomUUID(),
    timestamp: (!isString && eventInput.timestamp) ? eventInput.timestamp : new Date().toISOString(),
  };

  const res = await fetch("/api/grip-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Middleware returned ${res.status}: ${await res.text()}`);
  }

  return { payload, response: (await res.json()) as GripResponse };
}