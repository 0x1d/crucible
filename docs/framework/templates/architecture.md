---
id: <system>/<project>/<component>/architecture
title: Architecture
type: ARCH
owner: <system>/<project>/<component>
status: Draft
date: YYYY-MM-DD
depends: [<system>/<project>/<component>/requirements]
related: []
planned: []
---

# <Component> - Architecture

<Summary: one paragraph saying what this document establishes and its main points.>

## 1 Context

<!-- C4 level 1: the component as a single box, with the people and systems around it. Name each interaction. -->

```mermaid
flowchart LR
    U["<actor>"] -->|"<interaction>"| C["<component>"]
    C -->|"<interaction>"| D["<dependency>"]
```

## 2 Building blocks

<!-- C4 level 2: processes, containers and major modules. One row per block. Internals of a block go in DES. A block that needs an architecture of its own is a module:
     name its document (<component-id>/architecture/<block>) or its nested component (<component-id>/<block>) under Specified in (framework README, Modules). -->

```mermaid
flowchart TB
    A["<block>"] --> B["<block>"]
```

| Block | Responsibility | Technology | Code | Specified in |
| --- | --- | --- | --- | --- |
| <name> | <single responsibility> | <language / framework> | <path> | <component-id>/design |

## 3 Dependency rules

<!-- What may depend on what, and what must never. These rules are enforced in review or by tooling. -->

- <block A> may use <block B>; <block B> never imports <block A>.

## 4 Runtime scenarios

<!-- Sequence diagrams for the 2-5 interactions that matter most: the main flow, startup, and the main failure path. -->

### 4.1 <Scenario>

```mermaid
sequenceDiagram
    participant A as <block>
    participant B as <block>
    A->>B: <message>
    B-->>A: <reply>
```

## 5 Deployment

<!-- Where each block runs: host, process, container or device. Details go in OPS. -->

| Block | Runs on | Instances | Talks to |
| --- | --- | --- | --- |
| <name> | <host / device> | <n> | <blocks, protocols> |

## 6 Cross-cutting concepts

<!-- Concerns that span blocks: error handling, configuration, logging, concurrency, persistence. One short subsection each, or `Not applicable - <reason>.` -->

## 7 Decisions

<!-- The AD entries that shaped this architecture, linked to the log that holds them: the system's log (<system>/decisions), or this component's decisions.md. Rationale lives in the AD entry, not here. -->

| Decision | Summary |
| --- | --- |
| [<system>/AD-NN](<relative path to the decisions log>) | <one line> |
