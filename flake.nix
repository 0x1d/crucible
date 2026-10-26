{
  description = "Alchemist — Elixir capability codex + Cursor agent adapter";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      shellFor =
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        pkgs.callPackage ./shell.nix { inherit pkgs; };
    in
    {
      devShells = forAllSystems (system: {
        default = shellFor system;
      });
      # Nix clients older than 2.7 look up devShell.<system>.
      devShell = forAllSystems shellFor;
    };
}
