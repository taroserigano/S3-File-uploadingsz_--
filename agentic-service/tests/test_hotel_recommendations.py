"""
Thorough tests for hotel recommendations pipeline.

End-to-end coverage across all three layers:
  1. AmadeusService.get_city_code / search_hotels
  2. _merge_hotel_recommendations / _build_tour
  3. SimplePlanner integration (streaming & non-streaming)

Hotel display contract (TravelPlanner.jsx reads these fields):
  tripData.itinerary.recommended_hotels  →  list of:
    { name: str, rating: number, price_range: str, address: str, description: str }

Every test validates the exact schema the frontend expects.
"""
import asyncio
import json
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_service_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _service_root not in sys.path:
    sys.path.insert(0, _service_root)

# Frontend-expected fields on each hotel object
HOTEL_REQUIRED_FIELDS = {"name", "rating", "price_range", "address", "description"}


def _assert_valid_hotel(hotel: dict, msg: str = ""):
    """Assert a hotel dict has all fields the frontend renders."""
    for field in HOTEL_REQUIRED_FIELDS:
        assert field in hotel, f"{msg} missing '{field}': {hotel}"
    assert isinstance(hotel["name"], str) and hotel["name"], f"{msg} name empty"
    assert isinstance(hotel["rating"], (int, float)), f"{msg} rating not numeric"
    assert isinstance(hotel["price_range"], str) and hotel["price_range"], f"{msg} price_range empty"
    assert isinstance(hotel["address"], str) and hotel["address"], f"{msg} address empty"
    assert isinstance(hotel["description"], str), f"{msg} description not str"


def _assert_hotel_list_valid(hotels: list, min_count: int = 1, msg: str = ""):
    """Assert a list of hotels is non-empty and each item is valid."""
    assert isinstance(hotels, list), f"{msg} hotels is not a list"
    assert len(hotels) >= min_count, f"{msg} expected >= {min_count} hotels, got {len(hotels)}"
    for i, h in enumerate(hotels):
        _assert_valid_hotel(h, f"{msg} hotels[{i}]")


# =====================================================================
# 1. AmadeusService.get_city_code
# =====================================================================
class TestGetCityCode:
    """Static lookup + dynamic fallback."""

    def test_static_lookup_known_cities(self):
        from services.amadeus_service import AmadeusService
        svc = AmadeusService.__new__(AmadeusService)
        svc.client = None  # no live API
        assert svc.get_city_code("Tokyo") == "TYO"
        assert svc.get_city_code("paris") == "PAR"
        assert svc.get_city_code("NEW YORK") == "NYC"
        assert svc.get_city_code("  London  ") == "LON"

    def test_static_lookup_additional_cities(self):
        from services.amadeus_service import AmadeusService
        svc = AmadeusService.__new__(AmadeusService)
        svc.client = None
        assert svc.get_city_code("sendai") == "SDJ"
        assert svc.get_city_code("sapporo") == "SPK"
        assert svc.get_city_code("bali") == "DPS"
        assert svc.get_city_code("cancun") == "CUN"

    def test_unknown_city_no_client_returns_none(self):
        from services.amadeus_service import AmadeusService
        svc = AmadeusService.__new__(AmadeusService)
        svc.client = None
        assert svc.get_city_code("Timbuktu") is None

    def test_dynamic_lookup_with_mock_client(self):
        """If static map misses, calls Amadeus Location API."""
        from services.amadeus_service import AmadeusService
        svc = AmadeusService.__new__(AmadeusService)
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.data = [{"iataCode": "TBK"}]
        mock_client.reference_data.locations.get.return_value = mock_response
        svc.client = mock_client

        code = svc.get_city_code("Timbuktu")
        assert code == "TBK"
        mock_client.reference_data.locations.get.assert_called_once()

    def test_dynamic_lookup_failure_returns_none(self):
        """If Amadeus API throws, returns None gracefully."""
        from services.amadeus_service import AmadeusService
        svc = AmadeusService.__new__(AmadeusService)
        mock_client = MagicMock()
        mock_client.reference_data.locations.get.side_effect = Exception("API down")
        svc.client = mock_client

        code = svc.get_city_code("Timbuktu")
        assert code is None


