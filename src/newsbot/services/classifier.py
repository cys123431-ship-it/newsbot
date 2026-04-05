"""Category classification."""

from __future__ import annotations

from urllib.parse import urlsplit

from newsbot.categories import CATEGORY_CRYPTO
from newsbot.categories import CATEGORY_KR_CULTURE
from newsbot.categories import CATEGORY_KR_ECONOMY
from newsbot.categories import CATEGORY_KR_LOCAL
from newsbot.categories import CATEGORY_KR_POLITICS
from newsbot.categories import CATEGORY_KR_SOCIETY
from newsbot.categories import CATEGORY_KR_SPORTS
from newsbot.categories import CATEGORY_MILITARY
from newsbot.categories import CATEGORY_TECH_IT
from newsbot.categories import CATEGORY_US_ECONOMY
from newsbot.categories import CATEGORY_US_MARKETS
from newsbot.categories import CATEGORY_US_POLITICS
from newsbot.categories import CATEGORY_US_TECHNOLOGY
from newsbot.categories import CATEGORY_US_WORLD
from newsbot.categories import HUB_KR
from newsbot.categories import HUB_US
from newsbot.contracts import ArticleCandidate
from newsbot.source_registry import SourceDefinition
from newsbot.text_tools import guess_language


_KR_PUBLISHER_HOSTS = {
    "www.yna.co.kr",
    "en.yna.co.kr",
    "www.ytn.co.kr",
    "ytn.co.kr",
    "news.sbs.co.kr",
    "imnews.imbc.com",
    "news.kbs.co.kr",
    "www.hani.co.kr",
    "hani.co.kr",
    "www.khan.co.kr",
    "khan.co.kr",
    "www.donga.com",
    "rss.donga.com",
    "www.joongang.co.kr",
    "joongang.co.kr",
    "www.mk.co.kr",
    "mk.co.kr",
    "www.newsis.com",
    "www.nocutnews.co.kr",
    "nocutnews.co.kr",
    "www.segye.com",
    "segye.com",
    "www.chosun.com",
    "chosun.com",
    "www.edaily.co.kr",
    "www.asiae.co.kr",
    "asiae.co.kr",
    "www.etoday.co.kr",
    "www.kmib.co.kr",
    "kmib.co.kr",
    "www.seoul.co.kr",
    "seoul.co.kr",
}
_BLOCKED_PUBLISHER_HOSTS = {
    "www.pressian.com",
    "pressian.com",
}

_GLOBAL_CATEGORY_KEYWORDS = {
    CATEGORY_CRYPTO: (
        "crypto",
        "bitcoin",
        "ethereum",
        "token",
        "blockchain",
        "stablecoin",
        "digital asset",
        "가상자산",
        "비트코인",
        "이더리움",
        "코인",
    ),
    CATEGORY_TECH_IT: (
        "ai",
        "software",
        "chip",
        "semiconductor",
        "startup",
        "cloud",
        "iphone",
        "android",
        "meta",
        "google",
        "microsoft",
        "amazon",
        "tesla",
        "반도체",
        "인공지능",
        "테크",
        "it ",
    ),
    CATEGORY_MILITARY: (
        "military",
        "army",
        "navy",
        "air force",
        "defense",
        "missile",
        "drone",
        "ukraine",
        "nato",
        "국방",
        "군사",
        "훈련",
        "미사일",
        "드론",
    ),
}

