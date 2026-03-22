"""Static source registry."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from newsbot.categories import CATEGORY_CRYPTO
from newsbot.categories import CATEGORY_KR_SOCIETY
from newsbot.categories import CATEGORY_MILITARY
from newsbot.categories import CATEGORY_TECH_IT
from newsbot.categories import CATEGORY_US_FINANCE


@dataclass(frozen=True, slots=True)
class SourceDefinition:
    source_key: str
    name: str
    adapter_type: str
    category: str | None
    poll_interval_sec: int
    base_url: str
    trust_level: int
    discovery_only: bool = False
    allow_page_fetch: bool = False
    static_enabled: bool = True
    dedupe_strategy: str = "default"
    config: dict[str, Any] = field(default_factory=dict)


SOURCE_DEFINITIONS = [
    SourceDefinition(
        source_key="coindesk-rss",
        name="CoinDesk",
        adapter_type="rss",
        category=CATEGORY_CRYPTO,
        poll_interval_sec=300,
        base_url="https://www.coindesk.com",
        trust_level=90,
        config={"feed_url": "https://www.coindesk.com/arc/outboundfeeds/rss/"},
    ),
    SourceDefinition(
        source_key="cointelegraph-rss",
        name="Cointelegraph",
        adapter_type="rss",
        category=CATEGORY_CRYPTO,
        poll_interval_sec=300,
        base_url="https://cointelegraph.com",
        trust_level=85,
        config={"feed_url": "https://cointelegraph.com/rss"},
    ),
    SourceDefinition(
        source_key="sec-crypto-rss",
        name="SEC Crypto Filter",
        adapter_type="rss",
        category=CATEGORY_CRYPTO,
        poll_interval_sec=300,
        base_url="https://www.sec.gov",
        trust_level=95,
        config={
            "feed_url": "https://www.sec.gov/news/pressreleases.rss",
            "include_keywords": [
                "crypto",
                "digital asset",
                "bitcoin",
                "ethereum",
                "token",
                "blockchain",
            ],
        },
    ),
    SourceDefinition(
        source_key="federalreserve-rss",
        name="Federal Reserve",
        adapter_type="rss",
        category=CATEGORY_US_FINANCE,
        poll_interval_sec=300,
        base_url="https://www.federalreserve.gov",
        trust_level=100,
        config={"feed_url": "https://www.federalreserve.gov/feeds/press_all.xml"},
    ),
    SourceDefinition(
        source_key="sec-rss",
        name="SEC Press Releases",
        adapter_type="rss",
        category=CATEGORY_US_FINANCE,
        poll_interval_sec=300,
        base_url="https://www.sec.gov",
        trust_level=95,
        config={"feed_url": "https://www.sec.gov/news/pressreleases.rss"},
    ),
    SourceDefinition(
        source_key="bls-rss",
        name="BLS Latest Releases",
        adapter_type="rss",
        category=CATEGORY_US_FINANCE,
        poll_interval_sec=300,
        base_url="https://www.bls.gov",
        trust_level=95,
        config={"feed_url": "https://www.bls.gov/feed/bls_latest.rss"},
    ),
    SourceDefinition(
        source_key="techcrunch-rss",
        name="TechCrunch",
        adapter_type="rss",
        category=CATEGORY_TECH_IT,
        poll_interval_sec=300,
        base_url="https://techcrunch.com",
        trust_level=85,
        config={"feed_url": "https://techcrunch.com/feed/"},
    ),
    SourceDefinition(
        source_key="arstechnica-rss",
        name="Ars Technica",
        adapter_type="rss",
        category=CATEGORY_TECH_IT,
        poll_interval_sec=300,
        base_url="https://arstechnica.com",
        trust_level=85,
        config={"feed_url": "https://feeds.arstechnica.com/arstechnica/index"},
    ),
    SourceDefinition(
        source_key="defense-rss",
        name="Defense.gov",
        adapter_type="rss",
        category=CATEGORY_MILITARY,
        poll_interval_sec=300,
        base_url="https://www.defense.gov",
        trust_level=95,
        config={
            "feed_url": "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=20"
        },
    ),
    SourceDefinition(
        source_key="army-news",
        name="Army News",
        adapter_type="html_discovery",
        category=CATEGORY_MILITARY,
        poll_interval_sec=600,
        base_url="https://www.army.mil/news",
        trust_level=90,
        discovery_only=False,
        allow_page_fetch=False,
        config={
            "page_url": "https://www.army.mil/news",
            "allowed_domains": ["www.army.mil", "army.mil"],
            "article_prefixes": ["/article/", "/news/"],
        },
    ),
    SourceDefinition(
        source_key="naver-kr-society",
        name="NAVER News Search",
        adapter_type="naver_search",
        category=CATEGORY_KR_SOCIETY,
        poll_interval_sec=600,
        base_url="https://openapi.naver.com",
        trust_level=70,
        discovery_only=True,
        config={
            "queries": [
                "사건 사고",
                "재난 안전",
                "노동 현장",
                "교육 현장",
                "복지 현장",
                "의료 현장",
                "교통 안전",
                "지역 사회",
            ],
            "display": 10,
        },
    ),
    SourceDefinition(
        source_key="sbs-society-rss",
        name="SBS Society",
        adapter_type="rss",
        category=CATEGORY_KR_SOCIETY,
        poll_interval_sec=300,
        base_url="https://news.sbs.co.kr",
        trust_level=82,
        config={
            "feed_url": "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=03&plink=RSSREADER"
        },
    ),
    SourceDefinition(
        source_key="yahoo-finance-discovery",
        name="Yahoo Finance Discovery",
        adapter_type="html_discovery",
        category=CATEGORY_US_FINANCE,
        poll_interval_sec=600,
        base_url="https://finance.yahoo.com",
        trust_level=40,
        discovery_only=True,
        static_enabled=False,
        config={
            "page_url": "https://finance.yahoo.com/",
            "allowed_domains": ["finance.yahoo.com"],
            "article_prefixes": ["/news/", "/video/"],
        },
    ),
    SourceDefinition(
        source_key="financialjuice-discovery",
        name="FinancialJuice Discovery",
        adapter_type="html_discovery",
        category=CATEGORY_US_FINANCE,
        poll_interval_sec=600,
        base_url="https://www.financialjuice.com",
        trust_level=35,
        discovery_only=True,
        static_enabled=False,
        config={
            "page_url": "https://www.financialjuice.com/home",
            "allowed_domains": ["www.financialjuice.com", "financialjuice.com"],
            "article_prefixes": ["/home", "/news", "/article"],
        },
    ),
    SourceDefinition(
        source_key="telegram-dada-news2",
        name="Telegram @dada_news2",
        adapter_type="telegram_channel",
        category=None,
        poll_interval_sec=180,
        base_url="https://t.me/dada_news2",
        trust_level=55,
        config={"channel": "dada_news2"},
    ),
    SourceDefinition(
        source_key="telegram-news-kor",
        name="Telegram @news_kor",
        adapter_type="telegram_channel",
        category=None,
        poll_interval_sec=180,
        base_url="https://t.me/news_kor",
        trust_level=55,
        config={"channel": "news_kor"},
    ),
    SourceDefinition(
        source_key="telegram-claw-summary",
        name="Telegram @clawnewssummary",
        adapter_type="telegram_channel",
        category=None,
        poll_interval_sec=180,
        base_url="https://t.me/clawnewssummary",
        trust_level=55,
        config={"channel": "clawnewssummary"},
    ),
]


def get_source_definition(source_key: str) -> SourceDefinition:
    for source_definition in SOURCE_DEFINITIONS:
        if source_definition.source_key == source_key:
            return source_definition
    raise KeyError(f"Unknown source_key: {source_key}")
