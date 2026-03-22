"""Category constants and hub metadata."""

from __future__ import annotations

from dataclasses import dataclass


HUB_GLOBAL = "global"
HUB_KR = "kr"
HUB_US = "us"

CATEGORY_CRYPTO = "crypto"
CATEGORY_TECH_IT = "tech-it"
CATEGORY_MILITARY = "military"

CATEGORY_KR_POLITICS = "kr-politics"
CATEGORY_KR_ECONOMY = "kr-economy"
CATEGORY_KR_SOCIETY = "kr-society"
CATEGORY_KR_CULTURE = "kr-culture"
CATEGORY_KR_LOCAL = "kr-local"
CATEGORY_KR_SPORTS = "kr-sports"

CATEGORY_US_POLITICS = "us-politics"
CATEGORY_US_ECONOMY = "us-economy"
CATEGORY_US_MARKETS = "us-markets"
CATEGORY_US_WORLD = "us-world"
CATEGORY_US_TECHNOLOGY = "us-technology"

# Backward-compatible alias for older imports.
CATEGORY_US_FINANCE = CATEGORY_US_ECONOMY


@dataclass(frozen=True, slots=True)
class HubDefinition:
    key: str
    label: str
    headline: str
    description: str
    order: int


@dataclass(frozen=True, slots=True)
class CategoryDefinition:
    key: str
    label: str
    hub: str
    section_key: str
    section_label: str
    order: int


HUB_DEFINITIONS = (
    HubDefinition(
        key=HUB_KR,
        label="한국",
        headline="한국 페이지",
        description="한국 주요 신문사와 방송사 기사 흐름을 정치, 경제, 사회, 문화, 지역, 스포츠로 나눠 모아봅니다.",
        order=10,
    ),
    HubDefinition(
        key=HUB_US,
        label="미국",
        headline="미국 페이지",
        description="미국 주요 언론사와 방송사 보도를 정치, 경제, 시장, 세계, 기술 흐름으로 묶습니다.",
        order=20,
    ),
    HubDefinition(
        key=HUB_GLOBAL,
        label="글로벌",
        headline="글로벌 전문 페이지",
        description="코인, 테크, 군사처럼 글로벌 전문 트랙을 모아봅니다.",
        order=30,
    ),
)

HUB_LABELS = {definition.key: definition.label for definition in HUB_DEFINITIONS}
HUB_DESCRIPTIONS = {definition.key: definition.description for definition in HUB_DEFINITIONS}


CATEGORY_DEFINITIONS = (
    CategoryDefinition(
        key=CATEGORY_CRYPTO,
        label="코인",
        hub=HUB_GLOBAL,
        section_key="crypto",
        section_label="코인",
        order=10,
    ),
    CategoryDefinition(
        key=CATEGORY_TECH_IT,
        label="테크(IT)",
        hub=HUB_GLOBAL,
        section_key="technology",
        section_label="테크",
        order=20,
    ),
    CategoryDefinition(
        key=CATEGORY_MILITARY,
        label="군사",
        hub=HUB_GLOBAL,
        section_key="defense",
        section_label="군사",
        order=30,
    ),
    CategoryDefinition(
        key=CATEGORY_KR_POLITICS,
        label="한국 정치",
        hub=HUB_KR,
        section_key="politics",
        section_label="정치",
        order=10,
    ),
    CategoryDefinition(
        key=CATEGORY_KR_ECONOMY,
        label="한국 경제",
        hub=HUB_KR,
        section_key="economy",
        section_label="경제",
        order=20,
    ),
    CategoryDefinition(
        key=CATEGORY_KR_SOCIETY,
        label="한국 사회",
        hub=HUB_KR,
        section_key="society",
        section_label="사회",
        order=30,
    ),
    CategoryDefinition(
        key=CATEGORY_KR_CULTURE,
        label="한국 문화",
        hub=HUB_KR,
        section_key="culture",
        section_label="문화",
        order=40,
    ),
    CategoryDefinition(
        key=CATEGORY_KR_LOCAL,
        label="한국 지역",
        hub=HUB_KR,
        section_key="local",
        section_label="지역",
        order=50,
    ),
    CategoryDefinition(
        key=CATEGORY_KR_SPORTS,
        label="한국 스포츠",
        hub=HUB_KR,
        section_key="sports",
        section_label="스포츠",
        order=60,
    ),
    CategoryDefinition(
        key=CATEGORY_US_POLITICS,
        label="미국 정치",
        hub=HUB_US,
        section_key="politics",
        section_label="정치",
        order=10,
    ),
    CategoryDefinition(
        key=CATEGORY_US_ECONOMY,
        label="미국 경제",
        hub=HUB_US,
        section_key="economy",
        section_label="경제",
        order=20,
    ),
    CategoryDefinition(
        key=CATEGORY_US_MARKETS,
        label="미국 시장",
        hub=HUB_US,
        section_key="markets",
        section_label="시장",
        order=30,
    ),
    CategoryDefinition(
        key=CATEGORY_US_WORLD,
        label="미국 국제",
        hub=HUB_US,
        section_key="world",
        section_label="세계",
        order=40,
    ),
    CategoryDefinition(
        key=CATEGORY_US_TECHNOLOGY,
        label="미국 기술",
        hub=HUB_US,
        section_key="technology",
        section_label="기술",
        order=50,
    ),
)

ALL_CATEGORIES = tuple(definition.key for definition in CATEGORY_DEFINITIONS)

CATEGORY_LABELS = {definition.key: definition.label for definition in CATEGORY_DEFINITIONS}
CATEGORY_HUBS = {definition.key: definition.hub for definition in CATEGORY_DEFINITIONS}
CATEGORY_SECTION_KEYS = {
    definition.key: definition.section_key for definition in CATEGORY_DEFINITIONS
}
CATEGORY_SECTION_LABELS = {
    definition.key: definition.section_label for definition in CATEGORY_DEFINITIONS
}

HUB_CATEGORIES = {
    hub: tuple(
        definition.key
        for definition in CATEGORY_DEFINITIONS
        if definition.hub == hub
    )
    for hub in HUB_LABELS
}
