"""Contextual routing logic mapping each GRIP event_type to a Wuxia media asset,
evaluating reel outcome, payout ratio, symbols, and player pacing momentum.

The router is an ordered pipeline. Each stage answers one question and hands a
strictly richer directive to the next:

1. **session.ingest** — fold this spin into the player's pacing history
   (high-tier win streak, losing-streak drought, spin cadence).
2. **suspense.evaluate** — for a pre-resolution probe, decide whether the
   pending outcome is a close call worth teasing while the reels turn.
3. **allocate** — win/bet multiplier drives the celebration tier, volume and
   pulse; under-classed payouts escalate; a live high-tier streak overrides.
4. **mood.apply** — player speed and losing streak shape the audio envelope,
   the background bed, and the cabinet lighting.
5. **finalize** — stamp the pacing and suspense fields onto the directive.

Dramaturgy lives here, not in the presentation layer: the client receives a
finished cue ladder and only schedules it.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from asset_scanner import (
    resolve_asset,
    resolve_bed_asset,
    resolve_suspense_asset,
    safe_theme,
)
from models import EventTypeName, GripEvent
from mood import (
    apply_pacing,
    audio_profile,
    bed_volume,
    drought_tier,
    light_temperament,
    pacing_rationale,
)
from session import HIGH_TIER_EVENTS, SessionState, get_session, parse_timestamp
from suspense import (
    CloseCallSignal,
    build_suspense_program,
    detect_close_call,
    fuse_close_call,
    is_teasable_event,
    sanitize_reel_stops,
    suspense_allowed,
)

__all__ = [
    "BASE_VOLUMES",
    "BIG_WIN_THRESHOLD",
    "ESCALATION_POOL",
    "EVENT_ASSET_MAP",
    "HIGH_TIER_EVENTS",
    "JACKPOT_VOLUME_THRESHOLD",
    "NOOP_RESPONSE",
    "WIN_STREAK_OVERRIDE",
    "big_win_volume",
    "compute_multiplier",
    "compute_volume",
    "route_event",
]

# Under-classed events that escalate to the big-win celebration tier when the
# payout crosses BIG_WIN_THRESHOLD (Win/Bet). Identity events (BONUS_TRIGGER,
# BIG_WIN, JACKPOT) keep their own asset family and only scale intensity.
ESCALATION_POOL: tuple[str, ...] = ("SPIN_RESULT", "NO_WIN", "NEAR_WIN")
BIG_WIN_THRESHOLD: float = 10.0
JACKPOT_VOLUME_THRESHOLD: float = 50.0

# High-tier wins required before the streak celebration takes over.
WIN_STREAK_THRESHOLD = 2

# Priority asset returned when a high-tier event lands on an active streak.
WIN_STREAK_OVERRIDE = {
    "asset_path": "/wuxia/wuxia_win_streak.mp4",
    "asset_type": "video",
    "soundtrack_path": "/audio/win_streak.wav",
    "ui_pulse": "full",
    "message": "STATE OVERRIDE: Win Streak detected! Priority celebration allocated.",
}

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

# Cabinet lighting translation. ui_pulse picks the resting intensity and
# pattern; player tempo then tightens or stretches the flash period.
PULSE_INTENSITY: dict[str, float] = {
    "none": 0.0,
    "subtle": 0.25,
    "strong": 0.60,
    "full": 0.90,
}
PULSE_PATTERN: dict[str, str] = {
    "none": "none",
    "subtle": "breathe",
    "strong": "pulse",
    "flash": "flash-soft",
    "full": "flash-soft",
}
PULSE_ORDER: tuple[str, ...] = ("none", "subtle", "strong", "full")
TEMPERAMENT_COLORS: dict[str, str] = {"warm": "amber", "cool": "sky", "hushed": "indigo"}

# A fast player's cabinet flashes tighter; a slow player's breathes longer.
BASE_FLASH_PERIOD_MS = 900
TEMPO_FLASH_FACTOR: dict[str, float] = {"rapid": 0.72, "steady": 1.0, "deliberate": 1.35}

# Losing-streak depth at which the cabinet pulse steps down a notch.
DROUGHT_DOWNGRADE_TIERS: frozenset[str] = frozenset({"deep", "severe"})

DEFAULT_BET = 25.0


@dataclass
class _Spin:
    """Normalized view of an inbound event, legacy string form included."""

    event_type: str
    theme: str
    game_id: str
    session_id: str | None
    bet: float
    win: float
    symbols: list[str] | None
    spin_phase: str
    reel_stop_ms: list[int] | None
    timestamp: str | None = None


def _normalize(event: GripEvent | EventTypeName | str) -> _Spin:
    """Accept a full GripEvent or a bare event_type string (legacy callers)."""
    if isinstance(event, str):
        return _Spin(
            event_type=event,
            theme="wuxia",
            game_id="SLOT-WUXIA-01",
            session_id=None,
            bet=DEFAULT_BET,
            win=0.0,
            symbols=None,
            spin_phase="resolved",
            reel_stop_ms=None,
            timestamp=None,
        )
    return _Spin(
        event_type=event.event_type,
        theme=safe_theme(event.theme),
        game_id=event.game_id,
        session_id=event.session_id,
        bet=event.bet_amount or DEFAULT_BET,
        win=event.win_amount or 0.0,
        symbols=event.symbols,
        spin_phase=event.spin_phase,
        reel_stop_ms=event.reel_stop_ms,
        timestamp=event.timestamp,
    )


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


def _is_win(event_type: str, win: float, escalated: bool) -> bool:
    """Did this spin pay, or is it an identity win that pays by definition?

    A zero-payout NEAR_WIN is a drought spin for the music bed — it cost the
    player credits and won nothing — but it is still not a high-tier win for the
    celebration override.
    """
    if win > 0 or escalated:
        return True
    return event_type in HIGH_TIER_EVENTS or event_type == "WIN_STREAK"


def _drought_adjusted_pulse(pulse: str, state: SessionState) -> str:
    """Step the cabinet pulse down once the drought goes deep.

    Never upgrades: a deep drought must never make a dead spin louder than a
    win, so the ladder only ever clamps downward.
    """
    if drought_tier(state.losing_streak) not in DROUGHT_DOWNGRADE_TIERS:
        return pulse
    index = PULSE_ORDER.index(pulse) if pulse in PULSE_ORDER else 0
    return PULSE_ORDER[max(0, index - 1)]


def _light_program(pulse: str, tempo: str, temperament: str) -> dict:
    """Translate the resolved pulse into a sustained cabinet lighting program."""
    pattern = PULSE_PATTERN.get(pulse, "none")
    period = 0
    if pattern != "none":
        period = int(BASE_FLASH_PERIOD_MS * TEMPO_FLASH_FACTOR.get(tempo, 1.0))
    return {
        "pattern": pattern,
        "period_ms": period,
        "color": TEMPERAMENT_COLORS.get(temperament, "amber"),
        "intensity": PULSE_INTENSITY.get(pulse, 0.0),
        "temperament": temperament,
    }


def _finalize(
    directive: dict,
    spin: _Spin,
    state: SessionState,
    phase: str,
    released: dict | None,
) -> dict:
    """Apply player-speed and losing-streak pacing to an allocated directive."""
    profile = audio_profile(state.tempo, state.losing_streak)
    temperament = light_temperament(state.losing_streak)

    is_paying = spin.win > 0 or spin.event_type in HIGH_TIER_EVENTS
    pulse = directive.get("ui_pulse", "none")
    if not is_paying:
        pulse = _drought_adjusted_pulse(pulse, state)

    directive["ui_pulse"] = pulse
    directive["phase"] = phase
    # Win prominence: a paying spin is never attenuated by its pacing profile.
    # The consoling envelope softens drought spins; the moment the spin pays,
    # its volume floor returns to standard so a big win after a long losing
    # streak still lands loudly (punchy's slight boost for rapid players stays).
    volume_scale = profile.volume_scale
    if is_paying:
        volume_scale = max(1.0, volume_scale)
    directive["volume"] = round(
        min(1.0, max(0.0, directive.get("volume", 0.0) * volume_scale)), 2
    )

    pacing = apply_pacing(state)
    directive["audio"] = pacing["audio"]
    directive["bedtrack_path"] = resolve_bed_asset(spin.theme)
    directive["bedtrack_volume"] = bed_volume(state)
    directive["tempo"] = state.tempo
    directive["cadence_ms"] = pacing["cadence_ms"]
    directive["losing_streak"] = state.losing_streak
    directive["win_streak"] = state.win_streak
    directive["drought_tier"] = drought_tier(state.losing_streak)
    directive["light_program"] = _light_program(pulse, state.tempo, temperament)
    directive["session_id"] = state.session_id

    if released:
        directive["close_call"] = released.get("close_call")
        directive["suspense_total_ms"] = released.get("total_ms", 0)
    directive.setdefault("cues", [])
    directive.setdefault("close_call", None)
    directive.setdefault("suspense_asset_path", "")
    directive.setdefault("suspense_total_ms", 0)

    rationale = pacing_rationale(state, profile)
    if rationale:
        directive["message"] = f"{directive['message']} Pacing: {rationale}."
    return directive


def _route_probe(spin: _Spin, state: SessionState) -> dict:
    """Answer a pre-resolution probe: hold the presentation and build suspense.

    Streak and cadence state are deliberately untouched — the spin has not
    resolved yet, so counting it here would double-count every spin and report
    a machine-gun cadence for every cabinet on the floor.

    Before a ladder is scheduled the probe passes two policy gates: mood
    fusion (drought elevates weak teases, rapid tempo drops them) and the
    suspense fatigue gate (severity-scaled refractory + rolling budget).
    """
    multiplier = compute_multiplier(spin.win, spin.bet)
    pacing = apply_pacing(state)

    directive: dict = {
        "event_type": spin.event_type,
        "action": "noop",
        "asset_path": "",
        "asset_type": "none",
        "soundtrack_path": "",
        "ui_pulse": "none",
        "volume": 0.0,
        "win_multiplier": multiplier,
        "audio": pacing["audio"],
        "bedtrack_path": resolve_bed_asset(spin.theme),
        "bedtrack_volume": bed_volume(state),
        "tempo": state.tempo,
        "cadence_ms": pacing["cadence_ms"],
        "losing_streak": state.losing_streak,
        "win_streak": state.win_streak,
        "drought_tier": drought_tier(state.losing_streak),
        "session_id": state.session_id,
        "cues": [],
        "close_call": None,
        "suspense_asset_path": "",
        "suspense_total_ms": 0,
    }

    signal: CloseCallSignal | None = None
    fusion_note = ""
    if is_teasable_event(spin.event_type):
        signal = detect_close_call(spin.symbols, spin.event_type, spin.win, spin.bet)
        if signal is not None:
            signal, fusion_note = fuse_close_call(signal, state)
            if signal is None:
                # Fusion dropped the tease outright (e.g. a weak tease under a
                # rapid tempo). Say why instead of emitting an empty program.
                directive["phase"] = "idle"
                directive["light_program"] = _light_program(
                    "none", state.tempo, light_temperament(state.losing_streak)
                )
                directive["message"] = (
                    "Probe: weak tease skipped — rapid tempo leaves no window "
                    "while the reels race. No suspense allocated."
                )
                return directive

            # Fatigue gate: a seat that was just teased must rest (severity-
            # scaled refractory + rolling per-minute budget).
            allowed, fatigue_note = suspense_allowed(state, signal.severity, time.time())
            if not allowed:
                directive["phase"] = "idle"
                directive["light_program"] = _light_program(
                    "none", state.tempo, light_temperament(state.losing_streak)
                )
                directive["message"] = f"Probe: tease denied ({fatigue_note}). No suspense allocated."
                return directive

    if signal is None:
        # Not worth teasing. Say so explicitly rather than emitting an empty
        # program the client would have to special-case.
        directive["phase"] = "idle"
        directive["light_program"] = _light_program(
            "none", state.tempo, light_temperament(state.losing_streak)
        )
        directive["message"] = "Probe: no close call on the line. No suspense allocated."
        return directive

    profile = audio_profile(state.tempo, state.losing_streak)
    tier = drought_tier(state.losing_streak)
    program = build_suspense_program(
        signal,
        reel_stop_ms=sanitize_reel_stops(spin.reel_stop_ms),
        tempo=state.tempo,
        light_temperament=light_temperament(state.losing_streak),
        duration_scale=profile.duration_scale,
        drought_tier_name=tier,
        post_win_cooldown=state.cooldown_spins > 0,
    )
    state.open_suspense(program)

    stops = sanitize_reel_stops(spin.reel_stop_ms)
    directive["phase"] = "suspend"
    directive["cues"] = program["cues"]
    directive["light_program"] = program["light_program"]
    directive["close_call"] = program["close_call"]
    directive["suspense_asset_path"] = resolve_suspense_asset(
        spin.theme, fallback=EVENT_ASSET_MAP["NEAR_WIN"]["asset_path"]
    )
    directive["suspense_total_ms"] = program["total_ms"]
    directive["message"] = (
        f"SUSPENSE ARMED ({signal.label}): {signal.detail}. "
        f"Heartbeat {program['cues'][0]['bpm']:.0f}->"
        f"{program['cues'][-2]['bpm']:.0f} bpm across "
        f"{len(stops)} reel stops, lights escalate to {program['light_program']['pattern']}, "
        f"release at {program['total_ms']}ms."
    )
    if fusion_note:
        directive["message"] += f" [{fusion_note}]"
    return directive


def _allocate(spin: _Spin, multiplier: float, is_high_tier: bool, escalated: bool, state: SessionState) -> dict:
    """Core asset allocation: tier, streak override, escalation, volume, pulse."""
    event_type = spin.event_type

    if event_type == "WIN_STREAK":
        return {
            "event_type": event_type,
            "action": "play",
            **WIN_STREAK_OVERRIDE,
            "volume": 1.0,
            "win_multiplier": multiplier,
        }

    if (is_high_tier or escalated) and state.win_streak >= WIN_STREAK_THRESHOLD:
        return {
            "event_type": event_type,
            "action": "play",
            **WIN_STREAK_OVERRIDE,
            "volume": 1.0,
            "win_multiplier": multiplier,
            "message": (
                f"STATE OVERRIDE: {state.win_streak} consecutive high-tier wins! "
                f"Priority celebration allocated."
            ),
        }

    if escalated:
        directive = dict(EVENT_ASSET_MAP["BIG_WIN"])
        directive["asset_path"] = resolve_asset(
            spin.theme, "BIG_WIN", multiplier, fallback=EVENT_ASSET_MAP["BIG_WIN"]["asset_path"]
        )
        directive["ui_pulse"] = "strong" if multiplier < 25 else "full"
        directive["volume"] = big_win_volume(multiplier)
        directive["message"] = (
            f"Escalated {event_type}: payout {spin.win:.0f} credits ({multiplier:.1f}x bet "
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
        spin.theme, event_type, multiplier, fallback=base["asset_path"]
    )
    directive["volume"] = compute_volume(event_type, multiplier, spin.win)
    if event_type == "BIG_WIN":
        directive["message"] = (
            f"Big Win allocated: Payout {spin.win:.0f} credits ({multiplier:.1f}x bet). "
            f"High-energy celebration and soundtrack triggered."
        )
        directive["ui_pulse"] = "strong" if multiplier < 25 else "full"
    elif event_type == "NEAR_WIN":
        sym_text = f" on {spin.symbols}" if spin.symbols else ""
        directive["message"] = (
            f"Near-Win recognized{sym_text}: 4-symbol lock. "
            f"Tension riser and subtle pulse allocated."
        )
        directive["ui_pulse"] = "subtle"
    elif event_type == "SPIN_RESULT":
        if spin.win > 0:
            directive["soundtrack_path"] = "/audio/win_chime.wav"
            directive["ui_pulse"] = "subtle"
            directive["message"] = (
                f"Payline match: {spin.win:.0f} credits awarded. Reward audio allocated."
            )
        else:
            directive["message"] = "Reels stopped: standard spin result recorded."
    elif event_type == "JACKPOT":
        directive["message"] = (
            f"MEGA JACKPOT finale ({spin.win or 2500:.0f} credits)! "
            f"Dragon descent and grand fanfare allocated."
        )

    return {"event_type": event_type, "action": "play", **directive, "win_multiplier": multiplier}


def _route_resolved(spin: _Spin, state: SessionState) -> dict:
    """Allocate for a landed outcome and advance all pacing state."""
    multiplier = compute_multiplier(spin.win, spin.bet)
    is_high_tier = spin.event_type in HIGH_TIER_EVENTS
    escalated = (
        not is_high_tier
        and spin.event_type in ESCALATION_POOL
        and spin.win > 0
        and multiplier >= BIG_WIN_THRESHOLD
    )

    state.ingest(
        spin.event_type,
        is_win=_is_win(spin.event_type, spin.win, escalated),
        is_high_tier=is_high_tier or escalated,
        timestamp=parse_timestamp(spin.timestamp),
    )
    released = state.consume_suspense()

    directive = _allocate(spin, multiplier, is_high_tier, escalated, state)
    return _finalize(directive, spin, state, "release" if released else "play", released)


def route_event(event: GripEvent | EventTypeName) -> dict:
    """Evaluate inbound GRIP event and player context to allocate media.

    Takes player action, spin results (symbols, win amount, bet), and the
    player's pacing history (spin cadence, win streak, losing streak) into
    account:

    - Win/Bet multiplier selects the tiered celebration video, volume, and pulse.
    - Under-classed payout events (SPIN_RESULT / NO_WIN / NEAR_WIN with a payout
      at or above the big-win threshold) escalate to the big-win tier.
    - High-tier streaks override with priority celebration assets.
    - A ``reels_spinning`` probe returns a timed suspense cue ladder anchored to
      the cabinet's reel stops instead of a playback directive.
    - Player speed selects the audio envelope; a losing streak adds a soft
      encouraging bed and cools the cabinet lighting.
    """
    spin = _normalize(event)
    state = get_session(spin.game_id, spin.session_id)

    if spin.spin_phase == "reels_spinning":
        return _route_probe(spin, state)
    return _route_resolved(spin, state)