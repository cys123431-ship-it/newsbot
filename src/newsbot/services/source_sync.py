"""Sync source registry into the database."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from newsbot.models import Source
from newsbot.source_registry import get_source_definitions


STALE_SOURCE_ERROR = "Source no longer exists in the active registry and was disabled automatically."


def _apply_source_definition(source: Source, source_definition) -> None:
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


def sync_sources(session: Session) -> None:
    active_definitions = {
        source_definition.source_key: source_definition
        for source_definition in get_source_definitions()
    }
    existing_sources = {
        source.source_key: source for source in session.scalars(select(Source)).all()
    }

    for source_key, source in existing_sources.items():
        source_definition = active_definitions.pop(source_key, None)
        if source_definition is None:
            source.enabled = False
            source.last_error = STALE_SOURCE_ERROR
            continue
        _apply_source_definition(source, source_definition)
        if source.last_error == STALE_SOURCE_ERROR:
            source.last_error = None

    for source_definition in active_definitions.values():
        source = existing_sources.get(source_definition.source_key)
        if source is None:
            source = Source(
                source_key=source_definition.source_key,
                enabled=True,
            )
            session.add(source)
        _apply_source_definition(source, source_definition)
    session.commit()
