"""Pydantic response schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel
from pydantic import ConfigDict


class ArticleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    canonical_url: str
    source_key: str
    source_name: str
    thumbnail_url: str | None
    published_at: datetime | None
    primary_category: str
    tags: list[str]
    short_summary: str
    language: str
    trust_level: int


class ArticleListResponse(BaseModel):
    items: list[ArticleRead]
    next_cursor: str | None


class SourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source_key: str
    name: str
    adapter_type: str
    category: str | None
    enabled: bool
    discovery_only: bool
    poll_interval_sec: int
    consecutive_failures: int
    last_error: str | None
    last_success_at: datetime | None


class TrendItem(BaseModel):
    category: str
    count: int


class TrendsResponse(BaseModel):
    categories: list[TrendItem]


class HealthResponse(BaseModel):
    total_sources: int
    healthy_sources: int
    unhealthy_sources: int
    recent_fetch_runs: int
