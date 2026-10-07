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
| **Experience Engine** | `middleware/` | Contextual allocation: win multiplier tiering, escalation, streak state machine, close-call suspense, adaptive pacing, runtime asset scanning |
| Presentation frontend | `frontend/` | Slot cabinet UI, video player, Web Audio synthesis, cue runner, cabinet lighting |

## Quick Start (Windows)

### One-Click Launch

```bat
launch.bat   :: starts middleware (random port, 39107+) + frontend (random port, 39731+), opens browser
close.bat    :: stops both services (reads the same port files the launcher wrote)
```

### Manual Launch

```powershell
# Terminal 1 — Experience Engine Middleware
# (any free port works; 39107 keeps clear of tools that grab common ports)
cd middleware
pip install -r requirements.txt
$env:ENGINE_PORT = 39107
python -m uvicorn main:app --reload --port $env:ENGINE_PORT
# launch.bat writes its actual pick to %TEMP%\ee_middleware_port.txt

# Terminal 2 — Presentation Frontend
cd frontend
npm install
$env:ENGINE_URL = "http://127.0.0.1:39107"   # point /api/* at the middleware
npm run dev -- --port 39731                  # launch.bat writes its pick to %TEMP%\ee_frontend_port.txt

# (Optional) Terminal 3 — Simulated LT Game Backend CLI
cd backend
python simulate_events.py --spin
```

