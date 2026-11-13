---
id: crucible/packages/codex-client/interfaces/command-line
title: Command Line
type: IFC
owner: crucible/packages/codex-client
status: Draft
version: 0.1.0
date: 2026-11-13
depends: [crucible/packages/codex-client/requirements, crucible/packages/codex-client/interfaces/library-api]
related: []
planned: []
---

# Command Line

**Planned** crucible/P-03

The `codex` command sends one codex request to the runtime and prints the result. It is the package's `bin` entry and replaces `projects/alchemist/scripts/cli.mjs`.

## 1 Overview

| Item | Value |
| --- | --- |
| Kind | CLI |
| Transport | Process arguments in, standard output out |
| Encoding | JSON |

## 2 Versioning and compatibility

The contract version is the `version` of this document. Changing the argument form, the output form or an exit code is breaking.

## 3 Connection and lifecycle

Each invocation creates a client with the default options (environment variables apply), sends one request and exits. The runtime it starts or reuses follows the attached or detached mode of the client: attached, it stops when the command exits.

## 4 Operations

### CMD-01 `codex`

```text
codex '<json request>'
```

| Field | Value |
| --- | --- |
| Argument | One codex request as JSON ([crucible/packages/codex-client/interfaces/library-api](library-api.md) section 5). Missing or empty: `{}` |
| Standard output | The result as one line of JSON |
| Exit code 0 | A result was printed, also when it has `ok: false` |
| Exit code 1 | The argument is not JSON; `invalid JSON` on standard error |

```text
$ pnpm exec codex '{"op":"call","name":"echo","args":{"hello":"world"}}'
{"ok":true,"echoed":true,...}
```

## 5 Data types

The request and result types of [crucible/packages/codex-client/interfaces/library-api](library-api.md) section 5.

## 6 Errors

| Code | Meaning | Sent when | Consumer should |
| --- | --- | --- | --- |
| exit 1 | Invalid argument | The argument is not JSON | Fix the call |
| `ok: false` in the output | The request failed | See [crucible/packages/codex-client/interfaces/library-api](library-api.md) section 6 | Read `error` |

## 7 Mapping (integration profile only)

Not applicable - the package is a library.

## 8 Conformance

Not applicable - the contract has one implementation.

## 9 Changes

| Version | Change | Breaking | Consumer action |
| --- | --- | --- | --- |
| 0.1.0 | Initial contract; same argument and output as `node scripts/cli.mjs` | - | - |
