"""CLI tool to simulate the LT Game Backend firing GRIP events to the Experience Engine.

Usage:
    python simulate_events.py --event BIG_WIN
    python simulate_events.py --spin
    python simulate_events.py --scenario streak
    python simulate_events.py --scenario suspense
    python simulate_events.py --scenario drought
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timezone

from game_engine import spin_reels

DEFAULT_ENDPOINT = "http://127.0.0.1:39107/api/grip-event"

# The launcher (launch.bat) picks the middleware port at runtime and writes it
# to %TEMP%\ee_middleware_port.txt. Read it so the CLI stays in sync without
# flags; 39107 is the fallback pick (an unassigned dynamic-range port normal
# tools do not grab), then the historical 8000.
def _middleware_port() -> int:
    temp_file = os.path.join(os.environ.get("TEMP", ""), "ee_middleware_port.txt")
    if os.path.isfile(temp_file):
        try:
            port = int(open(temp_file).read().strip())
            if 1024 < port < 65536:
                return port
        except (ValueError, OSError):
            pass
    return 39107


DEFAULT_ENDPOINT = f"http://127.0.0.1:{_middleware_port()}/api/grip-event"

# Cabinet reel stop schedule the middleware anchors its suspense ladder to.
# Mirrors the on-screen cabinet: 900ms base plus a 750ms stagger per reel.
REEL_STOP_MS = [900, 1650, 2400, 3150, 3900]

# Near-miss board that the middleware classifies as a close call.
CLOSE_CALL_SYMBOLS = ["7", "7", "7", "7", "🍒"]


def send_grip_event(payload: dict, endpoint: str = DEFAULT_ENDPOINT) -> dict:
    """Send JSON GRIP event payload to the Experience Engine middleware."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            result = json.loads(response.read().decode("utf-8"))
            print(f"[LT Game Backend -> Middleware] Dispatched: {payload['event_type']}"
                  f"  phase={payload.get('spin_phase', 'resolved')}")
            print(f"  Symbols: {payload.get('symbols')} | Bet: {payload.get('bet_amount')} | Win: {payload.get('win_amount')}")
            print(f"[Middleware Directive Received]")
            print(f"  Action: {result.get('action')} | Phase: {result.get('phase')} | Asset: {result.get('asset_path')}")
            print(f"  Soundtrack: {result.get('soundtrack_path')} | Pulse: {result.get('ui_pulse')}")
            print(f"  Tempo: {result.get('tempo')} ({result.get('cadence_ms')}ms) | "
                  f"Profile: {(result.get('audio') or {}).get('name')} | "
                  f"Drought: {result.get('losing_streak')} ({result.get('drought_tier')}) | "
                  f"Bed: {result.get('bedtrack_volume')}")
            close_call = result.get("close_call")
            if close_call:
                print(f"  Close call: {close_call.get('label')} "
                      f"[{close_call.get('kind')} sev={close_call.get('severity')}] "
                      f"{close_call.get('detail')}")
            for cue in result.get("cues") or []:
                print(f"    cue @{cue['at_ms']:>4}ms  {cue['kind']:<9} "
                      f"{cue['bpm']:>5.1f}bpm  {cue['light']:<11} "
                      f"vol={cue['volume']:.2f}  {cue['note']}")
            print(f"  Message: {result.get('message')}\n")
            return result
    except Exception as e:
        print(f"[ERROR] Failed to send GRIP event to {endpoint}: {e}")
        return {}


def _stamp(payload: dict, session_id: str) -> dict:
    """Attach a shared session id and a fresh timestamp to a payload."""
    payload["session_id"] = session_id
    payload["timestamp"] = datetime.now(timezone.utc).isoformat()
    payload.setdefault("event_id", str(uuid.uuid4()))
    return payload


def run_suspense(endpoint: str, bet: float, session_id: str) -> None:
    """Close-call suspense: probe while the reels turn, then resolve.

    Mirrors what the cabinet does on a real spin — one pre-resolution probe
    carrying the reel stop schedule, then the landed outcome. The middleware
    answers the first with a timed heartbeat/light ladder and the second with
    the release plus the celebration directive.
    """
    print("=== Close-Call Suspense Scenario (4 sevens, final reel misses) ===\n")
    spin_id = str(uuid.uuid4())

    probe = _stamp(
        {
            "event_type": "NEAR_WIN",
            "game_id": "SLOT-WUXIA-01",
            "theme": "wuxia",
            "bet_amount": bet,
            "win_amount": 0.0,
            "win_level": "NONE",
            "symbols": CLOSE_CALL_SYMBOLS,
            "event_id": spin_id,
            "spin_phase": "reels_spinning",
            "reel_stop_ms": REEL_STOP_MS,
        },
        session_id,
    )
    print("[Cabinet] Reels in motion — outcome known, final reel still spinning.\n")
    send_grip_event(probe, endpoint)

    time.sleep(1.6)
    print("[Cabinet] Final reel stops.\n")
    resolved = _stamp(
        {
            "event_type": "NEAR_WIN",
            "game_id": "SLOT-WUXIA-01",
            "theme": "wuxia",
            "bet_amount": bet,
            "win_amount": 0.0,
            "win_level": "NONE",
            "symbols": CLOSE_CALL_SYMBOLS,
            "event_id": spin_id,
            "spin_phase": "resolved",
        },
        session_id,
    )
    send_grip_event(resolved, endpoint)


