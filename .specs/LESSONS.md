# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Plan/Checks)

Corroborated across multiple features. Safe to apply as guidance.

### L-003 - Assert the caller wiring of a helper through its entry point, not only the helper in isolation
- signal: `spec_precision_gap` · recurrence: 2 feature(s) · scope: `engine` · harmful: 0
- features: nucleo-liga-partida, elenco-mercado-financas
- evidence: C27 / src/engine/season.ts:34 (engine) (+1 more)
- last seen: 2026-09-26T22:12:06Z

### L-005 - A check that says every/all members of a set needs a table-driven proof over the whole set, not one sample.
- signal: `spec_precision_gap` · recurrence: 2 feature(s) · scope: `checks` · harmful: 0
- features: partida-ao-vivo, copa-nacional
- evidence: checks.md C47 (checks) (+1 more)
- last seen: 2026-09-27T15:59:05Z

### L-006 - A selection-rule check must name who takes the slot and the no-alternative fallback, with a fixture where the right and the likely wrong pick differ.
- signal: `spec_precision_gap` · recurrence: 2 feature(s) · scope: `checks` · harmful: 0
- features: partida-ao-vivo, parada-obrigatoria
- evidence: checks.md C48 (checks) (+1 more)
- last seen: 2026-09-29T21:43:50Z

### L-007 - When a check says available, the fixture must include an unavailable member so exclusion is actually exercised.
- signal: `spec_precision_gap` · recurrence: 2 feature(s) · scope: `tests` · harmful: 0
- features: partida-ao-vivo, elenco-mercado-financas
- evidence: checks.md C14 (tests) (+1 more)
- last seen: 2026-09-26T22:12:05Z

### L-008 - When a check quotes a user-facing message, assert the exact text where it is rendered or mapped, not only the engine reason code.
- signal: `ac_gap` · recurrence: 2 feature(s) · scope: `ui` · harmful: 0
- features: elenco-mercado-financas, lancamento
- evidence: C23 / src/store.ts:49 (ui) (+1 more)
- last seen: 2026-09-28T22:24:44Z

### L-009 - A one-way door added during the build needs its own check before the build closes.
- signal: `ac_gap` · recurrence: 2 feature(s) · scope: `checks` · harmful: 0
- features: elenco-mercado-financas, multiplas-temporadas
- evidence: plan.md Landing door 5 / src/engine/finance.ts:121 (checks) (+1 more)
- last seen: 2026-09-27T01:23:53Z

### L-030 - When checks close weak proofs over code that is already correct, run each new proof on the pre-fix code before writing the checks and declare every one that passes there as pinning existing behaviour.
- signal: `spec_precision_gap` · recurrence: 3 feature(s) · scope: `checks` · harmful: 0
- features: ajustes-saves, emprestimos, noticias
- evidence: checks.md Lições aplicadas / C2-C4 (checks) (+2 more)
- last seen: 2026-10-03T01:12:21Z

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Prove a screen state driven by storage by writing the stored document and rendering the app, not by setting store state directly
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `ui-persistence` · harmful: 0
- features: nucleo-liga-partida
- evidence: C36 / src/store.ts:77 (ui-persistence)
- last seen: 2026-09-26T19:16:04Z

### L-002 - When a criterion names columns shown on screen, assert the rendered header set, not only the engine rows
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: nucleo-liga-partida
- evidence: C28 / src/ui/Table.tsx:4 (ui)
- last seen: 2026-09-26T19:16:04Z

### L-004 - Compute expected values in tests independently of the production helper under test
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: nucleo-liga-partida
- evidence: C7 / src/ui/ChooseClub.test.tsx (tests)
- last seen: 2026-09-26T19:16:04Z

### L-010 - Give every displayed value a non-zero fixture so a miswired field cannot pass by showing zero.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: elenco-mercado-financas
- evidence: C9 / src/ui/Finance.test.tsx (tests)
- last seen: 2026-09-26T22:12:06Z

### L-011 - When a fix adds a test to strengthen a check, add it as a Proof line on that check too, or the check's proof never runs it.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: elenco-mercado-financas
- evidence: C7 / checks.md:35 (checks)
- last seen: 2026-09-26T22:19:36Z

### L-012 - When one piece of state feeds several screens, prove it renders on each screen that can trigger it.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: elenco-mercado-financas
- evidence: C23 / src/ui/Squad.tsx:260 (ui)
- last seen: 2026-09-26T22:19:36Z

### L-013 - A check that pins a seed or stream needs an assertion that reproduces the literal formula, not only determinism.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: multiplas-temporadas
- evidence: C52 / src/engine/migrate.test.ts:131 (tests)
- last seen: 2026-09-27T01:23:53Z

### L-014 - Pin an RNG stream over several draws and assert the rejected alternative gives different values; one draw can coincide.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: multiplas-temporadas
- evidence: C19 / src/engine/rollover.test.ts:126 (F8, F9) (tests)
- last seen: 2026-09-27T01:23:53Z

### L-015 - When a check says a count equals a total, assert it against an independently derived total, not a sum that is equal by construction.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: copa-nacional
- evidence: C19 / src/engine/cup.test.ts:472 (tests)
- last seen: 2026-09-27T15:59:05Z

### L-016 - Word a check's fixture the way the test builds it; a value read through production code is not a hand-built fixture.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: copa-nacional
- evidence: C9 / src/engine/rollover.test.ts:434 (checks)
- last seen: 2026-09-27T15:59:05Z

