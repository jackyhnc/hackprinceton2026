from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    knot_client_id: str = ""
    knot_secret: str = ""
    knot_environment: str = "development"
    knot_webhook_secret: str = ""

    k2_api_key: str = ""
    k2_base_url: str = ""
    k2_model: str = "k2-think-v2"

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    supabase_url: str = ""
    supabase_secret_key: str = ""

    shopify_api_key: str = ""
    shopify_api_secret: str = ""
    shopify_shop: str = ""
    shopify_admin_token: str = ""

    dedalus_api_key: str = ""
    dedalus_image: str = "twinstore-swarm-runner:latest"

    backend_public_url: str = "http://localhost:8000"


settings = Settings()
