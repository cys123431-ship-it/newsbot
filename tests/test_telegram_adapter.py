from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import newsbot.adapters.telegram_channel as telegram_channel
from newsbot.adapters.telegram_channel import _build_telegram_session
from newsbot.adapters.telegram_channel import _has_local_session_file
from newsbot.adapters.telegram_channel import extract_link_from_message
from newsbot.adapters.telegram_channel import extract_title_from_message
from newsbot.config import Settings
from telethon.tl.types import MessageEntityTextUrl
from telethon.tl.types import MessageEntityUrl


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


def test_settings_auto_enable_telegram_when_credentials_and_session_exist(
    monkeypatch, tmp_path
):
    session_base = tmp_path / "newsbot"
    Path(f"{session_base}.session").write_text("", encoding="utf-8")
    monkeypatch.delenv("NEWSBOT_TELEGRAM_INPUT_ENABLED", raising=False)
    monkeypatch.setenv("NEWSBOT_TELEGRAM_API_ID", "123456")
    monkeypatch.setenv("NEWSBOT_TELEGRAM_API_HASH", "hash-value")
    monkeypatch.setenv("NEWSBOT_TELEGRAM_SESSION_NAME", str(session_base))
    monkeypatch.delenv("NEWSBOT_TELEGRAM_SESSION_STRING", raising=False)

    settings = Settings()

    assert settings.telegram_input_enabled is True
    assert settings.telegram_runtime_enabled is True


def test_settings_allow_explicit_disable_even_with_credentials(monkeypatch, tmp_path):
    session_base = tmp_path / "newsbot"
    Path(f"{session_base}.session").write_text("", encoding="utf-8")
    monkeypatch.setenv("NEWSBOT_TELEGRAM_INPUT_ENABLED", "false")
    monkeypatch.setenv("NEWSBOT_TELEGRAM_API_ID", "123456")
    monkeypatch.setenv("NEWSBOT_TELEGRAM_API_HASH", "hash-value")
    monkeypatch.setenv("NEWSBOT_TELEGRAM_SESSION_NAME", str(session_base))
    monkeypatch.delenv("NEWSBOT_TELEGRAM_SESSION_STRING", raising=False)

    settings = Settings()

    assert settings.telegram_input_enabled is False
    assert settings.telegram_runtime_enabled is False


def test_extract_link_from_message_prefers_hidden_entity_url():
    message = SimpleNamespace(
        message="Read this update",
        entities=[
            MessageEntityTextUrl(
                offset=0,
                length=4,
                url="https://example.com/telegram-story",
            )
        ],
        media=None,
    )

    url = extract_link_from_message(message)

    assert url == "https://example.com/telegram-story"


def test_extract_link_from_message_uses_preview_url_when_text_has_no_visible_link():
    message = SimpleNamespace(
        message="Breaking market recap",
        entities=[],
        media=SimpleNamespace(
            webpage=SimpleNamespace(
                url="https://example.com/preview-story",
                title="Preview headline",
            )
        ),
    )

    url = extract_link_from_message(message)
    title = extract_title_from_message(
        message.message,
        url,
        preview_title=message.media.webpage.title,
    )

    assert url == "https://example.com/preview-story"
    assert title == "Breaking market recap"


def test_extract_link_from_message_skips_telegram_urls_when_external_url_exists():
    message_text = "https://t.me/source/123 https://example.com/final-story"
    message = SimpleNamespace(
        message=message_text,
        entities=[],
        media=None,
    )

    url = extract_link_from_message(message)

    assert url == "https://example.com/final-story"


def test_extract_link_from_message_entity_url_reads_visible_url_span():
    message_text = "go https://example.com/story now"
    message = SimpleNamespace(
        message=message_text,
        entities=[MessageEntityUrl(offset=3, length=25)],
        media=None,
    )

    url = extract_link_from_message(message)

    assert url == "https://example.com/story"
