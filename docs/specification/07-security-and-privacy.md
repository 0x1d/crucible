# 7. Security and Privacy

| | |
| --- | --- |
| Document | HOM-SPEC-07 |
| Status | Draft 0.1 |

## 7.1 Threat model (summary)

| Asset | Threat | Mitigation |
| --- | --- | --- |
| Microphone audio | Eavesdropping on LAN / Internet | WSS (TLS 1.2+); server certificate pinned or validated against provisioned CA |
| Device identity | Device impersonation | Per-device bearer token issued at pairing; stored in NVS (encrypted NVS in production) |
| Server | Rogue device connections | Pairing requires physical confirmation (code shown on device); tokens revocable |
| Host machine | Agent executing harmful tools | Default-deny for shell/file write; per-device sandbox `cwd`; permission policy with on-device confirmation |
| User accounts / external services | Prompt injection via web content triggers side effects | Side-effecting tools require on-device confirmation; tool output treated as untrusted in system prompt |
| Firmware | Malicious OTA | Signed images, Secure Boot v2, flash encryption (production builds) |
| API keys | Leakage | Keys only on server, never on device; environment/secret store |

## 7.2 Privacy principles

- Wake word detection runs **locally**; no audio leaves the device before activation (wake word, touch, button).
- Visual indication whenever the microphone is streaming (listening state ring); hardware-independent mic mute via PWR key / quick settings.
- Audio recordings are not stored by default; debug recording is opt-in per device.
- Local-only operation is possible: local STT/TTS + OpenCode with a local model provider.

## 7.3 Authentication

The Claude Agent SDK backend authenticates with an Anthropic API key. Use of claude.ai subscription login for third-party products built on the Agent SDK is not permitted; product naming must follow Anthropic's branding guidelines (e.g. "Homunculus, powered by Claude" — not "Claude Code").
