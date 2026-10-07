# Experience Engine Middleware

The **Experience Engine** is the core middleware layer of the casino presentation pipeline. It ingests inbound simulated **GRIP events** from the slot machine game backend, recognizes the game outcome and player momentum, and allocates multi-track presentation directives (video, audio soundtrack, cabinet lighting pulses, and timed suspense programs).

All dramaturgy lives here. The frontend is an executor: it receives finished cue ladders and audio envelopes and plays them. It decides no timing and no intensity.

## Modules

| Module | Role |
|---|---|
| `main.py` | FastAPI surface; assembles and validates directives |
| `router.py` | The ordered pipeline: session → suspense → allocate → mood → finalize |
| `session.py` | Per-session pacing state: streaks, spin cadence, drought cooldown |
| `suspense.py` | Close-call detection and the escalating heartbeat/light cue ladder |
| `mood.py` | Player-speed audio profiles, drought bed ladder, lighting temperament |
| `asset_scanner.py` | Runtime media indexing, including suspense stings and music beds |
| `models.py` | Pydantic contract (inbound GRIP event, outbound directive) |

## The pipeline

1. **`session.ingest`** — fold this spin into the player's pacing history.
2. **`suspense.evaluate`** — for a `reels_spinning` probe, decide whether the pending outcome is a close call worth teasing, and build the cue ladder.
3. **`allocate`** — win/bet multiplier drives the celebration tier; under-classed payouts escalate; a live high-tier streak overrides.
4. **`mood.apply`** — player speed selects the audio envelope; a losing streak adds the bed and cools the lighting.
5. **`finalize`** — stamp pacing and suspense fields onto the directive.

## Running the Middleware Standalone

```powershell
cd middleware
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000                         # classic
python -m uvicorn main:app --reload --port 39107                        # unassigned pick (matches launch.bat)
```

## Endpoints

- `GET /` or `GET /health` — Health check
- `GET /api/events` — Enumeration of supported event types, spin phases, tempos, audio profiles, light patterns
- `POST /api/grip-event` — Primary GRIP event ingestion and sensory directive allocation
- `GET /api/assets?theme=wuxia` — Live scanned media catalog (videos, tiers, suspense stings, beds)
- `GET /api/sessions` — Every tracked pacing session (QA readout)
- `GET /api/session/{game_id}?session_id=…` — One session's tempo, streaks, and cadence
- `DELETE /api/session/{game_id}?session_id=…` — Reset a session bucket (QA reset, seat change)
- `GET /docs` — Interactive OpenAPI / Swagger UI

## Two-phase spin lifecycle

A spin is reported twice so the engine can act while the cabinet is still turning.

| Phase | Meaning | Engine behaviour |
|---|---|---|
| `reels_spinning` | Outcome known, reels still turning. Carries `reel_stop_ms[]`. | Returns `phase: "suspend"` with a cue ladder, or `phase: "idle"` if nothing is worth teasing. **Streaks and cadence are not touched** — the spin has not resolved. |
| `resolved` | The reels landed. | Advances all pacing state and allocates the video, sting, bed, and lighting. Returns `phase: "release"` if it was closing a suspense window. |

Cadence is measured from `resolved` events only. A probe and its resolve are one physical spin; counting both would report a double cadence for every cabinet on the floor.

## Close-call suspense

`detect_close_call()` classifies a pending outcome, most-specific rule first:

| Kind | Condition | Severity |
|---|---|---|
| `near_miss` | Leading reels lock while the final reel misses | 1–2 |
| `jackpot_tease` | 4+ premium symbols (💎/7) on the line | 3 |
| `scatter_tease` | 2+ scatters (⭐) already landed | 2–3 |

Severity sets the ladder's base BPM, rung count, and release flare. The ladder is anchored to the cabinet's reel stop offsets, so every reel landing lands on a beat:

```
cue @    0ms  heartbeat  84.0 bpm  breathe       CLOSE CALL detected
cue @1650ms  heartbeat 100.8 bpm  pulse         Reel 2 stops — pulse tightens
cue @2400ms  heartbeat 117.6 bpm  flash-soft    Reel 3 stops — pulse tightens
cue @3150ms  heartbeat 134.4 bpm  flash-hard    Reel 4 stops — pulse tightens
cue @3900ms  heartbeat 150.0 bpm  flash-strobe  Reel 5 stops — pulse tightens
cue @3900ms  release       0.0 bpm  flare        Final reel stops — heartbeat released
```

