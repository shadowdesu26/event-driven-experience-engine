"use client";

import { useCallback, useRef, useState } from "react";

import { EVENT_TYPES, type EventType, type GripEventInput } from "@/app/lib/api";

type SlotSymbol = "7" | "BAR" | "🍒" | "🍋" | "🍇" | "🔔" | "⭐" | "💎";

const SYMBOLS: SlotSymbol[] = ["7", "BAR", "🍒", "🍋", "🍇", "🔔", "⭐", "💎"];

const SPIN_BASE_MS = 900;
const REEL_STAGGER_MS = 160;
const REEL_COUNT = 5;
const REEL_HEIGHT = 144;
const CELL_HEIGHT = 48;

const EVENT_TICKERS: Record<EventType, string> = {
  GAME_START: "GOOD LUCK, PLAYER ONE",
  SPIN_RESULT: "NO WIN — SPIN AGAIN",
  NO_WIN: "DEAD SPIN — NO PAYLINES",
  NEAR_WIN: "SO CLOSE — HEARTS ON FIRE",
  BONUS_TRIGGER: "BONUS ROUND AWARDED",
  BIG_WIN: "BIG WIN — CELEBRATE",
  JACKPOT: "JACKPOT — MEGA FORTUNE",
  WIN_STREAK: "WIN STREAK — STATE OVERRIDE",
};

const EVENT_PAYOUTS: Record<EventType, number> = {
  GAME_START: 0,
  SPIN_RESULT: 25,
  NO_WIN: 0,
  NEAR_WIN: 0,
  BONUS_TRIGGER: 250,
  BIG_WIN: 500,
  JACKPOT: 2500,
  WIN_STREAK: 0,
};

// WIN_STREAK is a backend state override with a manual demo trigger,
// not a raw reel outcome, so random spins never select it.
const SPIN_POOL: EventType[] = EVENT_TYPES.filter((t) => t !== "WIN_STREAK");

const BET_OPTIONS = [25, 50, 100] as const;

interface ReelView {
  spinning: boolean;
  cells: SlotSymbol[];
  strip: SlotSymbol[];
  landKey: number;
}

function randomSymbol(exclude?: SlotSymbol): SlotSymbol {
  let pick = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  while (exclude !== undefined && pick === exclude) {
    pick = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  }
  return pick;
}

function randomRestingCells(): SlotSymbol[] {
  return [randomSymbol(), randomSymbol(), randomSymbol()];
}

const INITIAL_REELS: SlotSymbol[][] = [
  ["🍒", "7", "🍋"],
  ["BAR", "⭐", "🍒"],
  ["🍋", "💎", "BAR"],
  ["⭐", "🍒", "🔔"],
  ["🍇", "BAR", "⭐"],
];

function spinStrip(): SlotSymbol[] {
  const base = Array.from({ length: 20 }, () => randomSymbol());
  return [...base, ...base];
}

function buildResultCells(event: EventType): SlotSymbol[][] {
  const fillers = () => [randomSymbol(), randomSymbol()];

  switch (event) {
    case "JACKPOT":
    case "BIG_WIN": {
      const symbol: SlotSymbol = event === "JACKPOT" ? "7" : "💎";
      return Array.from({ length: REEL_COUNT }, () => [randomSymbol(), symbol, randomSymbol()]);
    }
    case "NEAR_WIN": {
      const match = randomSymbol();
      const mismatch = randomSymbol(match);
      const missIndex = Math.floor(Math.random() * REEL_COUNT);
      return Array.from({ length: REEL_COUNT }, (_, i) =>
        fillers().toSpliced(1, 1, i === missIndex ? mismatch : match),
      );
    }
    case "BONUS_TRIGGER": {
      return Array.from({ length: REEL_COUNT }, (_, i) => {
        const cells = fillers();
        if (i % 2 === 0) cells[1] = "⭐";
        else if (cells[1] === "⭐") cells[1] = randomSymbol("⭐");
        return cells;
      });
    }
    case "SPIN_RESULT": {
      const pair = randomSymbol();
      return Array.from({ length: REEL_COUNT }, (_, i) => {
        const cells = fillers();
        if (i < 2) cells[1] = pair;
        return cells;
      });
    }
    case "NO_WIN": {
      // Intentional mismatch: 5 distinct symbols shuffled across the center
      // payline so no payline can possibly trigger.
      const pool = [...SYMBOLS];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return Array.from({ length: REEL_COUNT }, (_, i) => {
        const cells = fillers();
        cells[1] = pool[i];
        return cells;
      });
    }
    case "GAME_START":
    default:
      return Array.from({ length: REEL_COUNT }, () => {
        const cells = randomRestingCells();
        if (new Set(cells).size === 1) cells[0] = randomSymbol(cells[1]);
        return cells;
      });
  }
}

