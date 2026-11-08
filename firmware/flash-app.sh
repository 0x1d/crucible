#!/usr/bin/env bash
# Fast development flash: build, then write only the app image. esptool --diff-with transfers only
# the 4 KB sectors that differ from the image this script flashed last (build/last-flashed-app.bin).
# Bootloader, partition table, model and littlefs_data partitions are left as they are: use
# `idf.py flash` for a fresh board or after partition / bootloader changes. A stale diff base (flash
# changed by another tool) fails esptool's post-write verification and the whole image is rewritten.
#
#   cd firmware && ./flash-app.sh [port]        (inside `nix develop .#firmware`)
set -euo pipefail
cd "$(dirname "$0")"
port="${1:-${PORT:-/dev/ttyACM0}}"
last=build/last-flashed-app.bin

idf.py build

# Offset and flash settings from the build's flasher_args.json.
read -r offset file mode freq size < <(python - <<'EOF'
import json
a = json.load(open("build/flasher_args.json"))
s = a["flash_settings"]
print(a["app"]["offset"], "build/" + a["app"]["file"], s["flash_mode"], s["flash_freq"], s["flash_size"])
EOF
)

diff=()
[ -f "$last" ] && diff=(--diff-with "$last")
python -m esptool --chip esp32s3 -p "$port" --before default-reset --after hard-reset \
    write-flash --flash-mode "$mode" --flash-freq "$freq" --flash-size "$size" "${diff[@]}" "$offset" "$file"
cp "$file" "$last"
