"""FastAPI application entrypoint."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from newsbot.api.api import router as api_router
from newsbot.api.pages import router as page_router
from newsbot.config import Settings
from newsbot.config import get_settings
from newsbot.db import SessionLocal
from newsbot.db import engine
from newsbot.db import init_db
from newsbot.services.ingest import bootstrap_initial_content
from newsbot.services.scheduler import build_scheduler
from newsbot.services.source_sync import sync_sources


def create_app(
    settings: Settings | None = None,
    session_factory=None,
) -> FastAPI:
    active_settings = settings or get_settings()
    active_session_factory = session_factory or SessionLocal
    active_engine = getattr(active_session_factory, "kw", {}).get("bind", engine)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        init_db(bind_engine=active_engine)
        with active_session_factory() as session:
            sync_sources(session)
        if active_settings.bootstrap_on_startup:
            try:
                await asyncio.wait_for(
                    bootstrap_initial_content(active_session_factory, active_settings),
                    timeout=25,
                )
            except TimeoutError:
                pass
        scheduler = build_scheduler(active_session_factory, active_settings)
        application.state.scheduler = scheduler
        if active_settings.enable_scheduler:
            scheduler.start()
        try:
            yield
        finally:
            if scheduler.running:
                scheduler.shutdown(wait=False)

    app = FastAPI(title=active_settings.app_name, lifespan=lifespan)
    app.state.settings = active_settings
    app.state.session_factory = active_session_factory
    app.include_router(page_router)
    app.include_router(api_router)
    static_dir = Path(__file__).resolve().parent / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
    return app


app = create_app()


def run() -> None:
    uvicorn.run("newsbot.main:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    run()
