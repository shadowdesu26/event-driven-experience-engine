"use client";

import { useEffect, useRef, useState } from "react";

import type { GripEventPayload, GripResponse } from "@/app/lib/api";

interface VideoPlayerProps {
  response: GripResponse | null;
  payload: GripEventPayload | null;
  playbackKey: number;
}

interface AudioTrack {
  gain: GainNode;
  oscillators: OscillatorNode[];
}

// Shared audio engine: a singleton AudioContext feeding a master gain, with one
// gain-node track per directive. A new directive crossfades the previous track
// out over CROSSFADE_SECONDS while the new track starts at its directed volume.
const CROSSFADE_SECONDS = 0.35;
const DEFAULT_VOLUME = 0.7;

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let activeTrack: AudioTrack | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx || !masterGain) {
      const AudioCtxCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxCtor) return null;
      audioCtx = new AudioCtxCtor();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function fadeOutTrack(track: AudioTrack, fadeSeconds: number) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  try {
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setValueAtTime(Math.max(track.gain.gain.value, 0.0001), now);
    track.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
    track.oscillators.forEach((osc) => {
      try {
        osc.stop(now + fadeSeconds + 0.05);
      } catch {
        // oscillator already stopped
      }
    });
    window.setTimeout(() => {
      try {
        track.gain.disconnect();
      } catch {
        // already disconnected
      }
    }, (fadeSeconds + 0.1) * 1000);
  } catch {
    // track already torn down
  }
}

function addVoice(
  ctx: AudioContext,
  track: AudioTrack,
  opts: {
    type?: OscillatorType;
    freq: number;
    endFreq?: number;
    startAt: number;
    duration: number;
    peak: number;
  },
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.freq, opts.startAt);
  if (opts.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(opts.endFreq, opts.startAt + opts.duration * 0.89);
  }
  gain.gain.setValueAtTime(opts.peak, opts.startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, opts.startAt + opts.duration);
  osc.connect(gain);
  gain.connect(track.gain);
  osc.start(opts.startAt);
  osc.stop(opts.startAt + opts.duration);
  track.oscillators.push(osc);
}

// Per-event synthesis recipes; voice peaks are scaled by the directive volume.
function playAudioDirective(eventType: string, volume: number) {
  const ctx = getAudioContext();
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;

  if (activeTrack) {
    fadeOutTrack(activeTrack, CROSSFADE_SECONDS);
    activeTrack = null;
  }

  const trackGain = ctx.createGain();
  trackGain.gain.value = Math.min(1, Math.max(0, volume));
  trackGain.connect(masterGain);
  const track: AudioTrack = { gain: trackGain, oscillators: [] };
  activeTrack = track;

  if (eventType === "GAME_START") {
    // Ambient theme swell
    addVoice(ctx, track, { type: "sine", freq: 220, endFreq: 330, startAt: now, duration: 1.2, peak: 0.12 });
  } else if (eventType === "SPIN_RESULT") {
    // Reward chime
    addVoice(ctx, track, { type: "triangle", freq: 659.25, startAt: now, duration: 0.35, peak: 0.16 });
    addVoice(ctx, track, { type: "triangle", freq: 880, startAt: now + 0.12, duration: 0.4, peak: 0.14 });
  } else if (eventType === "NO_WIN") {
    // Muted descending tone
    addVoice(ctx, track, { type: "sine", freq: 293.66, endFreq: 110, startAt: now, duration: 0.6, peak: 0.1 });
  } else if (eventType === "NEAR_WIN") {
    // Tension pulse: oscillating drone
    addVoice(ctx, track, { freq: 140, startAt: now, duration: 1.8, peak: 0.18 });
    addVoice(ctx, track, { freq: 145, startAt: now, duration: 1.8, peak: 0.18 });
  } else if (eventType === "BIG_WIN") {
    // Victory arpeggio (C5 -> E5 -> G5 -> C6)
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    freqs.forEach((freq, idx) => {
      addVoice(ctx, track, { type: "triangle", freq, startAt: now + idx * 0.12, duration: 0.5, peak: 0.2 });
    });
  } else if (eventType === "WIN_STREAK") {
    // Rapid victory fanfare
    const freqs = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    freqs.forEach((freq, idx) => {
      addVoice(ctx, track, { type: "triangle", freq, startAt: now + idx * 0.08, duration: 0.45, peak: 0.2 });
    });
  } else if (eventType === "JACKPOT") {
    // Grand fanfare
    const freqs = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    freqs.forEach((freq, idx) => {
      addVoice(ctx, track, { type: "sawtooth", freq, startAt: now + idx * 0.1, duration: 0.7, peak: 0.18 });
    });
  } else if (eventType === "BONUS_TRIGGER") {
    // Mystical harmonic sweep
    addVoice(ctx, track, { type: "sine", freq: 329.63, endFreq: 880, startAt: now, duration: 0.9, peak: 0.2 });
  }
}

