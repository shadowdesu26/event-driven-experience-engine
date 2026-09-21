"""Contextual routing logic mapping each GRIP event_type to a Wuxia media asset,
evaluating reel outcome, payout ratio, symbols, and consecutive win streaks.

Dynamic allocation per event:
- Win/Bet multiplier drives video tier selection, volume, and pulse intensity.
- Under-classed payout events escalate to the big-win celebration tier.
- High-tier streaks (streak >= 2) override with celebration assets.
- asset_path resolves through the dynamic asset scanner, falling back to the
  static EVENT_ASSET_MAP when no scanned file matches.
"""

from asset_scanner import resolve_asset, safe_theme
from models import EventTypeName, GripEvent

# High-tier winning events that feed the consecutive-win streak state machine.
HIGH_TIER_EVENTS: tuple[str, ...] = ("BIG_WIN", "JACKPOT", "BONUS_TRIGGER")

# Under-classed events that escalate to the big-win celebration tier when the
# payout crosses BIG_WIN_THRESHOLD (Win/Bet). Identity events (BONUS_TRIGGER,
# BIG_WIN, JACKPOT) keep their own asset family and only scale intensity.
ESCALATION_POOL: tuple[str, ...] = ("SPIN_RESULT", "NO_WIN", "NEAR_WIN")
BIG_WIN_THRESHOLD: float = 10.0
JACKPOT_VOLUME_THRESHOLD: float = 50.0

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

# Base playback volume per event tier; big-win tiers scale with the multiplier.
BASE_VOLUMES: dict[str, float] = {
    "GAME_START": 0.40,
    "SPIN_RESULT": 0.35,
    "NO_WIN": 0.30,
    "NEAR_WIN": 0.55,
    "BONUS_TRIGGER": 0.75,
    "BIG_WIN": 0.80,
    "JACKPOT": 1.00,
}


def compute_multiplier(win: float, bet: float) -> float:
    """Payout relative to bet (Win/Bet), guarded against zero/negative bets."""
    return round(win / max(bet, 1.0), 2)


def big_win_volume(multiplier: float) -> float:
    """Big-win volume ladder: 0.80 base, 0.90 at 25x, 1.00 at 50x+."""
    if multiplier >= JACKPOT_VOLUME_THRESHOLD:
        return 1.0
    if multiplier >= 25:
        return 0.9
    return 0.8


def compute_volume(event_type: str, multiplier: float, win: float = 0.0) -> float:
    """Recommended audio playback volume (0.0-1.0) scaled by tier and multiplier."""
    if event_type == "WIN_STREAK":
        return 1.0
    if event_type == "BIG_WIN":
        return big_win_volume(multiplier)
    volume = BASE_VOLUMES.get(event_type, 0.5)
    if event_type == "SPIN_RESULT" and win > 0:
        volume = 0.5
    return round(min(1.0, max(0.0, volume)), 2)


def route_event(event: GripEvent | EventTypeName) -> dict:
    """Evaluate inbound GRIP event and player context to allocate visual & audio assets.

    Takes player action, spin results (symbols, win amount, bet) into account:
    - Win/Bet multiplier selects the tiered celebration video, volume, and pulse.
    - Under-classed payout events (SPIN_RESULT / NO_WIN / NEAR_WIN with a payout
      at or above the big-win threshold) escalate to the big-win tier.
    - High-tier streaks (streak >= 2, escalations included) override with
      priority celebration assets.
    """
    global streak_counter

    # Support either full GripEvent object or legacy event_type string
    if isinstance(event, str):
        event_type = event
        theme = "wuxia"
        bet = 25.0
        win = 0.0
        symbols = None
    else:
        event_type = event.event_type
        theme = safe_theme(event.theme)
        bet = event.bet_amount or 25.0
        win = event.win_amount or 0.0
        symbols = event.symbols

    multiplier = compute_multiplier(win, bet)

    if event_type == "WIN_STREAK":
        return {
            "event_type": event_type,
            "action": "play",
            **WIN_STREAK_OVERRIDE,
            "volume": 1.0,
            "win_multiplier": multiplier,
        }

    is_high_tier = event_type in HIGH_TIER_EVENTS
    escalated = (
        not is_high_tier
        and event_type in ESCALATION_POOL
        and win > 0
        and multiplier >= BIG_WIN_THRESHOLD
    )
    if is_high_tier or escalated:
        streak_counter += 1
    else:
        streak_counter = 0

    if (is_high_tier or escalated) and streak_counter >= 2:
        return {
            "event_type": event_type,
            "action": "play",
            **WIN_STREAK_OVERRIDE,
            "volume": 1.0,
            "win_multiplier": multiplier,
            "message": f"STATE OVERRIDE: {streak_counter} consecutive high-tier wins! Priority celebration allocated.",
        }

    if escalated:
        directive = dict(EVENT_ASSET_MAP["BIG_WIN"])
        directive["asset_path"] = resolve_asset(
            theme, "BIG_WIN", multiplier, fallback=EVENT_ASSET_MAP["BIG_WIN"]["asset_path"]
        )
        directive["ui_pulse"] = "strong" if multiplier < 25 else "full"
        directive["volume"] = big_win_volume(multiplier)
        directive["message"] = (
            f"Escalated {event_type}: payout {win:.0f} credits ({multiplier:.1f}x bet "
            f">= {BIG_WIN_THRESHOLD:.0f}x). Big-win celebration tier allocated."
        )
        return {"event_type": event_type, "action": "play", **directive, "win_multiplier": multiplier}

    base = EVENT_ASSET_MAP.get(event_type)
    if base is None:
        return {
            "event_type": event_type,
            **NOOP_RESPONSE,
            "volume": 0.0,
            "win_multiplier": multiplier,
        }

    # Dynamic allocation refinement based on player result
    directive = dict(base)
    directive["asset_path"] = resolve_asset(
        theme, event_type, multiplier, fallback=base["asset_path"]
    )
    directive["volume"] = compute_volume(event_type, multiplier, win)
    if event_type == "BIG_WIN":
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

    return {"event_type": event_type, "action": "play", **directive, "win_multiplier": multiplier}
