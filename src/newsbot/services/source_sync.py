"""Sync source registry into the database."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from newsbot.models import Source
from newsbot.source_registry import get_source_definitions


def sync_sources(session: Session) -> None:
    for source_definition in get_source_definitions():
        source = session.scalar(
            select(Source).where(Source.source_key == source_definition.source_key)
        )
        if source is None:
            source = Source(
                source_key=source_definition.source_key,
                enabled=True,
            )
            session.add(source)
        source.name = source_definition.name
        source.adapter_type = source_definition.adapter_type
        source.category = source_definition.category
        source.base_url = source_definition.base_url
        source.discovery_only = source_definition.discovery_only
        source.allow_page_fetch = source_definition.allow_page_fetch
        source.poll_interval_sec = source_definition.poll_interval_sec
        source.trust_level = source_definition.trust_level
        source.dedupe_strategy = source_definition.dedupe_strategy
        source.config_json = dict(source_definition.config)
    session.commit()
