"""Simulated LT Game EGM Game Engine.

Implements the slot machine mathematics, RNG reel strip generation,
paytable evaluation, and GRIP event packaging for the 8 core symbols:
7, BAR, 🍒, 🍋, 🍇, 🔔, ⭐, 💎.
"""

import random
import uuid
from datetime import datetime, timezone
from typing import Literal

SYMBOLS = ["7", "BAR", "🍒", "🍋", "🍇", "🔔", "⭐", "💎"]

PAYOUT_TABLE = {
    "JACKPOT": 2500,
    "BIG_WIN": 500,
    "BONUS_TRIGGER": 250,
    "SPIN_RESULT": 25,
    "NO_WIN": 0,
    "NEAR_WIN": 0,
    "GAME_START": 0,
}


def spin_reels(bet_amount: float = 25.0, forced_event: str | None = None) -> dict:
    """Generate a 5-reel spin outcome with symbols, payout, and GRIP event payload."""
    event_type = forced_event or random.choice(
        ["NO_WIN", "NO_WIN", "SPIN_RESULT", "SPIN_RESULT", "NEAR_WIN", "BONUS_TRIGGER", "BIG_WIN", "JACKPOT"]
    )

    payout = PAYOUT_TABLE.get(event_type, 0) * (bet_amount / 25.0)

    # Generate 5 center-line symbols according to event type
    if event_type == "JACKPOT":
        center_symbols = ["7", "7", "7", "7", "7"]
    elif event_type == "BIG_WIN":
        center_symbols = ["💎", "💎", "💎", "💎", "💎"]
    elif event_type == "NEAR_WIN":
        center_symbols = ["7", "7", "7", "7", "🍒"]
    elif event_type == "BONUS_TRIGGER":
        center_symbols = ["⭐", "🍒", "⭐", "🍋", "⭐"]
    elif event_type == "SPIN_RESULT":
        pair = random.choice(SYMBOLS)
        center_symbols = [pair, pair, "🍇", "🔔", "BAR"]
    else:  # NO_WIN or GAME_START
        center_symbols = random.sample(SYMBOLS, 5)

    win_level = "NONE"
    if payout >= 1000:
        win_level = "JACKPOT"
    elif payout >= 250:
        win_level = "HIGH"
    elif payout > 0:
        win_level = "MEDIUM"

    return {
        "event_type": event_type,
        "game_id": "SLOT-WUXIA-01",
        "theme": "wuxia",
        "bet_amount": bet_amount,
        "win_amount": payout,
        "win_level": win_level,
        "symbols": center_symbols,
        "event_id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
