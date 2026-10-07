"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_AUDIO_PROFILE, type GripResponse, type LightProgram } from "@/app/lib/api";
import {
  cancelCues,
  ingestDirective,
  playPlainLoss,
  playPlainWin,
  runCues,
  stopAll,
} from "@/app/lib/experience";
import { plainStingDirection } from "@/app/lib/plain";

interface VideoPlayerProps {
  /** The resolved directive: drives the video channel, sting, and bed. */
  response: GripResponse | null;
  /** The pre-resolution suspense directive: drives cues and the heartbeat. */
  suspense: GripResponse | null;
  /** Round trip of the probe request, so cues land on the real reel beats. */
  suspenseLatencyMs: number;
  playbackKey: number;
  /** Center-line symbols of the resolved spin — feeds the symbol sound-depth readout. */
  symbols?: string[];
  /** Engine off: the if/else baseline — fixed clips and one canned sound. */
  engineOn: boolean;
  /** Receives the engine's light programs for the cabinet rim glow. */
  onLight: (program: LightProgram) => void;
}

function videoMime(path: string): string {
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".ogg")) return "video/ogg";
  if (path.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

export default function VideoPlayer({
  response,
  suspense,
  suspenseLatencyMs,
  playbackKey,
  symbols,
  engineOn,
  onLight,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sourceError, setSourceError] = useState(false);

  // Stable light setter identity for the runtime callbacks.
  const applyLight = useCallback(
    (program: LightProgram) => {
      onLight(program);
    },
    [onLight],
  );

  // Resolved directive: video always plays; the audio channel depends on the
  // mode — engine stings/beds/rim lights, or one canned plain sound.
  useEffect(() => {
    setSourceError(false);
    const video = videoRef.current;
    if (video) {
      video.load();
      video.play().catch(() => {});
    }
    if (!response) return;
    if (!engineOn) {
      if (plainStingDirection(response.event_type) === "win") {
        playPlainWin();
      } else {
        playPlainLoss();
      }
      return;
    }
    ingestDirective(
      {
        event_type: response.event_type,
        action: response.action,
        phase: response.phase,
        volume: response.volume,
        audio: response.audio ?? DEFAULT_AUDIO_PROFILE,
        bedtrack_path: response.bedtrack_path,
        bedtrack_volume: response.bedtrack_volume,
        light_program: response.light_program,
        symbols,
      },
      applyLight,
    );
  }, [playbackKey, response, symbols, engineOn, applyLight]);

  // Suspense probe: run the cue ladder the middleware authored (heartbeat +
  // rim-light escalation). The plain if/else player has no pre-resolution
  // awareness — no probe, no cues.
  useEffect(() => {
    if (!engineOn || !suspense?.cues?.length) return;
    runCues(
      suspense.cues,
      suspense.audio ?? DEFAULT_AUDIO_PROFILE,
      applyLight,
      suspenseLatencyMs,
    );
  }, [engineOn, suspense, suspenseLatencyMs, applyLight]);

  // A new resolved directive always ends the suspense window.
  useEffect(() => {
    if (!response || !engineOn) return;
    cancelCues();
  }, [response, engineOn]);

  useEffect(() => () => stopAll(), []);

  const hasPlayableAsset =
    response !== null && response.action === "play" && response.asset_path !== "";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_0_50px_-12px_rgba(125,211,252,0.12),0_18px_40px_rgba(0,0,0,0.55)]">
      {/*
       * Viewport. The video is absolutely positioned and clipped, so its
       * intrinsic size can never push this panel wider or taller — the box
       * stays exactly the size the grid gave it, and object-contain keeps the
       * full frame visible inside it.
       */}
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
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
              {response
                ? "No media directive for this event"
                : "Press a GRIP event button or spin reels"}
            </p>
            <p className="text-xs text-zinc-700">
              Middleware allocates video and soundtrack directive here
            </p>
          </div>
        )}
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
