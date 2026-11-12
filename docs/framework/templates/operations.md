---
id: <system>/<project>/<component>/operations
title: Operations
type: OPS
owner: <system>/<project>/<component>
status: Draft
date: YYYY-MM-DD
depends: [<system>/<project>/<component>/architecture]
related: []
planned: []
---

# Operations

<Summary: one paragraph saying what this document establishes and its main points.>

## 1 Build

<!-- How release artefacts are produced: toolchain, commands, artefacts. Commands must be copy-pasteable.
     Everyday development commands are in the project's DEV; hosts, networks and ports are in INF. Link to them, do not repeat them. -->

| Step | Command | Output |
| --- | --- | --- |
| Build | `<command>` | <artefact> |
| Test | `<command>` | <report> |

## 2 Environments

| Environment | Purpose | Where | How it is reached |
| --- | --- | --- | --- |
| local | development | <host> | <url / port> |
| <staging / prod> | <purpose> | <host> | <url> |

## 3 Configuration and secrets

<!-- Environment variables and files per environment. Never put secret values here, only names and where they come from. -->

| Name | Required | Default | Source | Meaning |
| --- | --- | --- | --- | --- |
| `<VAR>` | yes | - | <secret store / .env> | <meaning> |

## 4 Deployment

<!-- How a version reaches each environment: CI job, manual steps, flashing, OTA. Include rollback. -->

## 5 Observability

<!-- Logs (where, format), metrics, health checks, traces, alerts. -->

| Signal | Where | Use |
| --- | --- | --- |
| <log / metric / health endpoint> | <location> | <what it tells you> |

## 6 Runbook

<!-- Known failure -> symptom -> what to do. -->

| Symptom | Likely cause | Action |
| --- | --- | --- |
| <symptom> | <cause> | <steps> |
