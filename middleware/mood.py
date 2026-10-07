"""Adaptive pacing policy for the Casino Experience Engine.

Two knobs, both derived in the middleware rather than the presentation layer:

* **Player speed** — a fast player gets audio that is *short and punchy*
  (clipped attack, no tail) because long tails stack up and turn into mud when
  spins land faster than the previous sting decays.
* **Losing streaks** — a long drought swaps the one-shot sting for a soft,
  encouraging background bed that fades in as the losses mount, and fades back
  out on the next win.

The bed is a *second* audio layer, not a louder sting: the frontend keeps one
crossfaded sting channel and one sustained bed channel.
"""

from __future__ import annotations

from dataclasses import dataclass

from session import SessionState, classify_tempo

# Drought ladder: (losing_streak threshold, bed volume). The first threshold met
# wins, so the ladder reads bottom-up.
BED_LADDER: tuple[tuple[int, float], ...] = ((3, 0.16), (6, 0.24), (10, 0.30))

# Absolute ceiling on the bed regardless of how bad the drought gets. This is a
# responsible-design bound, not a tuning value: the bed is ambient comfort, and
# it must never compete with a win.
BED_CEILING = 0.35

# Losing streaks at which the audio profile shifts to the soft variant.
CONSOLING_DROUGHT = 10

# Synth voice the frontend should use when no bed file is present on disk.
BED_SYNTH = "soft_pad"

# Audio envelope profile per pacing mode.
#
#   duration_scale — multiplier on every synthesized voice length
#   attack_ms      — time from silence to peak; punchy audio is instant
#   tail           — whether voices are allowed a long decay
#   lowpass_hz     — optional lowpass cutoff that dulls the top end
#   volume_scale   — pre-compensation for the shorter duration
@dataclass(frozen=True)
class AudioProfile:
    name: str
    duration_scale: float
    attack_ms: int
    tail: bool
    lowpass_hz: int | None
    volume_scale: float

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "duration_scale": self.duration_scale,
            "attack_ms": self.attack_ms,
            "tail": self.tail,
            "lowpass_hz": self.lowpass_hz,
            "volume_scale": self.volume_scale,
            "bed_synth": BED_SYNTH,
        }


PUNCHY = AudioProfile("punchy", 0.55, 0, False, None, 1.05)
STANDARD = AudioProfile("standard", 1.0, 8, True, None, 1.0)
CONSOLING = AudioProfile("consoling", 1.3, 60, True, 900, 0.8)


def audio_profile(tempo: str, losing_streak: int) -> AudioProfile:
    """Pick the pacing profile for this spin.

    ``rapid`` deliberately wins over the drought consolation. A player who is
    spinning fast *while* losing is exactly the case where long soft tails feel
    like a penalty rather than comfort, so the explicit brief — fast spinning
    stays short and punchy — takes precedence.
    """
    if tempo == "rapid":
        return PUNCHY
    if losing_streak >= CONSOLING_DROUGHT:
        return CONSOLING
    return STANDARD


def drought_tier(losing_streak: int) -> str:
    """Human-readable drought band, for the directive rationale and QA."""
    if losing_streak >= 10:
        return "severe"
    if losing_streak >= 6:
        return "deep"
    if losing_streak >= 3:
        return "mild"
    return "none"


def bed_volume(state: SessionState) -> float:
    """Target volume for the encouraging background bed.

    Suppressed entirely during the post-win cooldown so a single immediate miss
    cannot make the music stutter on and off, and hard-capped at
    :data:`BED_CEILING` so ambient comfort never outranks a payout.
    """
    if state.cooldown_spins > 0:
        return 0.0
    # Walk the ladder from the deepest threshold down so the *highest* rung the
    # player qualifies for wins, not the first one they clear.
    for threshold, volume in reversed(BED_LADDER):
        if state.losing_streak >= threshold:
            return min(volume, BED_CEILING)
    return 0.0


def light_temperament(losing_streak: int) -> str:
    """Colour temperature for the cabinet lighting.

    Wins run hot (amber/gold). A drought cools the cabinet down and then, past
    the severe threshold, drops it to a hushed low pulse — the lighting stops
    selling urgency and starts being calm.
    """
    if losing_streak >= 10:
        return "hushed"
    if losing_streak >= 3:
        return "cool"
    return "warm"


def apply_pacing(state: SessionState) -> dict:
    """Full pacing directive fragment for the current session."""
    profile = audio_profile(state.tempo, state.losing_streak)
    return {
        "audio": profile.as_dict(),
        "bed_volume": bed_volume(state),
        "tempo": state.tempo,
        "cadence_ms": (
            round(state.cadence_ewma_ms, 1) if state.cadence_ewma_ms is not None else 0.0
        ),
        "losing_streak": state.losing_streak,
        "win_streak": state.win_streak,
        "light_temperament": light_temperament(state.losing_streak),
        "drought_tier": drought_tier(state.losing_streak),
    }


def pacing_rationale(state: SessionState, profile: AudioProfile) -> str:
    """One sentence explaining the pacing decision, appended to the directive."""
    # The first spin of a session has no interval to report yet.
    cadence = f"{state.cadence_ewma_ms:.0f}ms/spin" if state.cadence_ewma_ms else "no cadence yet"

    parts: list[str] = []
    if state.tempo == "rapid":
        parts.append(
            f"rapid cadence ({cadence}) -> punchy audio "
            f"({profile.duration_scale:.2f}x duration, no tail)"
        )
    elif state.tempo == "deliberate":
        parts.append(f"deliberate cadence ({cadence}) -> full-length audio")
    else:
        parts.append(f"steady cadence ({cadence}) -> standard audio")

    if state.losing_streak:
        tier = drought_tier(state.losing_streak)
        level = bed_volume(state)
        if level > 0:
            parts.append(
                f"{state.losing_streak}-spin drought ({tier}) -> encouraging bed at "
                f"{level:.2f} volume"
            )
        elif state.cooldown_spins > 0:
            parts.append(
                f"{state.losing_streak}-spin drought -> bed held at zero during "
                f"post-win cooldown"
            )
        else:
            parts.append(
                f"{state.losing_streak}-spin drought -> below the bed threshold, "
                f"bed silent"
            )
    return "; ".join(parts)


__all__ = [
    "AudioProfile",
    "BED_CEILING",
    "BED_LADDER",
    "BED_SYNTH",
    "CONSOLING_DROUGHT",
    "PUNCHY",
    "STANDARD",
    "CONSOLING",
    "apply_pacing",
    "audio_profile",
    "bed_volume",
    "classify_tempo",
    "drought_tier",
    "light_temperament",
    "pacing_rationale",
]