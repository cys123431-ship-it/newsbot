"""Read queries for pages and APIs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import desc
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.orm import Session

from newsbot.models import Article
from newsbot.models import Bookmark
from newsbot.models import FetchRun
from newsbot.models import Source


def list_articles(
    session: Session,
    *,
    category: str | None = None,
    source_key: str | None = None,
    query_text: str | None = None,
    since: datetime | None = None,
    cursor: str | None = None,
    limit: int = 30,
) -> tuple[list[Article], str | None]:
    statement = select(Article)
    if category:
        statement = statement.where(Article.primary_category == category)
    if source_key:
        statement = statement.where(Article.source_key == source_key)
    if query_text:
        like_value = f"%{query_text}%"
        statement = statement.where(Article.title.ilike(like_value))
    if since:
        statement = statement.where(Article.published_at >= since)
    if cursor:
        statement = statement.where(Article.id < int(cursor))
    statement = statement.order_by(desc(Article.published_at), desc(Article.id)).limit(limit + 1)
    items = list(session.scalars(statement))
    next_cursor = str(items[-1].id) if len(items) > limit else None
    return items[:limit], next_cursor


def list_bookmarked_articles(session: Session) -> list[Article]:
    statement = (
        select(Article)
        .join(Bookmark, Bookmark.article_id == Article.id)
        .order_by(desc(Bookmark.created_at))
    )
    return list(session.scalars(statement))


def list_sources(session: Session) -> list[Source]:
    return list(session.scalars(select(Source).order_by(Source.source_key)))


def build_trends(session: Session) -> list[tuple[str, int]]:
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    rows = session.execute(
        select(Article.primary_category, func.count(Article.id))
        .where(Article.created_at >= since)
        .group_by(Article.primary_category)
        .order_by(func.count(Article.id).desc())
    )
    return [(row[0], row[1]) for row in rows]


def build_health_summary(session: Session) -> dict[str, int]:
    total_sources = session.scalar(select(func.count(Source.id))) or 0
    unhealthy_sources = session.scalar(
        select(func.count(Source.id)).where(Source.consecutive_failures > 0)
    ) or 0
    recent_fetch_runs = session.scalar(
        select(func.count(FetchRun.id)).where(
            FetchRun.started_at >= datetime.now(timezone.utc) - timedelta(hours=24)
        )
    ) or 0
    return {
        "total_sources": total_sources,
        "healthy_sources": total_sources - unhealthy_sources,
        "unhealthy_sources": unhealthy_sources,
        "recent_fetch_runs": recent_fetch_runs,
    }

