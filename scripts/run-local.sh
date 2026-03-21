#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHONPATH=./src:./.packages python3 -m uvicorn newsbot.main:app --reload

