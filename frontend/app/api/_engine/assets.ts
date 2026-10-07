/**
 * TypeScript port of middleware/asset_scanner.py, reduced for the online demo.
 *
 * The Python middleware mtime-scans `frontend/public/{theme}/` for tiered
 * variants (e.g. `wuxia_big_win_25x.mp4`) and bed audio at request time. This
 * port serves the static base catalog only — the demo deployment ships exactly
 * those files — so resolution collapses to the base map:
 *
 * - `resolve_asset` always returns the event's base asset.
 * - `resolve_bed_asset` returns "" (no bed files shipped) which makes the
 *   frontend synthesize the soft pad — identical behaviour to the Python
 *   engine when no bed file is on disk.
 * - `resolve_suspense_asset` returns the NEAR_WIN fallback clip.
 */

import type { EventType } from "@/app/lib/api";

export const BED_SYNTH = "soft_pad";

export function safe_theme(theme: string | null | undefined): string {
  if (theme && /^[A-Za-z0-9_-]+$/.test(theme)) return theme;
  return "wuxia";
}

export function resolve_asset(
  _theme: string,
  event_type: string,
  _multiplier: number,
  fallback: string,
): string {
  void event_type;
  void _multiplier;
  return fallback;
}

export function resolve_bed_asset(_theme: string): string {
  void _theme;
  return "";
}

export function resolve_suspense_asset(_theme: string, fallback: string): string {
  void _theme;
  return fallback;
}

export type { EventType };
