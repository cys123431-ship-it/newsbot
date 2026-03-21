"""Category classification."""

from __future__ import annotations

from urllib.parse import urlsplit

from newsbot.categories import CATEGORY_CRYPTO
from newsbot.categories import CATEGORY_KR_SOCIETY
from newsbot.categories import CATEGORY_MILITARY
from newsbot.categories import CATEGORY_TECH_IT
from newsbot.categories import CATEGORY_US_FINANCE
from newsbot.contracts import ArticleCandidate
from newsbot.source_registry import SourceDefinition
from newsbot.text_tools import guess_language


_KR_PUBLISHER_HOSTS = {
    "www.yna.co.kr",
    "en.yna.co.kr",
    "www.ytn.co.kr",
    "news.sbs.co.kr",
    "imnews.imbc.com",
    "news.kbs.co.kr",
    "www.hani.co.kr",
    "www.khan.co.kr",
    "www.donga.com",
    "www.joongang.co.kr",
    "www.mk.co.kr",
    "www.hankyung.com",
    "www.newsis.com",
    "www.nocutnews.co.kr",
    "www.munhwa.com",
    "www.segye.com",
    "www.chosun.com",
    "www.edaily.co.kr",
    "news.mt.co.kr",
}

_CATEGORY_KEYWORDS = {
    CATEGORY_CRYPTO: ("crypto", "bitcoin", "ethereum", "token", "blockchain", "코인"),
    CATEGORY_US_FINANCE: (
        "fed",
        "federal reserve",
        "inflation",
        "treasury",
        "stocks",
        "sec",
        "earnings",
        "금리",
        "증시",
    ),
    CATEGORY_TECH_IT: (
        "ai",
        "software",
        "chip",
        "startup",
        "cloud",
        "iphone",
        "meta",
        "google",
        "microsoft",
        "개발",
        "반도체",
        "it",
    ),
    CATEGORY_MILITARY: (
        "military",
        "army",
        "navy",
        "air force",
        "defense",
        "missile",
        "drone",
        "국방",
        "군사",
        "훈련",
    ),
}


def classify_candidate(
    candidate: ArticleCandidate, source_definition: SourceDefinition
) -> str | None:
    if source_definition.category == CATEGORY_KR_SOCIETY:
        return _classify_korean_society(candidate)
    if source_definition.category in {
        CATEGORY_CRYPTO,
        CATEGORY_US_FINANCE,
        CATEGORY_TECH_IT,
        CATEGORY_MILITARY,
    }:
        return source_definition.category
    haystack = f"{candidate.title} {candidate.summary} {candidate.url}".lower()
    for category, keywords in _CATEGORY_KEYWORDS.items():
        if any(keyword in haystack for keyword in keywords):
            return category
    return _classify_korean_society(candidate)


def _classify_korean_society(candidate: ArticleCandidate) -> str | None:
    host = urlsplit(candidate.url).netloc.lower()
    if host in _KR_PUBLISHER_HOSTS and guess_language(candidate.title, candidate.summary) == "ko":
        return CATEGORY_KR_SOCIETY
    return None

