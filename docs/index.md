# Alchemist documentation

Alchemist is a host-independent Elixir capability registry. A fixed JSON
protocol gives hosts access to capabilities whose implementation, composition,
and metadata live in an Elixir source tree.

## Reading paths

### Evaluate Alchemist

Start with the [product overview](../README.md), then read
[Architecture](./concepts/architecture.md) and the
[domain language](./concepts/domain-language.md) for product and implementation
boundaries.

### Create a registry entry

Follow [Getting started](./guides/getting-started.md) for setup, then
[Authoring registry entries](./guides/authoring-entries.md) for slug layout,
composition, and harness operations.

### Integrate a host

Read [Host adapters](./reference/hosts.md) for adapter patterns and deployment
considerations. Operation shapes are specified in the
[registry protocol](./reference/protocol.md) and
[`core/protocol.ts`](../core/protocol.ts).

### Understand the protocol

Read the [domain language](./concepts/domain-language.md), then the
[registry protocol](./reference/protocol.md) and
[architecture](./concepts/architecture.md) request lifecycle.

### Contribute to the repository

Read the [repository-agent rules](../AGENTS.md) and the
[Mix control-plane notes](../runtime/README.md) before changing the respective
subsystems.

## Public documents

| Document | Audience | Read when |
| --- | --- | --- |
| [Product overview](../README.md) | Evaluators and new contributors | Establishing scope, quick start, and documentation entry points. |
| [Documentation index](./index.md) | All readers | Selecting a goal-oriented path through the documentation. |
| [Architecture](./concepts/architecture.md) | Evaluators and integrators | Understanding components, lifecycle, and composition models. |
| [Domain language](./concepts/domain-language.md) | All readers and contributors | Interpreting canonical product and implementation terms. |
| [Getting started](./guides/getting-started.md) | Operators and authors | Installing dependencies and making the first registry call. |
| [Authoring registry entries](./guides/authoring-entries.md) | Registry entry authors | Slugs, modules, harness operations, and testing entries. |
| [Registry protocol](./reference/protocol.md) | Host integrators and contributors | Request and response contracts for all four operations. |
| [Host adapters](./reference/hosts.md) | Host integrators | Mapping environments to the registry protocol. |
| [Security boundary](./reference/security.md) | Operators and security reviewers | Current trust model and arbitrary-code risks. |
| [Mix control-plane notes](../runtime/README.md) | Runtime contributors | Working in the `runtime/` Mix project. |
| [Repository-agent rules](../AGENTS.md) | Coding agents contributing to the repository | Applying repository commands, layout rules, and contribution constraints. |

The served-agent prompt in `bot/instructions.md` is an operational input rather
than public product documentation.

## Historical engineering records

Files under `docs/internal/` record engineering decisions and implementation
plans at a point in time. They do not replace current public documentation.
See the [internal records index](./internal/index.md) for the full list.
