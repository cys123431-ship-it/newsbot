from __future__ import annotations

import asyncio

import httpx

from newsbot.contracts import ArticleCandidate
from newsbot.services.thumbnails import extract_thumbnail_from_html
from newsbot.services.thumbnails import hydrate_candidate_thumbnails
from newsbot.source_registry import SourceDefinition


def _source_definition(*, allow_page_fetch: bool = False) -> SourceDefinition:
    return SourceDefinition(
        source_key="sample-source",
        name="Sample Source",
        adapter_type="rss",
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
