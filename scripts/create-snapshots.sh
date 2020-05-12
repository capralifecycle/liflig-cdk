#!/bin/bash
set -eu -o pipefail

rm -rf cdk.out

node_modules/.bin/cdk \
  synth \
  --app "node_modules/.bin/ts-node examples/app.ts"

# Wipe previous snapshots as we are overwriting it.
rm -rf __snapshots__
mkdir __snapshots__

node lib/bin/cdk-create-snapshots.js \
  cdk.out \
  __snapshots__/app
