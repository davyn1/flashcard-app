from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # argon2 ($argon2id$...) or bcrypt ($2b$...) hash of the app password.
    app_password_hash: str = ""
    jwt_secret: str = ""
    jwt_expire_days: int = 90

    database_url: str = "sqlite:///./flashcards.db"

    # Comma-separated list of allowed frontend origins.
    cors_origins: str = "http://localhost:5173"

    # Login rate limit: at most this many attempts per client IP per window.
    login_rate_limit: int = 5
    login_rate_window_seconds: int = 60

    @field_validator("database_url")
    @classmethod
    def _normalize_db_url(cls, v: str) -> str:
        # Hosted Postgres providers hand out postgres:// or postgresql:// URLs;
        # point SQLAlchemy at the psycopg (v3) driver.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://") :]
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
