"""Server-rendered pages."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlencode

from fastapi import APIRouter
from fastapi import Depends
from fastapi import Query
from fastapi import Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session

from newsbot.api.deps import get_session
from newsbot.categories import ALL_CATEGORIES
from newsbot.categories import CATEGORY_LABELS
from newsbot.models import FetchRun
from newsbot.services.query import build_health_summary
from newsbot.services.query import build_refresh_notice
from newsbot.services.query import list_bookmarked_articles
from newsbot.services.query import list_sources
from newsbot.services.query import paginate_articles


router = APIRouter()
templates = Jinja2Templates(
    directory=str(Path(__file__).resolve().parent.parent / "templates")
)


def _render_article_page(
    request: Request,
    session: Session,
    *,
    category: str | None,
    q: str | None,
    source: str | None,
    page: int,
) -> HTMLResponse:
    articles, total_count, total_pages, current_page = paginate_articles(
        session,
        category=category,
        source_key=source,
        query_text=q,
        page=page,
        page_size=request.app.state.settings.article_page_size,
    )
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "request": request,
            "articles": articles,
            "categories": ALL_CATEGORIES,
            "category_labels": CATEGORY_LABELS,
            "active_category": category,
            "active_query": q or "",
            "active_source": source or "",
            "sources": list_sources(session),
            "page_title": "전체 뉴스" if category is None else CATEGORY_LABELS[category],
            "current_page": current_page,
            "total_pages": total_pages,
            "total_count": total_count,
            "pagination_items": _build_pagination_items(
                request.url.path,
                page=current_page,
                total_pages=total_pages,
                q=q,
                source=source,
            ),
            "prev_page_url": _build_page_url(
                request.url.path,
                page=max(current_page - 1, 1),
                q=q,
                source=source,
            )
            if current_page > 1
            else None,
            "next_page_url": _build_page_url(
                request.url.path,
                page=min(current_page + 1, total_pages),
                q=q,
                source=source,
            )
            if current_page < total_pages
            else None,
            "refresh_notice": build_refresh_notice(session),
        },
    )


@router.get("/", response_class=HTMLResponse)
def index(
    request: Request,
    q: str | None = Query(default=None),
    source: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    session: Session = Depends(get_session),
):
    return _render_article_page(request, session, category=None, q=q, source=source, page=page)


@router.get("/category/{category}", response_class=HTMLResponse)
def category_page(
    request: Request,
    category: str,
    q: str | None = Query(default=None),
    source: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    session: Session = Depends(get_session),
):
    return _render_article_page(
        request,
        session,
        category=category,
        q=q,
        source=source,
        page=page,
    )


@router.get("/bookmarks", response_class=HTMLResponse)
def bookmarks(request: Request, session: Session = Depends(get_session)):
    return templates.TemplateResponse(
        request,
        "bookmarks.html",
        {
            "request": request,
            "articles": list_bookmarked_articles(session),
            "category_labels": CATEGORY_LABELS,
            "refresh_notice": build_refresh_notice(session),
        },
    )


@router.get("/sources", response_class=HTMLResponse)
def sources(request: Request, session: Session = Depends(get_session)):
    return templates.TemplateResponse(
        request,
        "sources.html",
        {
            "request": request,
            "sources": list_sources(session),
            "category_labels": CATEGORY_LABELS,
            "refresh_notice": build_refresh_notice(session),
        },
    )


@router.get("/admin/health", response_class=HTMLResponse)
def admin_health(request: Request, session: Session = Depends(get_session)):
    fetch_runs = list(
        session.scalars(select(FetchRun).order_by(FetchRun.started_at.desc()).limit(20))
    )
    return templates.TemplateResponse(
        request,
        "admin_health.html",
        {
            "request": request,
            "summary": build_health_summary(session),
            "fetch_runs": fetch_runs,
            "refresh_notice": build_refresh_notice(session),
        },
    )


def _build_page_url(
    path: str,
    *,
    page: int,
    q: str | None,
    source: str | None,
) -> str:
    params: dict[str, str | int] = {}
    if q:
        params["q"] = q
    if source:
        params["source"] = source
    if page > 1:
        params["page"] = page
    query = urlencode(params)
    return f"{path}?{query}" if query else path


def _build_pagination_items(
    path: str,
    *,
    page: int,
    total_pages: int,
    q: str | None,
    source: str | None,
) -> list[dict[str, object]]:
    if total_pages <= 7:
        tokens: list[int | None] = list(range(1, total_pages + 1))
    else:
        pages = {1, total_pages, page - 1, page, page + 1}
        if page <= 3:
            pages.update({2, 3, 4})
        if page >= total_pages - 2:
            pages.update({total_pages - 3, total_pages - 2, total_pages - 1})
        tokens = []
        previous_page: int | None = None
        for value in sorted(candidate for candidate in pages if 1 <= candidate <= total_pages):
            if previous_page is not None and value - previous_page > 1:
                tokens.append(None)
            tokens.append(value)
            previous_page = value

    items: list[dict[str, object]] = []
    for token in tokens:
        if token is None:
            items.append({"kind": "ellipsis"})
            continue
        items.append(
            {
                "kind": "page",
                "label": str(token),
                "url": _build_page_url(path, page=token, q=q, source=source),
                "active": token == page,
            }
        )
    return items
