Lambda assets testing convention

Each lambda under `assets/` can include a small test harness and development dependencies. To make tests reproducible and isolated we follow this convention:

- Each lambda that has tests exposes a `requirements-dev.txt` file listing the Python test dependencies (pytest, pytest-mock, etc.).
- Tests live inside the lambda folder (e.g. `assets/slack-error-log-handler-lambda/test_handler.py`).
- To run all lambda tests locally or in CI, run the project Makefile target:

```bash
make py-test
```

This target will auto-discover all `assets/*` directories that contain `requirements-dev.txt`, create a per-lambda virtualenv (named `.venv-test-<major>_<minor>` inside each lambda folder), install the listed dev dependencies, and run `pytest` in that folder.

Interpreter selection

- By default the Makefile uses `python3` as the interpreter to create venvs. If a lambda requires a specific interpreter version, add a file named either `.python-version` or `python-version` inside the lambda folder containing the interpreter command to use (for example `python3.14`). The Makefile will use that interpreter when creating the venv for that lambda.
- On CI you must ensure that the requested interpreter is available on the runner (use `actions/setup-python` in GitHub Actions or provide a runner image with the interpreter installed).

Notes

- Per-lambda `requirements-dev.txt` keeps each lambda's test dependencies isolated and avoids clashes across assets.
- The test runner creates per-lambda virtualenvs whose names include the interpreter major/minor, for example `.venv-test-3_14` or `.venv-test-3_12`.
- If a lambda requires system packages or compiled native extensions, CI needs to provide those system dependencies (e.g., apt packages) or you should run tests inside a suitable container.

Adding a new lambda with tests

1. Add your lambda folder under `assets/`.
2. Add `requirements-dev.txt` with your test dependencies.
3. Add test files inside the folder and ensure they import the lambda code relative to that folder.
4. Run `make py-test` locally to verify.

This convention keeps test runs predictable and easy to run both locally and in CI.
