"""CLI tool to simulate the LT Game Backend firing GRIP events to the Experience Engine.

Usage:
    python simulate_events.py --event BIG_WIN
    python simulate_events.py --spin
    python simulate_events.py --scenario streak
"""

import argparse
import json
import sys
import time
import urllib.request

from game_engine import spin_reels

DEFAULT_ENDPOINT = "http://127.0.0.1:8000/api/grip-event"


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
            print(f"[LT Game Backend -> Middleware] Dispatched: {payload['event_type']}")
            print(f"  Symbols: {payload.get('symbols')} | Bet: {payload.get('bet_amount')} | Win: {payload.get('win_amount')}")
            print(f"[Middleware Directive Received]")
            print(f"  Action: {result.get('action')} | Asset: {result.get('asset_path')}")
            print(f"  Soundtrack: {result.get('soundtrack_path')} | Pulse: {result.get('ui_pulse')}")
            print(f"  Message: {result.get('message')}\n")
            return result
    except Exception as e:
        print(f"[ERROR] Failed to send GRIP event to {endpoint}: {e}")
        return {}


def main():
    # Windows console pipes may default to a legacy code page; keep emoji symbols printable.
    if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Simulate LT Game backend firing GRIP events to the Experience Engine")
    parser.add_argument("--event", choices=["GAME_START", "SPIN_RESULT", "NO_WIN", "NEAR_WIN", "BONUS_TRIGGER", "BIG_WIN", "JACKPOT", "WIN_STREAK"], help="Fire specific event")
    parser.add_argument("--bet", type=float, default=25.0, help="Bet amount")
    parser.add_argument("--spin", action="store_true", help="Simulate a random reel spin")
    parser.add_argument("--scenario", choices=["streak", "intro", "jackpot"], help="Play predefined sequence")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help="Middleware API endpoint")

    args = parser.parse_args()

    if args.event:
        payload = spin_reels(bet_amount=args.bet, forced_event=args.event)
        send_grip_event(payload, args.endpoint)
    elif args.scenario == "streak":
        print("=== Running Win Streak Demonstration Scenario ===")
        events = ["BIG_WIN", "BIG_WIN"]
        for ev in events:
            payload = spin_reels(bet_amount=args.bet, forced_event=ev)
            send_grip_event(payload, args.endpoint)
            time.sleep(2)
    elif args.scenario == "intro":
        print("=== Running Game Intro Scenario ===")
        events = ["GAME_START", "NO_WIN", "NEAR_WIN", "BONUS_TRIGGER"]
        for ev in events:
            payload = spin_reels(bet_amount=args.bet, forced_event=ev)
            send_grip_event(payload, args.endpoint)
            time.sleep(2)
    elif args.spin or len(sys.argv) == 1:
        payload = spin_reels(bet_amount=args.bet)
        send_grip_event(payload, args.endpoint)


if __name__ == "__main__":
    main()
