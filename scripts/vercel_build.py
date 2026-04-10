from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _python_env(src_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "").strip()
    env["PYTHONPATH"] = (
        f"{src_dir}{os.pathsep}{existing}"
        if existing
        else str(src_dir)
    )
    env["NEWSBOT_ENABLE_SCHEDULER"] = "false"
    env["NEWSBOT_BOOTSTRAP_ON_STARTUP"] = "false"
    env["NEWSBOT_TELEGRAM_INPUT_ENABLED"] = "false"
    env.setdefault("NEWSBOT_REQUEST_TIMEOUT_SEC", "8")
    env.setdefault("NEWSBOT_MAX_RETRIES", "2")
    env.setdefault("NEWSBOT_STATIC_FETCH_CONCURRENCY", "8")
    env.setdefault("NEWSBOT_STATIC_MIN_ARTICLES_TO_PUBLISH", "20")
    env.setdefault("NEWSBOT_STATIC_MAX_TOTAL_ARTICLES", "2000")
    env.setdefault("NEWSBOT_STATIC_ARCHIVE_URL", "https://newsbot9.vercel.app/data/site-data.json")
    return env


def _run_step(name: str, args: list[str], *, repo_root: Path, src_dir: Path) -> None:
    print(f"[vercel-build] {name}...")
    subprocess.run(
        args,
        check=True,
        cwd=repo_root,
        env=_python_env(src_dir),
    )


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    src_dir = repo_root / "src"

    _run_step(
        "refreshing crypto fallback datasets",
        [sys.executable, str(repo_root / "scripts" / "update_data.py")],
        repo_root=repo_root,
        src_dir=src_dir,
    )
    _run_step(
        "building static site",
        [sys.executable, "-m", "newsbot.site_builder"],
        repo_root=repo_root,
        src_dir=src_dir,
    )
    _run_step(
        "validating built site",
        [sys.executable, str(repo_root / "scripts" / "validate_site_dist.py")],
        repo_root=repo_root,
        src_dir=src_dir,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
