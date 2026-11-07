{
  description = "Homunculus - physical AI companion on ESP32 devices";

  nixConfig = {
    extra-substituters = [ "https://esp-idf-nix.cachix.org" ];
    extra-trusted-public-keys = [
      "esp-idf-nix.cachix.org-1:6qHkAxmub00GqSujpkTqbL3XZvT6d4g8/13FcL+wrpQ="
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";

    # ESP-IDF + Espressif toolchains. Keeps its own locked nixpkgs so the
    # esp-idf-nix binary cache applies.
    esp-idf-nix.url = "github:Cbeck527/esp-idf-nix";

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
      esp-idf-nix,
      ...
    }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ] (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # ESP-Brookesia 0.8 requires ESP-IDF >= 6.0, <= 6.2 on ESP32-S3.
        espIdf = esp-idf-nix.lib.mkEspIdfEnv {
          inherit system;
          version = "6.0.2";
        };

        commonTools = with pkgs; [
          git
          git-lfs
          jq
          nixfmt-rfc-style
        ];

        firmwareTools = with pkgs; [ picocom ];

        # inputsFrom merges packages and shellHook but not plain env attributes.
        espIdfShell = espIdf.devShells.full;
        espIdfEnv = {
          inherit (espIdfShell)
            ESP_IDF_VERSION
            ESP_ROM_ELF_DIR
            IDF_PATH
            OPENOCD_SCRIPTS
            ;
        };

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
          default = pkgs.mkShell (
            espIdfEnv
            // {
              name = "homunculus";
              inputsFrom = [ espIdfShell ];
              packages = commonTools ++ firmwareTools ++ serverTools;
              inherit shellHook;
            }
          );

          firmware = pkgs.mkShell (
            espIdfEnv
            // {
              name = "homunculus-firmware";
              inputsFrom = [ espIdfShell ];
              packages = commonTools ++ firmwareTools;
              inherit shellHook;
            }
          );

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
