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

        # esp-idf-nix pins idf-component-manager 3.0.x, which fails on manifest
        # conditions that reference Kconfig symbols invisible on the selected
        # board (MissingKconfigError in brookesia_hal_adaptor). 3.1.x handles
        # them. Shadow it via PYTHONPATH; other deps come from the IDF env.
        wheel =
          pname: version: hash:
          pkgs.python3Packages.buildPythonPackage {
            inherit pname version;
            format = "wheel";
            src = pkgs.fetchPypi {
              inherit pname version hash;
              format = "wheel";
              dist = "py3";
              python = "py3";
            };
            dontCheckRuntimeDeps = true;
          };
        idfComponentManager = [
          (wheel "idf_component_manager" "3.1.2" "sha256-QkSUSTtHth6g92ZtMBinHe7Ld/IRhryLZ2GwtvmOj5A=")
          (wheel "pathvalidate" "3.3.1" "sha256-UmO6q2kfjhr5YJL6UTfuF99b371s/x/KxNbvS8Lhc18=")
        ];
        firmwareShellHook = ''
          export PYTHONPATH=${
            pkgs.lib.concatMapStringsSep ":" (w: "${w}/lib/python3.13/site-packages") idfComponentManager
          }''${PYTHONPATH:+:$PYTHONPATH}
          # Server tools (piper-tts) bring their own python3; idf.py needs the IDF env first on PATH.
          export PATH=${espIdf.espPython.pythonEnv}/bin:$PATH
        '';

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
          whisper-cpp # STT (D-01): whisper-server
          piper-tts # TTS fallback (D-02)
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
              shellHook = shellHook + firmwareShellHook;
            }
          );

          firmware = pkgs.mkShell (
            espIdfEnv
            // {
              name = "homunculus-firmware";
              inputsFrom = [ espIdfShell ];
              packages = commonTools ++ firmwareTools;
              shellHook = shellHook + firmwareShellHook;
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
