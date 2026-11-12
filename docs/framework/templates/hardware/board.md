---
id: <system>/<project>/<component>/hardware/<board-slug>
title: <Board name>
type: HW
owner: <system>/<project>/<component>
status: Draft
date: YYYY-MM-DD
depends: []
related: []
planned: []
---

# <Board name>

<Summary: one paragraph saying what this document establishes and its main points.>

<!-- One sub-document per supported board: file hardware/<board-slug>.md, id <component-id>/hardware/<board-slug>. hardware.md lists the boards. -->

## 1 Board

| Item | Value |
| --- | --- |
| Vendor / model | <vendor, model, revision> |
| SoC | <chip, cores, clock> |
| Memory | <SRAM, PSRAM, flash> |
| Power | <supply, battery, charging> |
| Purchase / datasheet | <links> |

## 2 Peripherals

| Peripheral | Part | Bus | Address / pins | Driver |
| --- | --- | --- | --- | --- |
| <display / mic / IMU> | <part number> | <SPI / I2C / I2S> | <addr, pins> | <component / library> |

## 3 Pinout

| GPIO | Function | Direction | Notes |
| --- | --- | --- | --- |
| <n> | <function> | in / out | <pull-up, shared, strapping pin> |

## 4 Constraints and quirks

<!-- Anything that surprised someone: shared buses, strapping pins, power rails, errata. -->

## 5 Sources

<!-- Datasheets, schematics, vendor BSP and their versions. Keep copies under reference/ when licences allow. -->
