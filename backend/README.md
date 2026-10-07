# Simulated LT Game Backend (EGM / Game Server)

This directory simulates the **LT Game EGM (Electronic Gaming Machine) / Game Server** backend.

In production, this represents the physical or remote gaming machine that executes the slot machine math, determines RNG outcomes, and broadcasts standard **GRIP events** to the Experience Engine middleware.

## Files
- `game_engine.py` — RNG reel outcome generator, paytables, and symbol evaluation.
- `simulate_events.py` — CLI tool to dispatch simulated GRIP events to the Experience Engine middleware. It auto-follows the launcher's random port pick (`%TEMP%\ee_middleware_port.txt`, fallback 39107, the unassigned dynamic-range port `launch.bat` uses) via `--endpoint`, which overrides both.

## CLI Usage

```powershell
# Simulate a random slot spin
python simulate_events.py --spin

# Simulate a specific high-tier event
python simulate_events.py --event BIG_WIN --bet 50

# Simulate a win streak scenario (consecutive wins triggering state override)
python simulate_events.py --scenario streak
```
