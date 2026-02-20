"""
Shared test fixtures for agentic-service tests.
"""
import os
import sys
import pytest

# Ensure the agentic-service root is on sys.path so imports work
_service_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _service_root not in sys.path:
    sys.path.insert(0, _service_root)

# Set a dummy OpenAI key so Settings() doesn't blow up during tests
os.environ.setdefault("OPENAI_API_KEY", "sk-test-fake-key-for-unit-tests")


@pytest.fixture
def sample_plan_request():
    """Standard plan request payload used across tests."""
    return {
        "city": "Paris",
        "country": "France",
        "days": 3,
        "budget": 2000.0,
        "preferences": ["culture", "food"],
        "user_id": "test-user-001",
    }


@pytest.fixture
def sample_itinerary_data():
    """Minimal valid itinerary JSON as returned by the LLM."""
    return {
        "title": "3-Day Paris Adventure",
        "description": "An amazing 3-day journey through Paris, exploring culture and cuisine.",
        "top_10_places": [
            "Eiffel Tower, Paris",
            "Louvre Museum, Paris",
            "Notre-Dame Cathedral, Paris",
            "Sacré-Cœur, Montmartre",
            "Musée d'Orsay, Paris",
            "Champs-Élysées, Paris",
            "Palace of Versailles, Versailles",
            "Le Marais, Paris",
            "Montmartre, Paris",
            "Luxembourg Gardens, Paris",
        ],
        "daily_plans": [
            {
                "day": 1,
                "date": "Day 1",
                "theme": "Iconic Landmarks",
                "plan": [
                    {
                        "time": "9:00 AM",
                        "activity": "Visit the Eiffel Tower",
                        "location": "Eiffel Tower, Paris",
                        "duration": "2 hours",
                        "notes": "Buy tickets online in advance",
                    }
                ],
                "estimated_walking": "8 km",
                "tips": "Wear comfortable shoes",
            }
        ],
        "highlights": ["Eiffel Tower at sunset", "Croissant at a local bakery"],
        "local_tips": ["Metro is the fastest way to get around"],
        "recommended_hotels": [
            {
                "name": "Hotel Le Marais",
                "rating": 4.5,
                "price_range": "$150-250/night",
                "address": "Le Marais, Paris",
                "description": "Charming boutique hotel",
            }
        ],
        "compliance": {"visa_required": False, "safety_level": "safe", "vaccinations": []},
        "estimated_costs": {
            "accommodation": 600,
            "food": 300,
            "activities": 200,
            "transport": 100,
            "total": 1200,
        },
    }


@pytest.fixture
def sample_flight_data():
    """Mock Amadeus flight search result."""
    return {
        "flights": [
            {
                "price": {"total": "450.00", "currency": "USD"},
                "itineraries": [{"segments": [{"departure": {"iataCode": "LAX"}, "arrival": {"iataCode": "CDG"}}]}],
            }
        ]
    }


@pytest.fixture
def sample_hotel_data():
    """Mock Amadeus hotel search result."""
    return {
        "hotels": [
            {"name": "Hôtel Plaza Athénée", "rating": 5, "price": "500/night"}
        ]
    }
