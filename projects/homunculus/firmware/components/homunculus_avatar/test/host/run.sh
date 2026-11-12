#!/usr/bin/env bash
# Builds and runs the ring rasteriser host test; optional argument: PPM contact sheet path.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
comp="$here/../.."
out="${TMPDIR:-/tmp}/homunculus_test_ring"
"${CXX:-c++}" -std=c++20 -O1 -Wall -Wextra -I "$comp/src" "$here/test_ring.cpp" "$comp/src/ring_renderer.cpp" -o "$out"
"$out" "$@"
