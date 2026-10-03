# Ajustes da importação - checks

Profile: light
Plan: none - bounded change (`src/engine/saveFile.ts`, `src/store.ts` e os testes deles), no one-way door; intent below.

## Intent

Ficaram quatro pendências apontadas pelos Verifiers de `dificuldade` e `validacao-importacao`:

1. O teto de empréstimo de quem acabou de escolher o clube vale `2 ×` o caixa gerado, e não o caixa que o nível de dificuldade deu. Em Fácil o teto fica igual ao caixa (1×) e em Difícil fica em 4× o caixa. Ou seja, o nível difícil tem mais crédito relativo que o fácil, o contrário do que o nível promete.
2. A importação aceita `pendingJob.clubIds` vazio. Com `reason: "fired"`, isso trava o jogador na tela «Demitido» sem nenhum clube para escolher.
3. A importação não olha `boardWarnings`. Um texto ou um número fora de 0..3 mostra «Aviso da diretoria (7/3)» ou demite já na rodada seguinte.
4. A importação aceita, dentro do tipo, valores que o motor nunca grava: inteiros zero ou negativos em notícias e carreira (`season`, `date.round`, `date.phase`, `rounds`, `warnings`), `amount` negativo e `playerName` vazio. O texto sai estranho («lesionado por -3 rodadas»), sem quebrar a tela.

Com esta mudança, o teto de empréstimo do clube escolhido passa a ser `2 ×` o caixa já ajustado pelo nível: Fácil dobra o teto e Difícil o divide por dois, na mesma proporção do caixa. Um arquivo com qualquer um dos valores dos itens 2 a 4 é recusado como `malformed`. A tela mostra o aviso de arquivo corrompido e o save atual fica, como já acontece para os outros campos. Os limites saem do que o motor grava, e cada aceite na borda prova que nenhum save real passa a ser recusado.

Defaults escolhidos (o autor pediu para tratar as pendências, sem rodada de perguntas):

- Teto = `2 × caixa ajustado`. A regra de `initialFinance` (`finance.ts:85`) continua a mesma, só passa a valer depois do ajuste. Saves já gravados mantêm o teto que têm: não há migração, e o save continua v8.
- `pendingJob.clubIds` precisa de ao menos 1 clube, nos dois `reason`. `jobOffers` sempre devolve 3 e `reputationOffers` só cria a proposta com 1 ou mais.
- `boardWarnings`: ausente, ou um inteiro de 0 a `BOARD_PATIENCE - 1` (3). `boardAfterRound` zera o contador ao chegar em 4.
- Limites das notícias: `season` ≥ 1; `date.round` ≥ 1 (a rodada começa em 1, `generate.ts:143`); `date.phase` e `cup.phase` ≥ 0; `injury.rounds` e `suspension.rounds` ≥ 1 (a notícia só nasce quando o número sobe); `board.warnings` de 1 a 3; `offer.amount` e `transfer.amount` ≥ 0; `playerName` com algum caractere que não seja espaço.
- Limites da carreira: `season` ≥ 1 e `round` ≥ 0. `round` 0 fica aceito por segurança, porque é `league.currentRound` no momento da troca (`career.ts:141`).
- Fora do escopo: `rating.rating` fora de uma faixa, `state.season` no topo, ids repetidos em `clubIds` e a carreira em clube novo sem ajuste de nível (`takeJob` não mexe no caixa).

5 checks in 2 slices · 0 one-way doors · 0 open

Runner: Vitest (`npx vitest run <arquivo> -t "<nome>"`).

Lições aplicadas:

- L-003: o teto é provado pela tela (`ChooseClub` → `chooseClub` → save gravado), como já é feito para o caixa.
- L-005: cada conjunto vira uma tabela inteira, com os 3 níveis, os 2 `reason` e cada campo com limite.
- L-007: cada tabela tem aceites na borda ao lado das recusas.
- L-030: as recusas de C2 a C5 e o teto de C1 falham no código de antes. Os aceites na borda (`boardWarnings` ausente, 0 e 3; `amount` 0; `round` 1; `phase` 0; `career.round` 0) já passam hoje e ficam declarados como prendendo o comportamento atual.

## Checks

### S1 - Teto de empréstimo pelo nível · 2 files · ~43 KB · ~11k

**C1** - Ao escolher o primeiro clube na tela em cada nível (Fácil, Normal, Difícil), o save gravado tem `finance.loanLimit === 2 × finance.cash` do clube escolhido, com o `cash` já ajustado pelo nível. O teto de outro clube da mesma liga fica igual ao do jogo antes da escolha. Em Fácil o teto é o dobro do teto gerado, e em Difícil é `2 ×` o caixa arredondado da metade.
Proof: `npx vitest run src/ui/ChooseClub.test.tsx -t "teto de empréstimo pela dificuldade"`

