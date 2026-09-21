# Casino Experience Engine — PoC

An event-driven middleware PoC that sits between a simulated slot machine backend
(LT Game EGM) and a dynamic audio-visual presentation frontend. Instead of static
`IF event X → play video X` lookups, the **Experience Engine** evaluates player
results, reel context, and streak momentum to allocate video, audio, and cabinet
lighting directives.

> Focus of this PoC is **system architecture** — a functional event-driven pipeline —
> not raw asset production. Assets are Wuxia-themed placeholders.

## Architecture

```
┌──────────────────────┐   GRIP event (JSON)   ┌──────────────────────┐   Directives (JSON)   ┌──────────────────────┐
│ backend/             │ ────────────────────► │ middleware/          │ ────────────────────► │ frontend/            │
│ Simulated LT Game    │  POST /api/grip-event │ Experience Engine    │  video / audio /      │ Experience Player    │
│ EGM simulator        │                       │ FastAPI + uvicorn    │  pulse / volume       │ Next.js 16 (React 19)│
└──────────────────────┘                       └──────────────────────┘                       └──────────────────────┘
```

| Layer | Path | Role |
|---|---|---|
| Simulated game backend | `backend/` | RNG reel outcomes, paytables, GRIP event dispatch (CLI) |
| **Experience Engine** | `middleware/` | Contextual allocation: win multiplier tiering, escalation, streak state machine, runtime asset scanning |
| Presentation frontend | `frontend/` | Slot cabinet UI, video player, Web Audio synthesis, cabinet pulse |

## Quick Start (Windows)

### One-Click Launch

```bat
launch.bat   :: starts middleware (:8000) + frontend (:3000), opens browser
close.bat    :: stops both services
```

### Manual Launch

```powershell
# Terminal 1 — Experience Engine Middleware
cd middleware
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000

# Terminal 2 — Presentation Frontend
cd frontend
npm install
npm run dev

# (Optional) Terminal 3 — Simulated LT Game Backend CLI
cd backend
python simulate_events.py --spin
```

Open [http://localhost:3000](http://localhost:3000).

## Sending GRIP Events

Three ways to fire events — all hit the same endpoint, no manual intervention
afterwards:

1. **Slot cabinet (auto)** — press `SPIN` on the on-screen machine; after reels land
   it computes the center-line symbols, payout, and win level, then dispatches.
2. **Manual trigger panel** — 8 color-coded buttons (GAME_START … WIN_STREAK) with
   realistic game-state presets.
3. **CLI backend simulator** —
   ```powershell
   cd backend
   python simulate_events.py --event NEAR_WIN          # fire one event
   python simulate_events.py --spin                    # random RNG outcome
   python simulate_events.py --scenario streak         # BIG_WIN x2 → streak override
   python simulate_events.py --scenario intro          # GAME_START → NO_WIN → NEAR_WIN → BONUS_TRIGGER
   ```

### Example: NEAR_WIN flow

`NEAR_WIN` payload arrives with `symbols: ["7","7","7","7","🍒"]` → the engine
recognizes the 4-symbol lock → responds with the tension video asset, tension
soundtrack, `subtle` UI pulse, volume `0.55` → the frontend auto-plays both.
Sending `BIG_WIN` then `BONUS_TRIGGER` back-to-back instead demonstrates the
**win-streak state override** (priority celebration asset at full volume).

## Event Allocation Matrix

| Event | Trigger | Video | Volume | UI Pulse |
|---|---|---|---|---|
| `GAME_START` | Session start | `wuxia_game_start.mp4` | 0.40 | subtle |
| `SPIN_RESULT` | Minor payline hit | `wuxia_spin_result.mp4` | 0.35–0.50 | none/subtle |
| `NO_WIN` | Dead spin | `WUXIA_NO_WIN.mp4` | 0.30 | none |
| `NEAR_WIN` | 4 matching symbols | `wuxia_near_win.mp4` | 0.55 | subtle |
| `BONUS_TRIGGER` | 3+ scatter ⭐ | `wuxia_bonus_trigger.mp4` | 0.75 | strong |
| `BIG_WIN` | Payout ≥ 10× bet | `wuxia_big_win.mp4` (+`_25x`/`_50x` tiers) | 0.80–1.00 | strong→full |
| `JACKPOT` | 5× "7" | `wuxia_jackpot.mp4` | 1.00 | full |
| `WIN_STREAK` | 2+ consecutive high-tier wins | `wuxia_win_streak.mp4` | 1.00 | full |

**Dynamic rules** (in `middleware/router.py`):
- `win_multiplier = win_amount / bet_amount` is computed for every event.
- Under-classed events (`SPIN_RESULT` / `NO_WIN` / `NEAR_WIN`) with a payout
  ≥ 10× bet **escalate** to the big-win celebration tier automatically.
- Tiered video variants (`_10x` / `_25x` / `_50x` suffixes) are selected by
  multiplier via `middleware/asset_scanner.py`, which scans
  `frontend/public/{theme}/` at runtime (mtime-cached — swap/rename files
  without restarting).

## API Endpoints (middleware, port 8000)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/grip-event` | Submit a GRIP event, receive a playback directive |
| `GET` | `/api/events` | List supported event types |
| `GET` | `/api/assets?theme=wuxia` | Live scanned asset catalog (QA / observability) |
| `GET` | `/api/health` | Health check |

## GRIP Event Payload (PoC — NOT the final specification)

```json
{
  "event_type": "NEAR_WIN",
  "game_id": "SLOT-WUXIA-01",
  "theme": "wuxia",
  "bet_amount": 25,
  "win_amount": 0,
  "win_level": "NONE",
  "symbols": ["7", "7", "7", "7", "🍒"],
  "event_id": "uuid",
  "timestamp": "ISO-8601"
}
```

Directive response adds: `action`, `asset_path`, `asset_type`,
`soundtrack_path`, `ui_pulse`, `volume` (0.0–1.0), `win_multiplier`, and a
`message` explaining the allocation rationale.

## Notes

- Video assets are AI-generated Wuxia placeholders in `frontend/public/wuxia/`.
- Audio is synthesized in-browser via the Web Audio API (zero-latency fallback;
  no audio files required).
- In a production / regulated environment, GLI-11/GLI-19 compliance applies:
  the engine is air-gapped from EGM RNG and consumes only certified assets.
