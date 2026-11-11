---
id: <system>/<project>/<component>
title: <Component name>
type: manifest
owner: <system>/<project>
profile: <system | service | app | library | protocol | device | integration>
status: draft
summary: <one sentence: what this component is>
code: <path in the repo, e.g. projects/web/ide>
depends: [<system>/<project>/<component>, ...]
implements: []
documents: [<component-id>/REQ, <component-id>/ARCH, <component-id>/DES, <component-id>/VER]
date: YYYY-MM-DD
---

<!-- Component manifest. Copy to projects/<project>/docs/<component>/README.md (shared packages: packages/<name>/docs/README.md) and add a row to the project index projects/<project>/docs/README.md.
     In a project with a single component the manifest may be projects/<project>/docs/README.md itself; it is then also the project index.
     `status` is draft, active or deprecated. `date` is the date of the last change to the manifest.
     `documents` lists the full id of every document the component has: the required set of the profile (framework/FW-profiles.md), any optional ones, and every named one (IFC-http-api, IFC-event-api, ...).
     `depends` lists the full ids of the components whose IFC this component uses; tools read the component graph from it.
     `implements` lists the full ids of IFC documents owned by another component that this one implements (a protocol, a plugin API). -->

# <Component name>

<!-- Two or three sentences: what it is, who uses it, where it runs. -->

| Document | Title |
| --- | --- |
| [<component-id>/REQ](REQ-requirements.md) | Requirements |
| [<component-id>/ARCH](ARCH-architecture.md) | Architecture |
| [<component-id>/DES](DES-design.md) | Design |
| [<component-id>/VER](VER-verification.md) | Verification |

## At a glance

<!-- One Mermaid diagram showing the component and its direct neighbours. -->

```mermaid
flowchart LR
    A["<component>"] --> B["<dependency>"]
```

## Dependencies

| Component | Uses | Interface |
| --- | --- | --- |
| <component-id> | <what for> | [IFC](<relative path to that component's IFC-interface-contract.md>) |
