from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    src_dir = repo_root / "src"
    if str(src_dir) not in sys.path:
        sys.path.insert(0, str(src_dir))

    from newsbot.site_builder import main as build_main

    build_main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
