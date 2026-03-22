from __future__ import annotations

from newsbot.source_registry import get_source_definitions


def test_env_telegram_channels_are_added_to_source_definitions(monkeypatch):
    monkeypatch.setenv(
        "NEWSBOT_TELEGRAM_NEWS_CHANNELS",
        "@fresh_news, https://t.me/market_watch",
    )

    definitions = get_source_definitions()
    env_sources = {
        definition.source_key: definition
        for definition in definitions
        if definition.source_key.startswith("telegram-env-")
    }

    assert "telegram-env-fresh-news" in env_sources
    assert env_sources["telegram-env-fresh-news"].config["channel"] == "fresh_news"
    assert "telegram-env-market-watch" in env_sources
    assert env_sources["telegram-env-market-watch"].config["channel"] == "market_watch"
