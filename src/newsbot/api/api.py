"""JSON API routes."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from newsbot.api.deps import get_session
from newsbot.api.deps import get_settings
from newsbot.models import Article
from newsbot.models import Bookmark
from newsbot.schemas import ArticleListResponse
from newsbot.schemas import ArticleRead
from newsbot.schemas import HealthResponse
from newsbot.schemas import SourceRead
from newsbot.schemas import TrendsResponse
from newsbot.schemas import TrendItem
from newsbot.services.ingest import fetch_all_sources
from newsbot.services.query import build_health_summary
from newsbot.services.query import build_trends
from newsbot.services.query import InvalidCursorError
from newsbot.services.query import list_articles
from newsbot.services.query import list_sources


router = APIRouter(prefix="/api")


@router.get("/articles", response_model=ArticleListResponse)
def get_articles(
    category: str | None = Query(default=None),
    source: str | None = Query(default=None),
    q: str | None = Query(default=None),
    since: datetime | None = Query(default=None),
    cursor: str | None = Query(default=None),
    session: Session = Depends(get_session),
):
    try:
        items, next_cursor = list_articles(
            session,
            category=category,
            source_key=source,
            query_text=q,
            since=since,
            cursor=cursor,
        )
    except InvalidCursorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ArticleListResponse(
        items=[ArticleRead.model_validate(item) for item in items],
        next_cursor=next_cursor,
    )


@router.get("/sources", response_model=list[SourceRead])
def get_sources(session: Session = Depends(get_session)):
    return [SourceRead.model_validate(source) for source in list_sources(session)]


@router.get("/trends", response_model=TrendsResponse)
def get_trends(session: Session = Depends(get_session)):
    items = [TrendItem(category=category, count=count) for category, count in build_trends(session)]
    return TrendsResponse(categories=items)


@router.get("/admin/health", response_model=HealthResponse)
def get_health(session: Session = Depends(get_session)):
    return HealthResponse(**build_health_summary(session))


@router.post("/bookmarks/{article_id}")
def create_bookmark(article_id: int, session: Session = Depends(get_session)):
    article = session.get(Article, article_id)
    if article is None:
        raise HTTPException(status_code=404, detail="Article not found")
    existing = session.scalar(select(Bookmark).where(Bookmark.article_id == article_id))
    if existing is None:
        session.add(Bookmark(article_id=article_id))
        session.commit()
    return {"ok": True}


@router.post("/admin/fetch-now")
async def fetch_now(
    request: Request,
    source_key: str | None = Query(default=None),
    include_telegram_inputs: bool | None = Query(default=None),
    session: Session = Depends(get_session),
    settings=Depends(get_settings),
):
    del session
    include_telegram_sources = (
        settings.telegram_runtime_enabled
        if include_telegram_inputs is None
        else include_telegram_inputs
    )
    results = await fetch_all_sources(
        request.app.state.session_factory,
        settings,
        source_keys=[source_key] if source_key else None,
        include_telegram_sources=include_telegram_sources,
    )
    return {"ok": True, "results": results}
