"""Simple HTML discovery adapter."""

from __future__ import annotations

from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.source_registry import SourceDefinition
from newsbot.text_tools import clean_headline
from newsbot.text_tools import guess_language
from newsbot.text_tools import limit_summary
from newsbot.text_tools import normalize_whitespace


class _AnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            attrs_map = dict(attrs)
            self._href = attrs_map.get("href")
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self._href is None:
            return
        text = normalize_whitespace(" ".join(self._parts))
        self.links.append((self._href, text))
        self._href = None
        self._parts = []


class HtmlDiscoveryAdapter:
    async def fetch(
        self,
        source_definition: SourceDefinition,
        settings: Settings,
        client: httpx.AsyncClient,
    ) -> list[ArticleCandidate]:
        page_url = source_definition.config["page_url"]
        response = await client.get(page_url)
        response.raise_for_status()
        parser = _AnchorParser()
        parser.feed(response.text)
        allowed_domains = set(source_definition.config.get("allowed_domains", []))
        article_prefixes = tuple(source_definition.config.get("article_prefixes", []))
        max_links = int(source_definition.config.get("max_links", 25))
        candidates: list[ArticleCandidate] = []
        seen_urls: set[str] = set()
        for href, title in parser.links:
            resolved_url = urljoin(page_url, href)
            parsed = urlsplit(resolved_url)
            if allowed_domains and parsed.netloc not in allowed_domains:
                continue
            if article_prefixes and not parsed.path.startswith(article_prefixes):
                continue
            if resolved_url in seen_urls or len(title) < 12:
                continue
            seen_urls.add(resolved_url)
            cleaned_title = clean_headline(title)
            if len(cleaned_title) < 12:
                continue
            candidates.append(
                ArticleCandidate(
                    source_key=source_definition.source_key,
                    source_name=source_definition.name,
                    title=cleaned_title,
                    url=resolved_url,
                    summary=limit_summary(cleaned_title),
                    category=source_definition.category,
                    language=guess_language(cleaned_title),
                    trust_level=source_definition.trust_level,
                )
            )
            if len(candidates) >= max_links:
                break
        return candidates

