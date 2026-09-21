"use client";

import { EVENT_TYPES, type EventType, type GripEventInput } from "@/app/lib/api";

const EVENT_STYLES: Record<EventType, { border: string; dot: string }> = {
  GAME_START: { border: "border-blue-500/50 hover:border-blue-400 hover:bg-blue-500/10", dot: "bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" },
  SPIN_RESULT: { border: "border-slate-400/50 hover:border-slate-300 hover:bg-slate-400/10", dot: "bg-slate-300 shadow-[0_0_8px_rgba(203,213,225,0.8)]" },
  NO_WIN: { border: "border-gray-600 hover:border-gray-400 hover:bg-gray-600/10", dot: "bg-gray-400 shadow-[0_0_8px_rgba(156,163,175,0.8)]" },
  NEAR_WIN: { border: "border-amber-500/50 hover:border-amber-400 hover:bg-amber-500/10", dot: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" },
  BONUS_TRIGGER: { border: "border-purple-500/50 hover:border-purple-400 hover:bg-purple-500/10", dot: "bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.8)]" },
  BIG_WIN: { border: "border-orange-500/50 hover:border-orange-400 hover:bg-orange-500/10", dot: "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)]" },
  JACKPOT: { border: "border-rose-500/50 hover:border-rose-400 hover:bg-rose-500/10", dot: "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]" },
  WIN_STREAK: { border: "border-emerald-500/60 hover:border-emerald-400 hover:bg-emerald-500/10", dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" },
};

const DEFAULT_PRESETS: Record<EventType, { win_amount: number; bet_amount: number; symbols: string[]; win_level: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "JACKPOT" }> = {
  GAME_START: { win_amount: 0, bet_amount: 25, symbols: ["🍒", "7", "BAR", "⭐", "💎"], win_level: "NONE" },
  SPIN_RESULT: { win_amount: 25, bet_amount: 25, symbols: ["🍒", "🍒", "🍇", "🔔", "BAR"], win_level: "LOW" },
  NO_WIN: { win_amount: 0, bet_amount: 25, symbols: ["🍒", "🍋", "🍇", "🔔", "BAR"], win_level: "NONE" },
  NEAR_WIN: { win_amount: 0, bet_amount: 25, symbols: ["7", "7", "7", "7", "🍒"], win_level: "NONE" },
  BONUS_TRIGGER: { win_amount: 250, bet_amount: 25, symbols: ["⭐", "🍒", "⭐", "🍋", "⭐"], win_level: "HIGH" },
  BIG_WIN: { win_amount: 500, bet_amount: 25, symbols: ["💎", "💎", "💎", "💎", "💎"], win_level: "HIGH" },
  JACKPOT: { win_amount: 2500, bet_amount: 100, symbols: ["7", "7", "7", "7", "7"], win_level: "JACKPOT" },
  WIN_STREAK: { win_amount: 750, bet_amount: 50, symbols: ["7", "7", "7", "💎", "💎"], win_level: "HIGH" },
};

interface EventButtonsProps {
  onFire: (eventInput: GripEventInput) => void;
  loadingEvent: EventType | null;
}

export default function EventButtons({ onFire, loadingEvent }: EventButtonsProps) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {EVENT_TYPES.map((eventType, index) => {
        const busy = loadingEvent === eventType;
        const style = EVENT_STYLES[eventType];
        const preset = DEFAULT_PRESETS[eventType];
        return (
          <button
            key={eventType}
            type="button"
            disabled={loadingEvent !== null}
            onClick={() => onFire({ event_type: eventType, ...preset })}
            className={`group rounded-lg border bg-black/30 px-3 py-2.5 text-left transition-all duration-150 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ${style.border}`}
          >

            <span className="flex items-center justify-between gap-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${busy ? "led-flash " : ""}${style.dot}`} />
              <span className="font-mono text-[9px] text-zinc-600">
                {String(index + 1).padStart(2, "0")}
              </span>
            </span>
            <span className="mt-1.5 block font-mono text-[11px] leading-tight font-semibold tracking-wide text-zinc-100">
              {eventType}
            </span>
            <span className="mt-0.5 block text-[10px] text-zinc-500">
              {busy ? "Sending…" : "Fire GRIP event"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
