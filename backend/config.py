"""Application configuration and the shared Supabase service client."""
import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
    DEBUG = os.getenv("FLASK_DEBUG", "0") == "1"

    @classmethod
    def missing(cls):
        """Return the names of required settings that are empty."""
        required = {
            "SUPABASE_URL": cls.SUPABASE_URL,
            "SUPABASE_ANON_KEY": cls.SUPABASE_ANON_KEY,
            "SUPABASE_SERVICE_ROLE_KEY": cls.SUPABASE_SERVICE_ROLE_KEY,
        }
        return [name for name, value in required.items() if not value]


_client: Client | None = None


def get_supabase() -> Client:
    """Lazily create a service-role client. Never expose this key to the browser."""
    global _client
    if _client is None:
        if Config.missing():
            raise RuntimeError("Missing environment variables: " + ", ".join(Config.missing()))
        _client = create_client(Config.SUPABASE_URL, Config.SUPABASE_SERVICE_ROLE_KEY)
    return _client
