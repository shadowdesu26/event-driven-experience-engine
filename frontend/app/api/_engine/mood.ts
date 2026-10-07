/**
 * TypeScript port of middleware/mood.py — adaptive pacing policy.
 *
 * Two knobs, both derived in the engine rather than the presentation layer:
 *
 * - Player speed: a fast player gets audio that is short and punchy (clipped
 *   attack, no tail) because long tails stack into mud when spins land faster
 *   than the previous sting decays.
 * - Losing streaks: a long drought fades in a soft, encouraging background bed
 *   on a second audio channel, and cools the cabinet lighting.
 */

import { BED_SYNTH } from "./assets";
import type { SessionState } from "./session";

export type DroughtTier = "none" | "mild" | "deep" | "severe";
export type AudioProfileName = "punchy" | "standard" | "consoling";

// Drought ladder: (losing_streak threshold, bed volume). Checked deepest-first,
// so the deepest rung the streak qualifies for wins.
export const BED_LADDER: ReadonlyArray<readonly [number, number]> = [
  [3, 0.16],
  [6, 0.24],
  [10, 0.3],
];

// Absolute ceiling on the bed regardless of how bad the drought gets. This is a
// responsible-design bound: ambient comfort must never compete with a win.
export const BED_CEILING = 0.35;

// Losing streaks at which the audio profile shifts to the soft variant.
export const CONSOLING_DROUGHT = 10;

// Synth voice the frontend uses when no bed file is present on disk.
export const BED_SYNTH_NAME = BED_SYNTH;

export interface AudioProfile {
  name: AudioProfileName;
  duration_scale: number;
  attack_ms: number;
  tail: boolean;
  lowpass_hz: number | null;
  volume_scale: number;

  as_dict(): Record<string, unknown>;
}

function makeProfile(
  name: AudioProfileName,
  duration_scale: number,
  attack_ms: number,
  tail: boolean,
  lowpass_hz: number | null,
  volume_scale: number,
): AudioProfile {
  return {
    name,
    duration_scale,
    attack_ms,
    tail,
    lowpass_hz,
    volume_scale,
    as_dict() {
      return {
        name: this.name,
        duration_scale: this.duration_scale,
        attack_ms: this.attack_ms,
        tail: this.tail,
        lowpass_hz: this.lowpass_hz,
        volume_scale: this.volume_scale,
        bed_synth: BED_SYNTH_NAME,
      };
    },
  };
}

export const PUNCHY = makeProfile("punchy", 0.55, 0, false, null, 1.05);
export const STANDARD = makeProfile("standard", 1.0, 8, true, null, 1.0);
export const CONSOLING = makeProfile("consoling", 1.3, 60, true, 900, 0.8);

export function audio_profile(tempo: string, losing_streak: number): AudioProfile {
  // rapid deliberately wins over the drought consolation: a player spinning
  // fast *while* losing should not be handed long soft tails.
  if (tempo === "rapid") return PUNCHY;
  if (losing_streak >= CONSOLING_DROUGHT) return CONSOLING;
  return STANDARD;
}

export function drought_tier(losing_streak: number): DroughtTier {
  if (losing_streak >= 10) return "severe";
  if (losing_streak >= 6) return "deep";
  if (losing_streak >= 3) return "mild";
  return "none";
}

export function bed_volume(state: SessionState): number {
  // Suppressed during the post-win cooldown; hard-capped at BED_CEILING.
  if (state.cooldown_spins > 0) return 0.0;
  for (let i = BED_LADDER.length - 1; i >= 0; i--) {
    const [threshold, volume] = BED_LADDER[i];
    if (state.losing_streak >= threshold) {
      return Math.min(volume, BED_CEILING);
    }
  }
  return 0.0;
}

export function light_temperament(losing_streak: number): "warm" | "cool" | "hushed" {
  if (losing_streak >= 10) return "hushed";
  if (losing_streak >= 3) return "cool";
  return "warm";
}

export function apply_pacing(state: SessionState): Record<string, unknown> {
  const profile = audio_profile(state.tempo, state.losing_streak);
  return {
    audio: profile.as_dict(),
    bed_volume: bed_volume(state),
    tempo: state.tempo,
    cadence_ms:
      state.cadence_ewma_ms !== null ? Math.round(state.cadence_ewma_ms * 10) / 10 : 0.0,
    losing_streak: state.losing_streak,
    win_streak: state.win_streak,
    light_temperament: light_temperament(state.losing_streak),
    drought_tier: drought_tier(state.losing_streak),
  };
}

/** One sentence explaining the pacing decision, appended to the directive. */
export function pacing_rationale(state: SessionState, profile: AudioProfile): string {
  const cadence =
    state.cadence_ewma_ms !== null ? `${Math.round(state.cadence_ewma_ms)}ms/spin` : "no cadence yet";

  const parts: string[] = [];
  if (state.tempo === "rapid") {
    parts.push(
      `rapid cadence (${cadence}) -> punchy audio (${profile.duration_scale.toFixed(2)}x duration, no tail)`,
    );
  } else if (state.tempo === "deliberate") {
    parts.push(`deliberate cadence (${cadence}) -> full-length audio`);
  } else {
    parts.push(`steady cadence (${cadence}) -> standard audio`);
  }

  if (state.losing_streak) {
    const tier = drought_tier(state.losing_streak);
    const level = bed_volume(state);
    if (level > 0) {
      parts.push(
        `${state.losing_streak}-spin drought (${tier}) -> encouraging bed at ${level.toFixed(2)} volume`,
      );
    } else if (state.cooldown_spins > 0) {
      parts.push(`${state.losing_streak}-spin drought -> bed held at zero during post-win cooldown`);
    } else {
      parts.push(`${state.losing_streak}-spin drought -> below the bed threshold, bed silent`);
    }
  }
  return parts.join("; ");
}
