# Classic `nix-shell` entry point; uses the same pinned inputs as flake.nix.
#   nix-shell                      -> default shell (firmware + server)
#   nix-shell -A firmware          -> ESP-IDF only
#   nix-shell -A server / -A docs
let
  shells = (import ./default.nix).devShells.${builtins.currentSystem};
in
shells.default // shells