Open [http://localhost:39731](http://localhost:39731).

## Online Demo (Netlify)

The whole demo ships as **one Next.js app**: the presentation frontend plus a
TypeScript port of the Experience Engine served from `frontend/app/api/` route
handlers — no separate Python host needed online. The board's **Experience
Engine On/Off** toggle (top center) is the A/B switch:

- **ON (event-driven)** — the engine probes the spin before the reels land and
  returns contextual directives: close-call heartbeat ladders anchored to reel
  stops, punchy/consoling audio envelopes from player cadence, encouraging beds
  during losing streaks, streak state overrides, and escalation past 10x bet.
- **OFF (static if/else)** — a plain client-side handler picks one fixed clip
  and one canned win/loss sound per event type. Same results, zero context.

### Deploy it

```powershell
# Prereq: push this repo to GitHub, then either
#   a) netlify.com → "Add new site" → "Import an existing project" → pick the repo
#      (netlify.toml sets base=frontend, the build command, and the Next plugin), or
#   b) from the repo root:  npx netlify-cli deploy --build --prod
```

No environment variables are needed for the online build — with `ENGINE_URL`
unset, `/api/*` falls through to the built-in TypeScript engine.

### Local vs online engine

| Mode | Engine | How |
|---|---|---|
| Local dev (`launch.bat`) | Python middleware (reference) | sets `ENGINE_URL=http://127.0.0.1:<random pick from 39107+>`; `/api/*` rewrites to it |
| `npm run dev` / `next start` without `ENGINE_URL` | Built-in TypeScript engine | `frontend/app/api/_engine/` |
| Online (Netlify) | Built-in TypeScript engine | same, HTTPS, public URL |

The TS port mirrors the Python policy 1:1 (streaks, cadence EWMA, suspense
ladders, audio profiles, pacing rationale); `backend/parity_check.py` replays
scripted sequences against both engines and diffs every directive field
(currently: all match). Note the demo's session state is per-serverless-
instance — streak/cadence state is best treated as per-warm-instance, which is
fine for a demo.

## Sending GRIP Events

Three ways to fire events — all hit the same endpoint, no manual intervention
afterwards:

1. **Slot cabinet (auto)** — press `SPIN` on the on-screen machine. It reports the
   spin twice: once the outcome is known but the reels are still turning
   (`spin_phase: "reels_spinning"`), then again when they land
   (`spin_phase: "resolved"`). Reels stop 0.75s apart so every reel's landing
   sound gets its own moment.
2. **Manual trigger panel** — 8 color-coded buttons (GAME_START … WIN_STREAK) with
   realistic game-state presets.
3. **CLI backend simulator** —
   ```powershell
   cd backend
   # ENGINE_PORT follows the launcher's random pick; fall back to 8000.
   if (-not $env:ENGINE_PORT) { if (Test-Path "$env:TEMP\ee_middleware_port.txt") { $env:ENGINE_PORT = (Get-Content "$env:TEMP\ee_middleware_port.txt" -Raw).Trim() } else { $env:ENGINE_PORT = 8000 } }
   python simulate_events.py --event NEAR_WIN --endpoint "http://127.0.0.1:$env:ENGINE_PORT/api/grip-event"
   python simulate_events.py --spin          --endpoint "http://127.0.0.1:$env:ENGINE_PORT/api/grip-event"
   python simulate_events.py --scenario streak   --endpoint "http://127.0.0.1:$env:ENGINE_PORT/api/grip-event"
   python simulate_events.py --scenario intro    --endpoint "http://127.0.0.1:$env:ENGINE_PORT/api/grip-event"
   python simulate_events.py --scenario suspense --endpoint "http://127.0.0.1:$env:ENGINE_PORT/api/grip-event"
   python simulate_events.py --scenario drought  --endpoint "http://127.0.0.1:$env:ENGINE_PORT/api/grip-event"
   python simulate_events.py --scenario rapid    --endpoint "http://127.0.0.1:$env:ENGINE_PORT/api/grip-event"
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

### Suspense and pacing rules

- **Close-call suspense** — a `reels_spinning` probe whose symbols show a near
  miss, a premium lock, or early scatters returns a timed cue ladder instead of a
  playback directive. The heartbeat escalates (84 → 150 bpm on a four-sevens
  miss) and the lights step up `breathe → pulse → flash-soft → flash-hard →
  flash-strobe`, with a release flare on the final reel stop. Ladders are
  anchored to the cabinet's reel stop offsets so every reel lands on a beat.
- **Player speed** — smoothed inter-spin cadence picks the audio envelope.
  Under 2200 ms/spin the player is `rapid` and audio becomes short and punchy
  (0.55× duration, no tail). This deliberately outranks the drought bed: a
  player hammering the button while losing should not be handed a long tail.
- **Losing streaks** — three consecutive zero-payout spins fade in a soft
  encouraging bed on its own audio channel (0.16 → 0.24 → 0.30), deepen the
  audio envelope, and cool the cabinet from amber to sky to indigo. A win closes
  the bed and holds it closed for two spins. The bed is hard-capped at 0.35.

Full detail, including the pipeline order and the two-phase spin lifecycle, is in
[`middleware/README.md`](middleware/README.md).

### Suspense fatigue, mood fusion, and win prominence

- **Fatigue gate** — a seat that was just teased must rest: severity-scaled
  refractory (`15s/10s/5s` for severity `1/2/3`) plus a rolling budget of three
  ladders per minute per session. A denied probe answers `phase: idle` with an
  audit message instead of silently dropping the seat's drama budget. Higher
  severity cuts through a shorter predecessor's cooldown.
- **Mood fusion** — the drought and tempo rewrite a tease before it is
  scheduled: a losing streak (`drought ≥ mild`) escalates weak teases one
  severity tier (`1→2`, `2→3`), while a `rapid` player with no drought gets no
  weak tease at all (the spin window is too short for it to land). Drought
  depth also shapes the ladder: `+5%` bpm per drought tier and `+0.03/0.06/0.09`
  starting volume — suppressed during the post-win cooldown.
- **Win prominence** — a paying spin is never attenuated by its pacing profile:
  the consoling envelope softens drought spins, but the moment a spin pays its
  volume floor returns to standard, so a big win after a long losing streak
  still lands loudly (punchy's rapid-player boost stays).
- **Cabinet rim glow** — the engine's `light_program` renders as a thin colored
  ring and soft border glow on the machine (intensity clamped ≤ 0.5), following
  the cue ladder. Engine OFF leaves the rim dark.

## API Endpoints (middleware)

The local middleware port is **picked at launch time** — `launch.bat` scans for a
free port in the unassigned dynamic range (starting at **39107**, a port normal
apps almost never bind) and writes the winner to
`%TEMP%\ee_middleware_port.txt`. Old default 8000 still works if you start the
middleware manually.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/grip-event` | Submit a GRIP event, receive a playback directive |
| `GET` | `/api/events` | List supported event types, phases, tempos, profiles, light patterns |
| `GET` | `/api/assets?theme=wuxia` | Live scanned asset catalog (QA / observability) |
| `GET` | `/api/sessions` | Every tracked pacing session |
| `GET` | `/api/session/{game_id}` | One session's tempo, streaks, and cadence |
| `DELETE` | `/api/session/{game_id}` | Reset a session bucket |
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
  "session_id": "browser-tab-uuid",
  "spin_phase": "resolved",
  "reel_stop_ms": [900, 1650, 2400, 3150, 3900],
  "event_id": "uuid",
  "timestamp": "ISO-8601"
}
```

Directive response adds: `action`, `asset_path`, `asset_type`,
`soundtrack_path`, `ui_pulse`, `volume` (0.0–1.0), `win_multiplier`, and a
`message` explaining the allocation rationale, plus the pacing and suspense
fields: `phase`, `audio`, `bedtrack_path`, `bedtrack_volume`, `tempo`,
`cadence_ms`, `losing_streak`, `win_streak`, `drought_tier`, `cues`,
`light_program`, `close_call`, `suspense_asset_path`, `suspense_total_ms`, and
`session_id`.

Every added field has a default that reproduces the previous behaviour, so an
older client that sends nothing still gets a valid directive.

## Notes

- Video assets are AI-generated Wuxia placeholders in `frontend/public/wuxia/`.
- Audio is synthesized in-browser via the Web Audio API (zero-latency fallback;
  no audio files required).
- In a production / regulated environment, GLI-11/GLI-19 compliance applies:
  the engine is air-gapped from EGM RNG and consumes only certified assets.
