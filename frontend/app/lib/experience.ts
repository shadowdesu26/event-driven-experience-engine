/**
 * Experience runtime — the presentation-side executor for Experience Engine
 * directives.
 *
 * This module deliberately contains **no dramaturgy**. Every timing, ramp and
 * intensity is decided by the middleware and arrives as data:
 *
 * - `runCues()` schedules a suspense cue ladder the engine authored, re-aiming
 *   the heartbeat rate and light pattern as each reel lands.
 * - `playSting()` renders the one-shot event sting under the current envelope.
 * - `setBed()` runs the sustained background bed on its own gain node, so
 *   ambient encouragement can play *under* a sting instead of being cut off by
 *   it.
 * - `playSymbolDepths()` reads out the landed center-line symbols with tiered
 *   sound depths: gentle acoustic clicks for lower-tier matches, deep resonant
 *   tones for top-tier combinations — wins read as depth, not volume.
 *
 * Audio graph:
 *
 *     sting voices ─┐
 *     heartbeat   ──┼─> masterGain ─> bass shelf ─> treble care ─> ceiling lowpass ─> limiter ─> destination
 *     bed pad     ──┘                 (warm low     (notches sharp  (caps the top end, drifts
 *     symbol readout─┘                 end)          piercing overtones)  softer with session age)
 *
 * The sting channel crossfades per directive. The bed channel is independent,
 * which is what lets a losing streak carry soft background music through a
 * win sting rather than being replaced by it.
 *
 * The care chain after masterGain is **automatic**: every voice passes through
 * a fixed treble-cut + bass-warmth shelf so nothing can stab the ear, and the
 * ceiling drifts lower (and the shelf warmer) as the session gets long. The
 * limiter keeps the boosted low end from ever clipping.
 */

import {
  DEFAULT_AUDIO_PROFILE,
  type AudioProfileSpec,
  type Cue,
  type LightProgram,
} from "@/app/lib/api";

const STING_CROSSFADE_SECONDS = 0.35;
const BED_RAMP_SECONDS = 1.2;
const DEFAULT_STING_VOLUME = 0.7;

/** Heartbeat thump envelope, before the audio profile scales it. */
const THUMP_BASE_SECONDS = 0.22;
const THUMP_PEAK = 0.34;

interface AudioTrack {
  gain: GainNode;
  oscillators: OscillatorNode[];
}

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let activeSting: AudioTrack | null = null;

// Automatic acoustic care chain, created once with the context. Every voice
// routes through masterGain into these, so softening applies to everything.
let careShelf: BiquadFilterNode | null = null; // bass warmth, low-shelf
let careNotch: BiquadFilterNode | null = null; // cuts sharp piercing overtones
let careCeiling: BiquadFilterNode | null = null; // lowpass cap on the top end

// Resolved-spin counter that drifts the care chain warmer over a long session.
let resolvedSpinCount = 0;

// Timestamp of the most recent per-reel landing voice. The resolve-time symbol
// cascade stays quiet when a cabinet readout just finished, so the final reel
// is never heard twice; manual panel events still get the full cascade.
let lastReelLandAt = -1e9;
const REEL_READOUT_SUPPRESS_MS = 400;

// Engine gate: when the Experience Engine is toggled off, every entry point in
// this runtime goes silent so the game can be compared bare against driven.
let engineGate = true;

/** Switch the whole experience runtime on or off for A/B comparison. */
export function setEngineEnabled(enabled: boolean) {
  engineGate = enabled;
  if (!enabled) {
    stopAll();
  } else {
    getAudioContext();
  }
}

let bedGain: GainNode | null = null;
let bedVoices: AudioTrack | null = null;
let bedElement: HTMLAudioElement | null = null;

let heartbeatBpm = 0;
let heartbeatTimer: number | null = null;
let cueTimers: number[] = [];

