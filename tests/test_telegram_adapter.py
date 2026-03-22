from __future__ import annotations

from pathlib import Path

import newsbot.adapters.telegram_channel as telegram_channel
from newsbot.adapters.telegram_channel import _build_telegram_session
from newsbot.adapters.telegram_channel import _has_local_session_file
from newsbot.config import Settings


def test_build_telegram_session_prefers_string_session(monkeypatch):
    class FakeStringSession:
        def __init__(self, value):
            self.value = value

    monkeypatch.setattr(telegram_channel, "StringSession", FakeStringSession)
    settings = Settings(
        telegram_session_name="unused-session-name",
        telegram_session_string="session-string-value",
    )

    session = _build_telegram_session(settings)

    assert isinstance(session, FakeStringSession)
    assert session.value == "session-string-value"


def test_build_telegram_session_uses_local_session_file(tmp_path):
    session_base = tmp_path / "newsbot"
    Path(f"{session_base}.session").write_text("", encoding="utf-8")
    settings = Settings(
        telegram_session_name=str(session_base),
        telegram_session_string=None,
    )

    session = _build_telegram_session(settings)

    assert session == str(session_base)


def test_build_telegram_session_returns_none_without_any_session(tmp_path):
    settings = Settings(
        telegram_session_name=str(tmp_path / "missing-session"),
        telegram_session_string=None,
    )

    session = _build_telegram_session(settings)

    assert session is None


def test_has_local_session_file_accepts_explicit_session_suffix(tmp_path):
    session_path = tmp_path / "telegram.session"
    session_path.write_text("", encoding="utf-8")

    assert _has_local_session_file(str(session_path)) is True
