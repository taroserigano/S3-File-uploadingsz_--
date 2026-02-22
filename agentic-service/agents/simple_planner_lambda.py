"""
Simplified travel planner without LangGraph dependencies.
Uses direct OpenAI calls for itinerary generation + Amadeus for real travel data.
"""
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
import uuid
import json

import openai

from config_lambda import settings
from services.amadeus_service_lambda import amadeus_service
from services.unsplash_service import unsplash_service

logger = logging.getLogger(__name__)


class SimplePlanner:
    """
    Simplified travel planner using direct LLM calls.
    """
    
    def __init__(self):
        self.openai_client = openai.AsyncOpenAI(
            api_key=settings.openai_api_key
        )
    
    async def generate_itinerary(
        self,
        city: str,
        country: str,
        days: int,
        budget: Optional[float] = None,
        preferences: Dict[str, Any] = None,
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate a travel itinerary using a single LLM call.
        """
        run_id = str(uuid.uuid4())
        logger.info(f"[{run_id}] Generating itinerary for {days}-day trip to {city}, {country}")
        
        # Get real travel data from Amadeus if available
        flight_data = None
        hotel_data = None
        hero_image = None
        
        # Fetch hero image from Unsplash (parallel with Amadeus calls)
        try:
            hero_image = unsplash_service.get_destination_image(city, country)
            if hero_image:
                logger.info(f"[{run_id}] Hero image fetched: {hero_image['photographer']}")
        except Exception as e:
            logger.warning(f"[{run_id}] Failed to fetch hero image: {e}")
        
        if amadeus_service.is_available():
            try:
                # Get airport codes
                origin_code = "LAX"  # Default, could be user's location
                dest_code = amadeus_service.get_airport_code(city)
                
                if dest_code:
                    # Search for flights
                    departure_date = (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
                    return_date = (datetime.now() + timedelta(days=30+days)).strftime('%Y-%m-%d')
                    
                    logger.info(f"[{run_id}] Fetching real flight data...")
                    flight_data = amadeus_service.search_flights(
                        origin=origin_code,
                        destination=dest_code,
                        departure_date=departure_date,
                        return_date=return_date,
                        adults=1,
                        max_results=3
                    )
                
                # Search for hotels (basic info)
                city_code = amadeus_service.get_city_code(city)
                if city_code:
                    logger.info(f"[{run_id}] Fetching real hotel data for {city} (code={city_code})...")
                    hotel_data = amadeus_service.search_hotels(
                        city_code=city_code,
                        max_results=5
                    )
                else:
                    logger.warning(f"[{run_id}] No city code for '{city}' — skipping hotel search")
                
            except Exception as e:
                logger.warning(f"[{run_id}] Could not fetch Amadeus data: {e}")
        
        try:
            # Build preferences string
            pref_list = [k for k, v in (preferences or {}).items() if v]
            pref_str = ", ".join(pref_list) if pref_list else "balanced mix of activities"
            
            # Build budget string
            budget_str = f"${budget:.2f}" if budget else "flexible budget"
            
            # Build real travel data context
            travel_data_context = ""
            if flight_data and flight_data.get("flights"):
                cheapest_flight = min(flight_data["flights"], key=lambda x: float(x["price"]["total"]))
                travel_data_context += f"\n\nReal Flight Data Available:"
                travel_data_context += f"\n- Cheapest flight: {cheapest_flight['price']['currency']} {cheapest_flight['price']['total']}"
                travel_data_context += f"\n- {len(flight_data['flights'])} flight options found"
            
            if hotel_data and hotel_data.get("hotels"):
                travel_data_context += f"\n\nReal Hotel Data Available:"
                travel_data_context += f"\n- {len(hotel_data['hotels'])} hotels found"
                for hotel in hotel_data["hotels"][:3]:
                    travel_data_context += f"\n  • {hotel['name']}"
            
            # Create the prompt
            system_prompt = """You are an expert travel planner AI. Generate detailed, realistic travel itineraries.

CRITICAL REQUIREMENTS FOR LOCATIONS:
- Every location MUST include a complete, real street address with postal code
- NEVER use just neighborhood/district names
- NEVER repeat the same location twice in the entire itinerary
- Format locations as: "Place Name, Full Street Address with Chome, District, City Postal-Code" 
  Examples:
  * "Senso-ji Temple, 2-3-1 Asakusa, Taito, Tokyo 111-0032"
  * "Shibuya 109, 2 Chome-29-1 Dogenzaka, Shibuya, Tokyo 150-0043"
  * "Tsukiji Outer Market, 4 Chome-16-2 Tsukiji, Chuo, Tokyo 104-0045"
  * "Tokyo National Museum, 13-9 Uenokoen, Taito, Tokyo 110-8712"
- Include the "Chome" format (e.g., "2 Chome-29-1" not "2-29-1")
- Always include the postal code at the end
- For restaurants and stores, always provide the complete street address
- Each activity should have a unique, verifiable location

CRITICAL REQUIREMENTS FOR DESCRIPTIONS (notes field):
- Every activity MUST have a detailed, engaging description in the "notes" field
- Write 2-3 sentences (2 sentences preferred, 3 maximum)
- First sentence: What makes this place special or what visitors will experience
- Second sentence: A practical tip, historical context, or insider recommendation
- Example: "This renowned museum houses the world's largest collection of Japanese art, spanning ancient pottery to contemporary works. Arrive early to avoid crowds and don't miss the samurai armor exhibit on the second floor."
- NEVER write single short phrases like "Discover Japan's rich history through art"
- Make descriptions informative, specific, and helpful for travelers

Your itineraries should include:
- Day-by-day breakdown of activities with COMPLETE addresses
- Named attractions, restaurants with actual names and full addresses with postal codes
- Practical logistics and timing
- Local insights and tips
- Safety and compliance information

Return your response as a structured JSON object with this format:
{
  "title": "Trip title",
  "description": "Brief overview",
  "daily_schedule": [
    {
      "day": 1,
      "theme": "Day theme",
      "activities": [
        {"time": "9:00 AM", "activity": "Activity name", "location": "Place Name, Street Address with Chome, District, City Postal-Code", "notes": "Details"}
      ]
    }
  ],
  "daily_plans": [
    {
      "day": 1,
      "date": "Day 1",
      "theme": "Day theme",
      "plan": [
        {"time": "7:00 AM", "activity": "Wake up and breakfast", "location": "Cafe Name, Street Address with Chome, District, City Postal-Code", "duration": "1 hour", "notes": "Start your day with freshly baked croissants and locally roasted coffee at this charming neighborhood cafe. The outdoor seating offers great people-watching and the baristas can recommend the best dishes."},
        {"time": "8:30 AM", "activity": "Morning activity 1", "location": "Museum Name, Street Address with Chome, District, City Postal-Code", "duration": "2 hours", "notes": "This world-class museum houses over 10,000 artifacts spanning three centuries of cultural history. Arrive early to beat the crowds and don't miss the special exhibition on the third floor."},
        {"time": "10:30 AM", "activity": "Morning activity 2", "location": "Place Name, Street Address with Chome, District, City Postal-Code", "duration": "1.5 hours", "notes": "Explore this stunning area known for its unique architecture and vibrant atmosphere. A perfect spot for photography and soaking in the local culture."},
        {"time": "12:00 PM", "activity": "Lunch", "location": "Restaurant Name, Street Address with Chome, District, City Postal-Code", "duration": "1.5 hours", "notes": "Try their signature dish that has been perfected over three generations of family recipes. The lunch set menu offers excellent value and includes seasonal appetizers."},
        {"time": "2:00 PM", "activity": "Afternoon activity 1", "location": "Place Name, Street Address with Chome, District, City Postal-Code", "duration": "2 hours", "notes": "Experience breathtaking panoramic views from the observation deck, best visited on clear afternoons. The audio guide provides fascinating historical context and points out landmarks visible from the top."},
        {"time": "4:00 PM", "activity": "Afternoon activity 2", "location": "Place Name, Street Address with Chome, District, City Postal-Code", "duration": "1.5 hours", "notes": "Wander through this vibrant market district where locals shop for fresh produce, crafts, and street food. Don't miss the artisan stalls tucked in the back alleys."},
        {"time": "6:00 PM", "activity": "Dinner", "location": "Restaurant Name, Street Address with Chome, District, City Postal-Code", "duration": "2 hours", "notes": "This award-winning restaurant specializes in modern fusion cuisine using local ingredients. Reservations are recommended, and ask for a window seat to enjoy the evening city lights."},
        {"time": "8:00 PM", "activity": "Evening activity", "location": "Place Name, Street Address with Chome, District, City Postal-Code", "duration": "1.5 hours", "notes": "End the day with a leisurely stroll through this beautifully illuminated area. The nighttime atmosphere is magical and offers a completely different perspective from daytime."}
      ],
      "total_activities": 8,
      "estimated_walking": "5 km",
      "tips": "Wear comfortable shoes"
    }
  ],
  "top_10_places": ["Must-visit place 1", "Must-visit place 2", "Must-visit place 3", "Must-visit place 4", "Must-visit place 5", "Must-visit place 6", "Must-visit place 7", "Must-visit place 8", "Must-visit place 9", "Must-visit place 10"],
  "recommended_hotels": [
    {
      "name": "Hotel Name",
      "price_range": "$$-$$$",
      "rating": 4.5,
      "address": "Street Address, City",
      "description": "Brief description highlighting key features and why it's recommended"
    }
  ],
  "highlights": ["Specific attraction 1", "Specific attraction 2"],
  "local_tips": ["Tip 1", "Tip 2"],
  "compliance": {
    "visa_required": false,
    "safety_level": "safe",
    "vaccinations": []
  },
  "estimated_costs": {
    "accommodation": 0,
    "food": 0,
    "activities": 0,
    "transport": 0,
    "total": 0
  }
}"""
            
            user_prompt = f"""Plan a {days}-day trip to {city}, {country}.

Travel Preferences: {pref_str}
Budget: {budget_str}{travel_data_context}

Please create a comprehensive itinerary that:
1. Makes the most of {days} days in {city}
2. Includes activities matching the preferences: {pref_str}
3. Stays within or around the budget: {budget_str}
4. Includes practical details like timing and logistics
5. Provides local insights and safety information
6. Uses ONLY complete addresses with Chome format and postal codes: "Place Name, # Chome-#-# Street, District, City ###-####" (e.g., "Senso-ji Temple, 2-3-1 Asakusa, Taito, Tokyo 111-0032")
7. NEVER repeats the same location twice in the itinerary
8. Each location must be a specific, named place (museum, restaurant, store, landmark) with a REAL street address

IMPORTANT: 
1. Create a "top_10_places" array with EXACTLY 10 must-visit places/attractions in {city}
   - These should be the absolute best places a tourist should visit
   - Include famous landmarks, museums, restaurants, viewpoints, parks, etc.
   - Format each as "Place Name, City" (e.g., "Sagrada Familia, Barcelona")
   - Make sure all 10 are unique and different from each other

2. Create a "recommended_hotels" array with EXACTLY 3 best hotels for this destination:
   - Include hotel name, price_range ($ to $$$$), rating (out of 5), address, and description
   - Choose hotels with different price points (luxury, mid-range, budget-friendly)
   - Provide realistic ratings and helpful descriptions about amenities, location benefits
   - Example: {{"name": "The Ritz Carlton", "price_range": "$$$$", "rating": 4.8, "address": "123 Main St, City", "description": "Luxury waterfront hotel with spa, rooftop bar, and Michelin-star restaurant"}}

3. Create a detailed "daily_plans" section for EACH day with:
   - Hour-by-hour schedule from 7:00 AM to 8:00 PM
   - Include breakfast (7-8 AM), lunch (12-1:30 PM), dinner (6-8 PM)
   - Morning activities (8 AM - 12 PM), afternoon activities (2 PM - 6 PM)
   - Each activity should have: time, activity name, specific location, duration, and helpful notes
   - Include estimated walking distances and practical tips for each day
   - Make sure every time slot is filled with something meaningful

CRITICAL: You MUST include the "recommended_hotels" array with exactly 3 hotels. This is required. Do not skip this field.

Return the itinerary as JSON following the specified format."""
            
            # Call the OpenAI API directly
            response = await self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.7,
                max_tokens=16000
            )
            
            # Parse the response
            content = response.choices[0].message.content.strip()
            
            # Try to extract JSON from the response
            if "```json" in content:
                json_start = content.find("```json") + 7
                json_end = content.find("```", json_start)
                content = content[json_start:json_end].strip()
            elif "```" in content:
                json_start = content.find("```") + 3
                json_end = content.find("```", json_start)
                content = content[json_start:json_end].strip()
            
            try:
                itinerary_data = json.loads(content)
            except json.JSONDecodeError:
                # If JSON parsing fails, create a structured response
                itinerary_data = {
                    "title": f"{days}-Day {city} Adventure",
                    "description": content[:500],
                    "daily_schedule": [],
                    "highlights": [],
                    "local_tips": [],
                    "compliance": {
                        "visa_required": False,
                        "safety_level": "check official sources",
                        "vaccinations": []
                    },
                    "estimated_costs": {
                        "total": budget if budget else 0
                    }
                }
            
            # Use top_10_places if available, otherwise collect from activities
            stops = []
            if itinerary_data.get("top_10_places"):
                # Use the curated top 10 places list
                stops = itinerary_data["top_10_places"][:10]
            else:
                # Fallback: collect unique stops from activities
                seen_locations = set()
                for day in itinerary_data.get("daily_schedule", []):
                    for activity in day.get("activities", []):
                        location = activity.get("location", activity.get("activity", "Activity"))
                        if location and location.lower() not in seen_locations:
                            stops.append(location)
                            seen_locations.add(location.lower())
                
                # Add highlights if we don't have enough
                if len(stops) < 10:
                    for highlight in itinerary_data.get("highlights", [])[:10]:
                        if highlight and highlight.lower() not in seen_locations:
                            stops.append(highlight)
                            seen_locations.add(highlight.lower())
                            if len(stops) >= 10:
                                break
            
            # Ensure recommended_hotels exists, merge LLM + Amadeus + fallback
            llm_hotels = itinerary_data.get("recommended_hotels", [])
            amadeus_hotels = hotel_data.get("hotels", []) if hotel_data and isinstance(hotel_data, dict) else []

            # Start with LLM hotels
            recommended_hotels = []
            for h in llm_hotels:
                recommended_hotels.append({
                    "name": h.get("name", "Hotel"),
                    "rating": h.get("rating", 4.0),
                    "price_range": h.get("price_range", "$$"),
                    "address": h.get("address", f"{city}, {country}"),
                    "description": h.get("description", ""),
                    "source": "ai",
                })

            # Supplement with Amadeus hotels that aren't duplicates
            _price_tiers = [
                "$80-150/night", "$120-220/night", "$150-300/night",
                "$60-110/night", "$200-400/night",
            ]
            llm_names = {h.get("name", "").lower().strip() for h in llm_hotels}
            for idx, h in enumerate(amadeus_hotels):
                name = h.get("name", "")
                if name.lower().strip() in llm_names:
                    continue
                addr = h.get("address", {})
                recommended_hotels.append({
                    "name": name,
                    "rating": 4.0,
                    "price_range": _price_tiers[idx % len(_price_tiers)],
                    "address": addr.get("cityName", city) if isinstance(addr, dict) else str(addr),
                    "description": f"Listed on Amadeus — check travel sites for current rates.",
                    "source": "amadeus",
                })

            # If still empty, generate fallback
            if not recommended_hotels:
                logger.warning(f"[{run_id}] No hotels from LLM or Amadeus, generating fallback")
                recommended_hotels = [
                    {
                        "name": f"Premium Hotel {city}",
                        "price_range": "$$$$",
                        "rating": 4.5,
                        "address": f"Downtown {city}, {country}",
                        "description": f"Luxury accommodations in the heart of {city} with premium amenities, rooftop dining, and spa facilities."
                    },
                    {
                        "name": f"Comfort Inn {city}",
                        "price_range": "$$",
                        "rating": 4.0,
                        "address": f"Central {city}, {country}",
                        "description": f"Modern mid-range hotel offering excellent value with comfortable rooms, complimentary breakfast, and convenient location."
                    },
                    {
                        "name": f"Budget Stay {city}",
                        "price_range": "$",
                        "rating": 3.5,
                        "address": f"{city} City Center, {country}",
                        "description": f"Clean and affordable accommodations perfect for budget travelers, with basic amenities and friendly service."
                    }
                ]
            
            tour = {
                "city": city,
                "country": country,
                "title": itinerary_data.get("title", f"{days}-Day {city} Adventure"),
                "description": itinerary_data.get("description", f"An amazing {days}-day journey through {city}"),
                "image": "https://source.unsplash.com/800x600/?travel," + city.lower().replace(" ", "-"),
                "stops": stops[:10],  # Limit to 10 stops for display
                "daily_schedule": itinerary_data.get("daily_schedule", []),
                "daily_plans": itinerary_data.get("daily_plans", []),  # NEW: Detailed hour-by-hour plans
                "recommended_hotels": recommended_hotels[:5],  # LLM + Amadeus merged, capped at 5
                "compliance": itinerary_data.get("compliance", {}),
                "research": {
                    "highlights": itinerary_data.get("highlights", []),
                    "local_tips": itinerary_data.get("local_tips", []),
                    "estimated_costs": itinerary_data.get("estimated_costs", {})
                },
                "real_data": {
                    "flights": flight_data.get("flights", []) if flight_data and isinstance(flight_data, dict) else [],
                    "hotels": amadeus_hotels,
                    "has_real_data": bool(flight_data or amadeus_hotels)
                },
                "hero_image": hero_image  # Unsplash image data
            }
            
            result = {
                "run_id": run_id,
                "tour": tour,
                "cost": {
                    "llm_tokens": 2000,  # Approximate
                    "api_calls": 1,
                    "total_usd": 0.02
                },
                "citations": ["Generated by AI based on travel knowledge"],
                "status": "completed"
            }
            
            logger.info(f"[{run_id}] Itinerary generated successfully")
            return result
        
        except Exception as exc:
            logger.error(f"[{run_id}] Generation failed: {str(exc)}", exc_info=True)
            return {
                "run_id": run_id,
                "tour": {},
                "cost": {},
                "citations": [],
                "status": "failed",
                "error": str(exc)
            }

