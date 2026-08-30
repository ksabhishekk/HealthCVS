"""
verification_cache.py
----------------------
Disk-persisted cache for NMC doctor-registration lookups. The Apify scrape
takes 1-5 minutes per doctor; without caching, every claim involving a
previously-seen doctor re-runs the full scrape from scratch, which is both
slow (kills demo pacing) and needless load on the NMC site/Apify quota.

Persisted to a JSON file (not just in-memory) so it survives a uvicorn
--reload restart during development/rehearsal — losing the cache on every
restart would defeat the point.

Two TTLs: successful verifications are trusted for 30 days (a doctor's
registration status doesn't change often); failed lookups are only cached
for 1 hour, so a transient network/Apify hiccup doesn't get "stuck" as a
false negative for a month.
"""
import json
import os
import time

CACHE_PATH = os.path.join(os.path.dirname(__file__), "doctor_verification_cache.json")
SUCCESS_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days
FAILURE_TTL_SECONDS = 60 * 60            # 1 hour


def _load() -> dict:
    if not os.path.exists(CACHE_PATH):
        return {}
    try:
        with open(CACHE_PATH, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save(cache: dict) -> None:
    try:
        with open(CACHE_PATH, "w") as f:
            json.dump(cache, f)
    except OSError as e:
        print(f"[WARN] Failed to persist doctor verification cache: {e}")


def get_cached(reg_no: str) -> tuple[bool, str] | None:
    """Returns (is_verified, doctor_name) if a fresh cache entry exists, else None."""
    cache = _load()
    entry = cache.get(reg_no)
    if not entry:
        return None

    ttl = SUCCESS_TTL_SECONDS if entry["ok"] else FAILURE_TTL_SECONDS
    if time.time() - entry["ts"] > ttl:
        return None

    return entry["ok"], entry["name"]


def set_cached(reg_no: str, ok: bool, name: str) -> None:
    cache = _load()
    cache[reg_no] = {"ok": ok, "name": name, "ts": time.time()}
    _save(cache)
