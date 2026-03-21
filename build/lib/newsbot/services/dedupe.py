"""Dedupe helpers."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from newsbot.contracts import ArticleCandidate
from newsbot.models import Article
from newsbot.models import ArticleAlias
from newsbot.text_tools import build_title_hash
from newsbot.text_tools import normalize_title
from newsbot.text_tools import similar_titles
from newsbot.url_tools import canonicalize_url


def canonicalize_candidate(candidate: ArticleCandidate) -> tuple[str, str, str]:
    canonical_url = canonicalize_url(candidate.url)
    normalized_title = normalize_title(candidate.title)
    title_hash = build_title_hash(candidate.title)
    return canonical_url, normalized_title, title_hash


def find_existing_article(session: Session, candidate: ArticleCandidate) -> Article | None:
    canonical_url, normalized_title, title_hash = canonicalize_candidate(candidate)
    article = session.scalar(select(Article).where(Article.canonical_url == canonical_url))
    if article:
        return article
    alias = session.scalar(select(ArticleAlias).where(ArticleAlias.alias_url == canonical_url))
    if alias:
        return alias.article
    if candidate.published_at is None:
        return session.scalar(select(Article).where(Article.title_hash == title_hash))
    window_start = candidate.published_at - timedelta(hours=36)
    window_end = candidate.published_at + timedelta(hours=36)
    articles = session.scalars(
        select(Article).where(
            Article.title_hash == title_hash,
            Article.published_at >= window_start,
            Article.published_at <= window_end,
        )
    ).all()
    for article in articles:
        if article.normalized_title == normalized_title:
            return article
        if similar_titles(article.title, candidate.title):
            return article
    return None

