"""Application settings."""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from functools import lru_cache
import os
from pathlib import Path


def _load_dotenv() -> None:
    dotenv_path = Path(".env")
    if not dotenv_path.exists():
        return
    for line in dotenv_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()


def _bool_env(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return int(raw_value.strip())


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str = "newsbot"
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "NEWSBOT_DATABASE_URL", "sqlite:///./newsbot.db"
        )
    )
    bootstrap_on_startup: bool = field(
        default_factory=lambda: _bool_env("NEWSBOT_BOOTSTRAP_ON_STARTUP", True)
    )
    enable_scheduler: bool = field(
        default_factory=lambda: _bool_env("NEWSBOT_ENABLE_SCHEDULER", True)
    )
    request_timeout_sec: int = field(
        default_factory=lambda: _int_env("NEWSBOT_REQUEST_TIMEOUT_SEC", 10)
    )
    max_retries: int = field(default_factory=lambda: _int_env("NEWSBOT_MAX_RETRIES", 3))
    auto_disable_after_failures: int = field(
        default_factory=lambda: _int_env("NEWSBOT_AUTO_DISABLE_AFTER_FAILURES", 5)
    )
    telegram_input_enabled: bool = field(
        default_factory=lambda: _bool_env("NEWSBOT_TELEGRAM_INPUT_ENABLED", False)
    )
    telegram_api_id: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_TELEGRAM_API_ID")
    )
    telegram_api_hash: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_TELEGRAM_API_HASH")
    )
    telegram_session_name: str = field(
        default_factory=lambda: os.getenv("NEWSBOT_TELEGRAM_SESSION_NAME", "newsbot")
    )
    naver_client_id: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_NAVER_CLIENT_ID")
    )
    naver_client_secret: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_NAVER_CLIENT_SECRET")
    )
    static_output_dir: str = field(
        default_factory=lambda: os.getenv("NEWSBOT_STATIC_OUTPUT_DIR", "site-dist")
    )
    static_fetch_concurrency: int = field(
        default_factory=lambda: _int_env("NEWSBOT_STATIC_FETCH_CONCURRENCY", 5)
    )
    static_min_articles_to_publish: int = field(
        default_factory=lambda: _int_env("NEWSBOT_STATIC_MIN_ARTICLES_TO_PUBLISH", 20)
    )
    static_max_articles_per_source: int = field(
        default_factory=lambda: _int_env("NEWSBOT_STATIC_MAX_ARTICLES_PER_SOURCE", 18)
    )
    static_max_total_articles: int = field(
        default_factory=lambda: _int_env("NEWSBOT_STATIC_MAX_TOTAL_ARTICLES", 140)
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
