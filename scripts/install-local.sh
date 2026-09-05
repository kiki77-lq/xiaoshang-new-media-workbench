#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/local-service.mjs" install
