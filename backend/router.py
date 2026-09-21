"""1:1 routing logic mapping each GRIP event_type to a Wuxia media asset,
plus the stateful "Win Streak" priority override.

This module is intentionally pure (no FastAPI imports) so it can be unit-tested
independently and reused by other transports if the PoC evolves. Note that the
streak counter is in-memory module state: fine for the PoC, but a multi-worker
deployment would need shared state (e.g. Redis) instead.
"""

from models import EventTypeName, GripEvent

# High-tier winning events that feed the consecutive-win streak state machine.
HIGH_TIER_EVENTS: tuple[str, ...] = ("BIG_WIN", "JACKPOT", "BONUS_TRIGGER")


# Priority asset returned when a high-tier event lands on an active streak.
WIN_STREAK_OVERRIDE = {
    "asset_path": "/wuxia/wuxia_win_streak.mp4",
    "asset_type": "video",
    "soundtrack_path": "/audio/win_streak.wav",
    "ui_pulse": "full",
    "message": "STATE OVERRIDE: Win Streak detected! Priority celebration allocated.",
}

# Consecutive high-tier events seen so far (state, not an event type).
streak_counter = 0

EVENT_ASSET_MAP: dict[str, dict] = {
    "GAME_START": {
        "asset_path": "/wuxia/wuxia_game_start.mp4",
        "asset_type": "video",
        "soundtrack_path": "/audio/ambient.wav",
        "ui_pulse": "subtle",
        "message": "Opening sequence: enter the Wuxia world.",
    },
    "SPIN_RESULT": {
        "asset_path": "/wuxia/wuxia_spin_result.mp4",
        "asset_type": "video",
        "soundtrack_path": "/audio/spin_reel.wav",
        "ui_pulse": "none",
        "message": "Standard spin result reel.",
    },
    "NO_WIN": {
        "asset_path": "/wuxia/WUXIA_NO_WIN.mp4",
        "asset_type": "video",
        "soundtrack_path": "/audio/dead_spin.wav",
        "ui_pulse": "none",
        "message": "Dead spin: blade finds no mark. Pacing audio allocated.",
    },
    "NEAR_WIN": {
        "asset_path": "/wuxia/wuxia_near_win.mp4",
        "asset_type": "video",
        "soundtrack_path": "/audio/tension.wav",
        "ui_pulse": "subtle",
        "message": "Near-win tension beat: blade glances the edge.",
    },
    "BONUS_TRIGGER": {
        "asset_path": "/wuxia/wuxia_bonus_trigger.mp4",
        "asset_type": "video",
        "soundtrack_path": "/audio/celebration.wav",
        "ui_pulse": "strong",
        "message": "Bonus round triggered: hidden sect revealed.",
    },
    "BIG_WIN": {
        "asset_path": "/wuxia/wuxia_big_win.mp4",
        "asset_type": "video",
        "soundtrack_path": "/audio/celebration.wav",
        "ui_pulse": "strong",
        "message": "Big win celebration: master bestows the prize.",
    },
    "JACKPOT": {
        "asset_path": "/wuxia/wuxia_jackpot.mp4",
        "asset_type": "video",
        "soundtrack_path": "/audio/jackpot.wav",
        "ui_pulse": "full",
        "message": "Jackpot finale: dragon descends.",
    },
}

NOOP_RESPONSE = {
    "action": "noop",
    "asset_path": "",
    "asset_type": "none",
    "soundtrack_path": "",
    "ui_pulse": "none",
    "message": "No media mapped for this event.",
}


def route_event(event: GripEvent | EventTypeName) -> dict:
    """Evaluate inbound GRIP event and player context to allocate visual & audio assets.

    Takes player action, spin results (symbols, win amount, bet) into account:
    - High-tier streaks (streak >= 2) override with celebration assets.
    - Win amounts scale the audio & UI pulse intensity.
    - Near-win inspects matched symbols to allocate tension pacing.
    """
    global streak_counter

    # Support either full GripEvent object or legacy event_type string
    if isinstance(event, str):
        event_type = event
        bet = 25.0
        win = 0.0
        symbols = None
    else:
        event_type = event.event_type
        bet = event.bet_amount or 25.0
        win = event.win_amount or 0.0
        symbols = event.symbols

    if event_type == "WIN_STREAK":
        return {"event_type": event_type, "action": "play", **WIN_STREAK_OVERRIDE}

    if event_type in HIGH_TIER_EVENTS:
        streak_counter += 1
        if streak_counter >= 2:
            return {
                "event_type": event_type,
                "action": "play",
                **WIN_STREAK_OVERRIDE,
                "message": f"STATE OVERRIDE: {streak_counter} consecutive high-tier wins! Priority celebration allocated.",
            }
    else:
        streak_counter = 0

    base = EVENT_ASSET_MAP.get(event_type)
    if base is None:
        return {"event_type": event_type, **NOOP_RESPONSE}

    # Dynamic allocation refinement based on player result
    directive = dict(base)
    if event_type == "BIG_WIN":
        multiplier = win / max(bet, 1.0)
        directive["message"] = (
            f"Big Win allocated: Payout {win:.0f} credits ({multiplier:.1f}x bet). "
            f"High-energy celebration and soundtrack triggered."
        )
        directive["ui_pulse"] = "strong" if multiplier < 25 else "full"
    elif event_type == "NEAR_WIN":
        sym_text = f" on {symbols}" if symbols else ""
        directive["message"] = (
            f"Near-Win recognized{sym_text}: 4-symbol lock. "
            f"Tension riser and subtle pulse allocated."
        )
        directive["ui_pulse"] = "subtle"
    elif event_type == "SPIN_RESULT":
        if win > 0:
            directive["soundtrack_path"] = "/audio/win_chime.wav"
            directive["ui_pulse"] = "subtle"
            directive["message"] = f"Payline match: {win:.0f} credits awarded. Reward audio allocated."
        else:
            directive["message"] = "Reels stopped: standard spin result recorded."
    elif event_type == "JACKPOT":
        directive["message"] = f"MEGA JACKPOT finale ({win or 2500:.0f} credits)! Dragon descent and grand fanfare allocated."

    return {"event_type": event_type, "action": "play", **directive}

