---
id: <system>/<project>
title: <Project>
type: index
owner: <system>
date: YYYY-MM-DD
---

<!-- Project index. Copy to projects/<project>/docs/README.md. Level L2 of the framework: it names the components and points to them; nothing else.
     Documents follow the specification framework: <relative path to docs/framework/README.md>. -->

# <Project> - Documentation

<!-- One or two sentences: what the project is. -->

| Component | Profile | Summary |
| --- | --- | --- |
| [<system>/<project>/<component>](<component>/README.md) | <profile> | <one line> |

| Other | Content |
| --- | --- |
| [DEV](DEV-development.md) | How to work on the project |
| [INF](INF-infrastructure.md) | <infrastructure only this project uses; delete the row if there is none> |
| [guides/](guides/) | <user documentation: how-tos, concepts, reference; delete the row if there is none> |

System context, cross-project decisions and open items: <relative path to docs/architecture/README.md>.
