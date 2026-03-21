"""Adapter base types."""

from __future__ import annotations

from typing import Protocol

import httpx

from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.source_registry import SourceDefinition


class SourceAdapter(Protocol):
    async def fetch(
        self,
        source_definition: SourceDefinition,
        settings: Settings,
        client: httpx.AsyncClient,
    ) -> list[ArticleCandidate]:
        """Fetch article candidates for a source."""

