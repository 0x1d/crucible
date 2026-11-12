# Homunculus build / flash / backend entry points.
# Run `make help` for the target list.
#
# Toolchains come from the Nix flake. Outside a dev shell every command is run
# through `nix develop`; inside one (or with direnv) it runs directly.

BOARD ?= esp32_s3_touch_amoled_1_75c
PORT  ?= /dev/ttyACM0
# Keep in sync with TEMPORAL_REASONING_PACKAGE (server/src/memory/temporal-reasoning.ts).
MEMORY_MCP := temporal-reasoning==0.9.0

ifeq ($(IN_NIX_SHELL),)
FW_SHELL  := nix develop $(CURDIR)\#firmware --command
SRV_SHELL := nix develop $(CURDIR)\#server --command
else
FW_SHELL  :=
SRV_SHELL :=
endif

IDF := cd firmware && $(FW_SHELL) idf.py

.DEFAULT_GOAL := help
.PHONY: help setup deps models models-piper memory-mcp \
        fw-config fw-build fw-flash fw-flash-full fw-publish fw-monitor fw-flash-monitor fw-menuconfig fw-clean fw-test \
        server devices sim sim-play test typecheck backend check

help: ## Show this help
	@awk 'BEGIN{FS=":.*## "} /^[a-zA-Z_-]+:.*## /{printf "  %-18s %s\n",$$1,$$2}' $(MAKEFILE_LIST)
	@echo; echo "Variables: BOARD=$(BOARD) PORT=$(PORT)"

# ---- setup -----------------------------------------------------------------

setup: deps models memory-mcp fw-config ## One-time setup: JS deps, speech models, memory MCP server, board config

deps: ## Install JS dependencies (pnpm workspace)
	$(SRV_SHELL) pnpm install

models: deps ## Download speech models (whisper base.en, VAD) into server/models
	$(SRV_SHELL) pnpm --filter homunculus-server exec tsx scripts/fetch-models.ts

models-piper: deps ## Also download the Piper TTS fallback voice
	$(SRV_SHELL) pnpm --filter homunculus-server exec tsx scripts/fetch-models.ts --piper

memory-mcp: ## Fetch the temporal-reasoning MCP server (memory) into the uv cache
	$(SRV_SHELL) env -u PYTHONPATH -u PYTHONHOME uvx --from $(MEMORY_MCP) python -c "import mcp_server"

# ---- firmware --------------------------------------------------------------

fw-config: ## Generate Brookesia board config (once per checkout / board change)
	$(IDF) gen-bmgr-config -b $(BOARD)

fw-build: ## Build the firmware
	$(IDF) build

fw-flash: ## Build, flash only changed app sectors to PORT (development)
	cd firmware && $(FW_SHELL) ./flash-app.sh $(PORT)

fw-flash-full: ## Flash bootloader, partitions, app, model and littlefs (fresh board; ~90 s)
	$(IDF) -p $(PORT) flash
	cp firmware/build/homunculus.bin firmware/build/last-flashed-app.bin

fw-publish: fw-build ## Copy the built image to the server's OTA directory (device.update_firmware / console u)
	mkdir -p server/.data/ota
	cp firmware/build/homunculus.bin server/.data/ota/ws-s3-amoled-175c.bin

fw-monitor: ## Serial monitor on PORT (Ctrl-] to exit)
	$(IDF) -p $(PORT) monitor

fw-flash-monitor: fw-flash ## Fast flash, then open the serial monitor
	$(IDF) -p $(PORT) monitor

fw-menuconfig: ## ESP-IDF menuconfig
	$(IDF) menuconfig

fw-clean: ## Remove firmware build output
	$(IDF) fullclean

fw-test: ## Firmware host tests (HDP codec, ring rasteriser)
	$(FW_SHELL) firmware/components/homunculus_agent/test/host/run.sh
	$(FW_SHELL) firmware/components/homunculus_avatar/test/host/run.sh

# ---- backend ---------------------------------------------------------------

server: deps ## Run the backend (ws://0.0.0.0:8443/hdp; spawns whisper-server itself)
	$(SRV_SHELL) pnpm --filter homunculus-server dev

backend: server ## Alias for `server`

devices: ## Device pairing admin on the running server (ARGS="key|pending|approve <code> [name]|list|revoke <id>")
	$(SRV_SHELL) pnpm --silent --filter homunculus-server devices $(ARGS)

sim: deps ## Device simulator, interactive (needs a running server)
	$(SRV_SHELL) pnpm --filter @homunculus/simulator sim

sim-play: deps ## Device simulator with audio playback
	$(SRV_SHELL) pnpm --filter @homunculus/simulator sim --play

typecheck: deps ## Typecheck all TypeScript packages
	$(SRV_SHELL) pnpm typecheck

test: deps ## Run server / protocol tests
	$(SRV_SHELL) pnpm test

check: typecheck test fw-test ## All checks
