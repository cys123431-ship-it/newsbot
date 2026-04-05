from __future__ import annotations

from datetime import datetime
from datetime import timezone

from newsbot.models import Article
from newsbot.services.query import list_articles
from newsbot.services.query import list_sources
from newsbot.text_tools import build_title_hash
from newsbot.text_tools import normalize_title


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


def test_list_articles_hides_blocked_sources_and_decodes_entities(app):
    session_factory = app.state.session_factory

    with session_factory() as session:
        visible_title = '중단 거부 박상용에 민주당 &quot;법적 조치&quot;'
        session.add_all(
            [
                Article(
                    title=visible_title,
                    canonical_url="https://example.com/visible",
                    source_key="coindesk-rss",
                    source_name="CoinDesk",
                    thumbnail_url="https://img.example.com/thumb.jpg?x=1&amp;y=2",
                    published_at=datetime(2026, 4, 5, 10, 0, tzinfo=timezone.utc),
                    primary_category="crypto",
                    language="ko",
                    trust_level=90,
                    title_hash=build_title_hash(visible_title),
                    normalized_title=normalize_title(visible_title),
                ),
                Article(
                    title="프레시안 기사는 숨김 처리",
                    canonical_url="https://example.com/pressian-hidden",
                    source_key="pressian-politics-rss",
                    source_name="Pressian Politics",
                    published_at=datetime(2026, 4, 5, 10, 1, tzinfo=timezone.utc),
                    primary_category="kr-politics",
                    language="ko",
                    trust_level=80,
                    title_hash=build_title_hash("프레시안 기사는 숨김 처리"),
                    normalized_title=normalize_title("프레시안 기사는 숨김 처리"),
                ),
            ]
        )
        session.commit()

        articles, _ = list_articles(session, limit=10)
        sources = list_sources(session)

    assert [article.source_key for article in articles] == ["coindesk-rss"]
    assert articles[0].title == '중단 거부 박상용에 민주당 "법적 조치"'
    assert articles[0].thumbnail_url == "https://img.example.com/thumb.jpg?x=1&y=2"
    assert all(source.source_key != "pressian-politics-rss" for source in sources)
