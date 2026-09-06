# Phase 0 Contracts

**Feature**: `specs/001-foundations/` · **Date**: 2026-08-26

Phase 0 exposes no product capability, so it publishes no user-facing endpoint.
What it does publish is the set of interfaces every later phase is written
against — and those are contracts in the strongest sense, because R-API-9 makes
them additive-only from the moment they exist. Getting one wrong here is
expensive to unwind; getting one wrong in Phase 3 is expensive and public.

| Document | Contract |
|---|---|
| [ports.md](./ports.md) | The five port interfaces, expressed in the project's own domain terms |
| [kernel.md](./kernel.md) | Error shape, request context, caller kinds, surface separation, health signals |
| [lint-rules.md](./lint-rules.md) | Every custom lint rule, mapped to the constitution rule it enforces |

## What makes these binding

**Ports** are binding because R-API-5 forbids a vendor concept from entering an
interface, and because the stand-in behind each one is what lets the whole suite
run with no credentials (FR-054). A port that leaks a vendor's vocabulary cannot
be faked honestly — the fake ends up simulating the vendor rather than satisfying
the domain.

**The kernel contract** is binding because every module inherits it. A second
error shape, a second way to read the caller's identity, or a second definition
of which caller kinds exist would each split a guarantee the constitution states
once.

**Lint rule identifiers** are binding because FR-011 requires every build-time
refusal to name the constitution rule it enforces. Renaming a rule breaks the
trace from a failing build back to the prohibition, which is the thing that makes
the enforcement legible rather than merely obstructive.

## What is deliberately not here

No procedure catalogue for either surface. Both routers exist in this phase and
are mounted separately, and a test asserts their capability sets are disjoint
(FR-048) — but neither carries a product procedure yet. The contract snapshot
that guards R-API-9 is generated in this phase and starts nearly empty; its value
is that it exists before the first procedure lands, so no removal is ever
unobserved.
