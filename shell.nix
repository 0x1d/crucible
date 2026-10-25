{
  pkgs ? import <nixpkgs> { },
}:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_22
    beamPackages.elixir
    beamPackages.erlang
  ];

  shellHook = ''
    if [ ! -d node_modules ]; then
      echo "hint: run npm install"
    fi
    if [ ! -d runtime/deps ]; then
      echo "hint: run mix local.hex --force && mix local.rebar --force && (cd runtime && mix deps.get)"
    fi
  '';
}
