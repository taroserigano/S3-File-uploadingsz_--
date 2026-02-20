"""
Multi-tier caching service for itinerary responses.

Tier 1: In-memory LRU cache (cachetools TTLCache) – instant, per-process.
Tier 2: Redis – shared across processes/deployments, optional.

Cache key = sha256(city|country|days|budget|sorted_prefs)
"""
import hashlib
import logging
from typing import Any, Dict, Optional

try:
    import orjson

    def _dumps(obj: Any) -> str:
        return orjson.dumps(obj).decode()

    def _loads(raw: str) -> Any:
        return orjson.loads(raw)
except ImportError:
    import json

    def _dumps(obj: Any) -> str:
        return json.dumps(obj, sort_keys=True)

    def _loads(raw: str) -> Any:
        return json.loads(raw)

from cachetools import TTLCache

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Redis helper – optional
# ---------------------------------------------------------------------------
_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        from config import settings
        if not settings.redis_url:
            return None
        import redis
        _redis_client = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        _redis_client.ping()
        logger.info("Redis cache connected")
        return _redis_client
    except Exception as exc:
        logger.warning(f"Redis unavailable, using in-memory only: {exc}")
        _redis_client = False  # sentinel so we don't retry
        return None


# ---------------------------------------------------------------------------
# In-memory LRU with TTL
# ---------------------------------------------------------------------------
_mem_cache: TTLCache = None  # type: ignore


def _get_mem_cache() -> TTLCache:
    global _mem_cache
    if _mem_cache is None:
        from config import settings
        _mem_cache = TTLCache(maxsize=512, ttl=settings.cache_ttl_seconds)
    return _mem_cache


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def make_cache_key(
    city: str,
    country: str,
    days: int,
    budget: Optional[float],
    preferences: Optional[Dict[str, Any]],
) -> str:
    """Deterministic cache key from request parameters."""
    norm_city = city.strip().lower()
    norm_country = (country or "").strip().lower()
    budget_str = f"{budget:.0f}" if budget else "flex"
    if isinstance(preferences, dict):
        pref_str = ",".join(sorted(k for k, v in preferences.items() if v))
    elif isinstance(preferences, list):
        pref_str = ",".join(sorted(preferences))
    else:
        pref_str = ""
    raw = f"{norm_city}|{norm_country}|{days}|{budget_str}|{pref_str}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def get_cached(key: str) -> Optional[Dict[str, Any]]:
    """Try to fetch from mem cache, then Redis."""
    # Tier 1: memory
    mem = _get_mem_cache()
    if key in mem:
        logger.info(f"Cache HIT (memory): {key}")
        return mem[key]

    # Tier 2: Redis
    r = _get_redis()
    if r:
        try:
            raw = r.get(f"itinerary:{key}")
            if raw:
                data = _loads(raw)
                # Promote into mem cache
                mem[key] = data
                logger.info(f"Cache HIT (Redis): {key}")
                return data
        except Exception as exc:
            logger.warning(f"Redis get failed: {exc}")

    return None


def set_cached(key: str, data: Dict[str, Any]) -> None:
    """Store in both mem cache and Redis."""
    mem = _get_mem_cache()
    mem[key] = data

    r = _get_redis()
    if r:
        try:
            from config import settings
            r.setex(f"itinerary:{key}", settings.cache_ttl_seconds, _dumps(data))
            logger.info(f"Cache SET (memory+Redis): {key}")
        except Exception as exc:
            logger.warning(f"Redis set failed: {exc}")
    else:
        logger.info(f"Cache SET (memory only): {key}")


def invalidate(key: str) -> None:
    """Remove from both caches."""
    mem = _get_mem_cache()
    mem.pop(key, None)
    r = _get_redis()
    if r:
        try:
            r.delete(f"itinerary:{key}")
        except Exception:
            pass


def cache_stats() -> Dict[str, Any]:
    """Return cache statistics for monitoring."""
    mem = _get_mem_cache()
    stats = {
        "memory_size": len(mem),
        "memory_maxsize": mem.maxsize,
        "memory_ttl": mem.ttl,
    }
    r = _get_redis()
    if r:
        try:
            info = r.info("keyspace")
            stats["redis_connected"] = True
            stats["redis_keys"] = info
        except Exception:
            stats["redis_connected"] = False
    else:
        stats["redis_connected"] = False
    return stats