Dead spins and openings are never teased — a pulse that fires on nothing teaches the player it means nothing. `rapid` players get a ~12% faster pulse and clipped heartbeats.

### Suspense fatigue gate

`last_suspense_at` plus a rolling `suspense_times` deque drive `suspense_allowed()`:

- severity-scaled refractory — `15s / 10s / 5s` for severity `1 / 2 / 3`
- rolling tease budget — at most 3 ladders per 60s per session (cleared on `GAME_START`)
- a higher pending severity always cuts through a shorter predecessor's cooldown

Denied probes answer `phase: "idle"` with an audit message naming the policy ("refractory holds: …", "tease budget spent: …"), so QA sees *why* the drama was held back.

### Mood fusion before the ladder

`fuse_close_call()` rewrites (or drops) a tease against player context:

- `drought ≥ mild` → severity steps up one (`1→2`, `2→3`, cap 3): a near-miss after a drought means more
- `rapid` tempo + severity ≤ 1 + no drought → the tease is skipped outright; the spin window is too short for a weak pulse to land
- the ladder itself takes `drought_tier` + `post_win_cooldown`: `+5%` bpm per drought tier and `+0.03 / 0.06 / 0.09` starting volume (mild/deep/severe), suppressed right after a win

The fusion rationale rides in the probe message (`[drought-fused 1->2]`), and both the Python and TypeScript engines implement the identical policy (`backend/parity_check.py` covers it with the rapid-skip, fatigue, and drought-fusion scenarios).

## Adaptive pacing

**Player speed** — an EWMA (α=0.4) of inter-spin intervals from inbound timestamps:

| Tempo | Interval | Audio profile | Envelope |
|---|---|---|---|
| `rapid` | < 2200ms | `punchy` | 0.55x duration, 0ms attack, no tail, volume x1.05 |
| `steady` | 2200–4500ms | `standard` | 1.0x duration, 8ms attack |
| `deliberate` | > 4500ms | `standard` | 1.0x duration, 8ms attack |

**Losing streak** — consecutive zero-payout spins open a soft encouraging bed on its own audio channel, and cool the cabinet lighting:

| Streak | Tier | Bed | Lighting |
|---|---|---|---|
| 3+ | mild | 0.16 | cool (sky) |
| 6+ | deep | 0.24 | cool (sky) |
| 10+ | severe | 0.30, `consoling` audio | hushed (indigo) |

- The bed is capped at **0.35** — a responsible-design bound, not a tuning value. Ambient comfort never outranks a payout.
- A win closes the bed and holds it closed for 2 spins, so one immediate miss cannot make the music stutter.
- A deep drought steps the cabinet pulse down one notch. It only ever clamps downward: a drought must never make a dead spin louder than a win.
- `rapid` deliberately wins over `consoling`. A player hammering the button while losing gets short punchy audio, not a penalty that sounds like one.

The bed is synthesized in-browser unless the theme ships a file in `frontend/public/{theme}/bed/`, which `asset_scanner.py` picks up without a restart.

## Session state

Keyed by `(game_id, session_id)` so two browser tabs — or a CLI simulator beside a live cabinet — never bleed streaks into each other. `session_id` is optional; clients that omit it share the `game_id` bucket. `GAME_START` hard-resets.

## Demo scenarios

```powershell
cd backend
python simulate_events.py --scenario suspense   # close-call heartbeat + light flash
python simulate_events.py --scenario drought    # bed fades in, cabinet cools, win closes it
python simulate_events.py --scenario rapid      # punchy audio under fast spinning
python simulate_events.py --session my-seat --scenario streak
```

## TypeScript port (online demo)

rontend/app/api/_engine/ mirrors this module 1:1 in TypeScript (session pacing,
mood profiles, suspense ladders, the router pipeline) so the online demo runs the
whole engine inside one Next.js deployment instead of hosting Python. Local
development still uses THIS middleware via the ENGINE_URL rewrite that
launch.bat sets.

ackend/parity_check.py replays scripted GRIP sequences (drought, rapid, streak
override, escalation, close-call suspense) against both engines and diffs every
directive field within float-rounding tolerance. Run the middleware on the launcher's port (auto-read, fallback 39107) and

px next start --port 3600 (without ENGINE_URL, after 
ext build), then:

``powershell
cd backend
python parity_check.py --python-base http://127.0.0.1:8000 --ts-base http://127.0.0.1:3600
``

Asset tiering differs online: the TS port serves the static base catalog only
(the demo ships exactly those files), so esolve_asset always returns the base
clip and esolve_bed_asset returns "" (the frontend synthesizes the soft pad).
