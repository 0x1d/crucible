---
id: <system>/<project>/<component>/interfaces/<interface-slug>
title: <Interface name, e.g. HTTP API>
type: IFC
owner: <system>/<project>/<component>
status: Draft
version: 0.1.0
date: YYYY-MM-DD
depends: [<system>/<project>/<component>/requirements]
related: []
planned: []
---

# <Interface name>

<Summary: one paragraph saying what this document establishes and its main points.>

<!-- The contract other components depend on. Anything not written here is not part of the contract.
     One sub-document per interface: title HTTP API, file interfaces/http-api.md, id <component-id>/interfaces/http-api. interfaces.md lists the interfaces.
     Item ids (MSG, EP, FN, CMD, CF) are numbered per component, across all its interface contracts.
     For an integration: describe the mapping between the external interface and ours (section 7). -->

## 1 Overview

<!-- Providers and consumers are not listed here: the owner provides it, other providers name it under `implements` and consumers name the owner under `depends` in their manifests. Tools derive both lists. -->

| Item | Value |
| --- | --- |
| Kind | <HTTP API / WebSocket protocol / library API / CLI / MCP tools / file format> |
| Transport | <e.g. WSS, stdio JSON-RPC, in-process> |
| Encoding | <JSON / binary frames / ...> |

## 2 Versioning and compatibility

<!-- Semver of the contract, how versions are negotiated, what counts as a breaking change, deprecation policy. -->

## 3 Connection and lifecycle

<!-- How a session starts, authenticates, stays alive and ends. Sequence diagram if more than two steps. -->

## 4 Operations

<!-- One subsection per message, endpoint, function or command. Use MSG-NN for messages, EP-NN for endpoints, FN-NN for library functions, CMD-NN for commands. -->

### MSG-01 `<name>`

| Field | Value |
| --- | --- |
| Direction | <client -> server / both> |
| When | <trigger> |
| Response | <full MSG id / none> |

```json
{ "type": "<name>", "field": "<type> - <meaning>" }
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `field` | string | yes | <meaning, units, range> |

## 5 Data types

<!-- Shared types used by several operations. Prefer a schema (JSON Schema, or type definitions in the implementation language) as the normative form. -->

## 6 Errors

| Code | Meaning | Sent when | Consumer should |
| --- | --- | --- | --- |
| <code> | <meaning> | <condition> | <retry / abort / surface> |

## 7 Mapping (integration profile only)

<!-- External concept -> our concept, and what is not supported. Otherwise: `Not applicable - <reason>.` -->

| External | Ours | Notes |
| --- | --- | --- |
| <concept> | <concept> | <loss, conversion> |

## 8 Conformance

<!-- What an implementation must do to claim conformance. Each rule becomes a VER row. -->

| Id | Rule |
| --- | --- |
| CF-01 | <a provider shall ...> |

## 9 Changes

<!-- One row per released version of the contract, newest first. Consumers need it to upgrade; it is the only change history kept in a document. -->

| Version | Change | Breaking | Consumer action |
| --- | --- | --- | --- |
| 0.1.0 | Initial contract | - | - |
