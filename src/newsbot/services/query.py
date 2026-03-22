"""Read queries for pages and APIs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import ceil

from sqlalchemy import desc
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.orm import Session

from newsbot.models import Article
from newsbot.models import Bookmark
from newsbot.models import FetchRun
from newsbot.models import Source


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _apply_article_filters(
    statement,
    *,
    category: str | None = None,
    source_key: str | None = None,
    query_text: str | None = None,
    since: datetime | None = None,
):
    if category:
        statement = statement.where(Article.primary_category == category)
    if source_key:
        statement = statement.where(Article.source_key == source_key)
    if query_text:
        like_value = f"%{query_text}%"
        statement = statement.where(Article.title.ilike(like_value))
    if since:
        statement = statement.where(Article.published_at >= since)
    return statement


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
    statement = _apply_article_filters(
        select(Article),
        category=category,
        source_key=source_key,
        query_text=query_text,
        since=since,
    )
    if cursor:
        statement = statement.where(Article.id < int(cursor))
    statement = statement.order_by(desc(Article.published_at), desc(Article.id)).limit(limit + 1)
    items = list(session.scalars(statement))
    next_cursor = str(items[-1].id) if len(items) > limit else None
    return items[:limit], next_cursor


def paginate_articles(
    session: Session,
    *,
    category: str | None = None,
    source_key: str | None = None,
    query_text: str | None = None,
    since: datetime | None = None,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[Article], int, int, int]:
    total_count = session.scalar(
        _apply_article_filters(
            select(func.count(Article.id)),
            category=category,
            source_key=source_key,
            query_text=query_text,
            since=since,
        )
    ) or 0
    total_pages = max(1, ceil(total_count / page_size)) if page_size > 0 else 1
    current_page = min(max(page, 1), total_pages)
    offset = (current_page - 1) * page_size
    statement = (
        _apply_article_filters(
            select(Article),
            category=category,
            source_key=source_key,
            query_text=query_text,
            since=since,
        )
        .order_by(desc(Article.published_at), desc(Article.id))
        .offset(offset)
        .limit(page_size)
    )
    items = list(session.scalars(statement))
    return items, int(total_count), int(total_pages), current_page


def list_bookmarked_articles(session: Session) -> list[Article]:
    statement = (
        select(Article)
        .join(Bookmark, Bookmark.article_id == Article.id)
        .order_by(desc(Bookmark.created_at))
    )
    return list(session.scalars(statement))


def list_sources(session: Session) -> list[Source]:
    return list(session.scalars(select(Source).order_by(Source.source_key)))


def build_refresh_notice(session: Session) -> dict[str, object]:
    latest_success = session.scalar(
        select(FetchRun)
        .where(
            FetchRun.status == "success",
            FetchRun.finished_at.is_not(None),
        )
        .order_by(desc(FetchRun.finished_at))
    )
    if latest_success is None or latest_success.finished_at is None:
        latest_attempt = session.scalar(
            select(FetchRun)
            .where(FetchRun.finished_at.is_not(None))
            .order_by(desc(FetchRun.finished_at))
        )
        if latest_attempt is not None and latest_attempt.finished_at is not None:
            refreshed_at = _as_utc(latest_attempt.finished_at)
            return {
                "tone": "waiting",
                "headline": "새 기사 반영 대기 중",
                "detail": "아직 성공한 수집이 없어 마지막 시도 시각만 표시합니다.",
                "refreshed_at": refreshed_at,
                "recent_inserted_count": 0,
                "window_minutes": 15,
            }
        return {
            "tone": "waiting",
            "headline": "첫 갱신 대기 중",
            "detail": "아직 수집 기록이 없습니다.",
            "refreshed_at": None,
            "recent_inserted_count": 0,
            "window_minutes": 15,
        }

    refreshed_at = _as_utc(latest_success.finished_at)
    window_minutes = 15
    recent_inserted_count = session.scalar(
        select(func.coalesce(func.sum(FetchRun.inserted_count), 0)).where(
            FetchRun.status == "success",
            FetchRun.finished_at.is_not(None),
            FetchRun.finished_at >= refreshed_at - timedelta(minutes=window_minutes),
            FetchRun.finished_at <= refreshed_at,
        )
    ) or 0
    is_recent = refreshed_at >= datetime.now(timezone.utc) - timedelta(minutes=20)

    if recent_inserted_count > 0:
        headline = "새로 갱신됐어요"
        detail = f"최근 {window_minutes}분 동안 새 기사 {recent_inserted_count}건을 반영했습니다."
        tone = "fresh"
    elif is_recent:
        headline = "방금 다시 확인했어요"
        detail = f"최근 {window_minutes}분 동안 새 기사는 없었지만 수집은 정상 동작했습니다."
        tone = "steady"
    else:
        headline = "마지막 갱신 기록"
        detail = "가장 최근 자동 수집 시각입니다."
        tone = "idle"

    return {
        "tone": tone,
        "headline": headline,
        "detail": detail,
        "refreshed_at": refreshed_at,
        "recent_inserted_count": int(recent_inserted_count),
        "window_minutes": window_minutes,
    }


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