let currentProfile: AudioProfileSpec = DEFAULT_AUDIO_PROFILE;

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

      // Acoustic care: warm the low end, notch the piercing band, cap the
      // treble, then level the peaks so the boosted bass never clips.
      careShelf = audioCtx.createBiquadFilter();
      careShelf.type = "lowshelf";
      careShelf.frequency.value = 150;
      careShelf.gain.value = 0;

      careNotch = audioCtx.createBiquadFilter();
      careNotch.type = "peaking";
      careNotch.frequency.value = 3100;
      careNotch.Q.value = 1.1;
      careNotch.gain.value = -6.5;

      careCeiling = audioCtx.createBiquadFilter();
      careCeiling.type = "lowpass";
      careCeiling.frequency.value = 7600;
      careCeiling.Q.value = 0.7;

      const limiter = audioCtx.createDynamicsCompressor();
      // Kept loose on purpose: it only catches true overloads so the tier
      // ladder (nosy spins vs big wins) survives with real separation.
      limiter.threshold.value = -10;
      limiter.knee.value = 10;
      limiter.ratio.value = 1.8;
      limiter.attack.value = 0.006;
      limiter.release.value = 0.35;

      masterGain.connect(careShelf);
      careShelf.connect(careNotch);
      careNotch.connect(careCeiling);
      careCeiling.connect(limiter);
      limiter.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/** Route a voice through the profile's lowpass, when it specifies one. */
function voiceChain(ctx: AudioContext, profile: AudioProfileSpec): AudioNode {
  const head = ctx.createGain();
  if (profile.lowpass_hz) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = profile.lowpass_hz;
    head.connect(filter);
    return filter;
  }
  return head;
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
  gain.gain.setValueAtTime(Math.max(opts.peak, 0.0001), opts.startAt);
  if (!currentProfile.tail) {
    // Punchy profile: land on zero fast so the next spin does not stack tails.
    gain.gain.exponentialRampToValueAtTime(0.001, opts.startAt + opts.duration * 0.55);
    gain.gain.linearRampToValueAtTime(0, opts.startAt + opts.duration * 0.6);
  } else {
    gain.gain.exponentialRampToValueAtTime(0.001, opts.startAt + opts.duration);
  }
  osc.connect(gain);
  gain.connect(track.gain);
  osc.start(opts.startAt);
  osc.stop(opts.startAt + opts.duration);
  track.oscillators.push(osc);
}

/** One-shot event sting, shaped by the middleware's audio profile. */
function playSting(eventType: string, volume: number) {
  const ctx = getAudioContext();
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const scale = currentProfile.duration_scale;
  const dur = (seconds: number) => seconds * scale;

  if (activeSting) {
    fadeOutTrack(activeSting, STING_CROSSFADE_SECONDS);
    activeSting = null;
  }

  const trackGain = ctx.createGain();
  trackGain.gain.value = Math.min(1, Math.max(0, volume));
  const chain = voiceChain(ctx, currentProfile);
  trackGain.connect(chain);
  chain.connect(masterGain);
  const track: AudioTrack = { gain: trackGain, oscillators: [] };
  activeSting = track;

  const voice = (type: OscillatorType, freq: number, at: number, seconds: number, peak: number, endFreq?: number) =>
    addVoice(ctx, track, { type, freq, endFreq, startAt: now + at, duration: dur(seconds), peak });

  switch (eventType) {
    case "GAME_START":
      voice("sine", 220, 0, 1.2, 0.1, 330);
      break;
    case "SPIN_RESULT":
      voice("triangle", 659.25, 0, 0.35, 0.14);
      voice("triangle", 880, 0.12, 0.4, 0.12);
      break;
    case "NO_WIN":
      voice("sine", 293.66, 0, 0.6, 0.08, 110);
      break;
    case "NEAR_WIN":
      // Tension pulse: beating drone pair.
      addVoice(ctx, track, { freq: 140, startAt: now, duration: dur(1.8), peak: 0.16 });
      addVoice(ctx, track, { freq: 145, startAt: now, duration: dur(1.8), peak: 0.16 });
      break;
    case "BIG_WIN":
      // Win tiers sit well above the small-sting tier so loudness reads the
      // payout's size instead of vanishing into the care chain.
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
        voice("triangle", freq, i * 0.12, 0.5, 0.34),
      );
      break;
    case "WIN_STREAK":
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) =>
        voice("triangle", freq, i * 0.08, 0.45, 0.34),
      );
      break;
    case "JACKPOT":
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) =>
        voice("sawtooth", freq, i * 0.1, 0.7, 0.4),
      );
      break;
    case "BONUS_TRIGGER":
      voice("sine", 329.63, 0, 0.9, 0.24, 880);
      break;
    default:
      break;
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

