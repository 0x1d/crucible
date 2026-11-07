# Development Environment

The project is built exclusively with Nix. All toolchains are pinned in `flake.lock`.

## Shells

| Shell | Flake | Classic | Contents |
| --- | --- | --- | --- |
| default | `nix develop` | `nix-shell` | firmware + server tools |
| firmware | `nix develop .#firmware` | `nix-shell -A firmware` | ESP-IDF v5.5.x (Xtensa: ESP32/S2/S3), esptool, OpenOCD, picocom |
| server | `nix develop .#server` | `nix-shell -A server` | Node.js 22, pnpm, libopus, ffmpeg |
| docs | `nix develop .#docs` | `nix-shell -A docs` | mermaid-cli, poppler-utils |

All shells include git, git-lfs, jq and nixfmt. With direnv installed, `direnv allow` loads the default shell automatically (`.envrc`).

ESP-IDF comes from [nixpkgs-esp-dev](https://github.com/mirrexagon/nixpkgs-esp-dev). Its default IDF version (v5.5.x) matches ESP-Brookesia `release/v0.7` and the vendor-tested IDF for the reference device. RISC-V targets (ESP32-C6, ESP32-P4) will require switching `esp-idf-xtensa` to `esp-idf-full` in `flake.nix`.

## Checks and formatting

```bash
nix flake check
```

```bash
nix fmt
```

## Flashing on NixOS

The reference device enumerates as `/dev/ttyACM0` (native USB-Serial/JTAG). Your user needs to be in the `dialout` group:

```nix
users.users.<name>.extraGroups = [ "dialout" ];
```

## Git LFS

Binary assets (`*.pdf`, `*.png`, `*.jpg`, `*.webp`, `*.bin`, `*.zip`) are stored in Git LFS. The dev shells provide `git-lfs` and run `git lfs install --local` on entry; outside a shell, git operations on this repository need `git-lfs` on the PATH.

## Reproducible builds (planned)

Once firmware and server code exist, they will be exposed as flake packages (`nix build .#firmware-<board>`, `nix build .#server`). ESP-IDF component-manager dependencies (`managed_components/`) will need to be vendored or fixed-output fetched, since Nix builds have no network access.
