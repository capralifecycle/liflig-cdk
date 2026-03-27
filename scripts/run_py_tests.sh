#!/usr/bin/env bash
set -euo pipefail

PYTHON_DEFAULT=${1:-python3}

for d in assets/*; do
  if [ -f "$d/requirements-dev.txt" ]; then
    if [ -f "$d/.python-version" ]; then PYFILE="$d/.python-version"; else PYFILE=""; fi
    if [ -n "$PYFILE" ]; then INTERP="$(cat "$PYFILE" | tr -d '\r\n')"; else INTERP="$PYTHON_DEFAULT"; fi

    # Verify the interpreter exists; fall back to default PYTHON_DEFAULT if not.
    if ! command -v "$INTERP" >/dev/null 2>&1; then
      echo "Interpreter '$INTERP' not found; falling back to '$PYTHON_DEFAULT' for $d"
      INTERP="$PYTHON_DEFAULT"
    fi

    # Determine interpreter major.minor and include it in the venv name so
    # testing the same lambda with multiple interpreters doesn't clobber
    # previously-created venvs (e.g. .venv-test-3_14, .venv-test-3_12).
    INTERP_VERSION=$("$INTERP" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "py")
    INTERP_VERSION=${INTERP_VERSION//./_}
    VENV="$d/.venv-test-${INTERP_VERSION}"

    echo "Running Python tests for $d using $INTERP (venv: $VENV)"

    # Best-effort: upgrade pip/setuptools/wheel for the interpreter itself so
    # venv creation is more likely to include a working pip
    if command -v "$INTERP" >/dev/null 2>&1; then
      echo "Attempting to upgrade pip/setuptools/wheel for interpreter $INTERP"
      "$INTERP" -m pip install --upgrade pip setuptools wheel >/dev/null 2>&1 || true
    fi

    # Ensure pip exists before proceeding
    if [ ! -x "$VENV/bin/pip" ]; then
      echo "pip still missing in $VENV; skipping tests for $d"
      continue
    fi

    "$VENV"/bin/pip install --upgrade pip setuptools wheel -q
    "$VENV"/bin/pip install -r "$d/requirements-dev.txt" -q
    # Run pytest in verbose mode (-vv) and show extra test summary (-r a)
    "$VENV"/bin/pytest -vv -r a "$d"
  fi
done