# =====================================================================
# 2. AmadeusService.search_hotels
# =====================================================================
class TestSearchHotels:
    """search_hotels returns None on failure, dict on success."""

    def test_returns_none_when_no_client(self):
        from services.amadeus_service import AmadeusService
        svc = AmadeusService.__new__(AmadeusService)
        svc.client = None
        result = svc.search_hotels(city_code="TYO")
        assert result is None

    def test_returns_none_on_api_error(self):
        from services.amadeus_service import AmadeusService
        from amadeus import ResponseError
        svc = AmadeusService.__new__(AmadeusService)
        mock_client = MagicMock()
        # Simulate a ResponseError
        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.result = MagicMock()
        mock_response.result.parsed = True
        mock_client.reference_data.locations.hotels.by_city.get.side_effect = Exception("bad request")
        svc.client = mock_client

        result = svc.search_hotels(city_code="INVALID")
        assert result is None

    def test_returns_dict_on_success(self):
        from services.amadeus_service import AmadeusService
        svc = AmadeusService.__new__(AmadeusService)
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.data = [
            {"hotelId": "H1", "name": "Test Hotel", "geoCode": {"latitude": 35.0, "longitude": 139.0}, "address": {"cityName": "Tokyo"}},
        ]
        mock_client.reference_data.locations.hotels.by_city.get.return_value = mock_response
        svc.client = mock_client

        result = svc.search_hotels(city_code="TYO", max_results=5)
        assert result is not None
        assert "hotels" in result
        assert len(result["hotels"]) == 1
        assert result["hotels"][0]["name"] == "Test Hotel"


# =====================================================================
# 3. _merge_hotel_recommendations
# =====================================================================
class TestMergeHotelRecommendations:
    """Thorough tests for the merge logic."""

    def test_llm_only(self):
        from agents.simple_planner import _merge_hotel_recommendations
        llm = [
            {"name": "Hotel A", "rating": 4.5, "price_range": "$200/night", "address": "Downtown", "description": "Nice"},
        ]
        result = _merge_hotel_recommendations(llm, [], "Paris")
        _assert_hotel_list_valid(result, 1, "LLM-only")
        assert result[0]["name"] == "Hotel A"
        assert result[0]["source"] == "ai"

    def test_amadeus_only(self):
        from agents.simple_planner import _merge_hotel_recommendations
        amadeus = [
            {"name": "Amadeus Hotel", "hotelId": "AM1", "address": {"cityName": "Paris"}},
        ]
        result = _merge_hotel_recommendations([], amadeus, "Paris")
        _assert_hotel_list_valid(result, 1, "Amadeus-only")
        assert result[0]["name"] == "Amadeus Hotel"
        assert result[0]["source"] == "amadeus"

    def test_both_sources_merged(self):
        from agents.simple_planner import _merge_hotel_recommendations
        llm = [{"name": "LLM Hotel", "rating": 4.0, "price_range": "$150/night", "address": "Center", "description": "Good"}]
        amadeus = [{"name": "Amadeus Hotel", "hotelId": "AM1", "address": {"cityName": "Paris"}}]
        result = _merge_hotel_recommendations(llm, amadeus, "Paris")
        _assert_hotel_list_valid(result, 2, "Both-sources")
        names = [h["name"] for h in result]
        assert "LLM Hotel" in names
        assert "Amadeus Hotel" in names

    def test_deduplication(self):
        """Amadeus hotel with same name as LLM hotel should be skipped."""
        from agents.simple_planner import _merge_hotel_recommendations
        llm = [{"name": "Grand Hotel", "rating": 4.5, "price_range": "$200", "address": "Main St", "description": "Luxury"}]
        amadeus = [{"name": "Grand Hotel", "hotelId": "G1", "address": {"cityName": "Paris"}}]
        result = _merge_hotel_recommendations(llm, amadeus, "Paris")
        assert len(result) == 1
        assert result[0]["source"] == "ai"

    def test_case_insensitive_dedup(self):
        from agents.simple_planner import _merge_hotel_recommendations
        llm = [{"name": "Grand Hotel", "rating": 4.0, "price_range": "$200", "address": "X", "description": "Y"}]
        amadeus = [{"name": "grand hotel", "hotelId": "G1", "address": {"cityName": "Paris"}}]
        result = _merge_hotel_recommendations(llm, amadeus, "Paris")
        assert len(result) == 1

    def test_fallback_when_both_empty(self):
        """When both LLM and Amadeus return nothing, fallback hotels are generated."""
        from agents.simple_planner import _merge_hotel_recommendations
        result = _merge_hotel_recommendations([], [], "Tokyo")
        _assert_hotel_list_valid(result, 3, "Fallback")
        assert all(h["source"] == "fallback" for h in result)
        # Verify city name is in the fallback data
        assert any("Tokyo" in h["name"] for h in result)
        assert any("Tokyo" in h["address"] for h in result)

    def test_cap_at_five(self):
        """Never returns more than 5 hotels."""
        from agents.simple_planner import _merge_hotel_recommendations
        llm = [{"name": f"Hotel {i}", "rating": 4.0, "price_range": "$100", "address": "X", "description": "Y"} for i in range(10)]
        result = _merge_hotel_recommendations(llm, [], "Paris")
        assert len(result) <= 5

    def test_missing_fields_get_defaults(self):
        """LLM hotels with missing fields get sensible defaults."""
        from agents.simple_planner import _merge_hotel_recommendations
        llm = [{"name": "Sparse Hotel"}]  # Missing rating, price_range, address, description
        result = _merge_hotel_recommendations(llm, [], "Berlin")
        _assert_hotel_list_valid(result, 1, "Sparse")
        assert result[0]["rating"] == 4.0  # default
        assert "$" in result[0]["price_range"]  # default has a price

    def test_amadeus_string_address(self):
        """Amadeus hotel with string address (not dict) is handled."""
        from agents.simple_planner import _merge_hotel_recommendations
        amadeus = [{"name": "String Addr Hotel", "hotelId": "S1", "address": "123 Main St"}]
        result = _merge_hotel_recommendations([], amadeus, "NYC")
        _assert_hotel_list_valid(result, 1, "StringAddr")
        assert result[0]["address"] == "123 Main St"