// --- symbol sound depths ----------------------------------------------

/** Reel-readout cascade: one voice per center-line symbol, left to right. */
const SYMBOL_READOUT_STAGGER_S = 0.085;

type SymbolTier = "low" | "mid" | "deep";

/** Lower-tier symbols click, mid-tier hum, top-tier symbols sound deep. */
const SYMBOL_TIER: Record<string, SymbolTier> = {
  "🍒": "low",
  "🍋": "low",
  "🍇": "low",
  "BAR": "mid",
  "🔔": "mid",
  "⭐": "mid",
  "7": "deep",
  "💎": "deep",
};

// Mid-tier symbols keep a little pitch identity so they stay distinguishable.
const MID_SYMBOL_FREQ: Record<string, number> = { BAR: 293.66, "🔔": 392.0, "⭐": 349.23 };

// Top-tier fundamentals sit low in the chest: 98Hz (7) and 87Hz (diamond).
const DEEP_SYMBOL_FREQ: Record<string, number> = { "7": 98.0, "💎": 87.31 };

let clickNoise: AudioBuffer | null = null;

function getClickNoise(ctx: AudioContext): AudioBuffer {
  if (!clickNoise) {
    clickNoise = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.12)), ctx.sampleRate);
    const data = clickNoise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return clickNoise;
}

/** Gentle acoustic click: a filtered noise tick with a small wooden body. */
function symbolClick(ctx: AudioContext, at: number, peak: number, seconds: number) {
  const out = masterGain;
  if (!out) return;

  const tick = ctx.createBufferSource();
  tick.buffer = getClickNoise(ctx);
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 1800 + Math.random() * 600;
  bandpass.Q.value = 1.1;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

  tick.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(out);
  tick.start(at, Math.random() * 0.04, seconds + 0.02);
  tick.stop(at + seconds + 0.02);
  window.setTimeout(() => {
    try {
      gain.disconnect();
    } catch {
      // already disconnected
    }
  }, ((seconds + 0.02) * 1000) | 0);
}

/** Soft rounded tone; deep tiers add a detuned twin and an octave harmonic. */
function symbolTone(
  ctx: AudioContext,
  at: number,
  freq: number,
  seconds: number,
  peak: number,
  attack: number,
  resonant = false,
) {
  const out = masterGain;
  if (!out) return;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(peak, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  env.connect(out);

  const voices: Array<[OscillatorType, number, number]> = [["sine", freq, 1]];
  if (resonant) {
    voices.push(["sine", freq * 1.004, 0.55], ["triangle", freq * 2, 0.3]);
  }
  voices.forEach(([type, voiceFreq, level]) => {
    const osc = ctx.createOscillator();
    const voice = ctx.createGain();
    voice.gain.value = level;
    osc.type = type;
    osc.frequency.value = voiceFreq;
    osc.connect(voice);
    voice.connect(env);
    osc.start(at);
    osc.stop(at + seconds + 0.05);
  });

  window.setTimeout(() => {
    try {
      env.disconnect();
    } catch {
      // already disconnected
    }
  }, ((seconds + 0.2) * 1000) | 0);
}

/**
 * Read the landed center line with tiered sound depths.
 *
 * Lower-tier matches answer with gentle acoustic clicks, mid-tier symbols with
 * soft hums, and top-tier combinations with deep, resonant tones — so a win
 * reads as depth rather than an alarm. It runs as a quiet cascade under the
 * event sting, one voice per reel, left to right.
 *
 * `duck` scales the whole cascade down when a loud sting owns the moment
 * (a jackpot resolve ducks the readout to half) so the readout's bustle never
 * masks the sting's step up.
 */
function playSymbolDepths(symbols: string[], duck = 1) {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || duck <= 0) return;

  const scale = currentProfile.duration_scale;
  const volScale = currentProfile.volume_scale * duck;
  const board = symbols.slice(0, 5);
  const t0 = ctx.currentTime + 0.02;

  const deepCounts = new Map<string, number>();
  board.forEach((symbol, reelIndex) => {
    const at = t0 + reelIndex * SYMBOL_READOUT_STAGGER_S;
    const tier = SYMBOL_TIER[symbol] ?? "low";
    if (tier === "low") {
      symbolClick(ctx, at, 0.1 * volScale, 0.05 * scale);
      return;
    }
    if (tier === "mid") {
      symbolTone(ctx, at, MID_SYMBOL_FREQ[symbol] ?? 330, 0.3 * scale, 0.12 * volScale, 0.012);
      return;
    }
    deepCounts.set(symbol, (deepCounts.get(symbol) ?? 0) + 1);
    symbolTone(ctx, at, DEEP_SYMBOL_FREQ[symbol] ?? 98, 0.7 * scale, 0.16 * volScale, 0.02, true);
  });

  // A genuine top-tier combination (two or more matching premiums) gets one
  // shared sub-octave swell under the per-reel tones — depth, not loudness.
  let comboSymbol = "";
  let comboCount = 0;
  for (const [symbol, count] of deepCounts) {
    if (count > comboCount) {
      comboCount = count;
      comboSymbol = symbol;
    }
  }
  if (comboCount >= 2) {
    symbolTone(ctx, t0, (DEEP_SYMBOL_FREQ[comboSymbol] ?? 98) / 2, 1.0 * scale, 0.1 * volScale, 0.05);
  }
}

