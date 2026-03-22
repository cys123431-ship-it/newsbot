from __future__ import annotations

from newsbot.contracts import ArticleCandidate
from newsbot.services.classifier import classify_candidate
from newsbot.source_registry import get_source_definition


def test_classify_korean_society_candidate_from_korean_hub_source():
    candidate = ArticleCandidate(
        source_key="telegram-news-kor",
        source_name="Telegram",
        title="서울 지하철 안전 대책 강화 발표",
        url="https://www.yna.co.kr/view/AKR20260321000100004",
        summary="정부가 안전 대책을 강화했다.",
    )
    source_definition = get_source_definition("telegram-news-kor")
    assert classify_candidate(candidate, source_definition) == "kr-society"


def test_classify_korean_local_candidate_from_korean_hub_source():
    candidate = ArticleCandidate(
        source_key="telegram-news-kor",
        source_name="Telegram",
        title="부산시, 주민 안전 위해 지역 버스 노선 개편",
        url="https://www.yna.co.kr/view/AKR20260321000100005",
        summary="부산시와 구청이 지역 주민 교통 불편 해소에 나섰다.",
    )
    source_definition = get_source_definition("telegram-news-kor")
    assert classify_candidate(candidate, source_definition) == "kr-local"


def test_classify_telegram_candidate_using_global_keywords():
    candidate = ArticleCandidate(
        source_key="telegram-dada-news2",
        source_name="Telegram",
        title="Bitcoin jumps after ETF inflow surprise",
        url="https://example.com/crypto-story",
        summary="ETF and blockchain news",
    )
    source_definition = get_source_definition("telegram-dada-news2")
    assert classify_candidate(candidate, source_definition) == "crypto"


def test_classify_us_general_feed_candidate_into_markets():
    candidate = ArticleCandidate(
        source_key="axios-feed",
        source_name="Axios",
        title="Wall Street rally lifts Nasdaq after cooler inflation report",
        url="https://www.axios.com/2026/03/22/markets-rally",
        summary="Stocks rose across Wall Street and Treasury yields slipped.",
    )
    source_definition = get_source_definition("axios-feed")
    assert classify_candidate(candidate, source_definition) == "us-markets"


def test_section_specific_source_returns_its_explicit_category():
    candidate = ArticleCandidate(
        source_key="khan-culture-rss",
        source_name="Kyunghyang Culture",
        title="새 봄 공연 시즌, 서울 전역에서 전시와 뮤지컬 개막",
        url="https://www.khan.co.kr/culture/article/202603220001",
        summary="전시와 공연 일정이 이어진다.",
    )
    source_definition = get_source_definition("khan-culture-rss")
    assert classify_candidate(candidate, source_definition) == "kr-culture"
