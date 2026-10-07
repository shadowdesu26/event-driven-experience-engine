"""Compare the Python middleware and the built-in TypeScript engine.

Scripted GRIP sequences are replayed against both engines — the Python
middleware (reference implementation) and the built-in TypeScript engine in
`frontend/app/api/` — and the returned directives are diffed field by field.
Numeric fields compare within a small tolerance so Python-vs-JS float rounding
does not produce false alarms.

Prereqs:
    - Python middleware running on the launcher-picked port (auto-read from
      %TEMP%\ee_middleware_port.txt; fallback 39107, then 8000):
      python -m uvicorn main:app --port 39107
    - TS engine running:          npx next start --port 3600
      (run inside frontend/ WITHOUT the ENGINE_URL env var, after `next build`)

Usage:
    python parity_check.py                      # defaults shown above
    python parity_check.py --python-base http://127.0.0.1:39107 --ts-base http://127.0.0.1:3600
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

BASE_TIME = datetime.now(timezone.utc)
SESSION = str(uuid.uuid4())

REEL_STOPS = [900, 1650, 2400, 3150, 3900]

# (label, event_type, phase, win, bet, symbols, ts_offset_seconds, wall_delay)
# `ts_offset_seconds` feeds the payload timestamps (cadence); `wall_delay` is a
# real sleep before the send, needed for wall-clock policies like the suspense
# refractory gate.
SCENARIOS: list[tuple[str, list[tuple]]] = [
    (
        "drought (losing streak -> bed)",
        [
            ("GAME_START", "resolved", 0, 25, ["🍒", "7", "BAR", "⭐", "💎"], 0, 0),
            ("NO_WIN", "resolved", 0, 25, ["🍒", "🍋", "🔕", "🔔", "BAR"], 3, 0),
            ("NO_WIN", "resolved", 0, 25, ["🍒", "🍋", "🔕", "🔔", "BAR"], 6, 0),
            ("NO_WIN", "resolved", 0, 25, ["🍇", "🍋", "🍇", "🔔", "7"], 9, 0),
        ],
    ),
    (
        "rapid (fast spins -> punchy audio)",
        [
            ("GAME_START", "resolved", 0, 25, ["🍒", "7", "BAR", "⭐", "💎"], 0, 0),
            ("SPIN_RESULT", "resolved", 25, 25, ["🍒", "🍒", "🍇", "🔔", "BAR"], 1.5, 0),
            ("SPIN_RESULT", "resolved", 25, 25, ["🍋", "🍋", "🍇", "🔔", "BAR"], 3.0, 0),
            ("SPIN_RESULT", "resolved", 25, 25, ["🍇", "🍇", "🍒", "🔔", "BAR"], 4.5, 0),
        ],
    ),
    (
        "win streak (state override)",
        [
            ("BIG_WIN", "resolved", 500, 25, ["💎"] * 5, 0, 0),
            ("BIG_WIN", "resolved", 500, 25, ["💎"] * 5, 10, 0),
            ("BONUS_TRIGGER", "resolved", 250, 25, ["⭐", "🍒", "⭐", "🍋", "⭐"], 20, 0),
        ],
    ),
    (
        "escalation (20x payout -> big-win tier)",
        [
            ("NEAR_WIN", "resolved", 500, 25, ["7", "7", "7", "7", "🍒"], 0, 0),
        ],
    ),
    (
        "suspense (close-call probe + release)",
        [
            ("NEAR_WIN", "reels_spinning", 0, 25, ["7", "7", "7", "7", "🍒"], 0, 0),
            ("NEAR_WIN", "resolved", 0, 25, ["7", "7", "7", "7", "🍒"], 7.5, 0),
        ],
    ),
    (
        "rapid skip (weak tease dropped, fusion policy)",
        [
            ("GAME_START", "resolved", 0, 25, ["🍒", "7", "BAR", "⭐", "💎"], 0, 0),
            ("SPIN_RESULT", "resolved", 25, 25, ["🍒", "🍒", "🍇", "🔔", "BAR"], 2, 0),
            ("SPIN_RESULT", "resolved", 25, 25, ["🍋", "🍋", "🍇", "🔔", "BAR"], 4, 0),
            ("NEAR_WIN", "reels_spinning", 0, 25, ["🍒", "🍒", "🍒", "🍒", "🍋"], 4.4, 0),
            ("SPIN_RESULT", "resolved", 25, 25, ["🍒", "🍒", "🍇", "🔔", "BAR"], 6, 0),
        ],
    ),
    (
        "suspense fatigue (refractory + rolling budget)",
        [
            ("NEAR_WIN", "reels_spinning", 0, 25, ["7", "7", "7", "7", "🍒"], 0, 0),
            ("NEAR_WIN", "reels_spinning", 0, 25, ["7", "7", "7", "7", "🍒"], 0.3, 0.3),
            ("JACKPOT", "reels_spinning", 0, 25, ["💎"] * 5, 7, 6.7),
            ("JACKPOT", "reels_spinning", 0, 25, ["💎"] * 5, 13.5, 6.5),
            ("JACKPOT", "reels_spinning", 0, 25, ["💎"] * 5, 19, 5.5),
            ("NEAR_WIN", "resolved", 0, 25, ["7", "7", "7", "7", "🍒"], 21, 0),
        ],
    ),
    (
        "drought fusion (weak tease escalates under a losing streak)",
        [
            ("GAME_START", "resolved", 0, 25, ["🍒", "7", "BAR", "⭐", "💎"], 0, 0),
            ("NO_WIN", "resolved", 0, 25, ["🍒", "🍋", "🔕", "🔔", "BAR"], 3, 0),
            ("NO_WIN", "resolved", 0, 25, ["🍒", "🍋", "🔕", "🔔", "BAR"], 6, 0),
            ("NO_WIN", "resolved", 0, 25, ["🍇", "🍋", "🍇", "🔔", "7"], 9, 0),
            ("NEAR_WIN", "reels_spinning", 0, 25, ["🍒", "🍒", "🍒", "🍒", "🍋"], 12, 0),
        ],
    ),
]


def iso(offset_seconds: float) -> str:
    stamp = BASE_TIME + timedelta(seconds=offset_seconds)
    return stamp.isoformat().replace("+00:00", "Z")


def payload(event: tuple, session: str) -> dict:
    event_type, phase, win, bet, symbols, ts_offset = event[:6]
    return {
        "event_type": event_type,
        "game_id": "SLOT-WUXIA-01",
        "theme": "wuxia",
        "bet_amount": bet,
        "win_amount": win,
        "win_level": "JACKPOT" if win >= 1000 else ("HIGH" if win >= 250 else ("NONE" if win == 0 else "MEDIUM")),
        "symbols": symbols,
        "event_id": str(uuid.uuid4()),
        "timestamp": iso(ts_offset),
        "session_id": session,
        "spin_phase": phase,
        "reel_stop_ms": REEL_STOPS,
    }


def post(base: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{base}/api/grip-event",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def reset(base: str, session: str) -> None:
    url = f"{base}/api/session/SLOT-WUXIA-01?session_id={session}"
    req = urllib.request.Request(url, method="DELETE")
    try:
        urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise


def strip_suffix(message: str) -> str:
    return message.split(" [event_id=")[0]


def strip_freq(message: str) -> str:
    """Denial messages carry wall-clock remainders that differ per run; the
    policy text must match, the live seconds need not."""
    if "denied" not in message and "skipped" not in message:
        return message
    return re.sub(r"\d+(\.\d+)?", "N", message)


def close(a, b, tol):
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None:
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= tol
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(close(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(close(a[k], b[k], tol) for k in a)
    return a == b


def diff(path, a, b, tol, out):
    if not close(a, b, tol):
        if isinstance(a, dict) and isinstance(b, dict):
            for key in a:
                if key in b:
                    diff(f"{path}.{key}", a[key], b[key], tol, out)
                else:
                    out.append(f"{path}.{key}: python={a[key]!r} ts=<missing>")
            for key in b:
                if key not in a:
                    out.append(f"{path}.{key}: python=<missing> ts={b[key]!r}")
        else:
            out.append(f"{path}: python={a!r} ts={b!r}")


TOLERANCES = {
    "volume": 0.011,
    "bedtrack_volume": 0.011,
    "cadence_ms": 1.0,
    "suspense_total_ms": 2.0,
    "period_ms": 2.0,
}

DEFAULT_DEPTH_TOL = 0.011


def tolerance_for(path: str) -> float:
    leaf = path.rsplit(".", 1)[-1]
    if leaf == "bpm":
        return 0.15
    return TOLERANCES.get(leaf, DEFAULT_DEPTH_TOL)


def _python_port() -> int:
    """Follow the launcher's random middleware pick; fallback 39107, then 8000."""
    temp_file = os.path.join(os.environ.get("TEMP", ""), "ee_middleware_port.txt")
    if os.path.isfile(temp_file):
        try:
            port = int(open(temp_file).read().strip())
            if 1024 < port < 65536:
                return port
        except (ValueError, OSError):
            pass
    return 39107


