from __future__ import annotations

from newsbot.url_tools import canonicalize_url


def test_canonicalize_url_removes_tracking_parameters():
    url = (
        "https://Example.com/news/story/?utm_source=test&b=2&fbclid=abc&a=1#fragment"
    )
    assert canonicalize_url(url) == "https://example.com/news/story?a=1&b=2"

