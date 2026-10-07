"""Close-call suspense engine for the Casino Experience Engine.

When the outcome of a spin is already decided but the cabinet reels are still
turning, the engine has a window of a few hundred milliseconds to sell the
almost-win. This module owns that window.

The frontend fires one pre-resolution probe (``spin_phase="reels_spinning"``)
carrying the pending outcome plus the reel stop schedule. The engine decides
whether the result is worth teasing and, if so, returns a **timed cue ladder**
anchored to the reel stop boundaries — so every reel landing lands on a beat,
and the heartbeat accelerates as the final reel approaches its stop.

Everything here is policy: the frontend receives a finished program and only
schedules it.
"""

from __future__ import annotations

from dataclasses import dataclass

from mood import drought_tier
from session import SessionState, tempo_bpm_scale

# Symbol classes used to classify a pending outcome.
SCATTER_SYMBOLS: frozenset[str] = frozenset({"⭐"})
PREMIUM_SYMBOLS: frozenset[str] = frozenset({"7", "💎"})

# Reel stop schedule assumed when the client does not send one. Mirrors the
# cabinet simulator: 900ms base plus a 750ms stagger per reel.
DEFAULT_REEL_STOP_MS: tuple[int, ...] = (900, 1650, 2400, 3150, 3900)

# Slow cabinets stretch one spin across several seconds, so the validity guard
# has to accept stop offsets well past five seconds.
MAX_REEL_STOP_MS = 15000
MAX_SYMBOLS = 5

# Heartbeat ladder. Each rung is a tighter pulse and a harder light pattern.
#
#   base_bpm    — the pulse rate the ladder starts at, by severity
#   steps       — how many escalations before the release
#   bpm_step    — multiplicative rate increase per rung
#   base_volume / volume_step — audible ramp, capped below the win sting
#   max_bpm     — ceiling so the pulse never turns into a buzz
BASE_BPM: dict[int, float] = {1: 66.0, 2: 84.0, 3: 96.0}
STEPS: dict[int, int] = {1: 4, 2: 5, 3: 5}
BPM_STEP_RATIO = 0.20
BASE_VOLUME = 0.28
VOLUME_STEP = 0.07
MAX_VOLUME = 0.60
MAX_BPM = 150.0

# Light patterns escalate in step with the heartbeat.
LIGHT_LADDER: tuple[str, ...] = (
    "breathe",
    "pulse",
    "flash-soft",
    "flash-hard",
    "flash-strobe",
)

RELEASE_LIGHT = "flare"
RELEASE_INTENSITY: dict[int, float] = {1: 0.45, 2: 0.65, 3: 0.85}

# --- suspense fatigue policy -------------------------------------------
#
# A pulse that fires on every tease trains players to ignore it. The gate is
# severity-scaled: a quiet weak tease must rest 15s, a serious one only 5s, and
# a rolling budget caps how many ladders a seat may get per minute at all.
SUSPENSE_REFRACTORY_S: dict[int, float] = {1: 15.0, 2: 10.0, 3: 5.0}
SUSPENSE_BUDGET_WINDOW_S = 60.0
SUSPENSE_BUDGET_MAX = 3

# --- cross-state fusion ------------------------------------------------
#
# Mood may rewrite a tease before it is scheduled: a drought makes small
# near-misses matter more (severity steps up), while a racing player gets no
# weak tease at all (the spin window is too short to land one).
FUSION_BPM_STEP = 0.05  # per drought tier index, multiplicative
FUSION_VOLUME_STEP: dict[str, float] = {"none": 0.0, "mild": 0.03, "deep": 0.06, "severe": 0.09}

_TIER_INDEX: dict[str, int] = {"none": 0, "mild": 1, "deep": 2, "severe": 3}


def suspense_allowed(state: SessionState, severity: int, now: float) -> tuple[bool, str]:
    """Fatigue gate for a pending tease: True when the seat may get a ladder.

    Severity-scaled refractory window plus a rolling per-minute budget. A lower
    severity never blocks a higher one: if the *pending* severity needs a
    shorter cooldown than its predecessor, it is allowed through.
    """
    severity = max(1, min(3, severity))
    required = SUSPENSE_REFRACTORY_S[severity]
    if state.last_suspense_at is not None:
        since = now - state.last_suspense_at
        if since < required:
            remain = required - since
            return False, (
                f"refractory holds: {remain:.1f}s of {required:.0f}s cooldown "
                f"remains for severity {severity}"
            )
    recent = [t for t in state.suspense_times if now - t <= SUSPENSE_BUDGET_WINDOW_S]
    if len(recent) >= SUSPENSE_BUDGET_MAX:
        return False, (
            f"tease budget spent: {len(recent)} ladders in the last "
            f"{SUSPENSE_BUDGET_WINDOW_S:.0f}s"
        )
    return True, ""


