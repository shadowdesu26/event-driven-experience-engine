"""Dynamic asset scanning for the Casino Experience Engine.

Indexes video files under the frontend public theme directories by event
keyword so media files can be renamed or swapped at runtime without editing
backend code. Falls back to the static EVENT_ASSET_MAP paths when a theme
directory or event keyword has no scan match.
"""

import os
import re
from pathlib import Path

# Root directory containing per-theme asset folders (e.g. frontend/public/wuxia).
# Override with the ASSETS_ROOT environment variable.
_DEFAULT_ROOT = Path(__file__).resolve().parent.parent / "frontend" / "public"

VIDEO_EXTENSIONS: frozenset[str] = frozenset({".mp4", ".webm", ".ogg", ".m4v", ".mov"})

# Multiplier tier suffix convention: wuxia_big_win_25x.mp4 -> BIG_WIN @ 25x tier.
TIER_SUFFIX_RE = re.compile(r"_(\d+)x$")

# Keyword matching priority: most specific first so substring collisions resolve
# correctly ("wuxia_win_streak" -> WIN_STREAK, not BIG_WIN; "wuxia_no_win" ->
# NO_WIN, not the bare "win" fallback).
KEYWORD_PRIORITY: tuple[tuple[str, str], ...] = (
    ("bonus_trigger", "BONUS_TRIGGER"),
    ("spin_result", "SPIN_RESULT"),
    ("win_streak", "WIN_STREAK"),
    ("game_start", "GAME_START"),
    ("near_win", "NEAR_WIN"),
    ("big_win", "BIG_WIN"),
    ("jackpot", "JACKPOT"),
    ("no_win", "NO_WIN"),
    ("win", "BIG_WIN"),
)

_SAFE_THEME_RE = re.compile(r"[A-Za-z0-9_-]+")

# theme -> (directory mtime at scan time, catalog). A changed mtime triggers a
# rescan, so renamed or swapped files are picked up without a restart.
_scan_cache: dict[str, tuple[float, dict]] = {}

_EMPTY_CATALOG: dict = {"base": {}, "tiers": {}, "files": []}


def assets_root() -> Path:
    override = os.environ.get("ASSETS_ROOT")
    if override:
        return Path(override)
    return _DEFAULT_ROOT


def safe_theme(theme: str | None) -> str:
    """Clamp the theme to a safe single path segment (falls back to 'wuxia')."""
    if theme and _SAFE_THEME_RE.fullmatch(theme):
        return theme
    return "wuxia"


def normalize_name(filename: str) -> str:
    """Lowercased stem with any multiplier tier suffix stripped."""
    return TIER_SUFFIX_RE.sub("", Path(filename).stem.lower())


def detect_tier(filename: str) -> int | None:
    """Multiplier tier parsed from a trailing _NNx suffix, if present."""
    match = TIER_SUFFIX_RE.search(Path(filename).stem.lower())
    return int(match.group(1)) if match else None


def match_event(name: str) -> str | None:
    """Map a normalized filename to its event type via most-specific keyword."""
    for keyword, event_type in KEYWORD_PRIORITY:
        if keyword in name:
            return event_type
    return None


def scan_theme_assets(theme: str) -> dict:
    """Scan the theme directory and build the asset catalog (mtime-cached).

    Returns a read-only-style catalog:
      {"base": {EVENT_TYPE: url_path}, "tiers": {EVENT_TYPE: {tier: url_path}}, "files": [url_path]}
    """
    directory = assets_root() / theme
    try:
        mtime = directory.stat().st_mtime
    except OSError:
        return _EMPTY_CATALOG

    cached = _scan_cache.get(theme)
    if cached and cached[0] == mtime:
        return cached[1]

    catalog: dict = {"base": {}, "tiers": {}, "files": []}
    try:
        entries = sorted(directory.iterdir())
    except OSError:
        _scan_cache[theme] = (mtime, dict(_EMPTY_CATALOG))
        return _scan_cache[theme][1]

    for entry in entries:
        if not entry.is_file() or entry.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        url_path = f"/{theme}/{entry.name}"
        catalog["files"].append(url_path)
        event_type = match_event(entry.stem.lower())
        if event_type is None:
            continue
        tier = detect_tier(entry.name)
        if tier is None:
            # Sorted order keeps base matches deterministic; first file wins.
            catalog["base"].setdefault(event_type, url_path)
        else:
            catalog["tiers"].setdefault(event_type, {}).setdefault(tier, url_path)

    _scan_cache[theme] = (mtime, catalog)
    return catalog


def resolve_asset(
    theme: str,
    event_type: str,
    multiplier: float | None,
    fallback: str = "",
) -> str:
    """Best matching asset URL path for an event at the given win multiplier.

    Picks the highest tier suffix <= multiplier when tier variants exist,
    otherwise the base file. Falls back to `fallback` (the static
    EVENT_ASSET_MAP path) when the scan has no match for the event.
    """
    catalog = scan_theme_assets(theme)
    base = catalog["base"].get(event_type)
    if base is None:
        return fallback
    if multiplier is not None:
        tiers = catalog["tiers"].get(event_type, {})
        eligible = [tier for tier in tiers if multiplier >= tier]
        if eligible:
            return tiers[max(eligible)]
    return base
