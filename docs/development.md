# Development Environment

The project is built exclusively with Nix. All toolchains are pinned in `flake.lock`.

## Shells

| Shell | Flake | Classic | Contents |
| --- | --- | --- | --- |
| default | `nix develop` | `nix-shell` | firmware + server tools |
| firmware | `nix develop .#firmware` | `nix-shell -A firmware` | ESP-IDF v6.0.2 (Xtensa + RISC-V toolchains), idf-component-manager 3.x, esptool, OpenOCD, picocom |
| server | `nix develop .#server` | `nix-shell -A server` | Node.js 22, pnpm, libopus, ffmpeg |
| docs | `nix develop .#docs` | `nix-shell -A docs` | mermaid-cli, poppler-utils |

All shells include git, git-lfs, jq and nixfmt. With direnv installed, `direnv allow` loads the default shell automatically (`.envrc`).

ESP-IDF comes from [esp-idf-nix](https://github.com/Cbeck527/esp-idf-nix) (`lib.mkEspIdfEnv`, version pinned in `flake.nix`). ESP-Brookesia 0.8 requires ESP-IDF ≥ 6.0, ≤ 6.2 on ESP32-S3.

Binary cache: `https://esp-idf-nix.cachix.org` (declared in `nixConfig`). It is used only if your user is a trusted Nix user or the substituter is added system-wide:

```nix
nix.settings = {
  extra-substituters = [ "https://esp-idf-nix.cachix.org" ];
  extra-trusted-public-keys = [ "esp-idf-nix.cachix.org-1:6qHkAxmub00GqSujpkTqbL3XZvT6d4g8/13FcL+wrpQ=" ];
};
```

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

## Firmware

```bash
cd firmware
idf.py gen-bmgr-config -b esp32_s3_touch_amoled_1_75c
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

`gen-bmgr-config` generates `components/gen_bmgr_codes/` (git-ignored) from the Brookesia board definition; run it once per checkout or board change. Component versions are locked in `firmware/dependencies.lock`.

## Server

```bash
cd server
pnpm install
pnpm typecheck
pnpm spike:claude
```

Claude auth: `ANTHROPIC_API_KEY` if set, otherwise the logged-in Claude subscription.

## Git LFS

Binary assets (`*.pdf`, `*.png`, `*.jpg`, `*.webp`, `*.bin`, `*.zip`) are stored in Git LFS. The dev shells provide `git-lfs` and run `git lfs install --local` on entry; outside a shell, git operations on this repository need `git-lfs` on the PATH.

## Reproducible builds (planned)

Once firmware and server code exist, they will be exposed as flake packages (`nix build .#firmware-<board>`, `nix build .#server`). ESP-IDF component-manager dependencies (`managed_components/`) will need to be vendored or fixed-output fetched, since Nix builds have no network access.
