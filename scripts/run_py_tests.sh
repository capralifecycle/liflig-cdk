#!/usr/bin/env bash
set -euo pipefail

for d in assets/*/; do
  [ -f "$d"/pyproject.toml ] || continue
  echo "Running Python tests for $d"
  uv run --directory "$d" pytest -vv -r a .
done
