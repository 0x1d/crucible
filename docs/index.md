# Alchemist documentation

Alchemist is a host-independent Elixir capability registry. A fixed JSON
protocol gives hosts access to capabilities whose implementation, composition,
and metadata live in an Elixir source tree.

## Reading paths

### Evaluate Alchemist

Start with the [product overview](../README.md), then use the
[domain language](./concepts/domain-language.md) to identify the product and
implementation boundaries.

### Create a registry entry

Read [Using the harness](./USAGE.md) for the current authoring workflow. Keep
the [domain language](./concepts/domain-language.md) available for slug, module,
and composition conventions.

### Integrate a host

Read [Host adapters](./HOSTS.md) for the current adapter boundary and available
integration patterns. The operation names and request types are defined in
[`core/protocol.ts`](../core/protocol.ts).

### Understand the protocol

Begin with the registry protocol and implementation terms in the
[domain language](./concepts/domain-language.md), then inspect the operation
types in [`core/protocol.ts`](../core/protocol.ts).

### Contribute to the repository

Read the [repository-agent rules](../AGENTS.md) and the
[Mix control-plane notes](../runtime/README.md) before changing the respective
subsystems.

## Public documents

| Document | Audience | Read when |
| --- | --- | --- |
| [Product overview](../README.md) | Evaluators and new contributors | Establishing the product boundary, layers, and initial workflows. |
| [Documentation index](./index.md) | All readers | Selecting a goal-oriented path through the documentation. |
| [Domain language](./concepts/domain-language.md) | All readers and contributors | Interpreting canonical product and implementation terms. |
| [Using the harness](./USAGE.md) | Registry entry authors and operators | Defining, loading, finding, and calling entries with the current interfaces. |
| [Host adapters](./HOSTS.md) | Host integrators | Mapping a host environment to the registry protocol. |
| [Mix control-plane notes](../runtime/README.md) | Runtime contributors | Working in the `runtime/` Mix project. |
| [Repository-agent rules](../AGENTS.md) | Coding agents contributing to the repository | Applying repository commands, layout rules, and contribution constraints. |

The served-agent prompt in `bot/instructions.md` is an operational input rather
than public product documentation.

## Historical engineering records

Files under `docs/internal/` record engineering decisions and implementation
plans at a point in time. They do not replace current public documentation.

| Record | Scope |
| --- | --- |
| [Documentation rewrite plan](./internal/plans/2026-10-25-documentation-rewrite.md) | Planned restructuring of the public documentation set. |