def main() -> int:
    # Windows console pipes may default to a legacy code page; keep symbol
    # payloads printable in the diff output.
    if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser()
    parser.add_argument("--python-base", default=f"http://127.0.0.1:{_python_port()}")
    parser.add_argument("--ts-base", default="http://127.0.0.1:3600")
    args = parser.parse_args()

    failures = 0
    for label, events in SCENARIOS:
        reset(args.python_base, SESSION)
        reset(args.ts_base, SESSION)
        print(f"\n=== {label} ===")
        for event in events:
            wall_delay = event[6] if len(event) > 6 else 0
            if wall_delay:
                time.sleep(wall_delay)
            body = payload(event, SESSION)
            py_response = post(args.python_base, body)
            ts_response = post(args.ts_base, body)

            problems: list[str] = []
            diff("action", py_response.get("action"), ts_response.get("action"), 0, problems)
            diff("asset_path", py_response.get("asset_path"), ts_response.get("asset_path"), 0, problems)
            diff("asset_type", py_response.get("asset_type"), ts_response.get("asset_type"), 0, problems)
            diff("soundtrack_path", py_response.get("soundtrack_path"), ts_response.get("soundtrack_path"), 0, problems)
            diff("ui_pulse", py_response.get("ui_pulse"), ts_response.get("ui_pulse"), 0, problems)
            diff("phase", py_response.get("phase"), ts_response.get("phase"), 0, problems)
            diff("volume", py_response.get("volume"), ts_response.get("volume"), tolerance_for("volume"), problems)
            diff("win_multiplier", py_response.get("win_multiplier"), ts_response.get("win_multiplier"), 0.011, problems)
            diff(
                "message",
                strip_freq(strip_suffix(py_response.get("message", ""))),
                strip_freq(strip_suffix(ts_response.get("message", ""))),
                0,
                problems,
            )
            diff("audio", py_response.get("audio"), ts_response.get("audio"), 0.011, problems)
            diff("bedtrack_path", py_response.get("bedtrack_path"), ts_response.get("bedtrack_path"), 0, problems)
            diff("bedtrack_volume", py_response.get("bedtrack_volume"), ts_response.get("bedtrack_volume"), tolerance_for("bedtrack_volume"), problems)
            diff("tempo", py_response.get("tempo"), ts_response.get("tempo"), 0, problems)
            diff("cadence_ms", py_response.get("cadence_ms"), ts_response.get("cadence_ms"), tolerance_for("cadence_ms"), problems)
            diff("losing_streak", py_response.get("losing_streak"), ts_response.get("losing_streak"), 0, problems)
            diff("win_streak", py_response.get("win_streak"), ts_response.get("win_streak"), 0, problems)
            diff("drought_tier", py_response.get("drought_tier"), ts_response.get("drought_tier"), 0, problems)
            diff("cues", py_response.get("cues"), ts_response.get("cues"), 0.15, problems)
            diff("light_program", py_response.get("light_program"), ts_response.get("light_program"), 0.011, problems)
            diff("close_call", py_response.get("close_call"), ts_response.get("close_call"), 0.011, problems)
            diff("suspense_total_ms", py_response.get("suspense_total_ms"), ts_response.get("suspense_total_ms"), tolerance_for("suspense_total_ms"), problems)
            diff("suspense_asset_path", py_response.get("suspense_asset_path"), ts_response.get("suspense_asset_path"), 0, problems)

            tag = f"[{event[0]} / {event[1]}]"
            if problems:
                failures += 1
                print(f"  {tag} MISMATCH ({len(problems)} field(s))")
                for problem in problems:
                    print(f"      {problem}")
            else:
                phase = py_response.get("phase")
                note = ""
                if phase == "idle":
                    note = "  -> idle (denied/skipped as expected)"
                elif phase == "suspend":
                    note = f"  -> cues={len(py_response.get('cues') or [])}"
                print(f"  {tag} ok{note}")

    print()
    if failures:
        print(f"PARITY: FAIL — {failures} mismatched directive(s)")
        return 1
    print("PARITY: PASS — every directive matches the Python engine")
    return 0


if __name__ == "__main__":
    sys.exit(main())
