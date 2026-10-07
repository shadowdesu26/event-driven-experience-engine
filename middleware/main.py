"""FastAPI middleware for the Casino Experience Engine PoC.

Exposes `/api/grip-event` to accept simulated GRIP event payloads and returns
directives telling the presentation player what visual, audio, and lighting
assets to trigger — including the timed suspense program used while the reels
are still turning and the adaptive pacing that tracks player speed and streaks.
"""

import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from asset_scanner import BED_SUBDIR, assets_root, safe_theme, scan_bed_assets, scan_theme_assets
from models import GripEvent, GripResponse
from router import route_event
from session import list_sessions, reset_session, session_key

VERSION = "0.4.0"

app = FastAPI(title="Experience Engine Middleware", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        # launch.bat's picked frontend port (39731+) plus legacy defaults.
        "http://localhost:39731",
        "http://127.0.0.1:39731",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/")
@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "experience-engine-middleware", "version": VERSION}




@app.get("/api/workers/status")
@app.get("/workers/status")
def workers_status() -> dict:
    return {"status": "ok", "workers": 1, "service": "experience-engine-middleware"}


@app.get("/api/events")
def list_events() -> dict:
    """Enum helper so clients can stay in sync with supported events."""
    from router import EVENT_ASSET_MAP

    return {
        "events": list(EVENT_ASSET_MAP.keys()),
        "spin_phases": ["reels_spinning", "resolved"],
        "tempos": ["rapid", "steady", "deliberate"],
        "audio_profiles": ["punchy", "standard", "consoling"],
        "light_patterns": [
            "none",
            "breathe",
            "pulse",
            "flash-soft",
            "flash-hard",
            "flash-strobe",
            "flare",
        ],
    }


@app.get("/api/assets")
@app.get("/assets")
def list_assets(theme: str = "wuxia") -> dict:
    """Live scanned asset catalog for the requested theme (QA / observability)."""
    safe = safe_theme(theme)
    catalog = scan_theme_assets(safe)
    return {
        "theme": safe,
        "root": str(assets_root()),
        "events": sorted(catalog["base"].keys()),
        "base": catalog["base"],
        "tiers": catalog["tiers"],
        "files": catalog["files"],
        "beds": scan_bed_assets(safe)["beds"],
        "bed_dir": f"/{safe}/{BED_SUBDIR}",
    }


@app.get("/api/sessions")
def get_sessions() -> dict:
    """Every tracked pacing session (tempo, streaks, cadence) — QA readout."""
    return {"sessions": list_sessions()}


@app.get("/api/session/{game_id}")
def get_session(game_id: str, session_id: str | None = None) -> dict:
    """Pacing state for one session bucket, creating it on first read."""
    from session import get_session as fetch_session

    state = fetch_session(game_id, session_id)
    return {"session": state.as_dict()}


@app.delete("/api/session/{game_id}")
def delete_session(game_id: str, session_id: str | None = None) -> dict:
    """Reset one session bucket (QA reset, seat change, new player)."""
    state = reset_session(game_id, session_id)
    return {"status": "reset", "session": state.as_dict()}


@app.post("/api/grip-event", response_model=GripResponse)
def grip_event(event: GripEvent) -> GripResponse:
    routed = route_event(event)
    return GripResponse(
        event_type=routed["event_type"],
        action=routed["action"],
        asset_path=routed["asset_path"],
        asset_type=routed["asset_type"],
        soundtrack_path=routed.get("soundtrack_path", ""),
        ui_pulse=routed.get("ui_pulse", "none"),
        volume=routed.get("volume", 0.7),
        win_multiplier=routed.get("win_multiplier", 0.0),
        message=(
            f"{routed['message']} "
            f"[event_id={event.event_id or str(uuid.uuid4())} "
            f"t={event.timestamp or datetime.now(timezone.utc).isoformat()}]"
        ),
        phase=routed.get("phase", "play"),
        audio=routed.get(
            "audio",
            {"name": "standard", "duration_scale": 1.0, "attack_ms": 8, "tail": True,
             "lowpass_hz": None, "volume_scale": 1.0, "bed_synth": "soft_pad"},
        ),
        bedtrack_path=routed.get("bedtrack_path", ""),
        bedtrack_volume=routed.get("bedtrack_volume", 0.0),
        tempo=routed.get("tempo", "steady"),
        cadence_ms=routed.get("cadence_ms", 0.0),
        losing_streak=routed.get("losing_streak", 0),
        win_streak=routed.get("win_streak", 0),
        drought_tier=routed.get("drought_tier", "none"),
        cues=routed.get("cues", []),
        light_program=routed.get(
            "light_program",
            {"pattern": "none", "period_ms": 0, "color": "amber", "intensity": 0.0,
             "temperament": "warm"},
        ),
        close_call=routed.get("close_call"),
        suspense_asset_path=routed.get("suspense_asset_path", ""),
        suspense_total_ms=routed.get("suspense_total_ms", 0),
        session_id=routed.get("session_id") or session_key(event.game_id, event.session_id)[1],
    )