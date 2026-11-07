{
  description = "Homunculus - physical AI companion on ESP32 devices";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";

    # ESP-IDF + Espressif toolchains (default ESP-IDF v5.5.x).
    esp-dev = {
      url = "github:mirrexagon/nixpkgs-esp-dev";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };

    # Lets shell.nix / default.nix expose this flake to classic `nix-shell`.
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      esp-dev,
      ...
    }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ] (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ esp-dev.overlays.default ];
          # esptool depends on python-ecdsa, which nixpkgs marks insecure.
          # See https://github.com/mirrexagon/nixpkgs-esp-dev/issues/109
          config.permittedInsecurePackages = [ "python3.13-ecdsa-0.19.1" ];
        };

        commonTools = with pkgs; [
          git
          git-lfs
          jq
          nixfmt-rfc-style
        ];

        # ESP32-S3 is Xtensa; esp-idf-xtensa covers ESP32 / S2 / S3.
        # Switch to esp-idf-full once RISC-V boards (C6, P4) are supported.
        firmwareTools = with pkgs; [
          esp-idf-xtensa
          picocom
        ];

        # nixpkgs-esp-dev bundles idf-component-manager 2.2.2, which cannot resolve
        # Kconfig-conditional dependencies (esp_board_manager, used by Brookesia
        # v0.7). Shadow it with a newer release via PYTHONPATH; its runtime deps
        # come from the ESP-IDF Python environment.
        idfComponentManager = pkgs.python3Packages.buildPythonPackage rec {
          pname = "idf_component_manager";
          version = "2.4.9";
          format = "wheel";
          src = pkgs.fetchPypi {
            inherit pname version format;
            dist = "py3";
            python = "py3";
            hash = "sha256-DHfnsH0fIMkP2X1+gJQNVdSPBW4alARFK/nURpr/IzI=";
          };
          dontCheckRuntimeDeps = true;
        };

        firmwareShellHook = ''
          export PYTHONPATH=${idfComponentManager}/${pkgs.python3.sitePackages}''${PYTHONPATH:+:$PYTHONPATH}
        '';

        serverTools = with pkgs; [
          nodejs_22
          pnpm
          libopus
          ffmpeg-headless
        ];

        docsTools = with pkgs; [
          mermaid-cli
          poppler-utils
        ];

        shellHook = ''
          git lfs install --local >/dev/null 2>&1 || true
        '';
      in
      {
        devShells = {
          default = pkgs.mkShell {
            name = "homunculus";
            packages = commonTools ++ firmwareTools ++ serverTools;
            shellHook = shellHook + firmwareShellHook;
          };

          firmware = pkgs.mkShell {
            name = "homunculus-firmware";
            packages = commonTools ++ firmwareTools;
            shellHook = shellHook + firmwareShellHook;
          };

          server = pkgs.mkShell {
            name = "homunculus-server";
            packages = commonTools ++ serverTools;
            inherit shellHook;
          };

          docs = pkgs.mkShell {
            name = "homunculus-docs";
            packages = commonTools ++ docsTools;
            inherit shellHook;
          };
        };

        checks = {
          nix-format =
            pkgs.runCommandLocal "check-nix-format" { nativeBuildInputs = [ pkgs.nixfmt-rfc-style ]; }
              ''
                nixfmt --check ${./flake.nix} ${./shell.nix} ${./default.nix}
                touch $out
              '';
        };

        formatter = pkgs.nixfmt-rfc-style;
      }
    );
}
