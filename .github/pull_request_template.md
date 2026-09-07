<!--
The twelve REVIEW-only rules, verbatim from .specify/memory/constitution.md (FR-065).
These are the rules with no machine behind them. Everything else is already blocked by
the compiler, a lint rule, the database, or a pipeline gate. Answer each one honestly.
-->

## Review checklist

- [ ] **R-MOBILE-3** - is this genuinely identical between roles, or only roughly similar?
- [ ] **R-MOBILE-12** - does any component decide something instead of rendering?
- [ ] **R-MOBILE-14** - is any directional icon flipped by hand?
- [ ] **R-API-5** - did a vendor concept enter a port interface?
- [ ] **R-DB-2** - was a local schema hand-edited rather than reset?
- [ ] **R-DB-4** - does this store a derived value?
- [ ] **R-DB-9** - is this index backed by a measured slow query?
- [ ] **R-SEC-7** - does this introduce custom auth, session, or crypto code?
- [ ] **R-SEC-10** - was a leaked key rotated before investigation?
- [ ] **R-PROC-2** - do the spec and the code still agree?
- [ ] **R-PROC-3** - was a business rule invented at the keyboard?
- [ ] **R-PROC-6** - is this a feature disguised as hardening?
