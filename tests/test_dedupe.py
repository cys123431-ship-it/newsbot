from __future__ import annotations

from datetime import datetime, timedelta, timezone

from newsbot.contracts import ArticleCandidate
from newsbot.models import Article
from newsbot.services.dedupe import find_existing_article
from newsbot.text_tools import build_title_hash
from newsbot.text_tools import normalize_title


def test_find_existing_article_by_similar_title_and_time_window(app):
    session_factory = app.state.session_factory
    published_at = datetime.now(tz=timezone.utc)
    with session_factory() as session:
        article = Article(
            title="Fed signals slower rate cuts after strong jobs report",
            canonical_url="https://example.com/fed-story",
            source_key="federalreserve-rss",
            source_name="Federal Reserve",
            published_at=published_at,
            primary_category="us-finance",
            tags=[],
            short_summary="summary",
            language="en",
            trust_level=90,
            title_hash=build_title_hash(
                "Fed signals slower rate cuts after strong jobs report"
            ),
            normalized_title=normalize_title(
                "Fed signals slower rate cuts after strong jobs report"
            ),
        )
        session.add(article)
        session.commit()

        candidate = ArticleCandidate(
            source_key="sec-rss",
            source_name="SEC",
            title="Fed signals slower rate cuts after strong jobs report",
            url="https://another.example.com/story",
            published_at=published_at + timedelta(hours=2),
            summary="summary",
        )
        assert find_existing_article(session, candidate).id == article.id

