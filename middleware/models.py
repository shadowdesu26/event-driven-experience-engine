"""Pydantic models for the GRIP event pipeline."""

from typing import Literal

from pydantic import BaseModel, Field

EventTypeName = Literal[
    "GAME_START",
    "SPIN_RESULT",
    "NO_WIN",
    "NEAR_WIN",
    "BONUS_TRIGGER",
    "BIG_WIN",
    "JACKPOT",
    "WIN_STREAK",
]

WinLevel = Literal["NONE", "LOW", "MEDIUM", "HIGH", "JACKPOT"]
UiPulse = Literal["none", "subtle", "strong", "full"]

# --- Pacing / suspense vocabulary -------------------------------------
#
# Every field below is additive with a default that reproduces the previous
# behaviour, so an older client that sends nothing still gets a valid directive.

# Where in the spin lifecycle the event was emitted.
#
#   reels_spinning — pre-resolution probe. The outcome is known but the cabinet
#                    reels are still turning. The engine may answer with a
#                    suspense program and must not touch streak or cadence
#                    state, because the spin has not resolved yet.
#   resolved        — the outcome has landed. All pacing state advances here.
SpinPhase = Literal["reels_spinning", "resolved"]

Tempo = Literal["rapid", "steady", "deliberate"]
AudioProfileName = Literal["punchy", "standard", "consoling"]
DroughtTier = Literal["none", "mild", "deep", "severe"]
CueKind = Literal["heartbeat", "release"]
LightPattern = Literal[
    "none", "breathe", "pulse", "flash-soft", "flash-hard", "flash-strobe", "flare"
]
LightTemperament = Literal["warm", "cool", "hushed"]

# Response phase. Complements `action`, which stays play|noop for the video
# channel: a suspense probe returns action="noop" (no video to play yet) but
# phase="suspend" (the presentation layer should hold and ramp instead).
DirectivePhase = Literal["play", "suspend", "release", "idle"]


class GripEvent(BaseModel):
    """Inbound GRIP event sent from the slot simulator frontend or simulated backend."""

    event_type: EventTypeName
    game_id: str = Field(default="SLOT-WUXIA-01", description="Game title identifier")
    theme: str = Field(default="wuxia", description="Visual/sound theme")
    bet_amount: float = Field(default=25.0, description="Current bet amount")
    win_amount: float = Field(default=0.0, description="Payout / win amount for this spin")
    win_level: WinLevel = Field(default="NONE", description="Classified win tier")
    symbols: list[str] | None = Field(default=None, description="Reel symbols landed on paylines")
    event_id: str | None = Field(default=None, description="Optional correlation id")
    timestamp: str | None = Field(default=None, description="ISO-8601 timestamp, optional")

    session_id: str | None = Field(
        default=None,
        description="Player seat / browser tab id. Isolates pacing state between concurrent players.",
    )
    spin_phase: SpinPhase = Field(
        default="resolved",
        description="'reels_spinning' is a pre-resolution probe; 'resolved' carries the landed outcome.",
    )
    reel_stop_ms: list[int] | None = Field(
        default=None,
        description="Cabinet reel stop offsets in ms. Anchors the suspense cue ladder to real beats.",
    )


class Cue(BaseModel):
    """One timed instruction in a suspense program.

    ``heartbeat`` cues re-aim the pulse rate and the light pattern at ``at_ms``.
    ``release`` cues stop the pulse and hand off to the resolved directive.
    """

    at_ms: int = Field(default=0, ge=0, description="Offset from the start of the suspense window")
    kind: CueKind
    bpm: float = Field(default=0.0, ge=0.0, le=200.0, description="Heartbeat rate while this rung holds")
    light: LightPattern = Field(default="none")
    light_intensity: float = Field(default=0.0, ge=0.0, le=1.0)
    volume: float = Field(default=0.0, ge=0.0, le=1.0)
    note: str = Field(default="", description="Why this cue fired (audit trail)")


class LightProgram(BaseModel):
    """Sustained cabinet lighting instruction between cue changes."""

    pattern: LightPattern = Field(default="none")
    period_ms: int = Field(default=0, ge=0, description="Flash period; 0 means steady")
    color: str = Field(default="amber")
    intensity: float = Field(default=0.0, ge=0.0, le=1.0)
    temperament: LightTemperament = Field(
        default="warm", description="warm on wins, cool/hushed as a losing streak mounts"
    )


class AudioProfileSpec(BaseModel):
    """Envelope contract the presentation layer applies to synthesized voices."""

    name: AudioProfileName
    duration_scale: float = Field(default=1.0, ge=0.1, le=4.0)
    attack_ms: int = Field(default=8, ge=0, le=2000)
    tail: bool = Field(default=True, description="Allow long decay; False clips for punchy audio")
    lowpass_hz: int | None = Field(default=None, ge=200, le=20000)
    volume_scale: float = Field(default=1.0, ge=0.0, le=2.0)
    bed_synth: str = Field(default="soft_pad", description="Synth voice to use when no bed file exists")


class GripResponse(BaseModel):
    """Outbound directive telling the frontend what media and soundtrack to play."""

    event_type: EventTypeName
    action: Literal["play", "noop"]
    asset_path: str
    asset_type: Literal["video", "audio", "none"]
    soundtrack_path: str = Field(default="", description="Allocated soundtrack / audio sting path")
    ui_pulse: UiPulse = Field(default="none", description="Cabinet LED / UI pulse intensity")
    volume: float = Field(
        default=0.7,
        ge=0.0,
        le=1.0,
        description="Recommended audio playback volume (0.0-1.0), scaled by event tier and win multiplier",
    )
    win_multiplier: float = Field(
        default=0.0,
        ge=0.0,
        description="Payout relative to bet (win_amount / bet_amount) used for tier selection",
    )
    message: str

    # --- Pacing (player speed + losing streaks) ---
    phase: DirectivePhase = Field(
        default="play",
        description="'suspend' holds the presentation for a suspense probe; 'release' ends one.",
    )
    audio: AudioProfileSpec = Field(
        default_factory=lambda: AudioProfileSpec(name="standard"),
        description="Envelope profile: fast players get short punchy audio, droughts get soft audio.",
    )
    bedtrack_path: str = Field(default="", description="Background music bed (empty = synthesize)")
    bedtrack_volume: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Encouraging bed level during a losing streak"
    )
    tempo: Tempo = Field(default="steady", description="Smoothed player spin cadence band")
    cadence_ms: float = Field(
        default=0.0, ge=0.0, description="Smoothed milliseconds between spins; 0 until two spins land"
    )
    losing_streak: int = Field(default=0, ge=0)
    win_streak: int = Field(default=0, ge=0)
    drought_tier: DroughtTier = Field(default="none")

    # --- Close-call suspense ---
    cues: list[Cue] = Field(
        default_factory=list, description="Timed suspense program; empty unless a close call was detected"
    )
    light_program: LightProgram = Field(default_factory=LightProgram)
    close_call: dict | None = Field(
        default=None, description="Close-call classification (kind, severity, evidence) when one fired"
    )
    suspense_asset_path: str = Field(
        default="", description="Optional tension sting to layer under the suspense program"
    )
    suspense_total_ms: int = Field(
        default=0, ge=0, description="Length of the suspense window in ms; 0 when no program is attached"
    )

    # --- Observability ---
    session_id: str = Field(default="", description="Pacing state bucket this directive was derived from")