/**
 * Play ONE reel's tiered depth voice, right as that reel stops.
 *
 * The cabinet calls this per reel stop, so every landing gets its own moment
 * in the mix instead of the whole readout stacking into one blur at resolve.
 */
export function playReelLand(symbol: string) {
  if (!engineGate) return;
  const ctx = getAudioContext();
  if (!ctx || !masterGain) return;

  lastReelLandAt = performance.now();
  const scale = currentProfile.duration_scale;
  const volScale = currentProfile.volume_scale;
  const at = ctx.currentTime + 0.005;
  const tier = SYMBOL_TIER[symbol] ?? "low";

  if (tier === "low") {
    symbolClick(ctx, at, 0.12 * volScale, 0.05 * scale);
    return;
  }
  if (tier === "mid") {
    symbolTone(ctx, at, MID_SYMBOL_FREQ[symbol] ?? 330, 0.3 * scale, 0.14 * volScale, 0.012);
    return;
  }
  symbolTone(ctx, at, DEEP_SYMBOL_FREQ[symbol] ?? 98, 0.7 * scale, 0.18 * volScale, 0.02, true);
}

// --- heartbeat ---------------------------------------------------------

function stopHeartbeat() {
  if (heartbeatTimer !== null) {
    window.clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
  heartbeatBpm = 0;
}

/**
 * Aim the heartbeat at a new rate and let it run until the next cue re-aims it.
 * The pulse therefore accelerates across a suspense window without any local
 * ramp logic.
 */
function startHeartbeat(bpm: number, volume: number) {
  stopHeartbeat();
  if (bpm <= 0 || volume <= 0) return;
  heartbeatBpm = bpm;
  scheduleBeat(volume);
}

function scheduleBeat(volume: number) {
  const ctx = audioCtx;
  const period = Math.max(120, 60_000 / heartbeatBpm);
  heartbeatTimer = window.setTimeout(() => {
    if (heartbeatBpm <= 0) return;
    thump(volume);
    scheduleBeat(volume);
  }, period);
}

function thump(volume: number) {
  const ctx = getAudioContext();
  if (!ctx || !masterGain) return;

  const now = ctx.currentTime;
  const duration = THUMP_BASE_SECONDS * currentProfile.duration_scale;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(132, now);
  osc.frequency.exponentialRampToValueAtTime(48, now + duration * 0.9);

  const peak = Math.min(1, volume) * THUMP_PEAK;
  const attack = Math.max(0, currentProfile.attack_ms) / 1000;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  const chain = voiceChain(ctx, currentProfile);
  osc.connect(gain);
  gain.connect(chain);
  chain.connect(masterGain);

  osc.start(now);
  osc.stop(now + duration + 0.02);
  // Tear the filter down with the voice; at 150bpm these accumulate fast.
  window.setTimeout(() => {
    try {
      gain.disconnect();
      chain.disconnect();
    } catch {
      // already disconnected
    }
  }, (duration + 0.1) * 1000);
}

// --- cue runner --------------------------------------------------------

function cueLightProgram(cue: Cue, periodFallback: number): LightProgram {
  return {
    pattern: cue.light,
    period_ms: cue.bpm > 0 ? Math.max(80, Math.round(60_000 / cue.bpm)) : periodFallback,
    color: "amber",
    intensity: cue.light_intensity,
    temperament: "warm",
  };
}

/**
 * Schedule a suspense program the middleware authored.
 *
 * `elapsedMs` compensates for the round trip of the probe request, so cues that
 * are already due fire immediately and the release cue still lands on the final
 * reel stop rather than a beat late.
 */
export function runCues(
  cues: Cue[],
  profile: AudioProfileSpec | undefined,
  onLight?: (program: LightProgram) => void,
  elapsedMs = 0,
  onCue?: (cue: Cue) => void,
) {
  // Engine off: drop any running program and stay silent.
  if (!engineGate) {
    cancelCues();
    return;
  }
  cancelCues();
  if (!cues.length) return;
  getAudioContext();

  currentProfile = profile ?? DEFAULT_AUDIO_PROFILE;
  applyAcousticCare();
  const base = performance.now() - Math.max(0, elapsedMs);

  cues.forEach((cue) => {
    const delay = Math.max(0, cue.at_ms - (performance.now() - base));
    cueTimers.push(
      window.setTimeout(() => {
        onCue?.(cue);
        if (cue.kind === "release") {
          stopHeartbeat();
          onLight?.(cueLightProgram(cue, 0));
          return;
        }
        startHeartbeat(cue.bpm, cue.volume);
        onLight?.(cueLightProgram(cue, 1200));
      }, delay),
    );
  });
}

/** Drop any pending suspense program and silence the heartbeat. */
export function cancelCues() {
  cueTimers.forEach((timer) => window.clearTimeout(timer));
  cueTimers = [];
  stopHeartbeat();
}

// --- background bed ----------------------------------------------------

function stopBed() {
  if (bedElement) {
    bedElement.pause();
    bedElement.src = "";
    bedElement = null;
  }
  if (bedVoices && audioCtx) {
    fadeOutTrack(bedVoices, BED_RAMP_SECONDS);
    bedVoices = null;
  }
  bedGain = null;
}

/**
 * Run the sustained encouragement bed on its own channel.
 *
 * Prefers a shipped file when the theme provides one, otherwise synthesizes a
 * soft pad. Independent of the sting channel, so it survives a win cutting in.
 */
export function setBed(path: string, volume: number) {
  const target = Math.min(1, Math.max(0, volume));

  if (target <= 0) {
    stopBed();
    return;
  }

  if (path) {
    if (!bedElement) {
      const element = new Audio(path);
      element.loop = true;
      element.crossOrigin = "anonymous";
      element.volume = target;
      bedElement = element;
    } else {
      bedElement.volume = target;
    }
    void bedElement.play().catch(() => {});
    return;
  }

  const ctx = getAudioContext();
  if (!ctx || !masterGain) return;

  if (!bedGain) {
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 620;
    gain.connect(filter);
    filter.connect(masterGain);
    bedGain = gain;

    const now = ctx.currentTime;
    const track: AudioTrack = { gain, oscillators: [] };
    bedVoices = track;

    // Slow soft-fifth pad. Built by hand rather than through addVoice: the bed
    // must never inherit the sting's punchy envelope, or it clips into a stab.
    [110, 164.81, 220].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const voice = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      voice.gain.setValueAtTime(0.0001, now);
      voice.gain.linearRampToValueAtTime(0.05 / (index + 1), now + 2.5);
      osc.connect(voice);
      voice.connect(gain);
      osc.start(now);
      track.oscillators.push(osc);
    });
  }

  bedGain.gain.cancelScheduledValues(ctx.currentTime);
  bedGain.gain.setTargetAtTime(target, ctx.currentTime, BED_RAMP_SECONDS / 3);
}