# =====================================================================
# 4. _build_tour  →  recommended_hotels always present
# =====================================================================
class TestBuildTourHotels:
    """Verify _build_tour always includes valid recommended_hotels."""

    def test_with_llm_and_amadeus_hotels(self):
        from agents.simple_planner import _build_tour
        itinerary = {
            "title": "Test Trip",
            "description": "A test",
            "daily_plans": [],
            "top_10_places": [],
            "recommended_hotels": [
                {"name": "LLM Hotel", "rating": 4.5, "price_range": "$200/night", "address": "Center", "description": "Great"},
            ],
        }
        hotel_data = {
            "hotels": [
                {"name": "Amadeus Hotel", "hotelId": "A1", "address": {"cityName": "Paris"}},
            ]
        }
        tour = _build_tour("Paris", "France", 3, itinerary, None, hotel_data, None)
        _assert_hotel_list_valid(tour["recommended_hotels"], 2, "LLM+Amadeus in tour")

    def test_with_no_external_hotels(self):
        """When LLM has hotels but no Amadeus data."""
        from agents.simple_planner import _build_tour
        itinerary = {
            "daily_plans": [],
            "top_10_places": [],
            "recommended_hotels": [
                {"name": "Only LLM", "rating": 4.0, "price_range": "$100", "address": "Here", "description": "Fine"},
            ],
        }
        tour = _build_tour("Rome", "Italy", 2, itinerary, None, None, None)
        _assert_hotel_list_valid(tour["recommended_hotels"], 1, "LLM-only in tour")

    def test_with_no_hotels_at_all(self):
        """When neither LLM nor Amadeus has hotels → fallback generated."""
        from agents.simple_planner import _build_tour
        itinerary = {"daily_plans": [], "top_10_places": []}
        tour = _build_tour("Tokyo", "Japan", 3, itinerary, None, None, None)
        _assert_hotel_list_valid(tour["recommended_hotels"], 3, "Fallback in tour")
        assert all(h["source"] == "fallback" for h in tour["recommended_hotels"])

    def test_hotel_data_none_handled(self):
        """hotel_data=None should not raise."""
        from agents.simple_planner import _build_tour
        itinerary = {"daily_plans": [], "top_10_places": [], "recommended_hotels": []}
        tour = _build_tour("Berlin", "Germany", 2, itinerary, None, None, None)
        _assert_hotel_list_valid(tour["recommended_hotels"], 3, "None hotel_data")

    def test_hotel_data_empty_dict(self):
        """hotel_data={} (no 'hotels' key) handled."""
        from agents.simple_planner import _build_tour
        itinerary = {"daily_plans": [], "top_10_places": [], "recommended_hotels": []}
        tour = _build_tour("NYC", "USA", 1, itinerary, None, {}, None)
        _assert_hotel_list_valid(tour["recommended_hotels"], 3, "Empty hotel_data")


# =====================================================================
# 5. SimplePlanner.generate_itinerary - hotels in result
# =====================================================================
def _make_planner():
    from agents.simple_planner import SimplePlanner
    with patch("openai.AsyncOpenAI"):
        planner = SimplePlanner()
    return planner


