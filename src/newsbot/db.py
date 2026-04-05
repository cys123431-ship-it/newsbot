"""Database helpers."""

from __future__ import annotations

from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from newsbot.config import get_settings


class Base(DeclarativeBase):
    """Base class for ORM models."""


def create_engine_from_url(database_url: str):
    connect_args = {}
    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    return create_engine(database_url, connect_args=connect_args, future=True)


settings = get_settings()
engine = create_engine_from_url(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def create_session_factory(database_url: str):
    custom_engine = create_engine_from_url(database_url)
    return sessionmaker(bind=custom_engine, autoflush=False, expire_on_commit=False)


def init_db(bind_engine=None) -> None:
    from newsbot import models  # noqa: F401

    active_engine = bind_engine or engine
    Base.metadata.create_all(bind=active_engine)
    if active_engine.dialect.name == "sqlite":
        with active_engine.begin() as connection:
            column_rows = connection.exec_driver_sql("PRAGMA table_info(articles)").fetchall()
            column_names = {str(row[1]) for row in column_rows}
            if "thumbnail_url" not in column_names:
                connection.exec_driver_sql(
                    "ALTER TABLE articles ADD COLUMN thumbnail_url VARCHAR(1000)"
                )


def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