// --- automatic acoustic care -------------------------------------------

/** Resolved spins after which the care chain reaches its full softness. */
const CARE_FULL_SPINS = 60;

/**
 * Aim the care chain at the current profile and the session age.
 *
 * Fresh sessions keep a little sparkle; the longer someone plays, the lower
 * the treble ceiling sits and the warmer the bass shelf swells, so nothing
 * sharp builds up over hours of spinning. Every move glides with
 * setTargetAtTime — never stepped, never clicky.
 */
function applyAcousticCare() {
  if (!audioCtx || !careShelf || !careCeiling) return;
  const now = audioCtx.currentTime;
  const progress = Math.min(1, resolvedSpinCount / CARE_FULL_SPINS);

  const baseWarmth =
    currentProfile.name === "consoling" ? 8 : currentProfile.name === "punchy" ? 3.5 : 5.5;
  careShelf.gain.setTargetAtTime(Math.min(10, baseWarmth + 2.5 * progress), now, 0.6);

  const baseCeiling =
    currentProfile.name === "consoling" ? 5200 : currentProfile.name === "punchy" ? 9500 : 7600;
  careCeiling.frequency.setTargetAtTime(
    Math.max(3400, baseCeiling - 2200 * progress),
    now,
    0.6,
  );
}

// --- directive intake --------------------------------------------------

