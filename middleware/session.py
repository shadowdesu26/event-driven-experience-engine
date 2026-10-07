"""Per-session experience state for the Casino Experience Engine.

Everything the engine decides about *pacing* is temporal, not per-event: how
fast the player is spinning, how long they have been losing, whether the last
spin was already teased as a close call. This module owns that history.

State is keyed by ``(game_id, session_id)`` so two browser tabs — or a CLI
simulator running beside a live cabinet — never bleed streaks into each other.
``session_id`` is optional; clients that omit it share the ``game_id`` bucket.

Cadence is measured **only** from ``resolved`` phase events. A
``reels_spinning`` probe and the ``resolved`` call that follows it describe one
physical spin, so counting both would report a machine-gun cadence for every machine
on the floor regardless of how fast the player actually plays.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

# High-tier winning events that feed the consecutive-win streak state machine.
HIGH_TIER_EVENTS: tuple[str, ...] = ("BIG_WIN", "JACKPOT", "BONUS_TRIGGER")

# Session-opening event: hard reset rather than a win/loss transition.
RESET_EVENTS: tuple[str, ...] = ("GAME_START",)

# Tempo bands over the smoothed inter-spin interval, in milliseconds.
TEMPO_RAPID_MAX_MS = 2200.0
TEMPO_DELIBERATE_MIN_MS = 4500.0
DEFAULT_TEMPO = "steady"

# Weight given to the newest interval in the cadence moving average.
CADENCE_EWMA_ALPHA = 0.4

# Spins after a win during which the drought bed stays suppressed, so a single
# immediate miss cannot make the background music flap on and off.
BED_COOLDOWN_SPINS = 2

# Clamp a single observed interval. Guards against client clock jumps and
# against a client that reuses one timestamp for a burst of events.
MIN_INTERVAL_MS = 250.0
MAX_INTERVAL_MS = 600_000.0

TempoName = str


def parse_timestamp(raw: str | None) -> float | None:
    """Parse an ISO-8601 timestamp into a POSIX float, or None if unusable."""
    if not raw:
        return None
    text = raw.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def classify_tempo(interval_ms: float | None) -> TempoName:
    """Map a smoothed inter-spin interval onto a tempo band."""
    if interval_ms is None:
        return DEFAULT_TEMPO
    if interval_ms < TEMPO_RAPID_MAX_MS:
        return "rapid"
    if interval_ms > TEMPO_DELIBERATE_MIN_MS:
        return "deliberate"
    return "steady"


def tempo_bpm_scale(tempo: TempoName) -> float:
    """Heartbeat rate multiplier for a tempo band.

    Fast players get a faster pulse because the spin window is short and the
    tension has to land inside it; slow players get a calmer one.
    """
    return {"rapid": 1.12, "steady": 1.0, "deliberate": 0.92}.get(tempo, 1.0)


@dataclass
class SessionState:
    """Mutable pacing history for one player session."""

    game_id: str
    session_id: str
    win_streak: int = 0
    losing_streak: int = 0
    spin_count: int = 0
    cooldown_spins: int = 0
    cadence_ewma_ms: float | None = None
    tempo: TempoName = DEFAULT_TEMPO
    last_event_at: float | None = None
    last_suspense_at: float | None = None
    pending_suspense: dict | None = field(default=None)
    # Rolling timestamps of armed suspense ladders, for the tease-budget policy.
    suspense_times: list[float] = field(default_factory=list)

    @property
    def interval_ms(self) -> float | None:
        """The most recently observed inter-spin interval, if any."""
        return self.cadence_ewma_ms

    def reset(self) -> None:
        self.win_streak = 0
        self.losing_streak = 0
        self.spin_count = 0
        self.cooldown_spins = 0
        self.cadence_ewma_ms = None
        self.tempo = DEFAULT_TEMPO
        self.last_event_at = None
        self.last_suspense_at = None
        self.pending_suspense = None
        self.suspense_times = []

    def as_dict(self) -> dict:
        """Observability snapshot for the QA session endpoints."""
        return {
            "game_id": self.game_id,
            "session_id": self.session_id,
            "win_streak": self.win_streak,
            "losing_streak": self.losing_streak,
            "spin_count": self.spin_count,
            "cooldown_spins": self.cooldown_spins,
            "cadence_ewma_ms": (
                round(self.cadence_ewma_ms, 1) if self.cadence_ewma_ms is not None else None
            ),
            "tempo": self.tempo,
            "suspense_pending": self.pending_suspense is not None,
        }

    # -- transitions -----------------------------------------------------

    def open_suspense(self, program: dict) -> None:
        now = time.time()
        self.pending_suspense = program
        self.last_suspense_at = now
        # Keep only the recent window; the budget policies prune off it.
        self.suspense_times = [t for t in self.suspense_times if now - t <= 120.0]
        self.suspense_times.append(now)

    def consume_suspense(self) -> dict | None:
        program, self.pending_suspense = self.pending_suspense, None
        return program

    def ingest(
        self,
        event_type: str,
        is_win: bool,
        is_high_tier: bool,
        timestamp: float | None,
    ) -> None:
        """Fold one *resolved* spin into the pacing history.

        Two different streaks are tracked deliberately, because they mean
        different things to the presentation layer:

        * ``win_streak`` counts consecutive **high-tier** wins and is what the
          WIN_STREAK state override keys off.
        * ``losing_streak`` counts consecutive **zero-payout** spins and is what
          the drought bed keys off.

        A small SPIN_RESULT payout breaks the high-tier streak (so the celebration
        override releases) and also breaks the drought (so the bed fades out) —
        but it is itself neither, which is why the two flags are separate.
        """
        now = timestamp if timestamp is not None else time.time()

        if event_type in RESET_EVENTS:
            self.reset()
            self.spin_count = 1
            return

        if self.last_event_at is not None:
            observed_ms = (now - self.last_event_at) * 1000.0
            if MIN_INTERVAL_MS <= observed_ms <= MAX_INTERVAL_MS:
                if self.cadence_ewma_ms is None:
                    self.cadence_ewma_ms = observed_ms
                else:
                    alpha = CADENCE_EWMA_ALPHA
                    self.cadence_ewma_ms = (
                        alpha * observed_ms + (1.0 - alpha) * self.cadence_ewma_ms
                    )
                self.tempo = classify_tempo(self.cadence_ewma_ms)

        self.last_event_at = now
        self.spin_count += 1

        self.win_streak = self.win_streak + 1 if is_high_tier else 0

        if is_win:
            self.losing_streak = 0
            self.cooldown_spins = BED_COOLDOWN_SPINS
        else:
            self.losing_streak += 1
            if self.cooldown_spins > 0:
                self.cooldown_spins -= 1


_SESSIONS: dict[tuple[str, str], SessionState] = {}
_LOCK = threading.Lock()

DEFAULT_SESSION_ID = "default"


def session_key(game_id: str, session_id: str | None) -> tuple[str, str]:
    return (game_id or "SLOT-WUXIA-01", (session_id or DEFAULT_SESSION_ID).strip() or DEFAULT_SESSION_ID)


def get_session(game_id: str, session_id: str | None = None) -> SessionState:
    """Fetch or create the state bucket for a player session."""
    key = session_key(game_id, session_id)
    with _LOCK:
        state = _SESSIONS.get(key)
        if state is None:
            state = SessionState(game_id=key[0], session_id=key[1])
            _SESSIONS[key] = state
        return state


def reset_session(game_id: str, session_id: str | None = None) -> SessionState:
    """Hard-reset one session bucket (QA / seat change)."""
    state = get_session(game_id, session_id)
    with _LOCK:
        state.reset()
    return state


def list_sessions() -> list[dict]:
    """Every tracked session, newest activity first is not tracked; by key."""
    with _LOCK:
        return [state.as_dict() for state in _SESSIONS.values()]