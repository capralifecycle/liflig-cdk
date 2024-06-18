.PHONY: all build

all: build
build:
	npm install
	npm run lint
	npm run build
	npm run snapshots
	npm run test
