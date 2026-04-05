"""SQLAlchemy models."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from newsbot.db import Base


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    adapter_type: Mapped[str] = mapped_column(String(40), index=True)
    category: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    discovery_only: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_page_fetch: Mapped[bool] = mapped_column(Boolean, default=False)
    poll_interval_sec: Mapped[int] = mapped_column(Integer)
    trust_level: Mapped[int] = mapped_column(Integer, default=50)
    dedupe_strategy: Mapped[str] = mapped_column(String(40), default="default")
    config_json: Mapped[dict] = mapped_column(JSON, default=dict)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    canonical_url: Mapped[str] = mapped_column(String(1000), unique=True, index=True)
    source_key: Mapped[str] = mapped_column(String(100), index=True)
    source_name: Mapped[str] = mapped_column(String(120))
    thumbnail_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    primary_category: Mapped[str] = mapped_column(String(40), index=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    short_summary: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String(12), default="unknown")
    trust_level: Mapped[int] = mapped_column(Integer, default=50)
    title_hash: Mapped[str] = mapped_column(String(64), index=True)
    normalized_title: Mapped[str] = mapped_column(String(500), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    aliases: Mapped[list["ArticleAlias"]] = relationship(
        back_populates="article", cascade="all, delete-orphan"
    )
    bookmarks: Mapped[list["Bookmark"]] = relationship(
        back_populates="article", cascade="all, delete-orphan"
    )


class ArticleAlias(Base):
    __tablename__ = "article_aliases"
    __table_args__ = (
        UniqueConstraint("source_key", "alias_url", name="uq_article_alias_source_url"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id"))
    source_key: Mapped[str] = mapped_column(String(100), index=True)
    alias_url: Mapped[str] = mapped_column(String(1000), index=True)
    title: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    article: Mapped[Article] = relationship(back_populates="aliases")


class FetchRun(Base):
    __tablename__ = "fetch_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_key: Mapped[str] = mapped_column(String(100), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="running", index=True)
    fetched_count: Mapped[int] = mapped_column(Integer, default=0)
    inserted_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

class Bookmark(Base):
    __tablename__ = "bookmarks"
    __table_args__ = (UniqueConstraint("article_id", name="uq_bookmark_article"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    article: Mapped[Article] = relationship(back_populates="bookmarks")
