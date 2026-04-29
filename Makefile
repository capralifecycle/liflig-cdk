.PHONY: all
all: build

######################
# Main targets
######################

.PHONY: build
build: clean install fmt lint-fix npm-build snapshots

.PHONY: ci
ci: install verify

.PHONY: verify
# `snapshots-check` pulls in `snapshots` via the dep graph, so a single -j
# invocation schedules everything correctly: lint, fmt-check, py-test and the
# snapshots → snapshots-check chain run in parallel.
verify:
	@$(MAKE) --no-print-directory -j 4 lint fmt-check snapshots-check py-test


######################
# Composite targets
######################

.PHONY: install
install: npm-install

.PHONY: lint
lint: npm-lint py-lint

.PHONY: lint-fix
lint-fix: npm-lint-fix py-lint-fix

.PHONY: fmt
fmt: npm-fmt py-fmt

.PHONY: fmt-check
fmt-check: npm-fmt-check py-fmt-check

.PHONY: snapshots
snapshots: npm-cdk-snapshots npm-jest-snapshots

.PHONY: snapshots-check
snapshots-check: npm-snapshots-check

.PHONY: upgrade-dependencies
upgrade-dependencies: npm-upgrade-dependencies

.PHONY: update-docs
update-docs: npm-update-docs

######################
# Node targets
######################

.PHONY: npm-install
npm-install:
ifeq ($(CI),true)
	npm ci
else
	npm install
endif

.PHONY: npm-build
npm-build:
	npm run build

.PHONY: npm-lint
npm-lint:
	npm run lint

.PHONY: npm-lint-fix
npm-lint-fix:
	npm run lint:fix

.PHONY: npm-fmt
npm-fmt:
	npm run format

.PHONY: npm-fmt-check
npm-fmt-check:
	npm run format:check

.PHONY: npm-cdk-snapshots
# Needs `lib/` because create-snapshots.sh runs the compiled cdk-create-snapshots.js.
# Also serialized after npm-jest-snapshots: both contend on cdk.out, and the CDK CLI's
# lock blocks jest's in-process synth (Template.fromStack) when they run concurrently.
npm-cdk-snapshots: npm-build npm-jest-snapshots
	npm run snapshots

.PHONY: npm-jest-snapshots
npm-jest-snapshots:
	npm test -- --updateSnapshot

.PHONY: npm-snapshots-check
npm-snapshots-check: snapshots
	git status ':(glob)**/__snapshots__/**' && git add --intent-to-add ':(glob)**/__snapshots__/**' && git diff --exit-code ':(glob)**/__snapshots__/**'

.PHONY: validate-renovate-config
validate-renovate-config:
	npx --yes --package renovate@latest -- renovate-config-validator --strict renovate.json5

.PHONY: release
release:
	npm run semantic-release

.PHONY: clean
clean:
	rm -rf lib/
	rm -rf cdk.out/

.PHONY: clean-all
clean-all: clean
	rm -rf node_modules/

.PHONY: npm-upgrade-dependencies
npm-upgrade-dependencies:
	npm run upgrade-dependencies
	npm run snapshots

.PHONY: npm-update-docs
npm-update-docs:
	npm run docs

######################
# Python targets
######################

.PHONY: py-lint
py-lint:
	ruff check

.PHONY: py-lint-fix
py-lint-fix:
	ruff check --fix

.PHONY: py-fmt
py-fmt:
	ruff format

.PHONY: py-fmt-check
py-fmt-check:
	ruff format --check

# Python test runner for the lambda assets
.PHONY: py-test
py-test:
	@echo "Auto-discovering asset lambdas with tests..."
	@scripts/run_py_tests.sh
