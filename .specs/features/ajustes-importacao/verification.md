# Ajustes da importação verification

**Verdict**: PASS
**Profile**: light
**Diff range**: e66b3c7..7b4c807 (HEAD)
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Resumo: os cinco checks estão provados na HEAD 7b4c807 (C1 a C5 PASS). Cada um tem teste novo do diff que rodou e passou individualmente, e cada um tem assertion localizada. Conferi os limites novos de `src/engine/saveFile.ts` contra o que o motor grava, e nenhum recusa um valor que o motor escreve. O profile é light: não houve fault injection e a Coverage não foi recalculada como etapa obrigatória.

## Binding sources

Não há plan.md nem fonte binding. A seção `## Intent` de `checks.md` faz o papel do plano. O step 1 só roda no profile `ui`, então não se aplica.

## Checks

Verified at 7b4c807. Todas as provas rodaram numa só invocação:
`npx vitest run src/engine/saveFile.test.ts src/ui/ChooseClub.test.tsx -t "teto de empréstimo pela dificuldade|proposta pendente sem clubes|avisos da diretoria no arquivo|notícias no arquivo recusa valores fora do motor|carreira no arquivo recusa valores fora do motor" --reporter=verbose`. Saída 0, `Tests 5 passed | 22 skipped (27)`. Cada filtro casou exatamente um teste, marcado com ✓:

- `dificuldade na escolha do clube (dificuldade) > teto de empréstimo pela dificuldade` ✓ (`src/ui/ChooseClub.test.tsx:148`)
- `ajustes da importação (ajustes-importacao) > proposta pendente sem clubes` ✓ (`src/engine/saveFile.test.ts:357`)
- `ajustes da importação (ajustes-importacao) > avisos da diretoria no arquivo` ✓ (`src/engine/saveFile.test.ts:368`)
- `notícias no arquivo (noticias) > notícias no arquivo recusa valores fora do motor` ✓ (`src/engine/saveFile.test.ts:310`)
- `ajustes da importação (ajustes-importacao) > carreira no arquivo recusa valores fora do motor` ✓ (`src/engine/saveFile.test.ts:382`)

