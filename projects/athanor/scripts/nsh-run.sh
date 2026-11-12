#!/usr/bin/env bash
# Run the Native Shell CLI from common install locations (install.sh → ~/.local/bin).
set -eu

find_nsh() {
  if command -v nsh >/dev/null 2>&1; then
    command -v nsh
    return 0
  fi
  for candidate in \
    "${NSH_BIN:-}" \
    "${HOME}/.local/bin/nsh" \
    "${NSH_INSTALL_DIR:-${HOME}/.nsh}/bin/nsh"; do
    if [[ -n "${candidate}" && -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

NSH="$(find_nsh)" || {
  cat >&2 <<'EOF'
nshde: Native Shell CLI (nsh) not found.

Install NSH (once per machine):
  curl -fsSL https://nsh.dev/install.sh | sh

Then ensure ~/.local/bin is on your PATH, for example:
  export PATH="$HOME/.local/bin:$PATH"

Or point at the binary explicitly:
  export NSH_BIN="$HOME/.local/bin/nsh"

Docs: https://nsh.dev/docs/installation
EOF
  exit 127
}

exec "${NSH}" "$@"
