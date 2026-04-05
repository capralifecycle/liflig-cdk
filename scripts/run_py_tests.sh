#!/usr/bin/env bash
set -euo pipefail

found=0

for d in assets/*/; do
  [ -d "$d" ] || continue
  [ -f "$d/requirements-dev.txt" ] || continue
  found=1

  # Require an explicit .python-version file in each asset directory.
  # The requested interpreter must be available on the machine running the tests (CI or developer machine).
  if [ -f "$d/.python-version" ]; then
    INTERP="$(tr -d '\r\n' <"$d/.python-version")"
    if ! command -v "$INTERP" >/dev/null 2>&1; then
      echo "Interpreter '$INTERP' requested by $d/.python-version was not found."
      echo "Install the requested interpreter (e.g. via actions/setup-python in CI or your system package manager)."
      exit 1
    fi
  else
    echo "Asset directory '$d' is missing .python-version. Please add a .python-version file with the desired interpreter (e.g. 'python3.14')."
    exit 1
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
