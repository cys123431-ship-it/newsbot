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
    assert env_sources["telegram-env-fresh-news"].config["hub"] == "global"
    assert "telegram-env-market-watch" in env_sources
    assert env_sources["telegram-env-market-watch"].config["channel"] == "market_watch"


def test_source_registry_exposes_large_kr_and_us_hubs():
    definitions = get_source_definitions()
    kr_sources = [definition for definition in definitions if definition.config.get("hub") == "kr"]
    us_sources = [definition for definition in definitions if definition.config.get("hub") == "us"]

    assert len(kr_sources) >= 20
    assert len(us_sources) >= 50

    source_keys = {definition.source_key for definition in definitions}
    assert "sbs-politics-rss" in source_keys
    assert "khan-local-rss" in source_keys
    assert "donga-culture-rss" in source_keys
    assert "nyt-world-rss" in source_keys
    assert "cnn-money-rss" in source_keys
    assert "axios-feed" in source_keys
    assert "npr-politics-rss" in source_keys
    assert "bloomberg-markets-rss" in source_keys
    assert "guardian-us-rss" in source_keys
    assert "latimes-world-rss" in source_keys
    assert "verge-rss" in source_keys
    assert "semafor-feed" in source_keys
    assert "breitbart-feed" in source_keys


def test_source_registry_attaches_hub_section_and_publisher_group():
    definitions = {definition.source_key: definition for definition in get_source_definitions()}

    assert definitions["sbs-economy-rss"].config["hub"] == "kr"
    assert definitions["sbs-economy-rss"].config["section"] == "economy"
    assert definitions["sbs-economy-rss"].config["publisher_group"] == "broadcast"

    assert definitions["wapo-business-rss"].config["hub"] == "us"
    assert definitions["wapo-business-rss"].config["section"] == "economy"
    assert definitions["wapo-business-rss"].config["publisher_group"] == "newspaper"

    assert definitions["npr-politics-rss"].config["hub"] == "us"
    assert definitions["npr-politics-rss"].config["section"] == "politics"
    assert definitions["npr-politics-rss"].config["publisher_group"] == "public-media"

    assert definitions["bloomberg-markets-rss"].config["hub"] == "us"
    assert definitions["bloomberg-markets-rss"].config["section"] == "markets"
    assert definitions["bloomberg-markets-rss"].config["publisher_group"] == "business"

    assert definitions["semafor-feed"].config["hub"] == "us"
    assert definitions["semafor-feed"].config["section"] == "general"
    assert definitions["semafor-feed"].config["publisher_group"] == "internet"