function videoMime(path: string): string {
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".ogg")) return "video/ogg";
  if (path.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

export default function VideoPlayer({ response, payload, playbackKey }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sourceError, setSourceError] = useState(false);

  useEffect(() => {
    setSourceError(false);
    const video = videoRef.current;
    if (video) {
      video.load();
      video.play().catch(() => {});
    }
    if (response && response.action === "play") {
      playAudioDirective(response.event_type, response.volume ?? DEFAULT_VOLUME);
    }
  }, [playbackKey, response]);

  const hasPlayableAsset =
    response !== null && response.action === "play" && response.asset_path !== "";

  const pulseStyle =
    response?.ui_pulse === "full"
      ? "border-amber-400/80 ring-1 ring-amber-400/40"
      : response?.ui_pulse === "strong"
      ? "border-orange-500/60 ring-1 ring-orange-500/30"
      : response?.ui_pulse === "subtle"
      ? "border-amber-500/40"
      : "border-white/10 shadow-[0_0_50px_-12px_rgba(125,211,252,0.15),0_18px_40px_rgba(0,0,0,0.55)]";

  const pulseAnimClass =
    response?.ui_pulse === "full"
      ? "cabinet-pulse-full"
      : response?.ui_pulse === "strong"
      ? "cabinet-pulse-strong"
      : response?.ui_pulse === "subtle"
      ? "cabinet-pulse-subtle"
      : "";

  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-black transition-all duration-300 ${pulseStyle} ${pulseAnimClass}`}>
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/5 bg-zinc-950/90 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold text-amber-400">
            {response ? response.event_type : "AWAITING EVENT"}
          </p>
          <p className="truncate text-xs text-zinc-500">
            {response ? response.asset_path || "no asset mapped" : "middleware idle"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {response?.volume !== undefined ? (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] text-sky-300 uppercase">
              VOL: {response.volume.toFixed(2)}
            </span>
          ) : null}
          {response?.ui_pulse && response.ui_pulse !== "none" ? (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] text-amber-300 uppercase">
              PULSE: {response.ui_pulse}
            </span>
          ) : null}
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase ${
              hasPlayableAsset
                ? "bg-emerald-500/15 text-emerald-400 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]"
                : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {response ? response.action : "standby"}
          </span>
        </div>
      </div>

      <div className="relative aspect-video w-full lg:aspect-auto lg:min-h-0 lg:flex-1">
        {hasPlayableAsset ? (
          sourceError ? (
            <MissingAsset requestedPath={response.asset_path} />
          ) : (
            <video
              key={playbackKey}
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-contain"
              controls
              autoPlay
              playsInline
              preload="auto"
            >
              <source
                src={response.asset_path}
                type={videoMime(response.asset_path)}
                onError={() => setSourceError(true)}
              />
            </video>
          )
        ) : (
          <div className="absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-950">
            <p className="font-mono text-sm text-zinc-600">
              {response ? "No media directive for this event" : "Press a GRIP event button or spin reels"}
            </p>
            <p className="text-xs text-zinc-700">
              Middleware allocates video and soundtrack directive here
            </p>
          </div>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1.5 border-t border-white/5 bg-zinc-950/90 px-4 py-2 sm:grid-cols-4">
        <div className="min-w-0">
          <p className="font-mono text-[9px] tracking-[0.24em] text-zinc-600 uppercase">Win / Bet</p>
          <p className="truncate font-mono text-xs text-zinc-300">
            {payload?.win_amount !== undefined
              ? `${payload.win_amount} / ${payload.bet_amount ?? 25}${
                  response?.win_multiplier !== undefined ? ` (${response.win_multiplier}x)` : ""
                }`
              : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[9px] tracking-[0.24em] text-zinc-600 uppercase">Symbols</p>
          <p className="truncate font-mono text-xs text-zinc-300">
            {payload?.symbols ? payload.symbols.join(" ") : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[9px] tracking-[0.24em] text-zinc-600 uppercase">Soundtrack</p>
          <p className="truncate font-mono text-xs text-amber-300/80">
            {response?.soundtrack_path ? response.soundtrack_path.split("/").pop() : "none"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[9px] tracking-[0.24em] text-zinc-600 uppercase">Allocation Logic</p>
          <p className="truncate text-xs text-zinc-400" title={response?.message}>
            {response ? response.message : "awaiting event"}
          </p>
        </div>
      </div>
    </div>
  );
}

function MissingAsset({ requestedPath }: { requestedPath: string }) {
  return (
    <div className="absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-3 bg-zinc-950 px-6 text-center">
      <p className="font-mono text-sm font-semibold text-rose-400">ASSET NOT FOUND</p>
      <p className="font-mono text-xs text-zinc-500">
        GET <span className="text-zinc-300">{requestedPath}</span> → 404
      </p>
      <p className="max-w-md text-xs leading-5 text-zinc-600">
        Drop the matching file into{" "}
        <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-400">
          frontend/public/wuxia/
        </code>{" "}
        and fire the event again.
      </p>
    </div>
  );
}
