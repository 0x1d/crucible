#!/usr/bin/env bash
# Builds and runs the card rasteriser host test; optional argument: PPM contact sheet path.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
comp="$here/../.."
out="${TMPDIR:-/tmp}/homunculus_test_card"
"${CXX:-c++}" -std=c++20 -O1 -Wall -Wextra -I "$comp/src" "$here/test_card.cpp" "$comp/src/card_renderer.cpp" "$comp/src/ring_renderer.cpp" -o "$out"
"$out" "$@"
