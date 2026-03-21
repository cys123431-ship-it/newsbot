#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python3 -m pip install --target ./.packages \
  apscheduler \
  fastapi \
  feedparser \
  httpx \
  jinja2 \
  pydantic \
  sqlalchemy \
  telethon \
  uvicorn \
  pytest