Diff: os cinco testes foram criados no diff (C1 em 51a6c12, C2 a C5 em 7b4c807). Nenhuma prova depende de um teste que a feature não mexeu.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | Em cada nível, o save gravado tem `loanLimit === 2 × cash` do clube escolhido, com o caixa já ajustado; outro clube mantém o teto gerado; Fácil = dobro do teto gerado, Difícil = `2 ×` caixa arredondado da metade | `-t "teto de empréstimo pela dificuldade"` ✓, saída 0 | `src/ui/ChooseClub.test.tsx:161`: `expect(financeOf(saved, id).loanLimit, level).toBe(2 * financeOf(saved, id).cash)`. `src/ui/ChooseClub.test.tsx:162`: `expect(financeOf(saved, id).loanLimit, level).toBe(expected(financeOf(game, id).loanLimit))`, com Fácil `2 * l`, Normal `l` e Difícil `2 * Math.round(l / 2 / 2 / 100_000) * 100_000` (:151-155). `src/ui/ChooseClub.test.tsx:164`: `expect(financeOf(saved, other).loanLimit, level).toBe(financeOf(game, other).loanLimit)`. Código: `src/store.ts:611`, `src/engine/finance.ts:14`, `:87` | PASS |
| C2 | `pendingJob` com `clubIds: []` → `malformed` em `fired` e em `offer`; um clube de outra liga → `ok` com o mesmo jogo | `-t "proposta pendente sem clubes"` ✓, saída 0 | `src/engine/saveFile.test.ts:362`: `expect(decodeSaveFile(envelope({ ...g, pendingJob: { reason, clubIds: [] } })), reason).toEqual({ kind: "malformed" })`. `src/engine/saveFile.test.ts:364`: `expect(decodeSaveFile(encodeSaveFile(s, ISO)), reason).toEqual({ kind: "ok", state: s })`, com `clubIds: [other]` de `g.leagues[1]` (:360, :363), as duas sobre `["fired", "offer"]` (:361). Código: `src/engine/saveFile.ts:131` | PASS |
| C3 | `boardWarnings` ausente, `0`, `1`, `3` → `ok` com o mesmo jogo; `-1`, `4`, `1.5`, `"1"`, `null` → `malformed` | `-t "avisos da diretoria no arquivo"` ✓, saída 0 | `src/engine/saveFile.test.ts:372`: `expect(decodeSaveFile(encodeSaveFile(g, ISO))).toEqual({ kind: "ok", state: g })`, ausente (`"boardWarnings" in g` falso em :371). `src/engine/saveFile.test.ts:375`: `toEqual({ kind: "ok", state: s })` sobre `[0, 1, 3]` (:373). `src/engine/saveFile.test.ts:378`: `expect(decodeSaveFile(envelope({ ...g, boardWarnings })), String(boardWarnings)).toEqual({ kind: "malformed" })` sobre `[-1, 4, 1.5, "1", null]` (:377). Código: `src/engine/saveFile.ts:74`, `:82-84` | PASS |
| C4 | Sobre `newsOfEveryKind`, um campo por vez: 16 recusas (`season` 0, liga `round` 0, copa `phase` -1, `injury.rounds` 0, `suspension.rounds` 0, `board.warnings` 0 e 4, `offer.amount` -1, `transfer.amount` -1, `cup.phase` -1, `playerName` `""` em 5 tipos, `"  "` em `injury`) → `malformed`; 8 aceites na borda → `ok` com o mesmo jogo | `-t "notícias no arquivo recusa valores fora do motor"` ✓, saída 0 | `src/engine/saveFile.test.ts:337`: `for (const [name, news] of refused) expect(decodeSaveFile(envelope({ ...g, news })), name).toEqual({ kind: "malformed" })` sobre os 16 casos de :319-334, com `toHaveLength(16)` em :336. `src/engine/saveFile.test.ts:351`: `expect(decodeSaveFile(encodeSaveFile(s, ISO)), name).toEqual({ kind: "ok", state: s })` sobre os 8 casos de :339-346, com `toHaveLength(8)` em :348. Código: `src/engine/saveFile.ts:100-121` (`isName` :100, `isAmount` :101, data :103, `season` :104) | PASS |
| C5 | Sobre as duas trocas válidas de `career`: `season` 0 e `round` -1 → `malformed`; `season` 1 e `round` 0 → `ok` com o mesmo jogo | `-t "carreira no arquivo recusa valores fora do motor"` ✓, saída 0 | `src/engine/saveFile.test.ts:392`: `expect(decodeSaveFile(envelope({ ...g, career })), name).toEqual({ kind: "malformed" })` sobre `season 0` e `round -1` (:391). `src/engine/saveFile.test.ts:396`: `expect(decodeSaveFile(encodeSaveFile(s, ISO)), name).toEqual({ kind: "ok", state: s })` sobre `season 1` e `round 0` (:394). Código: `src/engine/saveFile.ts:94` | PASS |

Nível e amostragem:

- C1 é provado pela tela, como pede L-003. O teste clica no nível e no card em `<App />` e lê o save gravado por `loadGame()` (`ChooseClub.test.tsx:108-121`). A tabela tem os 3 níveis, e a linha :161 prende a regra (`2 × cash` gravado) independentemente da fórmula de :162. Na tabela de Difícil, `l / 2` é o caixa gerado (`finance.ts:87`), então a fórmula vira `2 ×` o caixa de Difícil arredondado em `store.ts:606`. Ela confere com o claim.
- C2 a C5 falam do valor que `decodeSaveFile` devolve, e as provas chamam `decodeSaveFile` direto com o texto do arquivo. Não há gap de nível. Cada recusa muda um só campo sobre uma base que o mesmo teste aceita (C2 :364, C3 :372, C4 :351 e a base de `newsOfEveryKind`, C5 :396 com `moves[0]` intacto).
- C4: conferi cada caso contra a base (`saveFile.test.ts:216-233`). O item 0 é `injury` com data de liga, então `season 0` cai em `:104` e `round 0` em `:103` de `saveFile.ts`. `cupAt` é o índice 2 (a suspensão de copa), então «data de copa phase -1» cai na data (`:103`). Já «cup phase -1» muda o item `cup` do índice 9, cuja data continua `phase: 0`, e por isso a recusa vem de `isIntIn(n.phase, 0)` em `:121`. São dois caminhos distintos. A tabela tem os 16 recusados e os 8 aceitos que o claim enumera, sem faltar nenhum.
- C5: as edições mudam só a segunda troca (`:390`), e a primeira continua válida. As duas trocas do claim formam a base, e a tabela tem os 4 valores do claim.