/**
 * Ingest a resolved directive: play the sting and the symbol-depth readout,
 * aim the sustained lighting, and set the drought bed. Also advances the
 * acoustic care chain — every resolved spin nudges the softening forward.
 */
export function ingestDirective(
  directive: {
    event_type: string;
    action: string;
    phase?: string;
    volume?: number;
    audio?: AudioProfileSpec;
    light_program?: LightProgram;
    bedtrack_path?: string;
    bedtrack_volume?: number;
    /** Center-line symbols of the landed spin, for the depth readout. */
    symbols?: string[];
  },
  onLight?: (program: LightProgram) => void,
) {
  // Engine off: stay silent, tear down anything still sounding.
  if (!engineGate) {
    cancelCues();
    stopBed();
    return;
  }
  getAudioContext();
  currentProfile = directive.audio ?? DEFAULT_AUDIO_PROFILE;

  // A resolved directive always ends any suspense window still running.
  cancelCues();

  resolvedSpinCount += 1;
  applyAcousticCare();

  if (directive.action === "play") {
    playSting(directive.event_type, directive.volume ?? DEFAULT_STING_VOLUME);
    // Cabinet spins already read out reel by reel as each reel stopped, so the
    // end-of-spin cascade would just replay the final reel — skip it there.
    const reelsJustRead = performance.now() - lastReelLandAt < REEL_READOUT_SUPPRESS_MS;
    if (directive.symbols?.length && !reelsJustRead) {
      // Duck the cascade under louder stings so the win keeps the headroom:
      // a 1.0-volume jackpot resolves to 0.55, a quiet 0.35 spin to ~0.84.
      const stingVolume = directive.volume ?? DEFAULT_STING_VOLUME;
      playSymbolDepths(directive.symbols, 1 - 0.45 * Math.min(1, Math.max(0, stingVolume)));
    }
  }

  if (directive.light_program) {
    onLight?.(directive.light_program);
  }

  setBed(directive.bedtrack_path ?? "", directive.bedtrack_volume ?? 0);
}

/** Silence everything. Used on unmount and when the engine gate closes. */
export function stopAll() {
  cancelCues();
  stopBed();
  if (activeSting && audioCtx) {
    fadeOutTrack(activeSting, STING_CROSSFADE_SECONDS);
    activeSting = null;
  }
}

// --- plain if/else player ----------------------------------------------

/** Fixed two-note win jingle for the engine-off baseline player. */
export function playPlainWin() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.09);
    gain.gain.linearRampToValueAtTime(0.14, now + i * 0.09 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.32);
    osc.connect(gain);
    gain.connect(masterGain!);
    osc.start(now + i * 0.09);
    osc.stop(now + i * 0.09 + 0.34);
  });
}

/** Fixed dull buzz for the engine-off baseline player. */
export function playPlainLoss() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(196, now);
  osc.frequency.exponentialRampToValueAtTime(130, now + 0.35);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  osc.connect(gain);
  gain.connect(masterGain!);
  osc.start(now);
  osc.stop(now + 0.42);
  window.setTimeout(() => {
    try {
      gain.disconnect();
    } catch {
      // already disconnected
    }
  }, 600);
}

/** One uniform mechanical tick for every reel stop in plain mode — no tiers. */
export function playPlainReelTick() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1250, now);
  osc.frequency.exponentialRampToValueAtTime(700, now + 0.04);
  gain.gain.setValueAtTime(0.07, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.06);
  window.setTimeout(() => {
    try {
      gain.disconnect();
    } catch {
      // already disconnected
    }
  }, 120);
}