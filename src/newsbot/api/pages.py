"""Server-rendered pages."""

from __future__ import annotations

from dataclasses import dataclass
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

import newsbot.categories as category_module
from newsbot.api.deps import get_session
from newsbot.categories import ALL_CATEGORIES
from newsbot.categories import CATEGORY_LABELS
from newsbot.models import FetchRun
from newsbot.services.query import build_health_summary
from newsbot.services.query import build_refresh_notice
from newsbot.services.query import list_bookmarked_articles
from newsbot.services.query import list_sources
from newsbot.services.query import paginate_articles


@dataclass(frozen=True, slots=True)
class CategoryView:
    key: str
    label: str
    hub: str
    hub_label: str
    order: int


@dataclass(frozen=True, slots=True)
class HubView:
    key: str
    label: str
    headline: str
    description: str
    order: int


_FALLBACK_HUBS = {
    "all": HubView(
        key="all",
        label="전체",
        headline="newsbot 전체 뉴스",
        description="한국, 미국, 글로벌 전문 카테고리를 한 흐름에서 빠르게 확인합니다.",
        order=0,
    ),
    "kr": HubView(
        key="kr",
        label="한국",
        headline="한국 페이지",
        description="정치, 경제, 사회, 문화, 지역, 스포츠 뉴스를 한국 언론사 중심으로 묶었습니다.",
        order=1,
    ),
    "us": HubView(
        key="us",
        label="미국",
        headline="미국 페이지",
        description="정치, 경제, 시장, 세계, 기술 뉴스를 미국 언론과 방송사 소스로 넓게 모읍니다.",
        order=2,
    ),
    "global": HubView(
        key="global",
        label="글로벌",
        headline="글로벌 전문 페이지",
        description="코인, 테크, 군사처럼 주제형 전문 카테고리를 모아 빠르게 훑습니다.",
        order=3,
    ),
}

_FALLBACK_CATEGORY_META = {
    "crypto": CategoryView("crypto", "코인", "global", "글로벌", 10),
    "tech-it": CategoryView("tech-it", "테크(IT)", "global", "글로벌", 20),
    "military": CategoryView("military", "군사", "global", "글로벌", 30),
    "kr-politics": CategoryView("kr-politics", "정치", "kr", "한국", 10),
    "kr-economy": CategoryView("kr-economy", "경제", "kr", "한국", 20),
    "kr-society": CategoryView("kr-society", "사회", "kr", "한국", 30),
    "kr-culture": CategoryView("kr-culture", "문화", "kr", "한국", 40),
    "kr-local": CategoryView("kr-local", "지역", "kr", "한국", 50),
    "kr-sports": CategoryView("kr-sports", "스포츠", "kr", "한국", 60),
    "us-politics": CategoryView("us-politics", "정치", "us", "미국", 10),
    "us-economy": CategoryView("us-economy", "경제", "us", "미국", 20),
    "us-markets": CategoryView("us-markets", "시장", "us", "미국", 30),
    "us-world": CategoryView("us-world", "세계", "us", "미국", 40),
    "us-technology": CategoryView("us-technology", "기술", "us", "미국", 50),
}

router = APIRouter()
templates = Jinja2Templates(
    directory=str(Path(__file__).resolve().parent.parent / "templates")
)


def _coerce_category_metadata() -> dict[str, CategoryView]:
    definitions = getattr(category_module, "CATEGORY_DEFINITIONS", None)
    hub_labels = getattr(category_module, "HUB_LABELS", {})
    if definitions:
        metadata: dict[str, CategoryView] = {}
        iterable = definitions.items() if isinstance(definitions, dict) else (
            (getattr(definition, "key", None), definition) for definition in definitions
        )
        for key, definition in iterable:
            if not key:
                continue
            label = getattr(
                definition,
                "section_label",
                getattr(definition, "label", CATEGORY_LABELS.get(key, key)),
            )
            hub = getattr(definition, "hub", "global")
            hub_label = getattr(
                definition,
                "hub_label",
                hub_labels.get(hub, _FALLBACK_HUBS.get(hub, _FALLBACK_HUBS["global"]).label),
            )
            order = int(getattr(definition, "order", 999))
            metadata[key] = CategoryView(key=key, label=label, hub=hub, hub_label=hub_label, order=order)
        return metadata

    metadata = dict(_FALLBACK_CATEGORY_META)
    for index, category in enumerate(ALL_CATEGORIES, start=1):
        if category in metadata:
            continue
        hub = _infer_hub_from_category(category)
        hub_label = _FALLBACK_HUBS.get(hub, _FALLBACK_HUBS["global"]).label
        metadata[category] = CategoryView(
            key=category,
            label=CATEGORY_LABELS.get(category, category),
            hub=hub,
            hub_label=hub_label,
            order=index * 10,
        )
    return metadata


def _coerce_hubs() -> list[HubView]:
    definitions = getattr(category_module, "HUB_DEFINITIONS", None)
    if definitions:
        hubs = []
        iterable = definitions.items() if isinstance(definitions, dict) else (
            (getattr(definition, "key", None), definition) for definition in definitions
        )
        for key, definition in iterable:
            if not key:
                continue
            hubs.append(
                HubView(
                    key=key,
                    label=getattr(definition, "label", key),
                    headline=getattr(definition, "headline", getattr(definition, "label", key)),
                    description=getattr(definition, "description", ""),
                    order=int(getattr(definition, "order", 999)),
                )
            )
        return sorted(hubs, key=lambda item: item.order)
    return sorted(_FALLBACK_HUBS.values(), key=lambda item: item.order)


