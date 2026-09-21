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
