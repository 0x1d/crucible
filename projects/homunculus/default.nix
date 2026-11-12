# Non-flake access to the flake outputs via flake-compat (pinned in flake.lock).
let
  lock = builtins.fromJSON (builtins.readFile ./flake.lock);
  flakeCompat = lock.nodes.flake-compat.locked;
in
(import (fetchTarball {
  url = "https://github.com/edolstra/flake-compat/archive/${flakeCompat.rev}.tar.gz";
  sha256 = flakeCompat.narHash;
}) { src = ./.; }).defaultNix
