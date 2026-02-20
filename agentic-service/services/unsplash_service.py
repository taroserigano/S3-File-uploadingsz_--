"""
Unsplash API service for fetching destination images.
"""
import os
import logging
from typing import Optional, Dict, Any
import httpx

logger = logging.getLogger(__name__)


class UnsplashService:
    """Service for fetching images from Unsplash API."""
    
    def __init__(self, access_key: str = None):
        # Accept explicit key, fall back to env vars
        self.access_key = (
            access_key
            or os.getenv("UNSPLASH_ACCESS_KEY")
            or os.getenv("UNSPLASH_API_KEY")
        )
        self.base_url = "https://api.unsplash.com"
        
        if not self.access_key:
            logger.warning("UNSPLASH_ACCESS_KEY not set - hero images will be unavailable")
    
    def get_destination_image(
        self, 
        destination: str, 
        country: str = None,
        orientation: str = "landscape"
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch a hero image for a destination from Unsplash.
        
        Args:
            destination: City or location name
            country: Country name (optional, helps with search accuracy)
            orientation: Image orientation (landscape, portrait, squarish)
            
        Returns:
            Dict with image data or None if fetch fails:
            {
                "url": str,          # Full resolution URL
                "regular": str,      # Regular size URL (1080px)
                "small": str,        # Small size URL (400px)
                "thumb": str,        # Thumbnail URL (200px)
                "photographer": str, # Photographer name
                "photographer_url": str,  # Photographer Unsplash profile
                "download_location": str  # Required for Unsplash attribution tracking
            }
        """
        if not self.access_key:
            logger.warning("Cannot fetch image - Unsplash API key not configured")
            return None
        
        try:
            # Build search query
            query = f"{destination} travel landmark"
            if country:
                query = f"{destination} {country} travel"
            
            # Call Unsplash search API
            url = f"{self.base_url}/search/photos"
            params = {
                "query": query,
                "per_page": 1,
                "orientation": orientation,
                "order_by": "relevant",
            }
            headers = {
                "Authorization": f"Client-ID {self.access_key}",
                "Accept-Version": "v1"
            }
            
            logger.info(f"Fetching Unsplash image for: {query}")
            
            with httpx.Client(timeout=10.0) as client:
                response = client.get(url, params=params, headers=headers)
                response.raise_for_status()
                data = response.json()
            
            if not data.get("results"):
                logger.warning(f"No images found for query: {query}")
                return None
            
            # Extract first result
            photo = data["results"][0]
            
            image_data = {
                "url": photo["urls"]["full"],
                "regular": photo["urls"]["regular"],
                "small": photo["urls"]["small"],
                "thumb": photo["urls"]["thumb"],
                "photographer": photo["user"]["name"],
                "photographer_url": photo["user"]["links"]["html"],
                "download_location": photo["links"]["download_location"],
                "alt_description": photo.get("alt_description", f"{destination} travel destination"),
            }
            
            logger.info(f"Successfully fetched image by {image_data['photographer']}")
            return image_data
            
        except httpx.TimeoutException:
            logger.error("Unsplash API request timed out")
            return None
        except httpx.HTTPStatusError as e:
            logger.error(f"Unsplash API error: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            logger.error(f"Failed to fetch Unsplash image: {str(e)}", exc_info=True)
            return None
    
    def trigger_download(self, download_location: str) -> None:
        """
        Trigger download tracking endpoint (required by Unsplash API guidelines).
        Call this when an image is actually used/displayed.
        
        Args:
            download_location: The download_location URL from the image data
        """
        if not self.access_key or not download_location:
            return
        
        try:
            headers = {
                "Authorization": f"Client-ID {self.access_key}",
            }
            with httpx.Client(timeout=5.0) as client:
                client.get(download_location, headers=headers)
            logger.debug("Triggered Unsplash download tracking")
        except Exception as e:
            logger.warning(f"Failed to trigger Unsplash download tracking: {e}")


# Global instance (key resolved lazily via settings or env)
try:
    from config import settings as _settings
    unsplash_service = UnsplashService(access_key=_settings.unsplash_access_key)
except Exception:
    unsplash_service = UnsplashService()