function SlotSymbolView({ symbol }: { symbol: SlotSymbol }) {
  if (symbol === "7") {
    return (
      <span className="text-[1.7rem] leading-none font-black text-red-600 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
        7
      </span>
    );
  }
  if (symbol === "BAR") {
    return (
      <span className="rounded-[3px] border border-zinc-600 bg-gradient-to-b from-zinc-100 to-zinc-300 px-1.5 py-0.5 text-[10px] leading-tight font-black tracking-[0.18em] text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
        BAR
      </span>
    );
  }
  return <span className="text-3xl leading-none">{symbol}</span>;
}

function Reel({ reel, index }: { reel: ReelView; index: number }) {
  return (
    <div
      className="relative overflow-hidden rounded-lg border border-stone-400/70 bg-gradient-to-r from-stone-300 via-white to-stone-300 shadow-[inset_0_14px_22px_rgba(0,0,0,0.35),inset_0_-14px_22px_rgba(0,0,0,0.35),inset_10px_0_14px_rgba(0,0,0,0.12),inset_-10px_0_14px_rgba(0,0,0,0.12)]"
      style={{ height: REEL_HEIGHT }}
    >
      {reel.spinning ? (
        <div
          className="reel-strip-spin flex flex-col blur-[1.6px]"
          style={{ animationDuration: `${0.3 + index * 0.05}s` }}
        >
          {reel.strip.map((symbol, i) => (
            <div
              key={i}
              className="flex items-center justify-center border-b border-zinc-300/40"
              style={{ height: CELL_HEIGHT }}
            >
              <SlotSymbolView symbol={symbol} />
            </div>
          ))}
        </div>
      ) : (
        <div key={reel.landKey} className="reel-land flex flex-col">
          {reel.cells.map((symbol, i) => (
            <div
              key={i}
              className={`flex items-center justify-center ${i === 1 ? "border-y-2 border-red-400/40 bg-amber-50/70" : "border-b border-zinc-300/40"}`}
              style={{ height: CELL_HEIGHT }}
            >
              <SlotSymbolView symbol={symbol} />
            </div>
          ))}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-white/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-zinc-900/25 to-transparent" />
    </div>
  );
}

function LedScreen({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  const color = accent ? "text-amber-400 [text-shadow:0_0_10px_rgba(251,191,36,0.7)]" : "text-red-500 [text-shadow:0_0_10px_rgba(239,68,68,0.75)]";
  return (
    <div className="flex-1 rounded-md border border-red-900/70 bg-black px-3 py-1.5 shadow-[inset_0_2px_8px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.06)]">
      <p className={`font-mono text-[9px] tracking-[0.28em] ${color} opacity-70`}>{label}</p>
      <p className={`font-mono text-lg leading-tight font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function LedTicker({ message, active }: { message: string; active: boolean }) {
  return (
    <div className="flex-[1.4] rounded-md border border-red-900/70 bg-black px-3 py-1.5 shadow-[inset_0_2px_8px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.06)]">
      <p className={`font-mono text-[9px] tracking-[0.28em] text-red-500 [text-shadow:0_0_10px_rgba(239,68,68,0.75)] opacity-70`}>
        MESSAGE
      </p>
      <p
        className={`truncate font-mono text-sm leading-tight font-bold tracking-[0.12em] text-red-500 [text-shadow:0_0_10px_rgba(239,68,68,0.75)] ${active ? "led-flash" : ""}`}
      >
        {message}
      </p>
    </div>
  );
}

function CabinetScrews() {
  const screw = "absolute h-2.5 w-2.5 rounded-full bg-gradient-to-br from-zinc-300 via-zinc-500 to-zinc-700 shadow-[inset_0_-1px_1px_rgba(0,0,0,0.6)]";
  return (
    <>
      <span className={`${screw} top-2.5 left-2.5`} />
      <span className={`${screw} top-2.5 right-2.5`} />
      <span className={`${screw} bottom-2.5 left-2.5`} />
      <span className={`${screw} bottom-2.5 right-2.5`} />
    </>
  );
}

interface SlotMachineProps {
  onFire: (eventInput: GripEventInput) => void;
  busy: boolean;
}

export default function SlotMachine({ onFire, busy }: SlotMachineProps) {
  const [reels, setReels] = useState<ReelView[]>(() =>
    INITIAL_REELS.map((cells) => ({
      spinning: false,
      cells,
      strip: [],
      landKey: 0,
    })),
  );
  const [spinning, setSpinning] = useState(false);
  const [bet, setBet] = useState<number>(BET_OPTIONS[0]);
  const [credit, setCredit] = useState(5000);
  const [ticker, setTicker] = useState("INSERT COIN — PRESS SPIN");
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearPending = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  const handleSpin = useCallback(() => {
    if (spinning || busy) return;

    const eventType = SPIN_POOL[Math.floor(Math.random() * SPIN_POOL.length)];
    const resultCells = buildResultCells(eventType);

    setSpinning(true);
    setTicker("REELS IN MOTION…");
    setCredit((c) => Math.max(0, c - bet));
    setReels((prev) =>
      prev.map((reel) => ({
        ...reel,
        spinning: true,
        strip: spinStrip(),
      })),
    );

    for (let i = 0; i < REEL_COUNT; i++) {
      const delay = SPIN_BASE_MS + i * REEL_STAGGER_MS;
      timeoutsRef.current.push(
        setTimeout(() => {
          setReels((prev) =>
            prev.map((reel, idx) =>
              idx === i
                ? { spinning: false, cells: resultCells[i], strip: reel.strip, landKey: reel.landKey + 1 }
                : reel,
            ),
          );
        }, delay),
      );
    }

    timeoutsRef.current.push(
      setTimeout(() => {
        setSpinning(false);
        setTicker(EVENT_TICKERS[eventType]);
        const payout = EVENT_PAYOUTS[eventType] * (bet / 25);
        setCredit((c) => c + payout);
        const centerLineSymbols = resultCells.map((cells) => String(cells[1]));
        onFire({
          event_type: eventType,
          game_id: "SLOT-WUXIA-01",
          theme: "wuxia",
          bet_amount: bet,
          win_amount: payout,
          symbols: centerLineSymbols,
          win_level: payout >= 1000 ? "JACKPOT" : payout >= 250 ? "HIGH" : payout > 0 ? "MEDIUM" : "NONE",
        });
      }, SPIN_BASE_MS + (REEL_COUNT - 1) * REEL_STAGGER_MS + 120),
    );
  }, [spinning, busy, bet, onFire]);

  return (
    <div className="relative flex h-full flex-col overflow-y-auto rounded-[1.6rem] border border-red-500/40 bg-gradient-to-b from-red-900 via-red-950 to-red-900 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_45px_rgba(0,0,0,0.6)]">
      <CabinetScrews />

      <div className="flex h-full flex-col gap-3 rounded-2xl border-2 border-red-500 bg-gradient-to-b from-zinc-900 to-zinc-950 p-3.5 shadow-[inset_0_0_34px_rgba(0,0,0,0.9)] md:p-4">
        <div className="marquee-pulse rounded-lg border border-amber-500/40 bg-gradient-to-b from-red-800 to-red-950 px-4 py-2 text-center shadow-[inset_0_-4px_10px_rgba(0,0,0,0.5)]">
          <p className="text-sm font-black tracking-[0.32em] text-amber-300 [text-shadow:0_0_16px_rgba(251,191,36,0.65),0_2px_0_rgba(120,53,15,0.9)] md:text-base">
            ★ FORTUNE ENGINE ★
          </p>
        </div>

        <div className="relative">
          <div className="grid grid-cols-5 gap-2 rounded-xl border border-red-950/80 bg-red-950/50 p-2 shadow-[inset_0_4px_12px_rgba(0,0,0,0.7)] md:gap-2.5">
            {reels.map((reel, i) => (
              <Reel key={i} reel={reel} index={i} />
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center">
            <div className="h-px w-full bg-red-500/20" />
          </div>
        </div>

        <div className="flex gap-2">
          <LedScreen label="TOTAL BET" value={String(bet).padStart(4, "0")} />
          <LedTicker message={ticker} active={spinning} />
          <LedScreen label="CREDIT" value={String(credit).padStart(6, "0")} accent />
        </div>

        <div className="mt-auto flex items-stretch gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => setTicker("8 GRIP EVENTS → POST /api/grip-event")}
            className="rounded-lg border border-zinc-400/60 bg-gradient-to-b from-zinc-200 to-zinc-400 px-3.5 pb-1.5 text-xs font-black tracking-widest text-zinc-800 uppercase shadow-[0_4px_0_#52525b,0_8px_14px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-100 hover:from-zinc-100 hover:to-zinc-300 active:translate-y-[3px] active:shadow-[0_1px_0_#52525b,inset_0_1px_0_rgba(255,255,255,0.9)] active:scale-95"
          >
            Info
          </button>
          <button
            type="button"
            onClick={() => {
              setBet(BET_OPTIONS[2]);
              setTicker("MAX BET ENGAGED — 100");
            }}
            className="rounded-lg border border-zinc-500/60 bg-gradient-to-b from-zinc-400 to-zinc-600 px-3.5 pb-1.5 text-xs font-black tracking-widest text-zinc-100 uppercase shadow-[0_4px_0_#3f3f46,0_8px_14px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.55)] transition-all duration-100 hover:from-zinc-300 hover:to-zinc-500 active:translate-y-[3px] active:shadow-[0_1px_0_#3f3f46,inset_0_1px_0_rgba(255,255,255,0.55)] active:scale-95"
          >
            Max&nbsp;Bet
          </button>

          <button
            type="button"
            onClick={handleSpin}
            disabled={spinning || busy}
            className="group relative flex-1 overflow-hidden rounded-xl border border-green-300/60 bg-gradient-to-b from-green-400 to-green-600 pb-1.5 shadow-[0_6px_0_#15803d,0_14px_26px_rgba(34,197,94,0.35),inset_0_2px_0_rgba(255,255,255,0.55)] transition-all duration-100 hover:from-green-300 hover:to-green-500 active:translate-y-[4px] active:shadow-[0_2px_0_#15803d,inset_0_2px_0_rgba(255,255,255,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" />
            <span className="relative block text-xl font-black tracking-[0.35em] text-white uppercase [text-shadow:0_2px_0_rgba(20,83,45,0.8)] md:text-2xl">
              {spinning ? "Spinning" : busy ? "Sending" : "Spin"}
            </span>
            <span className="relative mt-0.5 block font-mono text-[9px] tracking-[0.24em] text-green-50/90 uppercase">
              {spinning ? "Stop / Autospin" : "Fires Random GRIP Event"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