_KR_CATEGORY_KEYWORDS = {
    CATEGORY_KR_POLITICS: (
        "대통령",
        "국회",
        "정당",
        "여당",
        "야당",
        "장관",
        "총리",
        "선거",
        "총선",
        "대선",
        "청와대",
        "용산",
        "정책",
        "정부",
    ),
    CATEGORY_KR_ECONOMY: (
        "경제",
        "금융",
        "증시",
        "코스피",
        "코스닥",
        "금리",
        "환율",
        "부동산",
        "주가",
        "물가",
        "수출",
        "수입",
        "기업",
        "산업",
        "반도체",
        "은행",
        "예산",
    ),
    CATEGORY_KR_LOCAL: (
        "지역",
        "지방",
        "주민",
        "지자체",
        "시청",
        "도청",
        "군청",
        "구청",
        "충청",
        "호남",
        "영남",
        "제주",
        "부산",
        "대구",
        "광주",
        "대전",
        "울산",
        "세종",
    ),
    CATEGORY_KR_SPORTS: (
        "스포츠",
        "야구",
        "축구",
        "농구",
        "배구",
        "골프",
        "올림픽",
        "메달",
        "kbo",
        "k리그",
        "챔피언스리그",
    ),
    CATEGORY_KR_CULTURE: (
        "문화",
        "공연",
        "전시",
        "영화",
        "드라마",
        "연예",
        "배우",
        "가수",
        "뮤지컬",
        "방송",
        "웹툰",
        "책",
        "출판",
    ),
    CATEGORY_KR_SOCIETY: (
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
        "보육",
        "돌봄",
        "환경",
        "경찰",
        "법원",
        "검찰",
    ),
}

_US_CATEGORY_KEYWORDS = {
    CATEGORY_US_POLITICS: (
        "white house",
        "trump",
        "biden",
        "congress",
        "senate",
        "house",
        "campaign",
        "election",
        "governor",
        "supreme court",
        "federal judge",
        "policy",
        "president",
    ),
    CATEGORY_US_MARKETS: (
        "stocks",
        "stock market",
        "wall street",
        "nasdaq",
        "dow",
        "s&p 500",
        "bond",
        "treasury",
        "yield",
        "shares",
        "earnings",
        "futures",
        "rally",
        "selloff",
        "market",
    ),
    CATEGORY_US_ECONOMY: (
        "economy",
        "inflation",
        "gdp",
        "jobs",
        "payrolls",
        "consumer",
        "retail",
        "housing",
        "tariff",
        "labor",
        "recession",
        "prices",
        "trade",
    ),
    CATEGORY_US_WORLD: (
        "world",
        "ukraine",
        "russia",
        "china",
        "europe",
        "gaza",
        "israel",
        "taiwan",
        "south korea",
        "japan",
        "global",
        "foreign",
        "international",
    ),
    CATEGORY_US_TECHNOLOGY: (
        "technology",
        "tech",
        "ai",
        "artificial intelligence",
        "chip",
        "semiconductor",
        "software",
        "apple",
        "google",
        "meta",
        "microsoft",
        "amazon",
        "tesla",
        "startup",
        "openai",
    ),
}


def classify_candidate(
    candidate: ArticleCandidate, source_definition: SourceDefinition
) -> str | None:
    if is_blocked_candidate_url(candidate.url):
        return None
    if source_definition.category is not None:
        return source_definition.category

    hub = str(source_definition.config.get("hub", "")).strip().lower()
    if hub == HUB_KR:
        return _classify_korean_general(candidate)
    if hub == HUB_US:
        return _classify_by_keyword_map(candidate, _US_CATEGORY_KEYWORDS)

    return _classify_by_keyword_map(candidate, _GLOBAL_CATEGORY_KEYWORDS)


def is_blocked_candidate_url(url: str | None) -> bool:
    host = urlsplit(str(url or "")).netloc.lower()
    return host in _BLOCKED_PUBLISHER_HOSTS


def _build_haystack(candidate: ArticleCandidate) -> str:
    return " ".join(
        [
            candidate.title.lower(),
            candidate.summary.lower(),
            candidate.url.lower(),
            " ".join(tag.lower() for tag in candidate.tags),
        ]
    )


def _classify_by_keyword_map(
    candidate: ArticleCandidate,
    mapping: dict[str, tuple[str, ...]],
) -> str | None:
    haystack = _build_haystack(candidate)
    best_category: str | None = None
    best_score = 0
    for category, keywords in mapping.items():
        score = sum(keyword in haystack for keyword in keywords)
        if score > best_score:
            best_category = category
            best_score = score
    return best_category


def _classify_korean_general(candidate: ArticleCandidate) -> str | None:
    host = urlsplit(candidate.url).netloc.lower()
    if host and host not in _KR_PUBLISHER_HOSTS:
        return None
    if guess_language(candidate.title, candidate.summary) != "ko":
        return None
    return _classify_by_keyword_map(candidate, _KR_CATEGORY_KEYWORDS)
