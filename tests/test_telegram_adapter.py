from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import newsbot.adapters.telegram_channel as telegram_channel
from newsbot.adapters.telegram_channel import _build_telegram_session
from newsbot.adapters.telegram_channel import _has_local_session_file
from newsbot.adapters.telegram_channel import extract_candidates_from_public_channel_html
from newsbot.adapters.telegram_channel import extract_link_from_message
from newsbot.adapters.telegram_channel import extract_title_from_message
from newsbot.config import Settings
from newsbot.source_registry import SourceDefinition
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


def test_extract_candidates_from_public_channel_html_prefers_external_links():
    source_definition = SourceDefinition(
        source_key="telegram-dada-news2",
        name="Telegram @dada_news2",
        adapter_type="telegram_channel",
        category=None,
        poll_interval_sec=180,
        base_url="https://t.me/dada_news2",
        trust_level=55,
        config={"channel": "dada_news2"},
    )
    html = """
    <div class="tgme_widget_message_wrap js-widget_message_wrap">
      <div class="tgme_widget_message js-widget_message">
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          [뉴시스] 테스트 기사 제목<br/>
          <a href="https://www.newsis.com/view/NISX20260403_0003577592" target="_blank">link</a>
        </div>
        <div class="tgme_widget_message_footer compact js-message_footer">
          <div class="tgme_widget_message_info short js-message_info">
            <span class="tgme_widget_message_meta">
              <a class="tgme_widget_message_date" href="https://t.me/dada_news2/1">
                <time datetime="2026-04-03T11:10:54+00:00" class="time">11:10</time>
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
    """

    candidates = extract_candidates_from_public_channel_html(source_definition, html)

    assert len(candidates) == 1
    assert candidates[0].title == "[뉴시스] 테스트 기사 제목"
    assert candidates[0].url == "https://www.newsis.com/view/NISX20260403_0003577592"
    assert candidates[0].published_at is not None


def test_extract_candidates_from_public_channel_html_skips_messages_without_external_links():
    source_definition = SourceDefinition(
        source_key="telegram-news-kor",
        name="Telegram @news_kor",
        adapter_type="telegram_channel",
        category=None,
        poll_interval_sec=180,
        base_url="https://t.me/news_kor",
        trust_level=55,
        config={"channel": "news_kor"},
    )
    html = """
    <div class="tgme_widget_message_wrap js-widget_message_wrap">
      <div class="tgme_widget_message js-widget_message">
        <div class="tgme_widget_message_text js-message_text" dir="auto">
          <a href="https://t.me/news_kor/99">telegram only</a>
        </div>
      </div>
    </div>
    """

    candidates = extract_candidates_from_public_channel_html(source_definition, html)

    assert candidates == []
