#!/usr/bin/env bash
# Builds and runs the HDP codec host test against protocol/vectors.
# Needs a host C++20 compiler and firmware/managed_components (Boost headers from espressif/esp-boost;
# BOOST_NO_USER_CONFIG skips its ESP32 platform config).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
comp="$here/../.."
fw="$comp/../.."
repo="$fw/.."
boost="$fw/managed_components/espressif__esp-boost/src"
[ -d "$boost" ] || { echo "missing $boost (run idf.py reconfigure first)" >&2; exit 2; }
out="${TMPDIR:-/tmp}/homunculus_test_hdp"
"${CXX:-c++}" -std=c++20 -O1 -Wall -Wextra -I "$comp/include" -isystem "$boost" \
    -DBOOST_NO_USER_CONFIG -DBOOST_JSON_NO_LIB -DBOOST_CONTAINER_NO_LIB \
    "$here/test_hdp.cpp" "$comp/src/hdp.cpp" -o "$out"
"$out" "$repo/protocol/vectors"
