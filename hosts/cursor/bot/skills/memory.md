---
description: Use when a memory.remember, memory.query, memory.transact, memory.retract, or memory.by_session call needs a JSON example. The always-on prompt already states the schema.
---

# Memory call examples

For repo + memory + git status in one turn (replaces `decision/minimal-status-probe` chains), call `explore` with `profile: "status"` instead of separate `memory.overview`, `git.status`, and log probes.

Overview (ids only), then query one entity:

```json
{ "name": "memory.overview", "args": { "prefix": "decision/", "limit": 20 } }
```

```json
{
  "name": "memory.query",
  "args": {
    "where": [{ "e": "decision/factory-architecture", "a": "description", "v": "?text" }],
    "find": ["text"]
  }
}
```

Query as of a date:

```json
{
  "name": "memory.query",
  "args": {
    "as_of": "2026-10-31T23:59:59Z",
    "where": [{ "e": "?entity", "a": "description", "v": "?text" }],
    "find": ["entity", "text"]
  }
}
```

Remember a decision bundle (one call):

```json
{
  "name": "memory.remember",
  "args": {
    "reason": "User asked to remember git integration points.",
    "facts": [
      { "e": "decision/factory-git-integration", "a": "description", "v": "Four git seams: agent commit, merge handoff, build SHA pin, Argo CD deploy." },
      { "e": "decision/factory-git-integration", "a": "depends-on", "v": "dependency/argo-cd" }
    ]
  }
}
```

Replace a fact (close the old one, then write the new one):

```json
{
  "name": "memory.retract",
  "args": {
    "reason": "Argo CD replaced by Flux.",
    "facts": [{ "e": "decision/factory-git-integration", "a": "depends-on", "v": "dependency/argo-cd" }]
  }
}
```

Withdraw a fact that was recorded in error (it disappears from every valid time):

```json
{
  "name": "memory.retract",
  "args": {
    "reason": "Recorded in error.",
    "mode": "correct",
    "facts": [{ "e": "decision/factory-git-integration", "a": "description", "v": "Four git seams: agent commit, merge handoff, build SHA pin, Argo CD deploy." }]
  }
}
```

Record history with a valid-time window, plus a Datalog rule:

```json
{
  "name": "memory.transact",
  "args": {
    "reason": "Imported deploy history.",
    "facts": [
      { "e": "decision/factory-deploy", "a": "description", "v": "Deploy with Argo CD.", "valid_from": "2024-01-01", "valid_to": "2025-01-01" },
      { "e": "decision/factory-deploy", "a": "depends-on", "v": "dependency/argo-cd", "valid_from": "2024-01-01", "valid_to": "2025-01-01" },
      { "e": "dependency/argo-cd", "a": "description", "v": "Argo CD GitOps controller." }
    ],
    "rules": ["(rule [(needs ?a ?b) [?a :depends-on ?b]])"]
  }
}
```

What was true at a point in valid time (`"any"` searches all valid time):

```json
{
  "name": "memory.query",
  "args": {
    "valid_at": "2024-06-01",
    "where": [["decision/factory-deploy", "description", "?text"]],
    "find": ["text"]
  }
}
```

Rules, negation, and aggregates use `datalog` (attributes are hyphenated keywords, entities are `:decision/x`):

```json
{
  "name": "memory.query",
  "args": { "datalog": "(query [:find ?b :valid-at :any-valid-time :where (needs :decision/factory-deploy ?b)])" }
}
```

Entities remembered in a session (`memory.remember` takes an optional `source_session`):

```json
{ "name": "memory.by_session", "args": { "session_id": "<session id>" } }
```
