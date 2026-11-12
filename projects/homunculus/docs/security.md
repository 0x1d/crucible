---
id: crucible/homunculus/security
title: Security and Privacy
type: SEC
owner: crucible/homunculus
status: Draft
date: 2026-11-11
depends: [crucible/homunculus/requirements, crucible/homunculus/architecture]
related: []
planned: []
---

# Security and Privacy

## 1 Threat model (summary)

| Asset | Threat | Mitigation |
| --- | --- | --- |
| Microphone audio | Eavesdropping on LAN / Internet | WSS (TLS 1.2+); server certificate pinned or validated against provisioned CA |
| Device identity | Device impersonation | Per-device bearer token issued at pairing, bound to the device id, SHA-256 at rest on the server; stored in NVS (encrypted NVS in production) |
| Server | Rogue device connections | Pairing approval needs the code shown on the device and the server admin key; tokens revocable; development token `dev` from loopback only |
| Host machine | Agent executing harmful tools | Default-deny for shell/file write; per-device sandbox `cwd`; permission policy with on-device confirmation |
| User accounts / external services | Prompt injection via web content triggers side effects | Side-effecting tools require on-device confirmation; tool output treated as untrusted in system prompt |
| Firmware | Malicious OTA | Signed images, Secure Boot v2, flash encryption (production builds) |
| API keys | Leakage | Keys only on server, never on device; environment/secret store |

## 2 Privacy principles

- Wake word detection runs **locally**; no audio leaves the device before activation (wake word, touch, button).
- Visual indication whenever the microphone is streaming (listening state ring); hardware-independent mic mute via PWR key / quick settings.
- Audio recordings are not stored by default; debug recording is opt-in per device.
- Long-term memory (temporal graph, wiki) stays on the server host; each exchange is sent to the extraction model after the turn; wiki page deletion is confirmed on the device; erase via admin CLI [crucible/homunculus/server/design/memory](server/design/memory.md) section 7).
- Local-only operation is possible: local STT/TTS + OpenCode with a local model provider.

## 3 Authentication

Devices: per-device token from pairing [crucible/homunculus/firmware/design](firmware/design.md) section 5, [crucible/homunculus/server/design](server/design.md) section 9). A pairing request alone grants nothing: approval needs the admin key (phone page, once per phone via cookie; or the admin CLI on the server host). The approval URL and code travel over the LAN in plain HTTP unless TLS is configured.

The Claude Agent SDK backend authenticates with `ANTHROPIC_API_KEY` if set, otherwise with the host's logged-in Claude subscription. Subscription login: personal use only; offering claude.ai login in a distributed third-party product built on the Agent SDK is not permitted; product naming must follow Anthropic's branding guidelines (e.g. "Homunculus, powered by Claude" - not "Claude Code").