### L-017 - When two criteria gate the same action, add a check for the case where both apply at once.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: copa-nacional
- evidence: plan.md AC 23 x AC 44 / src/ui/Squad.tsx:312 (checks)
- last seen: 2026-09-27T15:59:05Z

### L-018 - When a rule reads one of two candidate values, build the fixture so the two differ, or the test passes under either reading.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: gastos-da-ia
- evidence: C1 / src/engine/market.test.ts:486 (ruling 1, purchase salary) (tests)
- last seen: 2026-09-27T17:37:45Z

### L-019 - When a check places one element beside another, assert their shared container, not only that both are present.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: gastos-da-ia
- evidence: C25 / src/ui/Market.test.tsx:249 (ui)
- last seen: 2026-09-27T17:37:46Z

### L-020 - List in the Superseded table every old assertion over a per-league collection, such as history division records, not only league and club counts.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: paises
- evidence: src/engine/rollover.test.ts:402 (verification.md Finding 1) (checks)
- last seen: 2026-09-27T20:03:35Z

### L-021 - Derive superseded expected values under the plan's new defaults, such as a list filter that starts on the user's own country.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: paises
- evidence: checks.md Superseded row 2 vs AC 18 (verification.md Finding 2) (checks)
- last seen: 2026-09-27T20:03:35Z

### L-022 - When a criterion says every event of a tick plays, assert the exact list of effects, not toContain on one event's effects.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: ajustes-audio
- evidence: C6 / src/ui/Live.test.tsx:452-454 (verification.md Finding 1) (checks)
- last seen: 2026-09-28T21:06:50Z

### L-023 - Give a browser layout check a fixed seed option so a green run is reproducible and not one random game.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `layout` · harmful: 0
- features: ajustes-audio
- evidence: C1/C2 / src/store.ts:266 randomSeed (verification.md Finding 2) (layout)
- last seen: 2026-09-28T21:06:50Z

### L-024 - When a migration seeds its own random streams, a check must pin each seed formula, not only the migrated result.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: copa-continental
- evidence: src/engine/migrate.ts:162-163 (verification.md observation 1) (checks)
- last seen: 2026-09-28T21:52:34Z

### L-025 - Tie a counted side effect to the entity that caused it, not to a count of any entity that changed.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: copa-continental
- evidence: C13 / src/engine/continental.test.ts:223,229 (verification.md observation 2) (tests)
- last seen: 2026-09-28T21:52:34Z

### L-026 - After a UI action that saves before changing state, wait for the post-save state (waitFor or a findBy of the new screen) before asserting, or the proof passes only in suite order.
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: carreira-dinamica
- evidence: C11 / src/store.test.ts:896 (ui)
- last seen: 2026-09-30T21:02:39Z

### L-027 - A new panel on an existing screen needs the layout check to put that panel on screen and measure it, not only the screen as first reached.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `layout` · harmful: 0
- features: carreira-dinamica
- evidence: C20 / scripts/layout-check.mjs:334 (layout)
- last seen: 2026-09-30T21:02:39Z

### L-028 - When a change moves state to a new place, add a check that a later operation which rebuilds that state keeps it there.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `state` · harmful: 0
- features: posicao-na-substituicao
- evidence: verification round 1 Finding 1 / src/engine/live.ts:709 (state)
- last seen: 2026-10-01T17:21:39Z

### L-029 - When a check is added to prove the fix of a Verifier finding, build its fixture on the exact case the finding named, so the proof fails on the pre-fix code.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: posicao-na-substituicao
- evidence: C9 / src/ui/Live.test.tsx:758 (checks)
- last seen: 2026-10-01T17:21:39Z

### L-031 - A test that asserts something is absent also asserts the precondition that makes it absent (market closed, rows rendered), or it passes on an empty screen.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: emprestimos
- evidence: src/ui/Squad.test.tsx:646 (C17) (tests)
- last seen: 2026-10-02T22:30:05Z

### L-032 - On a screen that renders the whole market list, find a button by its text with selector button, not by role and name: a role query names all ~900 buttons (about 1 s each in jsdom) and a test past its timeout keeps running and cleans up the next test's DOM.
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: emprestimos
- evidence: src/ui/Market.test.tsx:346 «oferta inválida» (tests)
- last seen: 2026-10-02T23:35:34Z

### L-033 - A fake that drops an option the code passes (cache.match ignoring ignoreVary) cannot prove that option; give the fake the real rule for it, or name the end-to-end proof that does.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: offline-instalar
- evidence: src/pwa/sw.test.ts:24 (C6, ignoreVary) (tests)
- last seen: 2026-10-03T00:38:49Z

### L-034 - A check that names a rounding rule needs a fixture whose exact value is not already round, or floor, ceil and no rounding all pass.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: dificuldade
- evidence: src/ui/ChooseClub.test.tsx:142 (C3) (tests)
- last seen: 2026-10-03T01:41:49Z

### L-035 - Take the members of a Coverage set of fields from the type declaration and give each field a refusal row, not only the fields listed by hand.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: validacao-importacao
- evidence: verification.md Coverage / src/engine/saveFile.test.ts:259-282 (checks)
- last seen: 2026-10-03T01:58:59Z

### L-036 - When a claim names one input among blended ones, prove it with a fixture where they differ, never with equal ratings that make them coincide.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: penaltis
- evidence: AC 3 / src/engine/live.ts:402 (checks)
- last seen: 2026-10-04T00:16:28Z

### L-037 - A new optional field on a persisted object needs a check for every action that rebuilds that object, found by grepping its writers.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: penaltis
- evidence: AC 12 / src/store.ts:657 (checks)
- last seen: 2026-10-04T00:16:28Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
