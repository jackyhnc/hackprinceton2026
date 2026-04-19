from functools import lru_cache

from supabase import Client, create_client

from config import settings


@lru_cache(maxsize=1)
def supa() -> Client:
    return create_client(settings.supabase_url, settings.supabase_secret_key)
