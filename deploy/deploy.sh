#!/usr/bin/env bash
# Push the working tree to the Etch web root. Run from anywhere:
#   ./deploy/deploy.sh
# Override the target with env vars:
#   ETCH_HOST=root@192.0.2.30 ETCH_DEST=/srv/etch ./deploy/deploy.sh
set -euo pipefail

HOST="${ETCH_HOST:-etch}"
DEST="${ETCH_DEST:-/srv/etch}"

cd "$(dirname "$0")/.."

# Ship only what the browser needs. The internal docs (CLAUDE.md, AGENTS.md,
# Handoff.md, antlii-*.md) are meant to stay internal, so exclude every *.md —
# they exist in the working tree and would otherwise land in the web root.
# Nothing the site loads is a .md file.
# --chmod normalises modes on the way in. Without it a directory that happens to
# be 750 locally (curl --create-dirs has produced one) ships as 750 and Caddy,
# running as its own user, cannot traverse it — every file under it 403s.
rsync -az --delete --info=stats1 \
	--chmod=D755,F644 \
	--exclude='.git/' \
	--exclude='.gitignore' \
	--exclude='.claude/' \
	--exclude='.playwright-mcp/' \
	--exclude='deploy/' \
	--exclude='*.md' \
	./ "$HOST:$DEST/"

echo "deployed to $HOST:$DEST"
