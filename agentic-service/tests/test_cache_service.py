"""
Tests for services/cache_service.py

Covers:
  - make_cache_key determinism & normalization
  - get_cached / set_cached round-trip (in-memory only, no Redis)
  - invalidate removes entries
  - cache_stats returns expected structure
  - TTL-based cache sizing
"""
import hashlib
import pytest
from unittest.mock import patch, MagicMock

# Patch config.settings before importing cache_service
import os, sys

_service_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _service_root not in sys.path:
    sys.path.insert(0, _service_root)


# ---------------------------------------------------------------------------
# Reset module-level singletons between tests
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _reset_cache_singletons():
    """Reset module-level cache globals so each test starts fresh."""
    import services.cache_service as cs
    cs._mem_cache = None
    cs._redis_client = None
    yield
    cs._mem_cache = None
    cs._redis_client = None


# ===================================================================
# make_cache_key
# ===================================================================
class TestMakeCacheKey:
    def test_deterministic(self):
        """Same inputs produce the same key."""
        from services.cache_service import make_cache_key
        k1 = make_cache_key("Paris", "France", 3, 2000, {"culture": True, "food": True})
        k2 = make_cache_key("Paris", "France", 3, 2000, {"culture": True, "food": True})
        assert k1 == k2

    def test_case_insensitive_city(self):
        """City name is normalized to lowercase."""
        from services.cache_service import make_cache_key
        k1 = make_cache_key("PARIS", "France", 3, 2000, None)
        k2 = make_cache_key("paris", "France", 3, 2000, None)
        assert k1 == k2

    def test_whitespace_trimmed(self):
        """Leading/trailing whitespace is stripped."""
        from services.cache_service import make_cache_key
        k1 = make_cache_key("  Paris  ", "  France  ", 3, 2000, None)
        k2 = make_cache_key("Paris", "France", 3, 2000, None)
        assert k1 == k2

    def test_different_days_different_key(self):
        """Different day counts produce different keys."""
        from services.cache_service import make_cache_key
        k1 = make_cache_key("Paris", "France", 3, 2000, None)
        k2 = make_cache_key("Paris", "France", 5, 2000, None)
        assert k1 != k2

    def test_different_budget_different_key(self):
        """Different budgets produce different keys."""
        from services.cache_service import make_cache_key
        k1 = make_cache_key("Paris", "France", 3, 1000, None)
        k2 = make_cache_key("Paris", "France", 3, 5000, None)
        assert k1 != k2

    def test_none_budget_uses_flex(self):
        """None budget maps to 'flex'."""
        from services.cache_service import make_cache_key
        k1 = make_cache_key("Paris", "France", 3, None, None)
        # Manually compute expected
        raw = "paris|france|3|flex|"
        expected = hashlib.sha256(raw.encode()).hexdigest()[:24]
        assert k1 == expected

    def test_preferences_sorted(self):
        """Preference dict keys are sorted so order doesn't matter."""
        from services.cache_service import make_cache_key
        k1 = make_cache_key("Paris", "France", 3, 2000, {"food": True, "culture": True})
        k2 = make_cache_key("Paris", "France", 3, 2000, {"culture": True, "food": True})
        assert k1 == k2

    def test_preferences_list(self):
        """Preferences passed as list are also handled."""
        from services.cache_service import make_cache_key
        k1 = make_cache_key("Paris", "France", 3, 2000, ["food", "culture"])
        k2 = make_cache_key("Paris", "France", 3, 2000, ["culture", "food"])
        assert k1 == k2

    def test_falsy_prefs_ignored(self):
        """Only truthy preference values contribute to the key."""
        from services.cache_service import make_cache_key
        k1 = make_cache_key("Paris", "France", 3, 2000, {"culture": True, "sports": False})
        k2 = make_cache_key("Paris", "France", 3, 2000, {"culture": True})
        assert k1 == k2

    def test_key_length(self):
        """Key is always 24 hex characters."""
        from services.cache_service import make_cache_key
        k = make_cache_key("Tokyo", "Japan", 5, 3000, {"history": True})
        assert len(k) == 24
        assert all(c in "0123456789abcdef" for c in k)


# ===================================================================
# get_cached / set_cached round-trip (memory only)
# ===================================================================
class TestCacheGetSet:
    def test_miss_returns_none(self):
        """A cache miss returns None."""
        from services.cache_service import get_cached
        assert get_cached("nonexistent_key_12345678") is None

    def test_roundtrip(self):
        """set_cached followed by get_cached returns identical data."""
        from services.cache_service import get_cached, set_cached
        data = {"tour": {"city": "Paris"}, "status": "completed"}
        set_cached("test_key_roundtrip_001", data)
        result = get_cached("test_key_roundtrip_001")
        assert result == data

    def test_overwrite(self):
        """Setting the same key again overwrites the value."""
        from services.cache_service import get_cached, set_cached
        set_cached("test_key_overwrite", {"v": 1})
        set_cached("test_key_overwrite", {"v": 2})
        result = get_cached("test_key_overwrite")
        assert result["v"] == 2

    def test_different_keys_independent(self):
        """Different keys store independent values."""
        from services.cache_service import get_cached, set_cached
        set_cached("key_a_independent", {"city": "Paris"})
        set_cached("key_b_independent", {"city": "Tokyo"})
        assert get_cached("key_a_independent")["city"] == "Paris"
        assert get_cached("key_b_independent")["city"] == "Tokyo"


# ===================================================================
# invalidate
# ===================================================================
class TestInvalidate:
    def test_invalidate_removes_entry(self):
        """Invalidate removes the entry from memory cache."""
        from services.cache_service import get_cached, set_cached, invalidate
        set_cached("key_to_invalidate", {"data": True})
        assert get_cached("key_to_invalidate") is not None
        invalidate("key_to_invalidate")
        assert get_cached("key_to_invalidate") is None

    def test_invalidate_nonexistent_key_no_error(self):
        """Invalidating a key that doesn't exist doesn't raise."""
        from services.cache_service import invalidate
        invalidate("totally_missing_key")  # should not raise


# ===================================================================
# cache_stats
# ===================================================================
class TestCacheStats:
    def test_stats_structure(self):
        """cache_stats returns expected keys."""
        from services.cache_service import cache_stats
        stats = cache_stats()
        assert "memory_size" in stats
        assert "memory_maxsize" in stats
        assert "memory_ttl" in stats
        assert "redis_connected" in stats

    def test_stats_reflect_insertions(self):
        """Stats memory_size grows after inserting entries."""
        from services.cache_service import cache_stats, set_cached
        initial = cache_stats()["memory_size"]
        set_cached("stats_test_key_a", {"a": 1})
        set_cached("stats_test_key_b", {"b": 2})
        after = cache_stats()["memory_size"]
        assert after == initial + 2

    def test_stats_maxsize(self):
        """Maxsize matches the configured value (512)."""
        from services.cache_service import cache_stats
        stats = cache_stats()
        assert stats["memory_maxsize"] == 512

    def test_stats_redis_false_without_redis(self):
        """Without Redis configured, redis_connected is False."""
        from services.cache_service import cache_stats
        stats = cache_stats()
        assert stats["redis_connected"] is False
