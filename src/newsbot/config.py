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


def _has_local_telegram_session_file(session_name: str) -> bool:
    session_path = Path(session_name)
    candidates = [session_path]
    if session_path.suffix != ".session":
        candidates.append(session_path.with_suffix(".session"))
    return any(candidate.exists() for candidate in candidates)


def _telegram_env_ready() -> bool:
    api_id = os.getenv("NEWSBOT_TELEGRAM_API_ID")
    api_hash = os.getenv("NEWSBOT_TELEGRAM_API_HASH")
    session_name = os.getenv("NEWSBOT_TELEGRAM_SESSION_NAME", "newsbot")
    session_string = os.getenv("NEWSBOT_TELEGRAM_SESSION_STRING")
    if not api_id or not api_hash:
        return False
    return bool(session_string or _has_local_telegram_session_file(session_name))


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
    static_source_timeout_sec: int = field(
        default_factory=lambda: _int_env(
            "NEWSBOT_STATIC_SOURCE_TIMEOUT_SEC",
            _int_env("NEWSBOT_REQUEST_TIMEOUT_SEC", 10),
        )
    )
    static_page_fetch_timeout_sec: int = field(
        default_factory=lambda: _int_env("NEWSBOT_STATIC_PAGE_FETCH_TIMEOUT_SEC", 6)
    )
    static_archive_timeout_sec: int = field(
        default_factory=lambda: _int_env("NEWSBOT_STATIC_ARCHIVE_TIMEOUT_SEC", 5)
    )
    auto_disable_after_failures: int = field(
        default_factory=lambda: _int_env("NEWSBOT_AUTO_DISABLE_AFTER_FAILURES", 5)
    )
    telegram_input_enabled: bool = field(
        default_factory=lambda: _bool_env(
            "NEWSBOT_TELEGRAM_INPUT_ENABLED",
            _telegram_env_ready(),
        )
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
    telegram_session_string: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_TELEGRAM_SESSION_STRING")
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
    article_page_size: int = field(
        default_factory=lambda: _int_env("NEWSBOT_ARTICLE_PAGE_SIZE", 25)
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
    static_archive_url: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_STATIC_ARCHIVE_URL")
    )
    static_analysis_archive_url: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_STATIC_ANALYSIS_ARCHIVE_URL")
    )
    markets_enabled: bool = field(
        default_factory=lambda: _bool_env("NEWSBOT_MARKETS_ENABLED", True)
    )
    markets_stocks_provider: str = field(
        default_factory=lambda: os.getenv(
            "NEWSBOT_MARKETS_STOCKS_PROVIDER",
            "fmp",
        ).strip().lower()
        or "fmp"
    )
    markets_crypto_provider: str = field(
        default_factory=lambda: os.getenv(
            "NEWSBOT_MARKETS_CRYPTO_PROVIDER",
            "coingecko",
        ).strip().lower()
        or "coingecko"
    )
    markets_korea_provider: str = field(
        default_factory=lambda: os.getenv(
            "NEWSBOT_MARKETS_KOREA_PROVIDER",
            "kis",
        ).strip().lower()
        or "kis"
    )
    fmp_api_key: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_FMP_API_KEY")
    )
    kis_app_key: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_KIS_APP_KEY")
    )
    kis_app_secret: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_KIS_APP_SECRET")
    )
    coingecko_api_key: str | None = field(
        default_factory=lambda: os.getenv("NEWSBOT_COINGECKO_API_KEY")
    )
    markets_max_stocks: int = field(
        default_factory=lambda: _int_env("NEWSBOT_MARKETS_MAX_STOCKS", 180)
    )
    markets_max_kr_stocks: int = field(
        default_factory=lambda: _int_env("NEWSBOT_MARKETS_MAX_KR_STOCKS", 120)
    )
    markets_max_coins: int = field(
        default_factory=lambda: _int_env("NEWSBOT_MARKETS_MAX_COINS", 120)
    )
    deployment_surface: str = field(
        default_factory=lambda: (os.getenv("NEWSBOT_DEPLOYMENT_SURFACE", "local").strip().lower() or "local")
    )

    @property
    def telegram_session_configured(self) -> bool:
        return bool(
            self.telegram_session_string
            or _has_local_telegram_session_file(self.telegram_session_name)
        )

    @property
    def telegram_runtime_enabled(self) -> bool:
        return (
            self.telegram_input_enabled
            and bool(self.telegram_api_id)
            and bool(self.telegram_api_hash)
            and self.telegram_session_configured
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
