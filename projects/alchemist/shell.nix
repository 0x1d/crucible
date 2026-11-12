{
  pkgs ? import <nixpkgs> { },
}:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_24
    pnpm
    beamPackages.elixir_1_20
    beamPackages.erlang
    gh
  ];

  shellHook = ''
    if [ ! -d node_modules ]; then
      echo "hint: run pnpm install (from the crucible root)"
    fi
    if [ ! -d runtime/deps ]; then
      echo "hint: run mix local.hex --force && mix local.rebar --force && (cd runtime && mix deps.get)"
    fi
  '';
}