def fuse_close_call(signal: CloseCallSignal, state: SessionState) -> tuple[CloseCallSignal | None, str]:
    """Mood x suspense fusion: rewrite (or drop) a tease by player context.

    Returns (signal, note). A None signal means the tease was skipped outright.
    """
    tier = drought_tier(state.losing_streak)
    severity = signal.severity
    note = ""

    # A drought raises the stakes of every small near-miss.
    if tier != "none" and severity < 3:
        severity = severity + 1
        note = f"drought-fused {signal.severity}->{severity}"

    # A racing player gets no weak tease: the spin window is too short for it
    # to land, and stacking pulses on rapid spins reads as noise.
    if state.tempo == "rapid" and severity <= 1 and tier == "none":
        return None, "rapid tempo leaves no window for a weak tease"

    if severity != signal.severity:
        signal = CloseCallSignal(
            kind=signal.kind,
            severity=severity,
            label=signal.label,
            detail=signal.detail,
            symbols=signal.symbols,
        )
    return signal, note


@dataclass(frozen=True)
class CloseCallSignal:
    """A pending outcome judged worth teasing while the reels turn."""

    kind: str
    severity: int
    label: str
    detail: str
    symbols: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "severity": self.severity,
            "label": self.label,
            "detail": self.detail,
            "symbols": list(self.symbols),
        }


def _clean_symbols(symbols: list[str] | None) -> list[str]:
    return [str(s) for s in (symbols or [])][:MAX_SYMBOLS]


def _leading_lock_count(symbols: list[str]) -> tuple[str | None, int]:
    """Most common symbol across the leading reels, and how many hold it."""
    if not symbols:
        return None, 0
    leading = symbols[:-1]
    counts: dict[str, int] = {}
    for symbol in leading:
        counts[symbol] = counts.get(symbol, 0) + 1
    best = max(counts.items(), key=lambda kv: kv[1])
    return best[0], best[1]


def detect_close_call(
    symbols: list[str] | None,
    event_type: str | None = None,
    win_amount: float = 0.0,
    bet_amount: float = 0.0,
) -> CloseCallSignal | None:
    """Classify a pending outcome as a close call, or return None.

    Checked most-specific first so a genuine near miss is never reported as a
    jackpot tease:

    1. **near_miss** — the leading reels lock while the final reel does not.
    2. **jackpot_tease** — four or more premium symbols on the line.
    3. **scatter_tease** — two or more scatter symbols already landed.
    """
    board = _clean_symbols(symbols)
    if not board:
        return None

    locked, lock_count = _leading_lock_count(board)
    final_differs = len(board) >= MAX_SYMBOLS and board[-1] != locked

    # 1. Near miss: leading reels lock, final reel misses.
    if locked is not None and lock_count >= 3 and final_differs:
        premium = locked in PREMIUM_SYMBOLS
        severity = 2 if premium else 1
        kind = "near_miss" if premium else "weak_tease"
        label = (
            f"{lock_count}x premium {locked} locked, final reel misses"
            if premium
            else f"{lock_count}x {locked} on the leading reels"
        )
        return CloseCallSignal(kind, severity, "CLOSE CALL", label, tuple(board))

    # 2. Jackpot / premium tease.
    premium_count = sum(1 for symbol in board if symbol in PREMIUM_SYMBOLS)
    if premium_count >= 4:
        return CloseCallSignal(
            "jackpot_tease",
            3,
            "JACKPOT TEASE",
            f"{premium_count} premium symbols on the line",
            tuple(board),
        )

    # 3. Scatter tease: bonus symbols landed before the final reel stopped.
    scatter_count = sum(1 for symbol in board if symbol in SCATTER_SYMBOLS)
    if scatter_count >= 2:
        return CloseCallSignal(
            "scatter_tease",
            3 if scatter_count >= 3 else 2,
            "BONUS TEASE",
            f"{scatter_count} scatter symbols already on the line",
            tuple(board),
        )

    # 4. An explicit NEAR_WIN classification is a close call by definition.
    if event_type == "NEAR_WIN":
        return CloseCallSignal(
            "near_miss", 2, "CLOSE CALL", "near-win classified by the game", tuple(board)
        )

    return None


def sanitize_reel_stops(reel_stop_ms: list[int] | None) -> list[int]:
    """Validate a client-supplied stop schedule into a sorted positive list."""
    if not reel_stop_ms:
        return list(DEFAULT_REEL_STOP_MS)
    stops = sorted(
        {
            int(value)
            for value in reel_stop_ms
            if isinstance(value, (int, float)) and 0 < value <= MAX_REEL_STOP_MS
        }
    )
    if len(stops) < 2:
        return list(DEFAULT_REEL_STOP_MS)
    return stops


def bpm_to_period_ms(bpm: float) -> int:
    """Heartbeat period in milliseconds for a pulse rate."""
    if bpm <= 0:
        return 0
    return max(80, int(round(60_000.0 / bpm)))


