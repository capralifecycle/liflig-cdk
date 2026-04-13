**Lambda assets testing convention**

Each lambda under `assets/` can include a small test setup and development dependencies. To make tests reproducible and isolated we follow this convention:

Each lambda that has tests exposes a `pyproject.toml` declaring its test/dev dependencies.
- Tests are inside the lambda folder (e.g. `assets/slack-error-log-handler-lambda/test_handler.py`).
- To run all lambda tests locally or in CI, run the project Makefile target:

```bash
make py-test
```

This target will auto-discover all `assets/*` directories that contain tests (via a `pyproject.toml`), and run `pytest` in each folder using the interpreter(s) provided on your machine or CI runner.

***Interpreter selection***

- The repository declares supported Python interpreters in the top-level `mise.toml` (used by CI). 
- Each asset should include a `.python-version` containing the desired interpreter for tests (for example `3.14`). 
- If present, the test runner will prefer that interpreter; if the interpreter isn't available on the runner the CI job will fail (this helps surface missing interpreter versions early).

Per-lambda `pyproject.toml` keeps each lambda's test/dev dependencies isolated and avoids clashes across assets. Tests run using the interpreter installed on the runner (see `mise.toml` and CI configuration).
- boto3 should match the version used in the lambda runtime - https://docs.aws.amazon.com/lambda/latest/dg/lambda-python.html#python-sdk-included
- If a lambda requires system packages or compiled native extensions, CI needs to provide those system dependencies (e.g., apt packages) or you should run tests inside a suitable container.

***Adding a new lambda with tests***

1. Add your lambda folder under `assets/`.
2. Add `pyproject.toml` declaring your test/dev dependencies.
3. Add test files inside the folder and ensure they import the lambda code relative to that folder.
4. Run `make py-test` locally to verify.

This convention keeps test runs predictable and easy to run both locally and in CI.