## Limites contra o que o motor grava

A Intent pede que nenhum save real passe a ser recusado. Conferi cada limite novo de `saveFile.ts` contra quem escreve o valor:

| Limite (`saveFile.ts`) | Quem escreve | Faixa que o motor grava | Recusa save real? |
| --- | --- | --- | --- |
| `boardWarnings` 0..3 (:74) | `career.ts:93-102` (soma 1 e zera em `>= BOARD_PATIENCE` = 4, `career.ts:29`), `career.ts:140` e `rollover.ts:297` (0) | 0..3 | não |
| `pendingJob.clubIds` ≥ 1 (:131) | `career.ts:96` (`jobOffers`, `board.ts:152-157`, devolve 3 com 4 ou mais clubes) e `career.ts:100` (só com `clubIds.length > 0`). São os únicos que gravam `pendingJob` | ≥ 1 | não |
| notícia `season` ≥ 1 (:104) | `news.ts:18` (`after.season`); `generate.ts:218` começa em 1 e `rollover.ts:164`/`:294` soma 1 | ≥ 1 | não |
| `date.round` ≥ 1 (:103) | `season.ts:76`/`:105` (`round.number`); `generate.ts:143` numera `rounds.length + 1` | ≥ 1 | não |
| `date.phase` e `cup.phase` ≥ 0 (:103, :121) | `cup.ts:329` (`phase: k`, índice) e `news.ts:28` | ≥ 0 | não |
| `injury.rounds`, `suspension.rounds` ≥ 1 (:107, :109) | `news.ts:33`, `:38`, `:40`: só grava quando o valor novo é maior que o antigo (ou `0`) | ≥ 1 | não |
| `board.warnings` 1..3 (:117) | `news.ts:61`: só quando `after > before >= 0`, e o `after` máximo é 3 (linha 1 desta tabela) | 1..3 | não |
| `offer.amount`, `transfer.amount` ≥ 0 (:101) | `market.ts:438` (oferta só com `amount > 0`); transferências de `market.ts:230` (`offer.amount`) e `:525` (`price`) | ≥ 0 | não |
| `playerName` não vazio (:100) | `news.ts:33`-`:70` copia `p.name` ou `t.playerName`, gerados por `names.ts:88` via `makePlayer` (`generate.ts:58`) | texto não vazio | não |
| `career.season` ≥ 1, `career.round` ≥ 0 (:94) | `career.ts:141` (`league.currentRound`, que vale 0 em `generate.ts:180` e `rollover.ts:277`) e `rollover.ts:211` (`round: rounds`) | `season` ≥ 1, `round` ≥ 0 | não |

`migrate.ts` não escreve `news`, `career`, `pendingJob` nem `boardWarnings`, então um save antigo migrado não traz esses campos fora da faixa. Nenhum limite recusa um valor que o motor grava. O teto de `C1` não é validado na importação, e por isso saves com o teto antigo continuam aceitos, como a Intent decide.

## Coverage

Carried from checks.md e não recalculado: o profile light não exige esse passo. Fiz uma conferência de leitura. Cada membro das 7 linhas de `checks.md` aparece nas tabelas dos testes citados acima (3 níveis em :151-155; 2 `reason` em :361; 4 aceitos e 5 recusados de `boardWarnings` em :371-377; os campos de notícia em :319-346; os 5 tipos com `playerName` em :329-333; `season` e `round` de carreira em :391-394).

