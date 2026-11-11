---
id: crucible/FW-profiles
title: Profiles
type: FW
owner: crucible
status: Draft
date: 2026-11-11
depends: [crucible/FW]
related: []
---

# Profiles

A profile is the kind of a component. It decides which documents the component must have.

## Required sets

R = required (at least one document of the type), O = optional (add it when it has content), - = not used. A component may have several documents of one type, for example one `IFC` per interface. (n) = see note n below the table.

| Profile | REQ | ARCH | IFC | DES | UX | SEC | OPS | HW | VER |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `system` | R | R | - | - | - | O | - | - | O (5) |
| `service` | R | R | R (1) | R | - | R | R | - | R |
| `app` | R | O | - | R | R | O | O | - | R |
| `library` | R (2) | - | R | R | - | - | - | - | R |
| `protocol` | O | - | R | - | - | O | - | - | R (3) |
| `device` | R | R | - | R | O | R | R | R | R |
| `integration` | R | - | R (4) | R | - | O | - | - | R |

- (1) Only when the service exposes an interface that is not already a `protocol` component.
- (2) Short: purpose, scope and the requirements on the public API.
- (3) Conformance checks that any implementation of the protocol must pass.
- (4) Mapping between the external system's interface and ours: concepts, messages, errors, unsupported features.
- (5) Only for checks that span projects. System requirements are otherwise traced to the component requirements that implement them. The system's documents are in `docs/architecture/` ([README.md](README.md#system-documents)).

Four document types are outside the required sets: `DEV` (one per project), `INF` (system level), and the `AD` and `OI` logs (system level; a component keeps its own, in `AD-decisions.md` and `OI-open-items.md`, only for entries that affect nothing outside it). See [Document types](README.md#document-types).

## Choosing a profile

| Profile | Choose it when the component ... | Examples |
| --- | --- | --- |
| `system` | is the whole system: groups the projects and defines how they fit together | an online shop, a smart-home platform |
| `service` | is a long-running process that others call over a network or IPC | REST API, voice server, job runner |
| `app` | is used directly by a person: GUI, TUI or CLI | web IDE, mobile app, terminal UI |
| `library` | is imported as code by other components | storage abstraction, SDK, UI kit |
| `protocol` | is a contract with more than one implementation or consumer | device protocol, plugin API, file format |
| `device` | is firmware running on specific hardware | ESP32 firmware, embedded controller |
| `integration` | adapts an external system (SDK, agent, API) to one of our interfaces | payment provider adapter, LLM backend |

If a component fits two profiles, it is probably two components. Split it, for example `app` (app) and `api` (service). A small CLI wrapped around a library can stay a single `library` and describe the CLI in its `DES`.

## Applying the framework

The mapping of a concrete system onto profiles (which projects it has, which components each contains, where their documents live) belongs to that system's own documents, in the repository layout or migration section of its `ARCH`, not here.
