# ADR 0001 — Modular monolith with ports

**Status:** accepted

## Context
Two client surfaces, one small team, and vendor decisions (video, push, storage,
messaging) that will change before the product does.

## Decision
One deployable API, split into modules with sealed public entries, talking to
the outside world through ports whose adapters are chosen at boot from config.
The worker is a second process of the same API application and shares the same
modules rather than reimplementing rules.

## Consequences
- A module can be extracted into a service later without rewriting callers,
  because callers only ever saw its `index.ts`.
- Swapping a video, push, storage or messaging vendor costs one adapter, not a
  branch in every rule. (Payment is not a port: the platform does not process
  payments — ADR 0005.)
- The discipline is enforced by lint, not by memory.