def build_suspense_program(
    signal: CloseCallSignal,
    reel_stop_ms: list[int] | None = None,
    tempo: str = "steady",
    light_temperament: str = "warm",
    duration_scale: float = 1.0,
    drought_tier_name: str = "none",
    post_win_cooldown: bool = False,
) -> dict:
    """Build the timed cue ladder for a close call.

    The ladder is anchored to the reel stop boundaries: the first heartbeat
    fires before any reel stops, each subsequent rung lands on a reel stop, and
    the final rung releases on the last reel — so the pulse is still running
    right up to the moment the outcome lands.

    ``duration_scale`` comes from the audio profile so a fast player gets
    clipped heartbeats rather than long ones.

    ``drought_tier_name`` and ``post_win_cooldown`` fuse mood into the ladder: a
    losing streak tightens the pulse and raises the entry volume while the
    player is in the hole (suppressed during the post-win cooldown), so the
    tease matches how much the near-miss actually means right now.
    """
    stops = sanitize_reel_stops(reel_stop_ms)
    severity = max(1, min(3, signal.severity))
    steps = STEPS[severity]

    tier_index = _TIER_INDEX.get(drought_tier_name, 0)
    bpm_boost = 1.0 + FUSION_BPM_STEP * tier_index
    volume_boost = 0.0 if post_win_cooldown else FUSION_VOLUME_STEP.get(drought_tier_name, 0.0)

    bpm_base = BASE_BPM[severity] * tempo_bpm_scale(tempo) * bpm_boost
    base_volume = BASE_VOLUME + volume_boost

    cues: list[dict] = []

    # Opening heartbeat, before the first reel stops.
    cues.append(
        {
            "at_ms": 0,
            "kind": "heartbeat",
            "bpm": round(min(bpm_base, MAX_BPM), 1),
            "light": LIGHT_LADDER[0],
            "light_intensity": round(0.20 + 0.10 * severity, 2),
            "volume": round(base_volume, 2),
            "note": f"{signal.label} detected — suspense armed while reels turn",
        }
    )

    # One rung per leading reel stop, tightening as the final reel approaches.
    for index in range(1, steps):
        stop = stops[min(index, len(stops) - 1)]
        rung = min(index, len(LIGHT_LADDER) - 1)
        bpm = min(bpm_base * (1.0 + BPM_STEP_RATIO * index), MAX_BPM)
        cues.append(
            {
                "at_ms": int(stop),
                "kind": "heartbeat",
                "bpm": round(bpm, 1),
                "light": LIGHT_LADDER[rung],
                "light_intensity": round(min(0.25 + 0.15 * index, 0.95), 2),
                "volume": round(min(base_volume + VOLUME_STEP * index, MAX_VOLUME), 2),
                "note": f"Reel {min(index + 1, len(stops))} stops — pulse tightens",
            }
        )

    # Release on the final reel stop; the resolved directive takes over here.
    terminal = cues[-1]
    release_at = stops[-1]
    cues.append(
        {
            "at_ms": int(release_at),
            "kind": "release",
            "bpm": 0.0,
            "light": RELEASE_LIGHT,
            "light_intensity": RELEASE_INTENSITY[severity],
            "volume": 0.0,
            "note": "Final reel stops — heartbeat released",
        }
    )

    light_program = {
        "pattern": terminal["light"],
        "period_ms": bpm_to_period_ms(terminal["bpm"]),
        "color": _temperament_color(light_temperament),
        "intensity": terminal["light_intensity"],
        "temperament": light_temperament,
    }

    return {
        "close_call": signal.as_dict(),
        "cues": cues,
        "light_program": light_program,
        "duration_scale": duration_scale,
        "total_ms": int(release_at),
    }


_TEMPERAMENT_COLORS = {
    "warm": "amber",
    "cool": "sky",
    "hushed": "indigo",
}


def _temperament_color(temperament: str) -> str:
    return _TEMPERAMENT_COLORS.get(temperament, "amber")


def is_teasable_event(event_type: str | None) -> bool:
    """Events that are never worth a suspense tease.

    A dead spin and an opening sequence have nothing to sell, and teasing them
    teaches the player that the pulse does not mean anything.
    """
    return event_type not in ("NO_WIN", "GAME_START")


__all__ = [
    "BASE_BPM",
    "FUSION_BPM_STEP",
    "FUSION_VOLUME_STEP",
    "SUSPENSE_BUDGET_MAX",
    "SUSPENSE_BUDGET_WINDOW_S",
    "SUSPENSE_REFRACTORY_S",
    "CloseCallSignal",
    "DEFAULT_REEL_STOP_MS",
    "LIGHT_LADDER",
    "MAX_BPM",
    "SCATTER_SYMBOLS",
    "PREMIUM_SYMBOLS",
    "bpm_to_period_ms",
    "build_suspense_program",
    "detect_close_call",
    "fuse_close_call",
    "is_teasable_event",
    "sanitize_reel_stops",
    "suspense_allowed",
]