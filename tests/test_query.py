from __future__ import annotations

from datetime import datetime
from datetime import timezone

from newsbot.models import Article
from newsbot.services.query import list_articles


def test_list_articles_cursor_supports_null_published_at(app):
    session_factory = app.state.session_factory

    with session_factory() as session:
        session.add_all(
            [
                Article(
                    title="Newest timed story",
                    canonical_url="https://example.com/timed",
                    source_key="coindesk-rss",
                    source_name="CoinDesk",
                    published_at=datetime(2026, 3, 25, 10, 0, tzinfo=timezone.utc),
                    primary_category="crypto",
                    language="en",
                    trust_level=90,
                    title_hash="timed-hash",
                    normalized_title="newest timed story",
                ),
                Article(
                    title="Null timestamp story B",
                    canonical_url="https://example.com/null-b",
                    source_key="coindesk-rss",
                    source_name="CoinDesk",
                    published_at=None,
                    primary_category="crypto",
                    language="en",
                    trust_level=90,
                    title_hash="null-hash-b",
                    normalized_title="null timestamp story b",
                ),
                Article(
                    title="Null timestamp story A",
                    canonical_url="https://example.com/null-a",
                    source_key="coindesk-rss",
                    source_name="CoinDesk",
                    published_at=None,
                    primary_category="crypto",
                    language="en",
                    trust_level=90,
                    title_hash="null-hash-a",
                    normalized_title="null timestamp story a",
                ),
            ]
        )
        session.commit()

        first_page, cursor = list_articles(session, category="crypto", limit=2)
        second_page, next_cursor = list_articles(
            session,
            category="crypto",
            limit=2,
            cursor=cursor,
        )

    assert [article.canonical_url for article in first_page] == [
        "https://example.com/timed",
        "https://example.com/null-a",
    ]
    assert cursor is not None
    assert [article.canonical_url for article in second_page] == [
        "https://example.com/null-b",
    ]
    assert next_cursor is None
