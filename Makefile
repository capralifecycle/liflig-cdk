.PHONY: all
all: build

.PHONY: install-deps
install-deps:
ifeq ($(CI),true)
	npm ci
else
	npm install
endif

.PHONY: build
build: clean install-deps
	npm install
	npm run lint
	npm run build
	npm run test
	npm run snapshots

.PHONY: snapshots
snapshots:
	npm run snapshots
	npm test -- --updateSnapshot

.PHONY: check-snapshots
check-snapshots:
	git status __snapshots__ && git add __snapshots__ --intent-to-add && git diff --exit-code __snapshots__

.PHONY: lint
lint:
	npm run lint

.PHONY: lint-fix
lint-fix:
	npm run lint:fix

.PHONY: test
test:
	npm run test

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

.PHONY: upgrade-dependencies
upgrade-dependencies:
	npm run upgrade-dependencies
	npm run snapshots

.PHONY: fmt
fmt:
	npm run format