| Set (size) | Recomputed from | Member -> proof | Unproven |
| --- | --- | --- | --- |
| níveis de dificuldade no teto (3) | carried from checks.md | Fácil/Normal/Difícil C1 (`ChooseClub.test.tsx:151-155`) | - |
| `reason` de `pendingJob` com lista vazia (2) | carried from checks.md | `fired`/`offer` C2 (`saveFile.test.ts:361`) | - |
| `boardWarnings` aceitos (4) | carried from checks.md | ausente :371-372 · 0/1/3 :373 | - |
| `boardWarnings` recusados (5) | carried from checks.md | -1/4/1.5/"1"/null :377 | - |
| campos de notícia com limite (12) | carried from checks.md | :319-334 recusas · :339-346 aceites | - |
| tipos de notícia com `playerName` (5) | carried from checks.md | :329-333 | - |
| campos de carreira com limite (2) | carried from checks.md | :391, :394 | - |

## Swept existing

- failure modes: `existing - malformed mantém o save atual (src/ui/Home.test.tsx)`. O teste existe e prende isso: `src/ui/Home.test.tsx:256-258` («arquivo corrompido mostra o aviso e mantém o save») chama `refused`, que confere a mensagem (`:237`), a fase `home` (`:238`), o save do slot intacto (`:239`, `expect(await loadGame()).toEqual({ kind: "ok", state: saved })`) e nenhum slot novo (`:240`). Na store, `malformed` só grava `importMessage` (`src/store.ts:870`). As recusas novas saem do mesmo `hasGameShape` e caem no mesmo `{ kind: "malformed" }` (`saveFile.ts:151`). A restrição citada está no código.
- Linhas `n/a` (idempotency, authorization, concurrency, dependency failure, observability): são política aprovada e não há o que conferir no código.
- Convenções (AGENTS.md): o diff e66b3c7..HEAD em `src/` não traz `Math.random`, React, DOM, zustand, idb nem «Brasfoot». `saveFile.ts` passa a importar `./career` (só para `BOARD_PATIENCE`), que é do motor e não importa `saveFile`, então não há ciclo. `tsc -p tsconfig.json`, `tsc -p tsconfig.engine.json` e `eslint` nos 5 arquivos do diff saem 0.

## Faults injected

Não roda no profile light, e nenhuma falha foi injetada. Por dedução, trocar o `0` de `job.clubIds.length > 0` (`saveFile.ts:131`), o `BOARD_PATIENCE - 1` de `:74` ou de `:117`, ou o mínimo de qualquer `isIntIn` faria algum caso das tabelas mudar de resultado. Isso é leitura, não mutação rodada.

## Gate

`npx vitest run` (suíte inteira na HEAD 7b4c807): 54 arquivos, 707 passed, 0 failed, saída 0. Provas nomeadas: 5 passed, 0 failed. `tsc -p tsconfig.json --noEmit` e `tsc -p tsconfig.engine.json --noEmit`: saída 0.

## Ranked gaps

Nenhum. Pontos fracos que não reprovam:

1. C4 - dois aceites na borda não mudam nada na base: «season 1» edita o item 0, que já tem `season: 1` (`src/engine/saveFile.test.ts:339` contra `:221`), e «data de copa phase 0» repõe a data que o índice 2 já tem (`:341` contra `:219`). A borda continua provada, porque a base inteira volta `ok`, mas a linha não testa uma mudança.
2. C1 - «outro clube da mesma liga» é tirado sempre de `game.leagues[0]` (`src/ui/ChooseClub.test.tsx:163`). Só é da mesma liga porque o primeiro card é dessa liga, com uma semente fixa (31, `:108`). O claim é atendido nesta semente, mas o teste não confere que os dois clubes são da mesma liga.
3. C4 - `playerName` só com espaços é provado só em `injury` (`src/engine/saveFile.test.ts:334`), e `rounds` 1 aceito só em `injury` (`:342`). É o que o claim pede, e o código usa o mesmo `isName` e o mesmo `isIntIn` para todos os tipos (`saveFile.ts:100`, `:107`, `:109`).
4. Nenhuma prova de mutação: o profile light não roda fault injection, então dizer que cada tabela pega a remoção de cada limite é dedução.
