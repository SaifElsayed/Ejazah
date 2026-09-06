# Specification Quality Checklist: Phase 0 — Foundations

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

**All items pass.** The specification is ready for `/speckit-plan`.

### Sources used

Written from the governing documents only:

- `PLAN.md`, Phase 0 — the spec objective, the deliverables and the definition of
  done. Each user story names which deliverables it covers.
- `.specify/memory/constitution.md` — the rule identifiers cited by every
  requirement and acceptance scenario.
- `docs/ERD.md` v1.3 — the authoritative data model: 33 tables across 12 module domains plus the platform kernel (ADR 0005, ADR 0007, ADR 0008),
  the binding conventions of its section 0, the index set of its section 14 and
  the integrity rules of its section 15.

No requirement was derived from source code in the repository. The current
implementation is placeholder scaffolding and carries no authority over what this
phase must deliver.

### Resolution of the two prior clarifications

1. **External applications** — withdrawn. The user confirmed the "five external
   applications" item in PLAN.md was not real. The product has three
   applications: a React Native app for users, a web application for
   administrators, and one backend serving both. The former User Story 8 and its
   requirement are removed; FR-001 now states the three-application structure,
   and the correction is recorded in Assumptions.
2. **Data model registry** — resolved. `docs/ERD.md` (now v1.2) was supplied and is
   cited directly by FR-022 through FR-036. Its section 14 backs the index
   restriction (FR-035) and its section 15 backs the integrity rules (FR-030).

### Conflicts found between the ERD and the constitution

Six, each now carried as a requirement rather than left as a note. Listed in full
under Assumptions in the spec: stored derived values beyond the two permitted
caches; a nullable idempotency key (moot since ADR 0005 removed the money tables);
delete revocation narrower than R-DB-3 requires, now resolved by soft deletion;
two plaintext token columns; a national identity document reference stored as
text; and a table count of 35 against 36 claimed (closed: ERD v1.2 defines 30).

A seventh was withdrawn after review. The settings table was read as failing
R-PROC-11's word "prospectively", which was an over-reading: the rule requires
only that no operational number is hardcoded and that changes go through the
administrative surface, audit-logged. No scheduling or version history is
needed, and the ERD's settings table is correct as written. FR-034 now states
the rule as intended.

The table count question is closed by ADR 0005: the five managed-payment tables
were removed and every document now states thirty.

The ERD agrees with the constitution on every load-bearing point — no money
tables, delete revoked at the Postgres role level, slots as local
wall-clock time beside a named zone, administrator identity fully separate, and
the invariants its section 15 already names. The disagreements are all at the
margin, and none requires a structural change to the model.

### Content quality notes

This phase's subject is development infrastructure, so its users are the
engineers, reviewers and operators who build and run the product, and its
outcomes are enforcement guarantees rather than product journeys. Requirements
are stated as outcomes and cite rule identifiers rather than naming tools. Where
a mechanism tier appears — a build-time refusal, a pipeline gate, a revoked
database privilege — it is because the constitution makes the tier itself the
requirement. The technology shape PLAN.md fixes is recorded once in Assumptions
as a given constraint rather than repeated through the requirements.

### Deliberate deviations from the template

- An `Overview` section precedes the mandatory sections, to state the scope
  boundary and the provenance rule before the requirements depending on them.
- Seven user stories rather than the template's three, because the phase has
  seven independently demonstrable outcomes and collapsing them would hide which
  of PLAN.md's deliverables were covered.

Section order and heading levels are otherwise unchanged.
