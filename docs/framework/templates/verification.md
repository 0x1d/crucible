---
id: <system>/<project>/<component>/verification
title: Verification
type: VER
owner: <system>/<project>/<component>
status: Draft
date: YYYY-MM-DD
depends: [<system>/<project>/<component>/requirements]
related: []
planned: []
---

# Verification

<Summary: one paragraph saying what this document establishes and its main points.>

<!-- Proves that each requirement and conformance rule is met. Every FR, OR and CF has at least one row; one row per check.
     A requirement without a row is unverified; a test without a requirement is suspicious. -->

## 1 Strategy

| Level | Tool | Command | Runs in |
| --- | --- | --- | --- |
| Unit | <framework> | `<command>` | CI |
| Integration | <framework> | `<command>` | CI |
| End-to-end / manual | <tool> | <procedure> | <release / on device> |

## 2 Traceability

<!-- Method: test (automated), inspection (review of code or config), demo (manual, scripted below), analysis (measurement or calculation),
     trace (met by the requirements of modules named in Check, by their full ids).
     Status: pass, fail, not built (requirement is Planned), missing (no check yet). -->

| Requirement | Method | Check | Status |
| --- | --- | --- | --- |
| <component-id>/FR-001 | test | `<path/to/test>::<test name>` | pass |
| <component-id>/OR-001 | analysis | <measurement procedure> | missing |

## 3 Manual procedures

<!-- One subsection per demo check, as numbered steps with the expected result. -->

### 3.1 <Check name> (<component-id>/FR-NNN)

1. <step>
2. <step>

**Expected:** <result>
