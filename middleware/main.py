"""FastAPI middleware for the Casino Experience Engine PoC.

Exposes `/api/grip-event` to accept simulated GRIP event payloads
and returns directives telling the presentation player what visual,
audio, and lighting assets to trigger.
"""

import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from models import GripEvent, GripResponse
from router import route_event

app = FastAPI(title="Experience Engine Middleware", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/")
@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "experience-engine-middleware", "version": "0.3.0"}


@app.get("/api/workers/status")
@app.get("/workers/status")
def workers_status() -> dict:
    return {"status": "ok", "workers": 1, "service": "experience-engine-middleware"}


@app.get("/api/events")
def list_events() -> dict:
    """Enum helper so clients can stay in sync with supported events."""
    from router import EVENT_ASSET_MAP

    return {"events": list(EVENT_ASSET_MAP.keys())}


@app.get("/api/assets")
@app.get("/assets")
def list_assets(theme: str = "wuxia") -> dict:
    """Live scanned asset catalog for the requested theme (QA / observability)."""
    from asset_scanner import assets_root, safe_theme, scan_theme_assets

    safe = safe_theme(theme)
    catalog = scan_theme_assets(safe)
    return {
        "theme": safe,
        "root": str(assets_root()),
        "events": sorted(catalog["base"].keys()),
        "base": catalog["base"],
        "tiers": catalog["tiers"],
        "files": catalog["files"],
    }


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
    )
