.PHONY: all build clean

all: build
build:
	npm install
	npm run lint
	npm run build
	npm run snapshots
	npm run test

clean:
	rm -rf node_modules
