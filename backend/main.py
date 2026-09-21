"""Simulated LT Game Backend Notice.

The Experience Engine middleware has moved to `../middleware/`.
This directory now contains the Simulated LT Game Backend (game_engine.py & simulate_events.py).

To launch the Experience Engine middleware:
    cd ../middleware
    python -m uvicorn main:app --reload --port 8000

To simulate LT Game EGM spin events:
    python simulate_events.py --spin
"""

if __name__ == "__main__":
    print("Experience Engine middleware has moved to '../middleware/'.")
    print("Run: cd ../middleware && python -m uvicorn main:app --reload --port 8000")
