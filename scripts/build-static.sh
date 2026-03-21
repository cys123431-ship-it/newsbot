#!/usr/bin/env bash
set -euo pipefail

export PYTHONPATH="./src:./.packages${PYTHONPATH:+:$PYTHONPATH}"
python3 -m newsbot.site_builder
