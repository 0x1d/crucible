# Alchemist documentation

Alchemist is a host-independent Elixir capability codex. A fixed JSON
protocol gives hosts access to capabilities whose implementation, composition,
and metadata live in an Elixir source tree.

## Reading paths

### Evaluate Alchemist

Start with the [product overview](../README.md), then read
[Architecture](./concepts/architecture.md) and the
[domain language](./concepts/domain-language.md) for product and implementation
boundaries.

### Create a codex entry

Follow [Getting started](./guides/getting-started.md) for setup, then
[Authoring codex entries](./guides/authoring-entries.md) for slug layout,
composition, and harness operations.

### Integrate a host

Read [Host adapters](./reference/hosts.md) for adapter patterns and deployment
considerations. Operation shapes are specified in the
[codex protocol](./reference/protocol.md) and
[`core/protocol.ts`](../core/protocol.ts).

### Understand the protocol

Read the [domain language](./concepts/domain-language.md), then the
[codex protocol](./reference/protocol.md) and
[architecture](./concepts/architecture.md) request lifecycle.
The [belief graph](./concepts/memory.md) is the durable fact log a codex
call can read and update.

### Contribute to the repository

Read the [repository-agent rules](../AGENTS.md) and the
[Codex runtime notes](../runtime/README.md) before changing the respective
subsystems.

## Public documents

| Document | Audience | Read when |
| --- | --- | --- |
| [Product overview](../README.md) | Evaluators and new contributors | Establishing scope, quick start, and documentation entry points. |
| [Documentation index](./index.md) | All readers | Selecting a goal-oriented path through the documentation. |
| [Architecture](./concepts/architecture.md) | Evaluators and integrators | Understanding components, lifecycle, and composition models. |
| [Memory](./concepts/memory.md) | Evaluators and entry authors | Belief graph, bi-temporal queries, and the `memory.*` entries. |
| [Domain language](./concepts/domain-language.md) | All readers and contributors | Interpreting canonical product and implementation terms. |
| [Getting started](./guides/getting-started.md) | Operators and authors | Installing dependencies and making the first codex call. |
| [Authoring codex entries](./guides/authoring-entries.md) | Codex entry authors | Slugs, modules, harness operations, and testing entries. |
| [Codex protocol](./reference/protocol.md) | Host integrators and contributors | Request and response contracts for all four operations. |
| [Host adapters](./reference/hosts.md) | Host integrators | Mapping environments to the codex protocol. |
| [Claude host README](../hosts/claude/README.md) | Host integrators | Running and evaluating the Claude Agent SDK example host. |
| [Security boundary](./reference/security.md) | Operators and security reviewers | Current trust model and arbitrary-code risks. |
| [Codex runtime notes](../runtime/README.md) | Runtime contributors | Working on the `:runtime` application and its Mix project. |
| [Repository-agent rules](../AGENTS.md) | Coding agents contributing to the repository | Applying repository commands, layout rules, and contribution constraints. |

The served-agent prompt in `hosts/cursor/bot/instructions.md` is an operational input rather
than public product documentation.

## Historical engineering records

Files under `docs/internal/` record engineering decisions and implementation
plans at a point in time. They do not replace current public documentation.
See the [internal records index](./internal/index.md) for the full list.
