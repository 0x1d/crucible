---
id: <system>/<project>/<component>/requirements
title: Requirements
type: REQ
owner: <system>/<project>/<component>
status: Draft
date: YYYY-MM-DD
depends: []
related: []
planned: []
---

# Requirements

<Summary: one paragraph saying what this document establishes and its main points.>

## 1 Purpose

<!-- Why this component exists: the problem it solves and for whom. One paragraph. -->

## 2 Scope

| In scope | Out of scope |
| --- | --- |
| <capability> | <explicitly excluded, with a pointer if another component covers it> |

## 3 Users and actors

| Actor | Kind | Goal |
| --- | --- | --- |
| <name> | person / component / external system | <what they want from this component> |

## 4 Goals

<!-- Measurable outcomes, 3-7 of them. Goals explain the requirements; they are not tested themselves. -->

| Id | Goal |
| --- | --- |
| G-01 | <outcome> |

## 5 Functional requirements

<!-- One row per requirement, in EARS form:
     The <component> shall <response>.
     When <trigger>, the <component> shall <response>.
     While <state>, the <component> shall <response>.
     If <unwanted condition>, then the <component> shall <response>.
     Acceptance: an observable check (input -> expected result). Every row gets a VER row.
     Priority: must / should / could.
     Not built yet: mark the id cell with the planned change that will build it, `FR-014 **Planned** P-03`, and declare that change under `planned` in the front matter.
     The id cell defines the item, so it is short; every reference to an item is its full id. -->

| Id | Requirement | Acceptance | Priority | Goal |
| --- | --- | --- | --- | --- |
| FR-001 | When <trigger>, the <component> shall <response>. | <observable check> | must | <component-id>/G-01 |

## 6 Operational requirements

<!-- Performance, latency, resource limits, availability, portability, accessibility, maintainability.
     Always give a number and how it is measured. -->

| Id | Quality | Requirement | Measure |
| --- | --- | --- | --- |
| OR-001 | latency | <statement> | <metric, threshold, conditions> |

## 7 Constraints

<!-- Fixed conditions the design must accept: platforms, languages, licences, hardware, mandated components. Link the AD that set each one, if any. -->

| Constraint | Source |
| --- | --- |
| <constraint> | <full AD id / external> |

## 8 Assumptions

<!-- Things believed true but not verified. Each becomes an OI if it turns out doubtful. -->

- <assumption>

## 9 Terminology

| Term | Meaning |
| --- | --- |
| <term> | <definition> |