### S2 - Importação recusa o que o motor não grava · 2 files · ~25 KB · ~6k

**C2** - `decodeSaveFile` de um jogo válido com `pendingJob` `{ reason: "fired", clubIds: [] }` e com `{ reason: "offer", clubIds: [] }` → `{ kind: "malformed" }`. Cada `reason` com um clube de outra liga → `ok`, com o jogo igual ao exportado.
Proof: `npx vitest run src/engine/saveFile.test.ts -t "proposta pendente sem clubes"`

**C3** - `decodeSaveFile` de um jogo válido, com `boardWarnings` em tabela: ausente, `0`, `1` e `3` → `ok` com o jogo igual ao exportado; `-1`, `4`, `1.5`, `"1"` e `null` → `malformed`.
Proof: `npx vitest run src/engine/saveFile.test.ts -t "avisos da diretoria no arquivo"`

**C4** - Sobre a lista válida de notícias de cada tipo (`newsOfEveryKind`), mudando um campo por vez, em tabela:

- Recusados (`malformed`): `season` `0`; data de liga com `round` `0`; data de copa com `phase` `-1`; `injury.rounds` `0`; `suspension.rounds` `0`; `board.warnings` `0`; `board.warnings` `4`; `offer.amount` `-1`; `transfer.amount` `-1`; `cup.phase` `-1`; `playerName` `""` em `injury`, `suspension`, `rating`, `offer` e `transfer`; `playerName` `"  "` em `injury`.
- Aceitos na borda (`ok`, com o jogo igual ao exportado): `season` `1`; data de liga com `round` `1`; data de copa com `phase` `0`; `injury.rounds` `1`; `board.warnings` `1` e `3`; `offer.amount` `0`; `transfer.amount` `0`.

Proof: `npx vitest run src/engine/saveFile.test.ts -t "notícias no arquivo recusa valores fora do motor"`

**C5** - Sobre as duas trocas válidas de `career`, em tabela: `season` `0` e `round` `-1` → `malformed`; `season` `1` e `round` `0` → `ok`, com o jogo igual ao exportado.
Proof: `npx vitest run src/engine/saveFile.test.ts -t "carreira no arquivo recusa valores fora do motor"`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| níveis de dificuldade no teto (3) | Fácil C1 · Normal C1 · Difícil C1 | - |
| `reason` de `pendingJob` com lista vazia (2) | `fired` C2 · `offer` C2 | - |
| `boardWarnings` aceitos (4) | ausente C3 · 0 C3 · 1 C3 · 3 C3 | - |
| `boardWarnings` recusados (5) | -1 C3 · 4 C3 · 1.5 C3 · texto C3 · `null` C3 | - |
| campos de notícia com limite (12) | `season` C4 · `date.round` C4 · `date.phase` C4 · `injury.rounds` C4 · `suspension.rounds` C4 · `board.warnings` (0 e 4) C4 · `offer.amount` C4 · `transfer.amount` C4 · `cup.phase` C4 · `playerName` vazio C4 · `playerName` só espaços C4 · aceites na borda C4 | - |
| tipos de notícia com `playerName` (5) | `injury` C4 · `suspension` C4 · `rating` C4 · `offer` C4 · `transfer` C4 | - |
| campos de carreira com limite (2) | `season` C5 · `round` C5 | - |

- Nenhum check fala de tela além de C1: a ligação `malformed` → aviso e save mantido já é provada por `src/ui/Home.test.tsx` («arquivo corrompido mostra o aviso e mantém o save»).

## Swept

- validation: C2, C3, C4, C5
- failure modes: existing - `malformed` mantém o save atual (`src/ui/Home.test.tsx`)
- idempotency: n/a - importar é uma leitura pura; o mesmo arquivo dá o mesmo resultado
- authorization: n/a - jogo local, sem contas
- concurrency: n/a - a importação roda numa ação só da store, sem trabalho em paralelo
- data lifecycle: C1 (só jogo novo; saves gravados mantêm o teto, sem migração)
- dependency failure: n/a - nenhuma dependência externa
- state transitions: C2 (proposta pendente sem saída), C3 (contador da diretoria)
- observability: n/a - sem log no jogo

## Handoff

- S1 = `src/store.ts` 36 KB + `src/ui/ChooseClub.test.tsx` 7 KB = 43 KB ÷ 4 ≈ 11k; S2 adds `src/engine/saveFile.ts` 7 KB + `src/engine/saveFile.test.ts` 18 KB = 25 KB ≈ 6k, 17k no total, abaixo do budget de 150k: um builder.
- Mechanism: one builder (abaixo do budget, sem pergunta)
