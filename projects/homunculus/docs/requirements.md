---
id: crucible/homunculus/requirements
title: Requirements
type: REQ
owner: crucible/homunculus
status: Draft
date: 2026-11-11
depends: []
related: []
planned: []
---

# Requirements

## 1 Vision

**Homunculus** is a physical AI companion: a small, battery-powered ESP32 device with a microphone, speaker and display that hosts an animated avatar. The user talks to the device; a server-side agent - a full agent harness with tools, web access and memory - executes the request and answers by voice, while the avatar reacts expressively to what is happening (listening, thinking, using tools, speaking, emotions).

The device is a **thin, expressive terminal**. All reasoning, speech recognition and speech synthesis run on the server. The device owns the real-time concerns that cannot be delegated: audio capture and echo cancellation, wake-word detection, audio playback, avatar animation and local input.

## 2 Scope

In scope (initial specification):

- Device firmware for ESP32-S3 based devices on ESP-IDF, with the Waveshare ESP32-S3-Touch-AMOLED-1.75C as reference device.
- A device <-> server real-time protocol (audio + control + avatar events).
- A server comprising: device gateway, session orchestration, speech services (STT, TTS, VAD), and an **inference abstraction layer** with initial backends **Claude Agent SDK** and **OpenCode SDK**.
- Avatar model: states, emotions, rendering approach.
- Multi-device support model (capability negotiation, per-device profiles).

Out of scope (initially): on-device LLM inference, camera/vision, multi-user voice identification, cloud multi-tenant hosting, mobile companion app.

## 3 Goals and non-goals

| Goals | Non-goals |
| --- | --- |
| Natural, low-latency voice conversation with barge-in | Running models on the MCU |
| Agent can use tools and the internet like a desktop agent harness | Re-implementing an agent loop - reuse SDK harnesses |
| Backend-agnostic: swap agent / STT / TTS providers via configuration | Locking into one vendor |
| Expressive avatar reflecting agent state in real time | Photorealistic rendering |
| Support multiple ESP32 device types via capability negotiation | Supporting non-ESP32 hardware in v1 |
| Self-hostable on a home server / workstation | Public SaaS |

## 4 Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-01 | The device shall capture user speech, apply AEC/NS/AGC and stream it to the server. | Must |
| FR-02 | The device shall support wake-word activation and push-to-talk (touch / button). | Must |
| FR-03 | The device shall play synthesized speech streamed by the server with < 300 ms buffering. | Must |
| FR-04 | The user shall be able to interrupt playback by speaking (barge-in) or touching the screen. | Must |
| FR-05 | The device shall render an animated avatar whose state follows the conversation (idle, listening, thinking, working, speaking, sleeping, error). | Must |
| FR-06 | The avatar shall display emotions requested by the agent (e.g. happy, curious, concerned, surprised). | Must |
| FR-07 | The avatar's mouth shall move in sync with speech output. | Should |
| FR-08 | The server shall transcribe speech (streaming STT) and forward final transcripts to the agent. | Must |
| FR-09 | The server shall run prompts through a pluggable agent backend; Claude Agent SDK and OpenCode SDK shall be supported initially. | Must |
| FR-10 | The agent shall have access to tools including web search/fetch and MCP servers. | Must |
| FR-11 | The server shall convert agent output into speech-friendly text and synthesize it incrementally (sentence streaming). | Must |
| FR-12 | Conversation sessions shall persist per device and resume after reconnects. | Should |
| FR-13 | The agent shall be able to call device-side tools (volume, brightness, show text/QR/image, IMU state, battery). | Should |
| FR-14 | Risky tool calls shall be confirmable by the user on the device (touch approve/deny). | Should |
| FR-15 | Devices shall announce capabilities; the server shall adapt (display size, audio formats, input methods). | Must |
| FR-16 | Devices shall be provisioned (Wi-Fi + server pairing) without reflashing. | Must |
| FR-17 | Firmware shall be updatable over the air. | Should |
| FR-18 | The device shall show text captions (user transcript / agent reply) optionally. | Could |

## 5 Non-functional requirements

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-01 | Voice-to-first-audio latency (end of user speech -> first agent audio), simple question, no tools | <= 1.5 s p50, <= 2.5 s p95 |
| NFR-02 | Avatar reaction to state change (e.g. VAD end -> "thinking") | <= 100 ms |
| NFR-03 | Barge-in: user speech -> playback stopped | <= 300 ms |
| NFR-04 | Avatar animation frame rate | >= 20 fps (target 30) |
| NFR-05 | Audio bandwidth per direction | <= 32 kbit/s (Opus) |
| NFR-06 | Battery runtime, idle with wake word armed and screen dimmed | >= 6 h on 1000 mAh (to be measured) |
| NFR-07 | Transport security | TLS 1.2+ (WSS); per-device credentials |
| NFR-08 | Server deployment | Single process or docker-compose on Linux x86_64/arm64 |
| NFR-09 | Firmware portability | Board-specific code isolated behind HAL / board definitions |

## 6 Terminology

| Term | Meaning |
| --- | --- |
| Device | An ESP32 hardware unit running Homunculus firmware |
| Gateway | Server component terminating device connections |
| Turn | One user utterance and the agent's complete response |
| Agent backend | An implementation of the inference abstraction (e.g. Claude Agent SDK) |
| AFE | Audio Front End (ESP-SR): AEC, NS, AGC, VAD, WakeNet |
| Emote | A named avatar expression (emotion + optional animation) |
| HDP | Homunculus Device Protocol (see [crucible/homunculus/hdp/interfaces/device-protocol](hdp/interfaces/device-protocol.md)) |