def run_drought(endpoint: str, bet: float, session_id: str, spins: int = 8) -> None:
    """Losing streak: watch the bed fade in and the cabinet cool down."""
    print(f"=== Losing Streak Scenario ({spins} dead spins, then a win) ===\n")
    for index in range(spins):
        payload = _stamp(
            {
                "event_type": "NO_WIN",
                "game_id": "SLOT-WUXIA-01",
                "theme": "wuxia",
                "bet_amount": bet,
                "win_amount": 0.0,
                "win_level": "NONE",
                "symbols": ["🍒", "🍋", "🍇", "🔔", "BAR"],
            },
            session_id,
        )
        print(f"--- Spin {index + 1}/{spins + 1} ---")
        send_grip_event(payload, endpoint)
        time.sleep(1.2)

    print("--- Final spin: the drought breaks ---")
    payload = _stamp(spin_reels(bet_amount=bet, forced_event="BIG_WIN"), session_id)
    send_grip_event(payload, endpoint)


def run_rapid(endpoint: str, bet: float, session_id: str, spins: int = 6) -> None:
    """Fast spinning: cadence drops into the rapid band and audio gets punchy."""
    print(f"=== Rapid Spin Scenario ({spins} spins, ~0.6s apart) ===\n")
    for index in range(spins):
        payload = _stamp(
            {
                "event_type": "SPIN_RESULT",
                "game_id": "SLOT-WUXIA-01",
                "theme": "wuxia",
                "bet_amount": bet,
                "win_amount": 0.0,
                "win_level": "NONE",
                "symbols": ["🍒", "🍒", "🍇", "🔔", "BAR"],
            },
            session_id,
        )
        print(f"--- Spin {index + 1}/{spins} ---")
        send_grip_event(payload, endpoint)
        time.sleep(0.6)


def main():
    # Windows console pipes may default to a legacy code page; keep emoji symbols printable.
    if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Simulate LT Game backend firing GRIP events to the Experience Engine")
    parser.add_argument("--event", choices=["GAME_START", "SPIN_RESULT", "NO_WIN", "NEAR_WIN", "BONUS_TRIGGER", "BIG_WIN", "JACKPOT", "WIN_STREAK"], help="Fire specific event")
    parser.add_argument("--bet", type=float, default=25.0, help="Bet amount")
    parser.add_argument("--spin", action="store_true", help="Simulate a random reel spin")
    parser.add_argument("--scenario", choices=["streak", "intro", "jackpot", "suspense", "drought", "rapid"], help="Play predefined sequence")
    parser.add_argument("--session", default="cli-seat", help="Pacing session id (isolates streaks from the browser)")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help="Middleware API endpoint")

    args = parser.parse_args()

    if args.event:
        payload = spin_reels(bet_amount=args.bet, forced_event=args.event)
        send_grip_event(_stamp(payload, args.session), args.endpoint)
    elif args.scenario == "streak":
        print("=== Running Win Streak Demonstration Scenario ===")
        for ev in ["BIG_WIN", "BIG_WIN"]:
            payload = spin_reels(bet_amount=args.bet, forced_event=ev)
            send_grip_event(_stamp(payload, args.session), args.endpoint)
            time.sleep(2)
    elif args.scenario == "intro":
        print("=== Running Game Intro Scenario ===")
        for ev in ["GAME_START", "NO_WIN", "NEAR_WIN", "BONUS_TRIGGER"]:
            payload = spin_reels(bet_amount=args.bet, forced_event=ev)
            send_grip_event(_stamp(payload, args.session), args.endpoint)
            time.sleep(2)
    elif args.scenario == "suspense":
        run_suspense(args.endpoint, args.bet, args.session)
    elif args.scenario == "drought":
        run_drought(args.endpoint, args.bet, args.session)
    elif args.scenario == "rapid":
        run_rapid(args.endpoint, args.bet, args.session)
    elif args.spin or len(sys.argv) == 1:
        payload = spin_reels(bet_amount=args.bet)
        send_grip_event(_stamp(payload, args.session), args.endpoint)


if __name__ == "__main__":
    main()
