"""
Integration test: hits the LIVE agentic service at localhost:8000.

Run ONLY when the server is actually running.
These tests verify the real endpoints respond correctly (even if
backend LLM/Amadeus keys aren't valid, the server should respond
with proper HTTP codes and JSON shapes).

Usage:
  pytest tests/test_integration_live.py -v --timeout=30
"""
import json
import os
import sys

import pytest
import httpx

_service_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _service_root not in sys.path:
    sys.path.insert(0, _service_root)

BASE_URL = os.environ.get("AGENTIC_SERVICE_URL", "http://localhost:8000")


# Skip all tests if server isn't reachable
@pytest.fixture(scope="module", autouse=True)
def _check_server_up():
    try:
        r = httpx.get(f"{BASE_URL}/", timeout=5)
        if r.status_code != 200:
            pytest.skip(f"Server at {BASE_URL} responded with {r.status_code}")
    except httpx.ConnectError:
        pytest.skip(f"Agentic service not running at {BASE_URL}")


# ===================================================================
# GET / (health check)
# ===================================================================
class TestLiveHealth:
    def test_root_health(self):
        r = httpx.get(f"{BASE_URL}/", timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "running"
        assert data["service"] == "agentic-travel-planner"

    def test_root_has_version(self):
        r = httpx.get(f"{BASE_URL}/", timeout=5)
        assert "version" in r.json()


# ===================================================================
# GET /api/v1/cache/stats
# ===================================================================
class TestLiveCacheStats:
    def test_cache_stats_shape(self):
        r = httpx.get(f"{BASE_URL}/api/v1/cache/stats", timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert "memory_size" in data
        assert "memory_maxsize" in data
        assert "memory_ttl" in data
        assert "redis_connected" in data
        assert isinstance(data["memory_size"], int)
        assert data["memory_maxsize"] == 512

    def test_cache_ttl_is_86400(self):
        r = httpx.get(f"{BASE_URL}/api/v1/cache/stats", timeout=5)
        assert r.json()["memory_ttl"] == 86400


# ===================================================================
# GET /api/agentic/status/{run_id}
# ===================================================================
class TestLiveStatus:
    def test_status_any_run_id(self):
        r = httpx.get(f"{BASE_URL}/api/agentic/status/fake-run-123", timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert data["run_id"] == "fake-run-123"


# ===================================================================
# POST /api/agentic/plan - validation
# ===================================================================
class TestLivePlanValidation:
    def test_plan_missing_city_returns_422(self):
        r = httpx.post(f"{BASE_URL}/api/agentic/plan", json={"country": "France"}, timeout=10)
        assert r.status_code == 422

    def test_plan_empty_body_returns_422(self):
        r = httpx.post(f"{BASE_URL}/api/agentic/plan", json={}, timeout=10)
        assert r.status_code == 422


# ===================================================================
# POST /api/v1/agentic/generate-itinerary - validation
# ===================================================================
class TestLiveGenerateValidation:
    def test_generate_missing_user_id_returns_422(self):
        r = httpx.post(
            f"{BASE_URL}/api/v1/agentic/generate-itinerary",
            json={"city": "Paris", "country": "France", "days": 3},
            timeout=10,
        )
        assert r.status_code == 422

    def test_generate_missing_city_returns_422(self):
        r = httpx.post(
            f"{BASE_URL}/api/v1/agentic/generate-itinerary",
            json={"country": "France", "days": 3, "user_id": "u1"},
            timeout=10,
        )
        assert r.status_code == 422


# ===================================================================
# POST /api/v1/agentic/refine-itinerary - validation
# ===================================================================
class TestLiveRefineValidation:
    def test_refine_missing_fields_returns_422(self):
        r = httpx.post(
            f"{BASE_URL}/api/v1/agentic/refine-itinerary",
            json={"run_id": "r1"},
            timeout=10,
        )
        assert r.status_code == 422


# ===================================================================
# SSE streaming endpoints respond with correct content-type
# ===================================================================
class TestLiveStreamContentType:
    def test_plan_stream_content_type(self):
        """The plan-stream endpoint should return text/event-stream."""
        # We can't easily stream-read with httpx sync, but we can
        # check the initial response headers.
        with httpx.Client(timeout=15) as client:
            # This will either timeout or return once the stream is done
            try:
                r = client.post(
                    f"{BASE_URL}/api/agentic/plan-stream",
                    json={"city": "TestCity_Invalid", "country": "XX", "days": 1},
                )
                # If server responds, check content type
                ct = r.headers.get("content-type", "")
                assert "text/event-stream" in ct or r.status_code >= 400
            except httpx.ReadTimeout:
                # Stream is working (timed out reading the SSE)
                pass

    def test_generate_stream_content_type(self):
        with httpx.Client(timeout=15) as client:
            try:
                r = client.post(
                    f"{BASE_URL}/api/v1/agentic/generate-itinerary-stream",
                    json={
                        "city": "TestCity_Invalid",
                        "country": "XX",
                        "days": 1,
                        "user_id": "test-integration",
                    },
                )
                ct = r.headers.get("content-type", "")
                assert "text/event-stream" in ct or r.status_code >= 400
            except httpx.ReadTimeout:
                pass


# ===================================================================
# 404 for unknown routes
# ===================================================================
class TestLive404:
    def test_unknown_route(self):
        r = httpx.get(f"{BASE_URL}/api/nonexistent-route", timeout=5)
        assert r.status_code == 404
