from __future__ import annotations

import asyncio

import httpx

from newsbot.contracts import ArticleCandidate
from newsbot.services.thumbnails import extract_thumbnail_from_payload
from newsbot.services.thumbnails import extract_thumbnail_from_html
from newsbot.services.thumbnails import hydrate_candidate_thumbnails
from newsbot.source_registry import SourceDefinition


def _source_definition(
    *,
    allow_page_fetch: bool = False,
    adapter_type: str = "rss",
) -> SourceDefinition:
    return SourceDefinition(
        source_key="sample-source",
        name="Sample Source",
        adapter_type=adapter_type,
        category="crypto",
        poll_interval_sec=300,
        base_url="https://example.com",
        trust_level=70,
        allow_page_fetch=allow_page_fetch,
        config={},
    )


def test_extract_thumbnail_from_html_accepts_content_before_property_and_decodes_entities():
    html = """
    <html>
      <head>
        <meta content="https://images.example.com/hero.jpg?x=1&amp;y=2" property="og:image" />
      </head>
    </html>
    """

    thumbnail = extract_thumbnail_from_html(
        html,
        base_url="https://example.com/news/1",
    )

    assert thumbnail == "https://images.example.com/hero.jpg?x=1&y=2"


def test_hydrate_candidate_thumbnails_normalizes_existing_thumbnail_urls():
    candidate = ArticleCandidate(
        source_key="sample-source",
        source_name="Sample Source",
        title="Sample article title",
        url="https://example.com/news/1",
        thumbnail_url="https://images.example.com/thumb.jpg?x=1&amp;y=2",
    )

    async def run() -> None:
        async with httpx.AsyncClient() as client:
            await hydrate_candidate_thumbnails(
                [candidate],
                source_definition=_source_definition(),
                client=client,
            )

    asyncio.run(run())

    assert candidate.thumbnail_url == "https://images.example.com/thumb.jpg?x=1&y=2"


def test_extract_thumbnail_from_payload_supports_html_content_blocks():
    payload = {
        "content": [
            {
                "value": """
                <div>
                  <img src="/images/feed-hero.jpg" alt="hero" />
                </div>
                """,
            }
        ]
    }

    thumbnail = extract_thumbnail_from_payload(
        payload,
        base_url="https://example.com/news/1",
    )

    assert thumbnail == "https://example.com/images/feed-hero.jpg"


def test_extract_thumbnail_from_payload_prefers_html_img_over_broken_wrapper_url():
    payload = {
        "thumbnail_url": '<div><img src="https:/img.etoday.co.kr/crop/200/120/2320207.jpg" /></div>',
    }

    thumbnail = extract_thumbnail_from_payload(
        payload,
        base_url="https://www.etoday.co.kr/news/view/2572888",
    )

    assert thumbnail == "https://img.etoday.co.kr/crop/200/120/2320207.jpg"


def test_extract_thumbnail_from_html_repairs_single_slash_https_urls():
    html = """
    <html>
      <body>
        <img src="https:/img.etoday.co.kr/crop/200/120/2320207.jpg" alt="hero" />
      </body>
    </html>
    """

    thumbnail = extract_thumbnail_from_html(
        html,
        base_url="https://www.etoday.co.kr/news/view/2572888",
    )

    assert thumbnail == "https://img.etoday.co.kr/crop/200/120/2320207.jpg"


def test_hydrate_candidate_thumbnails_fetches_page_for_telegram_sources():
    candidate = ArticleCandidate(
        source_key="telegram-dada-news2",
        source_name="Telegram @dada_news2",
        title="Telegram linked article",
        url="https://example.com/news/1",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://example.com/news/1"
        assert "Mozilla/5.0" in request.headers["User-Agent"]
        assert request.headers["Accept-Language"].startswith("ko-KR")
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            text="""
            <html>
              <head>
                <meta property="og:image" content="/images/hero.jpg" />
              </head>
            </html>
            """,
        )

    async def run() -> None:
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            await hydrate_candidate_thumbnails(
                [candidate],
                source_definition=_source_definition(
                    allow_page_fetch=True,
                    adapter_type="telegram_channel",
                ),
                client=client,
            )

    asyncio.run(run())

    assert candidate.thumbnail_url == "https://example.com/images/hero.jpg"
