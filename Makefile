.PHONY: all
all: build

.PHONY: build
build: clean

	# don't trigger prepare on install
	npm install --ignore-scripts
	npm run lint
	npm run build
	npm run snapshots
	npm run test

.PHONY: snapshots
snapshots:
	npm run snapshots
	npm test -- --updateSnapshot

.PHONY: clean
clean:
	rm -rf lib/
	rm -rf cdk.out/

.PHONY: clean-all
clean-all: clean
	rm -rf node_modules/