def _infer_hub_from_category(category: str | None) -> str:
    if not category:
        return "all"
    if category.startswith("kr-"):
        return "kr"
    if category.startswith("us-"):
        return "us"
    return "global"


def _categories_for_hub(category_meta: dict[str, CategoryView], hub: str) -> list[CategoryView]:
    if hub == "all":
        return sorted(category_meta.values(), key=lambda item: (item.hub, item.order, item.label))
    return sorted(
        [item for item in category_meta.values() if item.hub == hub],
        key=lambda item: (item.order, item.label),
    )


def _resolve_section(category_meta: dict[str, CategoryView], hub: str, section: str | None) -> str | None:
    if not section:
        return None
    info = category_meta.get(section)
    if info is None:
        return None
    if hub != "all" and info.hub != hub:
        return None
    return section


def _filter_sources_for_scope(
    sources: list,
    *,
    allowed_categories: list[str] | None,
) -> list:
    if allowed_categories is None:
        return sources
    allowed = set(allowed_categories)
    return [source for source in sources if source.category in allowed]


def _render_article_page(
    request: Request,
    session: Session,
    *,
    hub: str,
    section: str | None,
    q: str | None,
    source: str | None,
    page: int,
    path: str,
    title_override: str | None = None,
) -> HTMLResponse:
    category_meta = _coerce_category_metadata()
    hubs = _coerce_hubs()
    active_hub = hub if hub in {item.key for item in hubs} else "all"
    active_section = _resolve_section(category_meta, active_hub, section)
    scoped_categories = _categories_for_hub(category_meta, active_hub)
    allowed_categories = [item.key for item in scoped_categories] if active_hub != "all" else None
    if active_section:
        allowed_categories = [active_section]

    articles, total_count, total_pages, current_page = paginate_articles(
        session,
        category=active_section,
        categories=allowed_categories if active_section is None else None,
        source_key=source,
        query_text=q,
        page=page,
        page_size=request.app.state.settings.article_page_size,
    )

    all_sources = list_sources(session)
    visible_sources = _filter_sources_for_scope(all_sources, allowed_categories=allowed_categories)
    current_hub_view = next((item for item in hubs if item.key == active_hub), _FALLBACK_HUBS["all"])
    active_section_view = category_meta.get(active_section) if active_section else None
    page_title = title_override or current_hub_view.headline
    page_description = (
        f"{current_hub_view.label} 허브 안에서 {active_section_view.label} 기사만 최신순으로 모았습니다."
        if active_section_view
        else current_hub_view.description
    )

    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "request": request,
            "articles": articles,
            "category_labels": {key: value.label for key, value in category_meta.items()},
            "active_query": q or "",
            "active_source": source or "",
            "sources": visible_sources,
            "page_title": page_title,
            "page_section_label": active_section_view.label if active_section_view else "",
            "page_description": page_description,
            "hub_items": [
                {
                    "key": item.key,
                    "label": item.label,
                    "url": "/" if item.key == "all" else f"/hub/{item.key}",
                    "active": item.key == active_hub,
                }
                for item in hubs
            ],
            "section_items": [
                {
                    "key": item.key,
                    "label": item.label,
                    "url": f"/hub/{active_hub}/{item.key}",
                    "active": item.key == active_section,
                }
                for item in scoped_categories
            ],
            "active_hub": active_hub,
            "active_section": active_section or "",
            "current_page": current_page,
            "total_pages": total_pages,
            "total_count": total_count,
            "pagination_items": _build_pagination_items(
                path,
                page=current_page,
                total_pages=total_pages,
                q=q,
                source=source,
            ),
            "prev_page_url": _build_page_url(
                path,
                page=max(current_page - 1, 1),
                q=q,
                source=source,
            )
            if current_page > 1
            else None,
            "next_page_url": _build_page_url(
                path,
                page=min(current_page + 1, total_pages),
                q=q,
                source=source,
            )
            if current_page < total_pages
            else None,
            "active_nav": active_hub,
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
    return _render_article_page(
        request,
        session,
        hub="all",
        section=None,
        q=q,
        source=source,
        page=page,
        path="/",
    )


@router.get("/hub/{hub}", response_class=HTMLResponse)
def hub_page(
    request: Request,
    hub: str,
    q: str | None = Query(default=None),
    source: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    session: Session = Depends(get_session),
):
    return _render_article_page(
        request,
        session,
        hub=hub,
        section=None,
        q=q,
        source=source,
        page=page,
        path=f"/hub/{hub}",
    )


@router.get("/hub/{hub}/{section}", response_class=HTMLResponse)
def hub_section_page(
    request: Request,
    hub: str,
    section: str,
    q: str | None = Query(default=None),
    source: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    session: Session = Depends(get_session),
):
    return _render_article_page(
        request,
        session,
        hub=hub,
        section=section,
        q=q,
        source=source,
        page=page,
        path=f"/hub/{hub}/{section}",
    )


@router.get("/category/{category}", response_class=HTMLResponse)
def category_page(
    request: Request,
    category: str,
    q: str | None = Query(default=None),
    source: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    session: Session = Depends(get_session),
):
    hub = _infer_hub_from_category(category)
    return _render_article_page(
        request,
        session,
        hub=hub,
        section=category,
        q=q,
        source=source,
        page=page,
        path=f"/category/{category}",
        title_override=_coerce_category_metadata().get(category, CategoryView(category, category, hub, "", 999)).label,
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
            "active_nav": "",
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
            "active_nav": "",
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
            "active_nav": "",
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
