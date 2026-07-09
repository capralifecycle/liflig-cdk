#!/usr/bin/env bash
set -euo pipefail

# Validates the OpenTelemetry collector config against the exact collector image
# version pinned in the source. The ADOT collector has no offline "validate"
# subcommand, so validation means starting it against the config and confirming
# it builds all pipelines and stays running. An incompatible config (a component
# renamed or removed by a version bump) makes the collector exit non-zero at
# startup.
#
# Requires Docker.
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE_FILE="$REPO_ROOT/src/ecs/open-telemetry.ts"
CONFIG_FILE="$REPO_ROOT/assets/open-telemetry/otel-collector-task-metrics-config.yaml"

# Seconds to wait after start before concluding the config loaded successfully.
# Pipeline construction happens within ~1s; an invalid config exits before this.
WAIT_SECONDS="${WAIT_SECONDS:-10}"

CONTAINER_NAME="otel-config-validation-$$"

cleanup() {
  docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required but was not found on PATH." >&2
  exit 1
fi

# Single source of truth for the version: the same tag string Renovate bumps.
# The tag appears more than once in the source (JSDoc default + runtime default);
# require every occurrence to agree so we never validate a stale version.
mapfile -t IMAGES < <(grep -oE 'amazon/aws-otel-collector:[^"]+' "$SOURCE_FILE" | sort -u)
if [[ ${#IMAGES[@]} -eq 0 ]]; then
  echo "ERROR: could not find amazon/aws-otel-collector image tag in $SOURCE_FILE" >&2
  exit 1
fi
if [[ ${#IMAGES[@]} -gt 1 ]]; then
  echo "ERROR: conflicting amazon/aws-otel-collector tags in $SOURCE_FILE: ${IMAGES[*]}" >&2
  exit 1
fi
IMAGE="${IMAGES[0]}"

# Render the config exactly as open-telemetry.ts does before injecting it as
# AOT_CONFIG_CONTENT: strip lines whose first non-whitespace is a '##' comment.
RENDERED_CONFIG="$(grep -vE '^[[:space:]]*##' "$CONFIG_FILE")"

echo "Validating OpenTelemetry config against $IMAGE"
docker pull --quiet "$IMAGE"

# Mirror the production invocation (open-telemetry.ts): the config is passed via
# the AOT_CONFIG_CONTENT env var, not a --config flag. Dummy AWS + ECS metadata
# env let the awsecscontainermetrics receiver and aws* exporters build without a
# real ECS task or credentials. Without ECS_CONTAINER_METADATA_URI_V4 the
# receiver fails to construct off-ECS, which would be a false negative.
docker run --detach --name "$CONTAINER_NAME" \
  --env AWS_REGION=eu-west-1 \
  --env AWS_ACCESS_KEY_ID=dummy \
  --env AWS_SECRET_ACCESS_KEY=dummy \
  --env ECS_CONTAINER_METADATA_URI_V4=http://169.254.170.2/v4 \
  --env AOT_CONFIG_CONTENT="$RENDERED_CONFIG" \
  "$IMAGE" >/dev/null

sleep "$WAIT_SECONDS"

if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo false)" == "true" ]]; then
  echo "PASS: collector accepted the config and is running."
  exit 0
fi

exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$CONTAINER_NAME" 2>/dev/null || echo unknown)"
echo "FAIL: collector exited (code $exit_code) instead of running. Config is not valid for $IMAGE." >&2
echo "--- collector logs ---" >&2
docker logs "$CONTAINER_NAME" >&2 2>&1 || true
exit 1
