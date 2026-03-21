from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".packages"))
sys.path.insert(0, str(ROOT / "src"))

import pytest
from fastapi.testclient import TestClient

from newsbot.config import Settings
from newsbot.db import create_session_factory
from newsbot.db import init_db
from newsbot.main import create_app
from newsbot.services.source_sync import sync_sources


@pytest.fixture()
def app(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    session_factory = create_session_factory(database_url)
    init_db(bind_engine=session_factory.kw["bind"])
    with session_factory() as session:
        sync_sources(session)
    settings = Settings(
        database_url=database_url,
        bootstrap_on_startup=False,
        enable_scheduler=False,
        telegram_input_enabled=False,
    )
    return create_app(settings=settings, session_factory=session_factory)


@pytest.fixture()
def client(app):
    with TestClient(app) as client:
        yield client
