#!/usr/bin/env bash
# Builds the FlashNetwork test double into $1 (default: ./build).
# Fetches Flashforge's header from the Orca-Flashforge repository at build time.
set -euo pipefail
out="${1:-$(dirname "$0")/build}"
mkdir -p "$out"
curl -fsSL https://raw.githubusercontent.com/FlashForge/Orca-Flashforge/main/src/slic3r/GUI/FlashForge/FlashNetwork.h -o "$out/FlashNetwork.h"
cc -shared -fPIC -O1 -I"$out" -o "$out/libFlashNetwork.so" "$(dirname "$0")/fake-flashnetwork.c"
echo placeholder > "$out/FLASHNETWORK7.DAT"
echo "Built $out/libFlashNetwork.so — run the e2e with FAKE_FNET_DIR=$out"
