"""URL normalization helpers."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_TRACKING_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "guccounter",
    "guce_referrer",
    "guce_referrer_sig",
    "soc_src",
    "soc_trk",
    "ncid",
    "ref",
    "refsrc",
}


def canonicalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query_items = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=False)
        if key.lower() not in _TRACKING_KEYS
    ]
    query = urlencode(sorted(query_items))
    path = parts.path or "/"
    return urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.lower(),
            path.rstrip("/") or "/",
            query,
            "",
        )
    )

