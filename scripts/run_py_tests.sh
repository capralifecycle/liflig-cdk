#!/usr/bin/env bash
set -euo pipefail

# CDK hashes every file under an asset directory, so stray .pyc files there would
# change the hash of the deployed Lambda package.
export PYTHONDONTWRITEBYTECODE=1

for d in assets/*/; do
  [ -f "$d"/pyproject.toml ] || continue
  echo "Running Python tests for $d"
  uv run --directory "$d" pytest -vv -r a .
done
