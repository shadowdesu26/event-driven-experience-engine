"use client";

import { useCallback, useState } from "react";

import EventButtons from "@/app/components/EventButtons";
import SlotMachine from "@/app/components/SlotMachine";
import VideoPlayer from "@/app/components/VideoPlayer";
import {
  DEFAULT_LIGHT_PROGRAM,
  postGripEvent,
  type EventType,
  type GripEventInput,
  type GripEventPayload,
  type GripResponse,
  type LightProgram,
} from "@/app/lib/api";
import { setEngineEnabled } from "@/app/lib/experience";
import { plainDirective } from "@/app/lib/plain";

export default function Home() {
  const [response, setResponse] = useState<GripResponse | null>(null);
  const [suspense, setSuspense] = useState<GripResponse | null>(null);
  const [suspenseLatencyMs, setSuspenseLatencyMs] = useState(0);
  const [payload, setPayload] = useState<GripEventPayload | null>(null);
  const [loadingEvent, setLoadingEvent] = useState<EventType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbackKey, setPlaybackKey] = useState(0);
  // A/B gate: engine off swaps the event-driven middleware for a plain
  // client-side if/else player, so the engine's contribution is audible.
  const [engineOn, setEngineOn] = useState(true);
  // Cabinet rim-light program — the engine's lighting directives rendered as a
  // subtle border glow on the machine (never a full-cabinet flash).
  const [light, setLight] = useState<LightProgram>(DEFAULT_LIGHT_PROGRAM);

  const handleEngineToggle = useCallback(() => {
    setEngineOn((prev) => {
      const next = !prev;
      // Going dark: stop engine audio, keep the panels as the plain baseline
      // fills them on the next result (the plain if/else player takes over).
      setEngineEnabled(next);
      if (!next) {
        setSuspense(null);
        setError(null);
        setLight(DEFAULT_LIGHT_PROGRAM);
      }
      return next;
    });
  }, []);

  const handleFire = useCallback(async (eventInput: GripEventInput) => {
    const eventType = typeof eventInput === "string" ? eventInput : eventInput.event_type;
    const isString = typeof eventInput === "string";
    const bet = isString ? 25 : eventInput.bet_amount ?? 25;
    const win = isString ? 0 : eventInput.win_amount ?? 0;

    // Engine OFF: a plain if/else handler still runs — fixed video lookups and
    // one canned win/loss sound — but the middleware is never consulted, so
    // there is no pacing, no suspense, no streaks, no dynamic re-allocation.
    if (!engineOn) {
      const plainPayload: GripEventPayload = {
        game_id: "SLOT-WUXIA-01",
        theme: "wuxia",
        bet_amount: bet,
        win_amount: win,
        win_level: "NONE",
        spin_phase: "resolved",
        ...(isString ? {} : eventInput),
        event_type: eventType,
        event_id: !isString && eventInput.event_id ? eventInput.event_id : crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };
      setPayload(plainPayload);
      setResponse(plainDirective(plainPayload));
      setSuspense(null);
      setPlaybackKey((key) => key + 1);
      return;
    }

    setLoadingEvent(eventType);
    setError(null);
    try {
      const { payload: sentPayload, response: res } = await postGripEvent(eventInput);
      setPayload(sentPayload);
      setResponse(res);
      setPlaybackKey((key) => key + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingEvent(null);
    }
  }, [engineOn]);

  /**
   * Pre-resolution probe. Fires while the cabinet reels are still turning so the
   * middleware can answer with a suspense program. Kept off `playbackKey` and
   * off `response` on purpose: a probe allocates no video and must not restart
   * playback.
   */
  const handleProbe = useCallback(async (eventInput: GripEventInput) => {
    // Engine off: a plain if/else client cannot probe — it cannot know what
    // the outcome will be worth teasing. That contrast IS the demonstration.
    if (!engineOn) return;
    setError(null);
    const dispatchedAt = performance.now();
    try {
      const { response: res } = await postGripEvent(eventInput);
      setSuspenseLatencyMs(performance.now() - dispatchedAt);
      setSuspense(res.cues?.length ? res : null);
    } catch (err) {
      setSuspense(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [engineOn]);

  const soundtrackName = response?.soundtrack_path
    ? response.soundtrack_path.split("/").pop()
    : "none";

  return (
    <main className="flex min-h-screen flex-col overflow-x-hidden bg-slate-950 text-slate-100 lg:h-screen lg:overflow-hidden">
      <header className="relative flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-[0.22em] text-zinc-100 uppercase">
            Experience Engine
          </h1>
          <span className="rounded-sm bg-amber-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-widest text-amber-400 uppercase">
            PoC
          </span>
          <p className="hidden text-xs text-zinc-500 md:block">
            cabinet simulator → GRIP middleware → Wuxia media directive
          </p>
        </div>

        {/* A/B switch — dead center at the very top of the page. Engine off
            hands the presentation to a plain if/else handler: fixed clips and
            canned sounds, no middleware, no context, no drama. */}
        <button
          type="button"
          onClick={handleEngineToggle}
          title="Toggle the Experience Engine on/off to compare event-driven allocation vs a static if/else player"
          className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border px-4 py-1.5 font-mono text-[11px] font-bold tracking-[0.18em] uppercase transition-colors duration-150 ${
            engineOn
              ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.25)]"
              : "border-zinc-600 bg-zinc-800/70 text-zinc-500"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              engineOn ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" : "bg-zinc-600"
            }`}
          />
          Experience Engine {engineOn ? "On" : "Off"}
        </button>

        <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
          {engineOn ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
              POST /api/grip-event
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
              if/else mode — no middleware calls
            </>
          )}
        </div>
      </header>

      {/* Full-bleed: no max-width cap — the console and gameplay reach the walls */}
      <div className="grid min-h-0 min-w-0 flex-1 gap-4 p-4 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <aside className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden rounded-xl border border-white/10 bg-gray-900/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div>
            <h2 className="text-xs font-semibold tracking-[0.24em] text-zinc-400 uppercase">
              GRIP Event Simulator
            </h2>
            <p className="mt-1 text-[11px] leading-4 text-zinc-600">
              Manual triggers POST a simulated GRIP payload to the middleware
            </p>
          </div>

          {error ? (
            <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-[11px] leading-4 break-words text-rose-300">
              {error}
            </p>
          ) : null}

          <EventButtons onFire={handleFire} loadingEvent={loadingEvent} />

          <div className="rounded-lg border border-white/5 bg-black/50 p-3">
            <p className="font-mono text-[9px] tracking-[0.24em] text-zinc-600 uppercase">
              Last payload
            </p>
            <pre className="mt-1.5 overflow-x-auto font-mono text-[10px] leading-4 text-zinc-500">
              {payload
                ? JSON.stringify(payload, null, 2)
                : "// fire an event to inspect the request body"}
            </pre>
          </div>

          {/* Directive log — the player panel's metadata lives here instead */}
          <div className="mt-auto rounded-lg border border-white/5 bg-black/50 p-3">
            <p className="font-mono text-[9px] tracking-[0.24em] text-zinc-600 uppercase">
              Directive log
            </p>
            {response ? (
              <div className="mt-2 space-y-1.5 font-mono text-[10px] leading-4 text-zinc-500">
                <p className="text-zinc-400">
                  WIN/BET: {payload?.win_amount ?? "—"} / {payload?.bet_amount ?? "—"}
                  {response.win_multiplier !== undefined ? ` (${response.win_multiplier}x)` : ""}
                </p>
                <p className="truncate" title={payload?.symbols?.join(" ")}>
                  SYMBOLS: {payload?.symbols ? payload.symbols.join(" ") : "—"}
                </p>
                <p>AUDIO: {soundtrackName}</p>
                <p>
                  STREAK:{" "}
                  <span className={response.losing_streak ? "text-rose-400" : ""}>
                    {String(response.losing_streak ?? 0).padStart(2, "0")}L
                  </span>{" "}
                  / <span className="text-amber-400">{String(response.win_streak ?? 0).padStart(2, "0")}W</span>
                  {response.drought_tier && response.drought_tier !== "none"
                    ? ` · ${response.drought_tier} drought`
                    : ""}
                </p>
                <p className="whitespace-pre-wrap break-words pt-1 text-zinc-400">
                  {response.message}
                </p>
              </div>
            ) : (
              <p className="mt-2 font-mono text-[10px] leading-4 text-zinc-500">
                {"// fire an event to see the allocation rationale"}
              </p>
            )}
          </div>
        </aside>

        <div className="grid min-h-0 min-w-0 gap-4 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="flex min-h-0 min-w-0 flex-col gap-2">
            <div className="flex shrink-0 items-baseline justify-between">
              <h2 className="text-xs font-semibold tracking-[0.24em] text-zinc-400 uppercase">
                Experience Player
              </h2>
              <p className="text-[11px] text-zinc-600">auto-plays the routed asset</p>
            </div>
            <div className="min-h-0 min-w-0 flex-1">
              <VideoPlayer
                response={response}
                suspense={suspense}
                suspenseLatencyMs={suspenseLatencyMs}
                playbackKey={playbackKey}
                symbols={payload?.symbols}
                engineOn={engineOn}
                onLight={setLight}
              />
            </div>
          </section>

          <section className="flex min-h-[420px] min-w-0 flex-col gap-2 lg:min-h-0">
            <div className="flex shrink-0 items-baseline justify-between">
              <h2 className="text-xs font-semibold tracking-[0.24em] text-zinc-400 uppercase">
                Slot Machine Simulator
              </h2>
              <p className="text-[11px] text-zinc-600">spin fires a random GRIP event</p>
            </div>
            <div className="min-h-[420px] min-w-0 flex-1 lg:min-h-0">
              <SlotMachine
                onFire={handleFire}
                onProbe={handleProbe}
                busy={loadingEvent !== null}
                engineOn={engineOn}
                light={light}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
