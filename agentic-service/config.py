"""
Configuration management for agentic service.
Loads environment variables for database, OpenAI, Ollama, FAISS.
"""
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Service configuration from environment variables."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        extra="allow",
        case_sensitive=False,
    )

    database_url: Optional[str] = None
    openai_api_key: str
    ollama_base_url: str = "http://localhost:11434"
    faiss_index_path: str = "./data/faiss_index"
    hf_model_name: str = "sentence-transformers/all-MiniLM-L6-v2"
    
    # Optional external APIs
    google_maps_api_key: Optional[str] = None
    amadeus_api_key: Optional[str] = None
    amadeus_api_secret: Optional[str] = None
    openweather_api_key: Optional[str] = None
    unsplash_access_key: Optional[str] = None

    # Redis (optional – falls back to in-memory LRU when unavailable)
    redis_url: Optional[str] = None  # e.g. redis://localhost:6379/0
    cache_ttl_seconds: int = 86400  # 24 hours


settings = Settings()
