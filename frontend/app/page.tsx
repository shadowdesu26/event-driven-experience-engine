"use client";

import { useCallback, useState } from "react";

import EventButtons from "@/app/components/EventButtons";
import SlotMachine from "@/app/components/SlotMachine";
import VideoPlayer from "@/app/components/VideoPlayer";
import {
  postGripEvent,
  type EventType,
  type GripEventInput,
  type GripEventPayload,
  type GripResponse,
} from "@/app/lib/api";

export default function Home() {
  const [response, setResponse] = useState<GripResponse | null>(null);
  const [payload, setPayload] = useState<GripEventPayload | null>(null);
  const [loadingEvent, setLoadingEvent] = useState<EventType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbackKey, setPlaybackKey] = useState(0);

  const handleFire = useCallback(async (eventInput: GripEventInput) => {
    const eventType = typeof eventInput === "string" ? eventInput : eventInput.event_type;
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
  }, []);


  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-100 lg:h-screen lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
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
        <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
          POST /api/grip-event
        </div>
      </header>

      <div className="grid flex-1 gap-4 p-4 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border border-white/10 bg-gray-900/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
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

          <div className="mt-auto rounded-lg border border-white/5 bg-black/50 p-3">
            <p className="font-mono text-[9px] tracking-[0.24em] text-zinc-600 uppercase">
              Last payload
            </p>
            <pre className="mt-1.5 overflow-x-auto font-mono text-[10px] leading-4 text-zinc-500">
              {payload
                ? JSON.stringify(payload, null, 2)
                : "// fire an event to inspect the request body"}
            </pre>
          </div>
        </aside>

        <div className="grid min-h-0 gap-4 lg:grid-rows-2">
          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex shrink-0 items-baseline justify-between">
              <h2 className="text-xs font-semibold tracking-[0.24em] text-zinc-400 uppercase">
                Experience Player
              </h2>
              <p className="text-[11px] text-zinc-600">auto-plays the routed asset</p>
            </div>
            <div className="min-h-0 flex-1">
              <VideoPlayer response={response} payload={payload} playbackKey={playbackKey} />
            </div>
          </section>

          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex shrink-0 items-baseline justify-between">
              <h2 className="text-xs font-semibold tracking-[0.24em] text-zinc-400 uppercase">
                Slot Machine Simulator
              </h2>
              <p className="text-[11px] text-zinc-600">
                spin fires a random GRIP event
              </p>
            </div>
            <div className="min-h-[420px] flex-1 lg:min-h-0">
              <SlotMachine onFire={handleFire} busy={loadingEvent !== null} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