class TestPlannerHotelIntegration:
    """Integration tests: hotels appear in final output."""

    @pytest.fixture(autouse=True)
    def _reset_cache(self):
        import services.cache_service as cs
        cs._mem_cache = None
        cs._redis_client = None
        yield
        cs._mem_cache = None
        cs._redis_client = None

    @pytest.mark.asyncio
    async def test_generate_itinerary_has_recommended_hotels(self):
        """Non-streaming generate_itinerary always has recommended_hotels."""
        planner = _make_planner()
        llm_data = {
            "title": "3-Day Tokyo",
            "description": "Tokyo trip",
            "top_10_places": [f"Place {i}" for i in range(10)],
            "daily_plans": [{"day": 1, "plan": [], "theme": "Fun"}],
            "recommended_hotels": [
                {"name": "Tokyo Inn", "rating": 4.0, "price_range": "$120/night", "address": "Shinjuku", "description": "Nice"},
            ],
            "highlights": [],
            "local_tips": [],
            "compliance": {},
            "estimated_costs": {},
        }
        planner._call_llm = AsyncMock(return_value=llm_data)
        planner._fetch_amadeus_data = AsyncMock(return_value=(None, None))
        planner._fetch_hero_image = AsyncMock(return_value=None)

        result = await planner.generate_itinerary(
            city="Tokyo", country="Japan", days=3,
            preferences={"culture": True}, user_id="test",
        )
        assert result["status"] == "completed"
        _assert_hotel_list_valid(result["tour"]["recommended_hotels"], 1, "generate_itinerary")

    @pytest.mark.asyncio
    async def test_generate_itinerary_no_llm_hotels_gets_fallback(self):
        """When LLM returns no recommended_hotels, fallback is used."""
        planner = _make_planner()
        llm_data = {
            "title": "Trip",
            "description": "A trip",
            "top_10_places": [],
            "daily_plans": [],
            "highlights": [],
            "local_tips": [],
            "compliance": {},
            "estimated_costs": {},
            # NO recommended_hotels
        }
        planner._call_llm = AsyncMock(return_value=llm_data)
        planner._fetch_amadeus_data = AsyncMock(return_value=(None, None))
        planner._fetch_hero_image = AsyncMock(return_value=None)

        result = await planner.generate_itinerary(
            city="London", country="UK", days=2,
            preferences={}, user_id="test",
        )
        assert result["status"] == "completed"
        _assert_hotel_list_valid(result["tour"]["recommended_hotels"], 3, "no-LLM-hotels fallback")

    @pytest.mark.asyncio
    async def test_generate_itinerary_with_amadeus_hotels(self):
        """When Amadeus returns hotels, they get merged."""
        planner = _make_planner()
        llm_data = {
            "title": "Trip",
            "description": "A trip",
            "top_10_places": [],
            "daily_plans": [],
            "recommended_hotels": [
                {"name": "LLM Hotel", "rating": 4.2, "price_range": "$150", "address": "Center", "description": "Good"},
            ],
            "highlights": [],
            "local_tips": [],
            "compliance": {},
            "estimated_costs": {},
        }
        amadeus_hotel_data = {
            "hotels": [
                {"name": "Amadeus Place", "hotelId": "AP1", "address": {"cityName": "Rome"}},
            ]
        }
        planner._call_llm = AsyncMock(return_value=llm_data)
        planner._fetch_amadeus_data = AsyncMock(return_value=(None, amadeus_hotel_data))
        planner._fetch_hero_image = AsyncMock(return_value=None)

        result = await planner.generate_itinerary(
            city="Rome", country="Italy", days=3,
            preferences={"food": True}, user_id="test",
        )
        hotels = result["tour"]["recommended_hotels"]
        _assert_hotel_list_valid(hotels, 2, "LLM+Amadeus merged")
        names = [h["name"] for h in hotels]
        assert "LLM Hotel" in names
        assert "Amadeus Place" in names


