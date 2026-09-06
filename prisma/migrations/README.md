# migrations

Immutable once merged (R-DB-1). Checksum-verified in the pipeline (FR-037).

A migration is generated, then extended by hand with the raw SQL the schema language cannot express
(research R-6): check constraints, the two roles and their revocations, partial unique indexes, and the
scheduled-sessions partial index. That is not a violation of the ban on editing generated files (R-PROC-9):
a migration becomes the source of truth the moment it is created. See docs/RUNBOOK.md.

Migration files are created by T064 through T067. Nothing lives here until then.
