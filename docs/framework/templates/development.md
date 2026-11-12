---
id: <system>/<project>/development
title: Development
type: DEV
owner: <system>/<project>
status: Draft
date: YYYY-MM-DD
depends: []
related: []
planned: []
---

# Development

<Summary: one paragraph saying what this document establishes and its main points.>

<!-- How to work on the project: from a fresh checkout to a reviewed change. One per project.
     Release builds and deployment are in each component's OPS; link to them. Commands must be copy-pasteable. -->

## 1 Prerequisites

| Tool | Version | Needed for | Provided by |
| --- | --- | --- | --- |
| <tool> | <version> | <build / test / flash> | <dev shell / manual install> |

## 2 Setup

<!-- From clone to a working environment: dev shells, dependencies, local configuration, secrets for development (names and sources only). -->

1. <step>

## 3 Everyday commands

| Task | Command | Notes |
| --- | --- | --- |
| Run | `<command>` | <what starts, where it listens> |
| Test | `<command>` | <scope, duration> |
| Lint / format | `<command>` | <what it checks> |

## 4 Running locally

<!-- What has to run together, in which order; simulators, emulators, fake services, seed and fixture data. -->

## 5 Target hardware

<!-- Flashing, serial monitor, on-device debugging. Or `Not applicable - <reason>.` -->

## 6 Debugging

<!-- Where logs go in development, how to attach a debugger, useful switches. -->

## 7 Conventions

<!-- Only what is specific to this project: code style, branch and commit rules, what a reviewer checks. Workspace-wide rules are linked, not repeated. -->

## 8 Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| <symptom> | <cause> | <steps> |
