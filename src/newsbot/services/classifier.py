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
    "www.ohmynews.com",
    "biz.chosun.com",
    "www.etnews.com",
}

_CATEGORY_KEYWORDS = {
    CATEGORY_CRYPTO: (
        "crypto",
        "bitcoin",
        "ethereum",
        "token",
        "blockchain",
        "stablecoin",
        "etf inflow",
        "digital asset",
        "코인",
        "가상자산",
        "비트코인",
        "이더리움",
    ),
    CATEGORY_US_FINANCE: (
        "fed",
        "federal reserve",
        "inflation",
        "treasury",
        "stocks",
        "sec",
        "earnings",
        "cpi",
        "ppi",
        "payrolls",
        "bond",
        "nasdaq",
        "s&p 500",
        "금리",
        "증시",
        "연준",
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

_KR_SOCIETY_POSITIVE_KEYWORDS = (
    "사회",
    "사건",
    "사고",
    "재난",
    "안전",
    "화재",
    "침수",
    "폭우",
    "폭설",
    "산불",
    "실종",
    "구조",
    "복지",
    "교육",
    "학교",
    "대학",
    "노동",
    "근로",
    "산재",
    "파업",
    "의료",
    "응급",
    "병원",
    "교통",
    "지하철",
    "버스",
    "주거",
    "전세",
    "월세",
    "보육",
    "돌봄",
    "환경",
    "오염",
    "경찰",
    "법원",
    "검찰",
    "지역",
    "주민",
)

_KR_SOCIETY_NEGATIVE_KEYWORDS = (
    "대통령",
    "국회",
    "정당",
    "여당",
    "야당",
    "장관",
    "총선",
    "대선",
    "정치",
    "주가",
    "증시",
    "코스피",
    "코스닥",
    "비트코인",
    "이더리움",
    "코인",
    "가상자산",
    "토큰",
    "etf",
    "반도체",
    "ai ",
    "아이폰",
    "스타트업",
    "연예",
    "배우",
    "가수",
    "드라마",
    "야구",
    "축구",
    "농구",
    "배구",
)


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
    if host not in _KR_PUBLISHER_HOSTS:
        return None
    if guess_language(candidate.title, candidate.summary) != "ko":
        return None
    haystack = " ".join(
        [
            candidate.title.lower(),
            candidate.summary.lower(),
            " ".join(tag.lower() for tag in candidate.tags),
        ]
    )
    if any(keyword in haystack for keyword in _KR_SOCIETY_NEGATIVE_KEYWORDS):
        return None
    if any(keyword in haystack for keyword in _KR_SOCIETY_POSITIVE_KEYWORDS):
        return CATEGORY_KR_SOCIETY
    return None
