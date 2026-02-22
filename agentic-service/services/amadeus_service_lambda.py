"""
Amadeus API integration for real travel data.
Provides flight search, hotel search, and travel recommendations.
"""
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

from amadeus import Client, ResponseError

from config_lambda import settings

logger = logging.getLogger(__name__)


class AmadeusService:
    """Service for integrating Amadeus travel APIs."""
    
    def __init__(self):
        """Initialize Amadeus client with API credentials."""
        if not settings.amadeus_api_key or not settings.amadeus_api_secret:
            logger.warning("Amadeus API credentials not configured")
            self.client = None
            return
        
        try:
            self.client = Client(
                client_id=settings.amadeus_api_key,
                client_secret=settings.amadeus_api_secret
            )
            logger.info("Amadeus API client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Amadeus client: {e}")
            self.client = None
    
    def is_available(self) -> bool:
        """Check if Amadeus API is available."""
        return self.client is not None
    
    def search_flights(
        self,
        origin: str,
        destination: str,
        departure_date: str,
        return_date: Optional[str] = None,
        adults: int = 1,
        max_results: int = 5
    ) -> Dict[str, Any]:
        """
        Search for flight offers.
        
        Args:
            origin: Origin airport code (e.g., 'LAX')
            destination: Destination airport code (e.g., 'NRT')
            departure_date: Departure date (YYYY-MM-DD)
            return_date: Return date for round trip (optional)
            adults: Number of adult passengers
            max_results: Maximum number of results to return
        
        Returns:
            Dict with flight offers and metadata
        """
        if not self.is_available():
            return {"error": "Amadeus API not configured", "flights": []}
        
        try:
            logger.info(f"Searching flights: {origin} → {destination} on {departure_date}")
            
            response = self.client.shopping.flight_offers_search.get(
                originLocationCode=origin,
                destinationLocationCode=destination,
                departureDate=departure_date,
                returnDate=return_date,
                adults=adults,
                max=max_results
            )
            
            flights = []
            for offer in response.data:
                # Extract key information
                price = offer.get('price', {})
                itineraries = offer.get('itineraries', [])
                
                flight_data = {
                    "id": offer.get('id'),
                    "price": {
                        "total": price.get('total'),
                        "currency": price.get('currency')
                    },
                    "itineraries": []
                }
                
                for itinerary in itineraries:
                    segments = itinerary.get('segments', [])
                    itinerary_data = {
                        "duration": itinerary.get('duration'),
                        "segments": []
                    }
                    
                    for segment in segments:
                        departure = segment.get('departure', {})
                        arrival = segment.get('arrival', {})
                        
                        itinerary_data["segments"].append({
                            "departure": {
                                "airport": departure.get('iataCode'),
                                "time": departure.get('at')
                            },
                            "arrival": {
                                "airport": arrival.get('iataCode'),
                                "time": arrival.get('at')
                            },
                            "carrier": segment.get('carrierCode'),
                            "flight_number": segment.get('number'),
                            "duration": segment.get('duration')
                        })
                    
                    flight_data["itineraries"].append(itinerary_data)
                
                flights.append(flight_data)
            
            logger.info(f"Found {len(flights)} flight offer(s)")
            return {
                "flights": flights,
                "search": {
                    "origin": origin,
                    "destination": destination,
                    "departure_date": departure_date,
                    "return_date": return_date
                }
            }
        
        except ResponseError as error:
            logger.error(f"Amadeus API error: {error}")
            return {
                "error": str(error),
                "flights": []
            }
        except Exception as e:
            logger.error(f"Flight search failed: {e}", exc_info=True)
            return {
                "error": str(e),
                "flights": []
            }
    
    def search_hotels(
        self,
        city_code: str,
        check_in_date: Optional[str] = None,
        check_out_date: Optional[str] = None,
        adults: int = 1,
        max_results: int = 10
    ) -> Dict[str, Any]:
        """
        Search for hotels in a city.
        
        Args:
            city_code: City code (e.g., 'NYC', 'LON', 'TYO')
            check_in_date: Check-in date (YYYY-MM-DD)
            check_out_date: Check-out date (YYYY-MM-DD)
            adults: Number of guests
            max_results: Maximum results
        
        Returns:
            Dict with hotel listings
        """
        if not self.is_available():
            logger.warning("Amadeus API not configured — skipping hotel search")
            return None
        
        try:
            logger.info(f"Searching hotels in {city_code}")
            
            # First, get hotel list by city
            response = self.client.reference_data.locations.hotels.by_city.get(
                cityCode=city_code
            )
            
            hotels = []
            for hotel in response.data[:max_results]:
                hotel_data = {
                    "id": hotel.get('hotelId'),
                    "name": hotel.get('name'),
                    "location": {
                        "latitude": hotel.get('geoCode', {}).get('latitude'),
                        "longitude": hotel.get('geoCode', {}).get('longitude')
                    },
                    "address": hotel.get('address', {})
                }
                hotels.append(hotel_data)
            
            logger.info(f"Found {len(hotels)} hotel(s) in {city_code}")
            return {
                "hotels": hotels,
                "search": {
                    "city_code": city_code,
                    "check_in": check_in_date,
                    "check_out": check_out_date
                }
            }
        
        except ResponseError as error:
            logger.error(f"Amadeus hotel API error for city_code={city_code}: {error}")
            return None
        except Exception as e:
            logger.error(f"Hotel search failed for city_code={city_code}: {e}", exc_info=True)
            return None
    
    def search_hotel_offers(
        self,
        city_code: str,
        check_in_date: str,
        check_out_date: str,
        adults: int = 1,
        max_results: int = 5
    ) -> Dict[str, Any]:
        """
        Search for hotel offers with pricing and availability.
        
        Args:
            city_code: City code (e.g., 'NYC', 'LON', 'TYO')
            check_in_date: Check-in date (YYYY-MM-DD)
            check_out_date: Check-out date (YYYY-MM-DD)
            adults: Number of guests
            max_results: Maximum results
        
        Returns:
            Dict with hotel offers including pricing
        """
        if not self.is_available():
            return {"error": "Amadeus API not configured", "hotel_offers": []}
        
        try:
            logger.info(f"Searching hotel offers in {city_code} for {check_in_date} to {check_out_date}")
            
            # Search for hotel offers with pricing
            response = self.client.shopping.hotel_offers_search.get(
                cityCode=city_code,
                checkInDate=check_in_date,
                checkOutDate=check_out_date,
                adults=adults,
                roomQuantity=1,
                radius=50,
                radiusUnit='KM',
                currency='USD',
                bestRateOnly=True
            )
            
            hotel_offers = []
            for offer in response.data[:max_results]:
                hotel = offer.get('hotel', {})
                offers = offer.get('offers', [])
                
                # Get best offer (first one since bestRateOnly=True)
                best_offer = offers[0] if offers else {}
                price = best_offer.get('price', {})
                room = best_offer.get('room', {})
                
                hotel_data = {
                    "hotel_id": hotel.get('hotelId'),
                    "name": hotel.get('name'),
                    "location": {
                        "latitude": hotel.get('latitude'),
                        "longitude": hotel.get('longitude')
                    },
                    "address": {
                        "lines": [hotel.get('address', {}).get('lines', [''])[0]] if hotel.get('address') else [],
                        "cityName": hotel.get('address', {}).get('cityName'),
                        "countryCode": hotel.get('address', {}).get('countryCode')
                    },
                    "rating": hotel.get('rating'),
                    "price": {
                        "total": price.get('total'),
                        "currency": price.get('currency'),
                        "per_night": float(price.get('total', 0)) / max(1, (datetime.strptime(check_out_date, '%Y-%m-%d') - datetime.strptime(check_in_date, '%Y-%m-%d')).days) if price.get('total') else None
                    },
                    "room": {
                        "type": room.get('typeEstimated', {}).get('category'),
                        "beds": room.get('typeEstimated', {}).get('beds'),
                        "bedType": room.get('typeEstimated', {}).get('bedType')
                    },
                    "amenities": hotel.get('amenities', [])
                }
                hotel_offers.append(hotel_data)
            
            logger.info(f"Found {len(hotel_offers)} hotel offer(s) with pricing")
            return {
                "hotel_offers": hotel_offers,
                "search": {
                    "city_code": city_code,
                    "check_in": check_in_date,
                    "check_out": check_out_date
                }
            }
        
        except ResponseError as error:
            logger.error(f"Amadeus API error: {error}")
            return {
                "error": str(error),
                "hotel_offers": []
            }
        except Exception as e:
            logger.error(f"Hotel offers search failed: {e}", exc_info=True)
            return {
                "error": str(e),
                "hotel_offers": []
            }
    
    def get_flight_inspiration(
        self,
        origin: str,
        max_destinations: int = 10
    ) -> Dict[str, Any]:
        """
        Get cheapest flight destinations from an origin.
        
        Args:
            origin: Origin airport code (e.g., 'LAX')
            max_destinations: Maximum number of destinations to return
        
        Returns:
            Dict with cheapest destination offers
        """
        if not self.is_available():
            return {"error": "Amadeus API not configured", "destinations": []}
        
        try:
            logger.info(f"Fetching flight inspiration from {origin}")
            
            response = self.client.shopping.flight_destinations.get(
                origin=origin,
                maxPrice=2000  # Max price in USD
            )
            
            destinations = []
            for dest in response.data[:max_destinations]:
                destination_data = {
                    "destination": dest.get('destination'),
                    "origin": dest.get('origin'),
                    "price": {
                        "total": dest.get('price', {}).get('total'),
                        "currency": "USD"
                    },
                    "departure_date": dest.get('departureDate'),
                    "return_date": dest.get('returnDate'),
                    "type": dest.get('type')  # One-way or round-trip
                }
                destinations.append(destination_data)
            
            logger.info(f"Found {len(destinations)} flight inspiration destination(s)")
            return {
                "destinations": destinations,
                "origin": origin
            }
        
        except ResponseError as error:
            logger.error(f"Amadeus API error: {error}")
            return {
                "error": str(error),
                "destinations": []
            }
        except Exception as e:
            logger.error(f"Flight inspiration search failed: {e}", exc_info=True)
            return {
                "error": str(e),
                "destinations": []
            }
    
    def get_city_code(self, city_name: str) -> Optional[str]:
        """
        Get IATA city code via static mapping with Amadeus Location API fallback.
        """
        static_codes = {
            "tokyo": "TYO", "paris": "PAR", "london": "LON",
            "new york": "NYC", "los angeles": "LAX", "san francisco": "SFO",
            "chicago": "CHI", "miami": "MIA", "seattle": "SEA", "boston": "BOS",
            "rome": "ROM", "barcelona": "BCN", "amsterdam": "AMS",
            "dubai": "DXB", "singapore": "SIN", "hong kong": "HKG",
            "sydney": "SYD", "bangkok": "BKK", "seoul": "SEL", "beijing": "BJS",
            "istanbul": "IST", "berlin": "BER", "madrid": "MAD",
            "mumbai": "BOM", "delhi": "DEL", "taipei": "TPE",
            "kuala lumpur": "KUL", "osaka": "OSA", "kyoto": "UKY",
            "prague": "PRG", "vienna": "VIE", "lisbon": "LIS",
            "athens": "ATH", "cairo": "CAI", "cape town": "CPT",
            "buenos aires": "BUE", "mexico city": "MEX", "rio de janeiro": "RIO",
            "hanoi": "HAN", "dublin": "DUB", "edinburgh": "EDI",
            "copenhagen": "CPH", "stockholm": "STO", "oslo": "OSL",
            "helsinki": "HEL", "zurich": "ZRH", "florence": "FLR",
            "marrakech": "RAK", "havana": "HAV", "bali": "DPS",
            "phuket": "HKT", "cancun": "CUN", "reykjavik": "REK",
            "sendai": "SDJ", "sapporo": "SPK", "fukuoka": "FUK",
            "nagoya": "NGO", "hiroshima": "HIJ", "vancouver": "YVR",
            "toronto": "YTO", "montreal": "YMQ", "lima": "LIM",
            "bogota": "BOG", "santiago": "SCL", "johannesburg": "JNB",
            "nairobi": "NBO", "casablanca": "CAS", "doha": "DOH",
            "abu dhabi": "AUH", "ho chi minh city": "SGN",
            "jakarta": "JKT", "manila": "MNL", "auckland": "AKL",
            "melbourne": "MEL", "perth": "PER", "brisbane": "BNE",
        }
        code = static_codes.get(city_name.strip().lower())
        if code:
            return code

        if self.is_available():
            try:
                response = self.client.reference_data.locations.get(
                    keyword=city_name,
                    subType="CITY",
                )
                if response.data:
                    found_code = response.data[0].get("iataCode")
                    if found_code:
                        logger.info(f"Amadeus location lookup: {city_name} \u2192 {found_code}")
                        return found_code
            except Exception as e:
                logger.warning(f"Amadeus location lookup failed for '{city_name}': {e}")

        logger.warning(f"No IATA city code found for '{city_name}'")
        return None

    def get_airport_code(self, city_name: str) -> Optional[str]:
        """
        Get IATA airport code for a city.
        Uses static mapping with dynamic Amadeus fallback.
        """
        airport_codes = {
            "tokyo": "NRT", "paris": "CDG", "london": "LHR",
            "new york": "JFK", "los angeles": "LAX", "san francisco": "SFO",
            "chicago": "ORD", "miami": "MIA", "seattle": "SEA", "boston": "BOS",
            "rome": "FCO", "barcelona": "BCN", "amsterdam": "AMS",
            "dubai": "DXB", "singapore": "SIN", "hong kong": "HKG",
            "sydney": "SYD", "bangkok": "BKK", "seoul": "ICN", "beijing": "PEK",
        }
        code = airport_codes.get(city_name.strip().lower())
        if code:
            return code

        if self.is_available():
            try:
                response = self.client.reference_data.locations.get(
                    keyword=city_name,
                    subType="AIRPORT",
                )
                if response.data:
                    found_code = response.data[0].get("iataCode")
                    if found_code:
                        logger.info(f"Amadeus airport lookup: {city_name} \u2192 {found_code}")
                        return found_code
            except Exception as e:
                logger.warning(f"Amadeus airport lookup failed for '{city_name}': {e}")

        return None


# Global instance
amadeus_service = AmadeusService()

