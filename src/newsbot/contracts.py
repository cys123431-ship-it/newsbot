"""Shared contracts across adapters and services."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class ArticleCandidate:
    source_key: str
    source_name: str
    title: str
    url: str
    published_at: datetime | None = None
    summary: str = ""
    category: str | None = None
    tags: list[str] = field(default_factory=list)
    language: str | None = None
    trust_level: int = 50
    raw_payload: dict[str, Any] = field(default_factory=dict)

