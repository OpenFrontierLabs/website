.PHONY: setup dev build check release assets migrate
setup:
	bun install
dev:
	bun run dev
build:
	bun run build
assets:
	bun run assets
check:
	bun run check
release:
	bun run release
migrate:
	bun run migrate
