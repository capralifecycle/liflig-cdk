#!/usr/bin/env bash
set -euo pipefail

PYTHON_DEFAULT=${1:-python3}
found=0

for d in assets/*/; do
  [ -d "$d" ] || continue
  [ -f "$d/requirements-dev.txt" ] || continue
  found=1

  if [ -f "$d/.python-version" ]; then
    INTERP="$(tr -d '\r\n' <"$d/.python-version")"
  else
    INTERP="$PYTHON_DEFAULT"
  fi

  if ! command -v "$INTERP" >/dev/null 2>&1; then
    echo "Interpreter '$INTERP' not found; falling back to '$PYTHON_DEFAULT' for $d"
    INTERP="$PYTHON_DEFAULT"
  fi

  INTERP_VERSION=$(
    "$INTERP" -c 'import sys; print("%s_%s" % (sys.version_info.major, sys.version_info.minor))' 2>/dev/null || echo "py"
  )
  VENV="$d/.venv-test-${INTERP_VERSION}"

  echo "Running Python tests for $d using $INTERP (venv: $VENV)"

  if [ ! -d "$VENV" ]; then
      echo "Creating virtualenv $VENV using $INTERP"
      "$INTERP" -m venv "$VENV"
  fi

  # Ensure pip/setuptools/wheel are installed and up to date
  "$VENV/bin/python" -m ensurepip --upgrade >/dev/null 2>&1 || true
  "$VENV/bin/python" -m pip install --upgrade pip setuptools wheel -q

  # Install dev requirements and run tests
  "$VENV/bin/python" -m pip install -r "$d/requirements-dev.txt" -q
  "$VENV/bin/python" -m pytest -vv -r a "$d" || { echo "Tests failed for $d"; exit 1; }
done

if [ "$found" -ne 1 ]; then
  echo "No asset directories with requirements-dev.txt found."
fi
