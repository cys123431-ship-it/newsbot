"""Scheduler wiring."""

from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from newsbot.config import Settings
from newsbot.models import Source
from newsbot.services.ingest import ADAPTERS
from newsbot.services.ingest import fetch_single_source
from newsbot.source_registry import find_source_definition


def build_scheduler(session_factory, settings: Settings) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="UTC")
    with session_factory() as session:
        sources = list(
            session.scalars(select(Source).where(Source.enabled.is_(True)).order_by(Source.source_key))
        )
    for source in sources:
        source_definition = find_source_definition(source.source_key)
        if source_definition is None:
            continue
        if source_definition.adapter_type not in ADAPTERS:
            continue
        scheduler.add_job(
            fetch_single_source,
            "interval",
            seconds=source.poll_interval_sec,
            args=[session_factory, settings, source.source_key],
            id=f"fetch:{source.source_key}",
            replace_existing=True,
            max_instances=1,
        )
    return scheduler

