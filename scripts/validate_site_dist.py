from __future__ import annotations

import sys
from pathlib import Path

from newsbot.site_builder import validate_site_output


def main() -> int:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("site-dist")
    validate_site_output(target)
    print(f"Validated site output: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
