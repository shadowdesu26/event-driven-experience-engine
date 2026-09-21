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
}

export interface PostGripEventResult {
  payload: GripEventPayload;
  response: GripResponse;
}

export type GripEventInput = EventType | (Partial<GripEventPayload> & { event_type: EventType });

export async function postGripEvent(eventInput: GripEventInput): Promise<PostGripEventResult> {
  const isString = typeof eventInput === "string";
  const eventType = isString ? eventInput : eventInput.event_type;

  const payload: GripEventPayload = {
    game_id: "SLOT-WUXIA-01",
    theme: "wuxia",
    bet_amount: 25,
    win_amount: 0,
    win_level: "NONE",
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

