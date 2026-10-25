# Alchemist Documentation Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current flat, host-led documentation with a progressively discoverable, product-led documentation system using canonical domain language and Mermaid diagrams.

**Architecture:** `README.md` introduces the product and routes readers to `docs/index.md`. The index separates concepts, guides, reference, subsystem documentation, and internal records. Public documents have one responsibility each; dated design and implementation records move under `docs/internal/`.

**Tech Stack:** Markdown, Mermaid, Node 22 documentation checks, Agent SDK validation

## Global Constraints

- Use **Alchemist** as the public product name.
- Describe `@grok/agent-sdk` and Cursor as the first host adapter, not the product boundary.
- Use neutral declarative prose in public documentation.
- Use second person only for direct procedural instructions.
- Use Mermaid for architecture, sequence, state, and navigation diagrams.
- Keep code samples and filesystem trees in ordinary fenced code blocks.
- Do not document unimplemented hardening behavior.
- Preserve current executable commands and version requirements.
- Keep internal plans and specifications discoverable but outside public reading paths.
- Add no npm dependency.

---

### Task 1: Documentation quality checks

**Files:**
- Create: `scripts/check-docs.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: tracked Markdown files returned by `git ls-files '*.md'`
- Produces: `npm run check:docs`, a zero-dependency documentation validation command

- [ ] **Step 1: Write the failing documentation check**

Create `scripts/check-docs.mjs` with checks for:

1. Missing local Markdown link targets.
2. Box-drawing architecture characters (`┌`, `┐`, `└`, `┘`, `─`, `│`, `►`) in public docs.
3. The known runtime scaffold description marker and Hex installation boilerplate.
4. Missing `docs/index.md`.
5. Required public entry links from `README.md` to `docs/index.md`.

The script must:

- use `git ls-files` rather than recursively scanning dependencies;
- classify `docs/internal/**` as internal;
- report every violation as `path:line: message`;
- exit `1` when violations exist and `0` otherwise;
- ignore URL, fragment-only, and `mailto:` links;
- resolve relative local links from the containing document.

- [ ] **Step 2: Add the package command**

Add:

```json
"check:docs": "node scripts/check-docs.mjs"
```

Keep `check` as TypeScript-only until the rewritten documents pass.

- [ ] **Step 3: Run the check and verify it fails on the current corpus**

Run:

```bash
npm run check:docs
```

Expected: nonzero with findings for missing `docs/index.md`, README box drawing,
and the placeholder `runtime/README.md`.

- [ ] **Step 4: Commit the failing quality gate**

```bash
git add package.json scripts/check-docs.mjs
git commit -m "test(docs): add documentation quality checks"
```

---

### Task 2: Domain language and progressive index

**Files:**
- Create: `docs/index.md`
- Create: `docs/concepts/domain-language.md`
- Modify: `AGENTS.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: code identifiers in `core/protocol.ts`, `runtime/lib/runtime/*.ex`, and `runtime/lib/agent_fn/*.ex`
- Produces: the canonical glossary and public reading paths used by every later document

- [ ] **Step 1: Create the domain language reference**

Define these terms and their boundaries:

| Term | Required meaning |
| --- | --- |
| Alchemist | The product: a host-independent Elixir capability registry |
| Registry | The capability tree, metadata, and four-operation contract |
| Registry entry | A slug-addressed capability implemented by `AgentFn.*.run/1` |
| Slug | Canonical dot-separated address mapped to a path and module |
| Registry protocol | JSON operations `define`, `load`, `find`, and `call` |
| Harness tool | A model-facing alias for one registry operation |
| Host | An environment exposing the registry protocol |
| Host adapter | Code mapping a host tool API to registry operations |
| Mix control plane | `runtime/`, which validates, compiles, discovers, and invokes entries |
| Entry module | The `AgentFn.*` module matching a slug and exporting `run/1` |
| Deep module | Supporting code beneath one entry tree |
| Shared library | `AgentLib.*` code under `functions/lib/` |
| Static composition | Direct module calls when the dependency is known |
| Dynamic dispatch | `AgentFn.Registry.call/2` when a slug is runtime data |

Add a disambiguation table for:

- product Registry versus `Runtime.Registry` versus `AgentFn.Registry`;
- registry entry versus harness tool versus `AgentFn.Tool`;
- `runtime/` project versus one-shot BEAM process.

- [ ] **Step 2: Create `docs/index.md`**

Open with the product thesis and provide five reading paths:

1. Evaluate Alchemist.
2. Create a registry entry.
3. Integrate a host.
4. Understand the protocol.
5. Contribute to the repository.

List every public document with `Document`, `Audience`, and `Read when` columns.
List `docs/internal/` separately as historical engineering records.

- [ ] **Step 3: Align repository-agent identity**

Change the `AGENTS.md` title from `elixir-harness-tmp` to `Alchemist`. State
that the file contains repository-agent rules, then link `README.md` and
`docs/index.md`. Preserve the existing command loop and constraints.

- [ ] **Step 4: Align package metadata**

Keep the package name for compatibility. Replace the temporary description with:

```json
"description": "Alchemist host-independent Elixir capability registry"
```

- [ ] **Step 5: Verify index and language**

Run:

```bash
npm run check:docs
```

Expected: failures remain only in documents not yet rewritten.

- [ ] **Step 6: Commit the information architecture**

```bash
git add AGENTS.md package.json docs/index.md docs/concepts/domain-language.md
git commit -m "docs: establish domain language and documentation index"
```

---

### Task 3: Architecture and protocol reference

**Files:**
- Create: `docs/concepts/architecture.md`
- Create: `docs/reference/protocol.md`
- Create: `docs/reference/security.md`
- Modify: `core/protocol.ts` only if its comments conflict with the canonical terms

**Interfaces:**
- Consumes: current behavior in `core/elixir-bridge.ts`, `Runtime.CLI`, `Runtime.Engine`, `Runtime.Compiler`, and `Runtime.Registry`
- Produces: accurate conceptual and contract documentation without promising future hardening

- [ ] **Step 1: Write architecture concepts**

Include Mermaid diagrams for:

1. Component boundaries:
   host → host adapter/CLI → Node bridge → Mix control plane → capability tree.
2. Current request lifecycle:
   compile runtime → start one-shot Mix process → dispatch operation → emit JSON → process exits.
3. Static versus dynamic composition.

State explicitly:

- there is no persistent registry server;
- `load` compiles in the current one-shot process;
- persisted `loaded` metadata reflects the last successful validation, not live
  process state;
- the filesystem tree is the current source of truth;
- Cursor is one adapter.

- [ ] **Step 2: Write the protocol reference**

For each operation document:

- request fields;
- success response shape;
- failure behavior;
- disk reads and writes;
- compile behavior;
- current limitations.

Document canonical slug mapping and JSON object arguments. Explain that `find`
discovers directories with `meta.json`, so a hand-authored source appears after
`load`, `define`, or auto-load during `call`.

- [ ] **Step 3: Write the security reference**

State the current security boundary without mitigation claims:

- `define` stores arbitrary Elixir;
- compile-time and runtime code execute with the Mix process's host authority;
- the bridge currently inherits the host environment;
- registry access must therefore be restricted to trusted users and inputs;
- sandboxing and multi-user isolation are future architecture, not current
  behavior.

Link the postponed hardening design only from the internal records index once it
is merged; do not present it as implemented.

- [ ] **Step 4: Review against source**

Check every behavior claim against:

```text
core/protocol.ts
core/elixir-bridge.ts
runtime/lib/runtime/cli.ex
runtime/lib/runtime/engine.ex
runtime/lib/runtime/compiler.ex
runtime/lib/runtime/registry.ex
runtime/lib/agent_fn/registry.ex
```

- [ ] **Step 5: Commit architecture and protocol**

```bash
git add core/protocol.ts docs/concepts/architecture.md docs/reference/protocol.md docs/reference/security.md
git commit -m "docs: document architecture and registry protocol"
```

Omit `core/protocol.ts` from `git add` when no comment change is needed.

---

### Task 4: Task-oriented guides

**Files:**
- Create: `docs/guides/getting-started.md`
- Create: `docs/guides/authoring-entries.md`
- Delete: `docs/USAGE.md`

**Interfaces:**
- Consumes: setup commands from the current README, USAGE guide, AGENTS rules, and Nix files
- Produces: one setup source and one authoring source

- [ ] **Step 1: Write the getting-started guide**

Structure:

1. Prerequisites: Node 22.13+ and Elixir 1.14+.
2. Dependency installation:

```bash
npm ci
mix local.hex --force
mix local.rebar --force
(cd runtime && mix deps.get)
```

3. Validate:

```bash
npm run check
npx @grok/agent-sdk validate --dir .
(cd runtime && mix test)
```

4. Call the bundled `echo` entry through `registry-cli`.
5. Optional Agent SDK development workflow.
6. Optional Nix/direnv workflow, linking to the repository files without
   duplicating the dated internal design.
7. Next links to authoring, protocol, hosts, and security.

- [ ] **Step 2: Write the authoring guide**

Cover:

- slug, path, and module mapping;
- complete entry-module example with `@moduledoc`, `@spec`, and `run/1`;
- deep modules;
- `AgentLib.*`;
- static composition and dynamic dispatch;
- `define`, hand editing, `load`, `find`, and `call`;
- metadata lifecycle and discovery limitation;
- result forms currently accepted by `Runtime.Engine`;
- testing an entry;
- the arbitrary-code security boundary.

Use neutral examples rather than conversational prompts such as “ask the agent”.

- [ ] **Step 3: Remove the superseded guide**

Delete `docs/USAGE.md` after all unique setup and authoring material has moved.
Update every inbound link to the new guide or index.

- [ ] **Step 4: Verify commands and links**

Run:

```bash
npm run check:docs
npm run check
```

- [ ] **Step 5: Commit the guides**

```bash
git add docs/guides docs/USAGE.md README.md
git commit -m "docs: add focused setup and authoring guides"
```

Include `README.md` only when this task updates an obsolete USAGE link.

---

### Task 5: Host reference and runtime subsystem

**Files:**
- Create: `docs/reference/hosts.md`
- Delete: `docs/HOSTS.md`
- Replace: `runtime/README.md`
- Modify: `bot/instructions.md`

**Interfaces:**
- Consumes: current host adapter and runtime implementation
- Produces: factual host integration reference, accurate runtime documentation, and aligned served-agent vocabulary

- [ ] **Step 1: Replace host positioning with a reference**

Write a host adapter matrix with:

- current repository support;
- integration boundary;
- credential/billing owner;
- maturity.

Describe Cursor/Agent SDK first because it is implemented. Describe other hosts
as integration patterns, not recommendations. Consolidate subscription and
billing caveats into one short section. Replace “Recommended layout for you”
with neutral deployment considerations.

- [ ] **Step 2: Replace the runtime scaffold README**

Document:

- purpose of the Mix control plane;
- module responsibility table;
- one-shot CLI lifecycle;
- source and metadata locations;
- development and test commands;
- environment variables;
- current limitations and link to security/reference docs.

Remove all Hex publishing boilerplate.

- [ ] **Step 3: Align the served-agent prompt**

Retitle it `# Alchemist served-agent instructions`. Use canonical terms:

- registry entry;
- harness tool;
- static composition;
- dynamic dispatch.

Keep behavioral instructions concise. Add the explicit arbitrary-code and
secret-exposure warning. Do not add public documentation narrative to the
prompt.

- [ ] **Step 4: Remove the superseded host document**

Delete `docs/HOSTS.md` and update every inbound link.

- [ ] **Step 5: Commit subsystem and host references**

```bash
git add bot/instructions.md docs/HOSTS.md docs/reference/hosts.md runtime/README.md
git commit -m "docs: clarify host adapters and runtime behavior"
```

---

### Task 6: Product README and internal records

**Files:**
- Rewrite: `README.md`
- Create: `docs/internal/index.md`
- Move: `docs/superpowers/specs/2026-10-25-nix-direnv-design.md` → `docs/internal/specs/2026-10-25-nix-direnv-design.md`
- Move: `docs/superpowers/plans/2026-10-25-nix-direnv.md` → `docs/internal/plans/2026-10-25-nix-direnv.md`
- Keep: `docs/internal/plans/2026-10-25-documentation-rewrite.md`
- Remove empty `docs/superpowers/` directories

**Interfaces:**
- Consumes: the completed public documentation tree
- Produces: the concise product entry point and separated historical records

- [ ] **Step 1: Rewrite README**

Keep only:

1. Product thesis.
2. Mermaid component diagram.
3. A concise explanation of the fixed four-operation surface and Elixir-owned
   capability tree.
4. Shortest verified setup and first call.
5. Security warning.
6. Links to `docs/index.md`, getting started, architecture, and protocol.
7. License.

Remove:

- duplicated naming table;
- full Nix walkthrough;
- duplicated Agent SDK command set;
- host billing narrative;
- ASCII box diagram.

- [ ] **Step 2: Move dated records**

Use `git mv` so history follows the Nix design and implementation plan. Update
their cross-links and add a neutral internal index with columns `Record`,
`Status`, and `Scope`.

The internal index must state that records describe decisions at a point in time
and do not override current public reference documentation.

- [ ] **Step 3: Verify progressive disclosure**

Starting from `README.md`, confirm:

- every public document is reachable through `docs/index.md`;
- public docs do not link directly to implementation plans;
- subsystem and contributor paths are one or two links away;
- no old `docs/USAGE.md` or `docs/HOSTS.md` links remain.

- [ ] **Step 4: Commit the README and internal organization**

```bash
git add README.md docs
git commit -m "docs: present Alchemist vision and organize internal records"
```

---

### Task 7: Final documentation verification

**Files:**
- Modify: `package.json`
- Modify: any public Markdown file that fails verification

**Interfaces:**
- Consumes: the complete rewritten corpus
- Produces: one standard project check that includes documentation quality

- [ ] **Step 1: Make documentation checks part of `npm run check`**

Change scripts to:

```json
"check": "npm run check:types && npm run check:docs",
"check:types": "tsc --noEmit",
"check:docs": "node scripts/check-docs.mjs"
```

- [ ] **Step 2: Run repository verification**

Run:

```bash
npm run check
npx @grok/agent-sdk validate --dir .
node scripts/registry-cli.mjs '{"op":"call","name":"echo","args":{"hello":"world"}}'
(cd runtime && mix test)
```

Expected:

- documentation and TypeScript checks pass;
- Agent SDK validation reports no diagnostics;
- registry CLI returns `ok: true` and `echoed: true`;
- Elixir tests pass.

If Elixir is unavailable in the environment, record that as an environment
blocker and do not claim those checks passed.

- [ ] **Step 3: Perform editorial scans**

Run:

```bash
rg -n 'elixir-harness-tmp|Recommended layout for you|If available in Hex' --glob '*.md' .
rg -n '┌|┐|└|┘|─|│|►' --glob '*.md' README.md docs runtime
rg -n 'Cursor|Grok|host-agnostic|host-independent' --glob '*.md' README.md docs runtime
```

Expected:

- first two scans return no matches;
- vendor and host-independence mentions occur only where technically relevant,
  not as repeated positioning.

- [ ] **Step 4: Review the final diff**

Check:

```bash
git diff --check
git diff --stat main...HEAD
git diff main...HEAD -- '*.md' package.json scripts/check-docs.mjs
```

Confirm one responsibility per document, canonical terms, working links, Mermaid
diagrams, and no claims about postponed hardening.

- [ ] **Step 5: Commit final verification changes**

```bash
git add package.json README.md AGENTS.md bot/instructions.md docs runtime/README.md scripts/check-docs.mjs
git commit -m "chore(docs): enforce documentation quality"
```

Skip the commit when verification requires no changes.
