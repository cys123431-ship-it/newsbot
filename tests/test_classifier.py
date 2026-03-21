from __future__ import annotations

from newsbot.contracts import ArticleCandidate
from newsbot.services.classifier import classify_candidate
from newsbot.source_registry import get_source_definition


def test_classify_korean_society_candidate_from_whitelist_domain():
    candidate = ArticleCandidate(
        source_key="naver-kr-society",
        source_name="NAVER News Search",
        title="서울 지하철 안전 대책 강화 발표",
        url="https://www.yna.co.kr/view/AKR20260321000100004",
        summary="정부가 안전 대책을 강화했다.",
    )
    source_definition = get_source_definition("naver-kr-society")
    assert classify_candidate(candidate, source_definition) == "kr-society"


def test_classify_telegram_candidate_using_keywords():
    candidate = ArticleCandidate(
        source_key="telegram-dada-news2",
        source_name="Telegram",
        title="Bitcoin jumps after ETF inflow surprise",
        url="https://example.com/crypto-story",
        summary="ETF and blockchain news",
    )
    source_definition = get_source_definition("telegram-dada-news2")
    assert classify_candidate(candidate, source_definition) == "crypto"


def test_korean_society_rejects_political_headline():
    candidate = ArticleCandidate(
        source_key="naver-kr-society",
        source_name="NAVER News Search",
        title="여야, 교육 정책 두고 국회 공방",
        url="https://www.yna.co.kr/view/AKR20260321000100004",
        summary="정치권 충돌이 이어졌다.",
        tags=["교육 현장"],
    )
    source_definition = get_source_definition("naver-kr-society")
    assert classify_candidate(candidate, source_definition) is None
