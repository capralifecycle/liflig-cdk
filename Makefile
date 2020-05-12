all:
	@echo "Specify a valid target"
	@exit 1

.PHONY: snapshots
snapshots:
	./scripts/create-snapshots.sh