# =====================================================================
# 6. SimplePlanner.generate_itinerary_stream - hotels in final SSE
# =====================================================================
class TestPlannerStreamHotelIntegration:
    """Hotels must appear in the SSE 'result' event."""

    @pytest.fixture(autouse=True)
    def _reset_cache(self):
        import services.cache_service as cs
        cs._mem_cache = None
        cs._redis_client = None
        yield
        cs._mem_cache = None
        cs._redis_client = None

    @pytest.mark.asyncio
    async def test_stream_result_has_recommended_hotels(self):
        """The result SSE event from streaming includes recommended_hotels."""
        planner = _make_planner()

        llm_data = {
            "title": "Stream Trip",
            "description": "Streaming",
            "top_10_places": [],
            "daily_plans": [],
            "recommended_hotels": [
                {"name": "Stream Hotel", "rating": 4.3, "price_range": "$180/night", "address": "River St", "description": "Great view"},
            ],
            "highlights": [],
            "local_tips": [],
            "compliance": {},
            "estimated_costs": {},
        }
        json_str = json.dumps(llm_data)

        async def fake_stream(*args, **kwargs):
            for ch in [json_str[:50], json_str[50:]]:
                yield ch

        planner._call_llm_stream = fake_stream
        planner._fetch_amadeus_data = AsyncMock(return_value=(None, None))
        planner._fetch_hero_image = AsyncMock(return_value=None)

        result_event = None
        async for event in planner.generate_itinerary_stream(
            city="Kyoto", country="Japan", days=2,
            preferences={"culture": True}, user_id="test",
        ):
            if event.startswith("event: result"):
                # Next line is data
                data_line = event.split("\n")[1]
                result_event = json.loads(data_line.replace("data: ", ""))

        assert result_event is not None, "No result event emitted"
        _assert_hotel_list_valid(
            result_event["tour"]["recommended_hotels"], 1,
            "Streaming result hotels"
        )

    @pytest.mark.asyncio
    async def test_stream_no_llm_hotels_gets_fallback(self):
        """Streaming with no LLM hotels still gets fallback hotels."""
        planner = _make_planner()

        llm_data = {
            "title": "Bare Trip",
            "description": "No hotels",
            "top_10_places": [],
            "daily_plans": [],
            # NO recommended_hotels
            "highlights": [],
            "local_tips": [],
            "compliance": {},
            "estimated_costs": {},
        }
        json_str = json.dumps(llm_data)

        async def fake_stream(*args, **kwargs):
            yield json_str

        planner._call_llm_stream = fake_stream
        planner._fetch_amadeus_data = AsyncMock(return_value=(None, None))
        planner._fetch_hero_image = AsyncMock(return_value=None)

        result_event = None
        async for event in planner.generate_itinerary_stream(
            city="Barcelona", country="Spain", days=4,
            preferences={}, user_id="test",
        ):
            if event.startswith("event: result"):
                data_line = event.split("\n")[1]
                result_event = json.loads(data_line.replace("data: ", ""))

        assert result_event is not None
        _assert_hotel_list_valid(
            result_event["tour"]["recommended_hotels"], 3,
            "Streaming fallback hotels"
        )


# =====================================================================
# 7. _repair_truncated_json - hotels at end of JSON
# =====================================================================
class TestRepairTruncatedJson:
    """recommended_hotels is near the end of the JSON schema, so it's most
    likely to get truncated by token limits. Verify repair handles this."""

    def test_truncated_after_hotels_array(self):
        from agents.simple_planner import _extract_json
        # JSON that gets truncated right after recommended_hotels
        truncated = '{"title":"Trip","recommended_hotels":[{"name":"Hotel A","rating":4.5}]'  # missing closing }
        data = _extract_json(truncated)
        assert data["title"] == "Trip"
        assert len(data["recommended_hotels"]) == 1

    def test_truncated_mid_hotel_entry(self):
        from agents.simple_planner import _extract_json
        # Truncated in middle of a hotel entry
        truncated = '{"title":"Trip","recommended_hotels":[{"name":"Hotel A","rating":4.5},{"name":"Hotel B","rati'
        data = _extract_json(truncated)
        assert data["title"] == "Trip"
        # Should recover at least the first hotel
        assert len(data["recommended_hotels"]) >= 1

    def test_truncated_empty_hotels_array(self):
        from agents.simple_planner import _extract_json
        truncated = '{"title":"Trip","recommended_hotels":[]'
        data = _extract_json(truncated)
        assert data["recommended_hotels"] == []


# =====================================================================
# 8. Async wrappers
# =====================================================================
class TestAsyncWrappers:
    @pytest.mark.asyncio
    async def test_async_get_city_code(self):
        from services.amadeus_service import AmadeusService
        svc = AmadeusService.__new__(AmadeusService)
        svc.client = None
        code = await svc.async_get_city_code("Tokyo")
        assert code == "TYO"

    @pytest.mark.asyncio
    async def test_async_get_city_code_unknown(self):
        from services.amadeus_service import AmadeusService
        svc = AmadeusService.__new__(AmadeusService)
        svc.client = None
        code = await svc.async_get_city_code("Atlantis")
        assert code is None

    @pytest.mark.asyncio
    async def test_async_search_hotels_no_client(self):
        from services.amadeus_service import AmadeusService
        svc = AmadeusService.__new__(AmadeusService)
        svc.client = None
        result = await svc.async_search_hotels(city_code="TYO")
        assert result is None
