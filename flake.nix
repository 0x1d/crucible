{
  description = "Crucible - monorepo of alchemist, homunculus and athanor";

  # The project flakes stay usable on their own; this flake builds the
  # workspace shells on top of them (crucible/architecture/repository-and-migration).
  inputs = {
    alchemist.url = "path:./projects/alchemist";
    homunculus.url = "path:./projects/homunculus";
    nixpkgs.follows = "alchemist/nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      alchemist,
      homunculus,
    }:
    let
      # Systems every project flake supports.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          # Node 24, pnpm, Elixir, Erlang: alchemist, homunculus server, packages.
          default = pkgs.mkShell {
            name = "crucible";
            # Same toolchain as the alchemist shell (projects/alchemist/shell.nix).
            packages = with pkgs; [
              nodejs_24
              pnpm
              beamPackages.elixir_1_20
              beamPackages.erlang
              gh
              git-lfs
              python3 # Formulary's check-docs.py
            ];
          };

          athanor = pkgs.mkShell {
            name = "crucible-athanor";
            packages = with pkgs; [
              bun
              nodejs_24
            ];
          };

          firmware = homunculus.devShells.${system}.firmware;
          homunculus-server = homunculus.devShells.${system}.server;
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt-rfc-style);
    };
}
