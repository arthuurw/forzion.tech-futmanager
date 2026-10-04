# Pênaltis durante o jogo e cobrador verification

**Verdict**: FAIL
**Profile**: light
**Diff range**: d09b5c2..909b492 (HEAD)
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Resumo: 14 dos 16 checks estão provados na HEAD 909b492. C3 e C9 não passam. Cada prova rodou e passou individualmente, e cada filtro casou com o seu teste. Há três achados:

1. O código contradiz AC 3. A cobrança usa o setor de goleiro misturado com a defesa (`Strength.gk`), e o critério manda usar `keeperStrength`. A prova de C3 usa times de rating uniforme e por isso não distingue os dois.
2. `assignStarter` apaga `lineup.penaltyTaker`. Trocar qualquer titular no Elenco devolve o seletor a «Automático» sem o usuário escolher. Esse caminho da escalação ficou fora do conjunto de C10/C11.
3. C9 afirma que, sem `penaltyTaker`, o seletor mostra «Automático», e nenhuma assertion confere esse caso.

O profile é light: não houve fault injection, e a Coverage não foi recalculada como passo obrigatório.

## Binding sources

O plano não marca nenhuma fonte binding além dele mesmo, porque o design foi aprovado no chat. O step 1 só roda no profile `ui` e não se aplica aqui.

## Checks

Verified at 909b492. Todas as provas vitest rodaram numa só invocação:
`npx vitest run src/engine/live.test.ts src/engine/balance.test.ts src/engine/narration.test.ts src/audio/sfx.test.ts src/engine/match.test.ts src/ui/Squad.test.tsx src/store.test.ts src/engine/rollover.test.ts src/engine/cup.test.ts src/engine/saveFile.test.ts -t "pênalti marcado e cobrado|sem ninguém em campo não tem pênalti|tipos de evento ocorrem e têm narração|cobrador escolhido bate no jogo|pênaltis por partida|conversão do pênalti pelo cobrador e pelo goleiro|times iguais|forte contra fraco|postura ofensiva|postura defensiva|taxa de cartões|taxa de lesões|caixa equilibrado|narração do pênalti no jogo|som do pênalti no jogo|seletor de pênaltis|cobrador mantido na formação e na postura|cobrador na virada|cobrador escolhido na ordem|cobrador escolhido abre a disputa|cobrador no arquivo" --reporter=verbose`

A saída foi 0, com `Test Files 10 passed (10)` e `Tests 22 passed | 216 skipped (238)`. Os 21 filtros casaram 22 testes, e cada um aparece marcado com ✓:

- `live.test.ts > rodada ao vivo (engine) > todos os 11 tipos de evento ocorrem e têm narração` ✓ (:316)
- `live.test.ts > pênalti no jogo (penaltis) > pênalti marcado e cobrado` ✓ (:981)
- `live.test.ts > pênalti no jogo (penaltis) > sem ninguém em campo não tem pênalti` ✓ (:1005)
- `live.test.ts > pênalti no jogo (penaltis) > cobrador escolhido bate no jogo` ✓ (:1018)
- `match.test.ts > simulação de partida > todos os tipos de evento ocorrem e têm narração` ✓ (:65)
- `balance.test.ts > pênaltis no jogo (penaltis) > pênaltis por partida` ✓ (:554). O log imprime `0.348` por partida, `0.0257` por chance, conversão `0.759` e defesas `0.560`.
- `balance.test.ts > pênaltis no jogo (penaltis) > conversão do pênalti pelo cobrador e pelo goleiro` ✓ (:572). O log imprime `90x60 0.904 (1757)` e `60x90 0.594 (254)`.
- `balance.test.ts > balanceamento >` `times iguais` (:56), `forte contra fraco` (:64), `postura ofensiva cria e sofre mais finalizações` (:69), `postura defensiva sofre menos gols` (:76), `taxa de cartões` (:82) e `taxa de lesões` (:90) ✓. Também `equilíbrio financeiro > caixa equilibrado em uma temporada` ✓ (:98).
- `narration.test.ts > pênalti no jogo (penaltis) > narração do pênalti no jogo` ✓ (:51)
- `sfx.test.ts > pênalti no jogo (penaltis) > som do pênalti no jogo` ✓ (:251)
- `Squad.test.tsx > cobrador no elenco (penaltis) > seletor de pênaltis` ✓ (:728)
- `store.test.ts > cobrador na store (penaltis) > cobrador mantido na formação e na postura` ✓ (:1111)
- `rollover.test.ts > cobrador na virada (penaltis) > cobrador na virada` ✓ (:776)
- `cup.test.ts > cobrador escolhido (penaltis) > cobrador escolhido na ordem` ✓ (:561)
- `cup.test.ts > cobrador escolhido (penaltis) > cobrador escolhido abre a disputa` ✓ (:590)
- `saveFile.test.ts > cobrador no arquivo (penaltis) > cobrador no arquivo` ✓ (:418)

Nenhum filtro casou zero testes. A alternação de C4 casou exatamente os 7 testes de balanço de hoje e nenhum teste novo. No diff, todos os testes de C1-C3 e C5-C15 foram criados por 5002fa4 ou por 648ca60. O teste de C8 em `live.test.ts` foi renomeado de «10» para «11» e ficou mais estrito. Os 7 testes de C4 já existiam, e o diff de `balance.test.ts` só acrescenta linhas: nenhuma faixa mudou (`git diff d09b5c2..HEAD -- src/engine/balance.test.ts | grep "^-"` mostra só o cabeçalho).

C16 rodou uma vez com `npm run check:layout` e saiu com 0. A saída traz estas linhas:
- `ok    squad      scrollHeight 700 scrollWidth 400 · Música 267,14-320,35 · Efeitos 324,14-379,35`
- `ok    squadDesktop 1366 × 768 scrollHeight 768 scrollWidth 1366 · 2 de 2 coluna(s) com painel · nenhum texto cortado`
- `layout: as 23 telas cabem em 400 × 700 px e são legíveis em 1366 × 768 px`

Depois da saída, `netstat -ano | grep 4179 | grep LISTEN` não devolveu nada (exit 1). Durante a execução, o PID 21692 ocupava a porta, e ele não existe mais (`tasklist` não o encontra). Nenhum processo ficou escutando.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | Cada `penalty` é seguido, na posição seguinte, por exatamente uma cobrança do mesmo minuto e clube com `penalty: true` (`goal`/`shot_saved`/`shot_missed`). Nenhum outro chute do clube cai no minuto, e nenhum `penalty: true` aparece órfão. Gol de pênalti entra em `goals`. Os 3 tipos aparecem em 500 seeds | `-t "pênalti marcado e cobrado"` ✓, saída 0 | `src/engine/live.test.ts:988`: `if (e.penalty) expect(events[i - 1]?.type, …).toBe("penalty")`. `:992`: `expect(kick).toMatchObject({ minute: e.minute, clubId: e.clubId, penalty: true })`. `:993`: `expect(KICKS).toContain(kick.type)`. `:997`: `expect(shots).toEqual([kick])`. `:998`: `expect(result.goals).toContainEqual({ minute: kick.minute, clubId: kick.clubId, playerId: kick.playerId })`. `:1002`: `expect([...kinds].sort()).toEqual(["goal", "shot_missed", "shot_saved"])`. Código: `src/engine/live.ts:400-402`, `:520-532` | PASS |
| C2 | Em 2000 partidas 70×70: entre 0,2 e 0,4 pênalti por partida; taxa por chance dentro de `PENALTY_PER_CHANCE` ± 0,01; conversão entre 0,65 e 0,85; defesas ÷ perdidos dentro de `PENALTY_SAVED_SHARE` ± 0,1 | `-t "pênaltis por partida"` ✓, saída 0 | `src/engine/balance.test.ts:564-565`: `expect(perMatch).toBeGreaterThanOrEqual(0.2)` / `toBeLessThanOrEqual(0.4)`. `:566`: `expect(Math.abs(perChance - PENALTY_PER_CHANCE)).toBeLessThanOrEqual(0.01)`. `:567-568`: `conversion` entre `0.65` e `0.85`. `:569`: `expect(Math.abs(savedShare - PENALTY_SAVED_SHARE)).toBeLessThanOrEqual(0.1)` | PASS |
| C3 | A cobrança vira gol pela `penaltyChance` (AC 3). Em 4000 partidas 90×60, a conversão fica dentro de `penaltyChance(90, 60)` ± 0,06 e de `penaltyChance(60, 90)` ± 0,06 | `-t "conversão do pênalti pelo cobrador e pelo goleiro"` ✓, saída 0 | `src/engine/balance.test.ts:578`: `expect(Math.abs(strong - penaltyChance(90, 60))).toBeLessThanOrEqual(0.06)`. `:579`: `expect(Math.abs(weak - penaltyChance(60, 90))).toBeLessThanOrEqual(0.06)`. As faixas passam, mas o código passa `defStrength.gk` (`src/engine/live.ts:402`), que vale `floor(gk * 0.7 + def * 0.3)` (`live.ts:227`), e AC 3 manda `keeperStrength`. Com times de rating uniforme os dois valores são iguais, então a prova não distingue a regra do critério da que o código aplica. É um gap de precisão, e o código contradiz AC 3 | FAIL |
| C4 | As faixas de balanço de hoje passam sem mudança de limite | alternação de 7 nomes ✓ (7 testes), saída 0 | `src/engine/balance.test.ts:58-61`: `meanGoals` entre `2.3` e `3.1` e `homeWinRate` entre `0.4` e `0.52`. `:66`: `expect(r.homeWinRate).toBeGreaterThanOrEqual(0.75)`. `:72`: `expect(attacking.homeShots).toBeGreaterThanOrEqual(balanced.homeShots * 1.15)`. `:79`: `expect(defensive.homeConceded).toBeLessThanOrEqual(balanced.homeConceded * 0.85)`. `:84-87`: `yellows` 3,0-5,5 e `reds` 0,08-0,3. `:92-93`: `injuries` 0,1-0,4. `:125-126`: cada razão de caixa entre `0.5` e `2.5`. O diff não remove nenhuma linha do arquivo | PASS |
| C5 | `narrate` dá as 4 frases novas com «Azul»/«Fulano», e os 3 tipos sem pênalti mantêm a frase de hoje | `-t "narração do pênalti no jogo"` ✓, saída 0 | `src/engine/narration.test.ts:68`: `for (const [event, line] of rows) expect(narrate(event, ctx), …).toBe(line)`. A tabela tem 7 linhas: as 4 frases de AC 7 copiadas literalmente e as 3 frases antigas. Código: `src/engine/narration.ts:41-47` | PASS |
| C6 | `effectsFor`: `penalty` de qualquer lado dá `whistle-short`; gol de pênalti do usuário dá roar e jingle, do outro dá groan; defesa e pra fora dão `crowd-ooh` | `-t "som do pênalti no jogo"` ✓, saída 0 | `src/audio/sfx.test.ts:261`: `expect(effectsFor(event, "u"), …).toEqual(expected)` sobre as 6 linhas de :253-260 (`penalty` u e o, `goal` u e o, `shot_saved` u e `shot_missed` o). Código: `src/audio/sfx.ts:36` | PASS |
| C7 | Com todas as vagas `null`, `stepMatch` 1..90 em 200 seeds não grava nenhum `penalty` desse time | `-t "sem ninguém em campo não tem pênalti"` ✓, saída 0 | `src/engine/live.test.ts:1014`: `expect(m.events.filter((e) => e.type === "penalty" && e.clubId === "H"), …).toEqual([])`. Código: `src/engine/live.ts:521-522` (`if (!taker) return` antes do push) | PASS |
| C8 | `MATCH_EVENT_TYPES` tem 11 tipos, com `"penalty"`, e todos aparecem (sem `substitution` em `simulateMatch`) | `-t "todos os tipos de evento…"` e `-t "tipos de evento ocorrem e têm narração"` ✓, saída 0 | `src/engine/live.test.ts:335`: `expect(MATCH_EVENT_TYPES).toHaveLength(11)`. `:336`: `toContain("penalty")`. `:337`: `expect([...seen.keys()].sort()).toEqual([...MATCH_EVENT_TYPES].sort())`. `:338`: `size).toBe(11)`. `src/engine/match.test.ts:81`: `expect([...seen].sort()).toEqual(MATCH_EVENT_TYPES.filter((t) => t !== "substitution").sort())`. `:83`: `size).toBe(10)` | PASS |
| C9 | «Pênaltis» vem logo depois de «Treino». As opções são «Automático» e os 11 na ordem das vagas. Sem `penaltyTaker` aparece «Automático», e com um reserva também. Escolher um titular grava o id na store e no save. «Automático» tira o campo | `-t "seletor de pênaltis"` ✓, saída 0 | `src/ui/Squad.test.tsx:739`: `expect(labels.indexOf("Pênaltis")).toBe(labels.indexOf("Treino") + 1)`. `:742`: `toEqual(["Automático", ...starters.map((p) => p.name)])`. `:743`: `selectedOptions[0]!.textContent).toBe("Automático")`, só no caso do reserva (`:731-733`). `:747`, `:751`: `penaltyTaker).toBe(mf.id)` na store e no save. `:755`, `:758`: `"penaltyTaker" in …lineup).toBe(false)` nos dois. O caso «sem `penaltyTaker` → Automático» não tem assertion: o teste começa com um reserva escolhido e, depois de «Automático», só confere a store e o save, sem ler o seletor | FAIL |
| C10 | `setFormation` (para outra formação) e `setPosture` mantêm o id na store e no save | `-t "cobrador mantido na formação e na postura"` ✓, saída 0 | `src/store.test.ts:1126`: `expect(userClub(useGame.getState().game!)!.lineup!.penaltyTaker, name).toBe(taker)`. `:1128`: `expect(saved.kind === "ok" && userClub(saved.state)!.lineup!.penaltyTaker, name).toBe(taker)`. As duas rodam para «formação» e «postura». `:1130`: `formation).toBe("3-5-2")`. Código: `src/store.ts:626-629`, `:635` | PASS |
| C11 | `nextSeason` no mesmo clube mantém `penaltyTaker` | `-t "cobrador na virada"` ✓, saída 0 | `src/engine/rollover.test.ts:783`: `expect(next.userClubId).toBe(s.userClubId)`. `:784`: `expect(userOf(next).lineup!.penaltyTaker).toBe(taker)`. Código: `src/engine/rollover.ts:285` | PASS |
| C12 | O escolhido em campo vem primeiro e o resto segue a ordem automática. Nos 6 casos fora de campo vale exatamente a ordem automática. `makeSide` sem a opção não tem `penaltyTaker` | `-t "cobrador escolhido na ordem"` ✓, saída 0 | `src/engine/cup.test.ts:564`: `expect(penaltyTakers(side("H-", "H-mf70"), players)).toEqual(h(["mf70", "fw90", …, "gk"]))`. `:585`: `expect(penaltyTakers(s, players), name).toEqual(expected)` sobre os 6 casos de :577-584 (no banco, substituído, expulso, lesionado, id desconhecido, sem escolha). `:587`: `expect("penaltyTaker" in side("A-")).toBe(false)`. Código: `src/engine/live.ts:461-465` | PASS |
| C13 | Pela entrada (`startRound` → `sideFor`), o lado do usuário leva o `penaltyTaker` e nenhum lado da IA leva. O meia escolhido, que não é o primeiro da ordem automática, bate o pênalti a favor | `-t "cobrador escolhido bate no jogo"` ✓, saída 0 | `src/engine/live.test.ts:1031`: `expect(side.penaltyTaker).toBe(side.clubId === club.id ? mf : undefined)`. `:1034`: `expect(auto).not.toBe(mf)`. `:1039`: `expect(m.events[i + 1]!.playerId, …).toBe(mf)`. `:1043`: `expect(checked).toBeGreaterThan(0)`. Código: `src/engine/live.ts:590` | PASS |
| C14 | Na disputa com `H-mf70` em campo, o 1º chute do mandante é dele e os 9 seguintes seguem a ordem automática sem ele | `-t "cobrador escolhido abre a disputa"` ✓, saída 0 | `src/engine/cup.test.ts:602`: `expect(found).not.toBeNull()`. `:604`: `expect(takers.slice(0, 10)).toEqual(h(["mf70", "fw90", "fw80", "fw75", "mf78", "mf65", "df72", "df68", "df60", "df55"]))` | PASS |
| C15 | `decodeSaveFile`: `penaltyTaker` ausente e `"qualquer-id"` dão `ok` com o mesmo jogo; `7`, `null` e `{}` dão `malformed` | `-t "cobrador no arquivo"` ✓, saída 0 | `src/engine/saveFile.test.ts:422-423`: `"penaltyTaker" in lineup` é `false` e `toEqual({ kind: "ok", state: g })`. `:430`: `toEqual({ kind: "ok", state: text })`. `:431`: `for (const bad of [7, null, {}]) expect(decodeSaveFile(envelope(withTaker(bad))), …).toEqual({ kind: "malformed" })`. O clube editado, `clubs[0]`, é o do usuário (`withClub`, `saveFile.test.ts:16-17`). Código: `src/engine/saveFile.ts:73` | PASS |
| C16 | `npm run check:layout` sai com 0 e mede `squad` e `squadDesktop` já com o seletor | `npm run check:layout`, saída 0 | Saída do script: `ok    squad      scrollHeight 700 scrollWidth 400 …` e `ok    squadDesktop 1366 × 768 … nenhum texto cortado` (medidas em `scripts/layout-check.mjs:436`). O seletor está sempre na tela Elenco quando há escalação (`src/ui/Squad.tsx:186-196`) | PASS |

Nível e amostragem:

- C1, C2, C3 e C7 provam o motor direto (`simulateMatch`/`stepMatch`), que é o nível do claim. C13 prova pela entrada (`startRound`), como pede L-003, e C9 prova pela tela renderizada lendo o save por `loadGame`.
- C3: o time de rating 60 teve só 254 pênaltis. O desvio padrão da conversão fica em torno de 0,03, então a faixa de ± 0,06 dá cerca de 2 desvios. As seeds são fixas e o resultado é determinístico (0,594), mas a faixa diz pouco sobre a regra de AC 3. O defeito principal está na linha de C3 da tabela.
- C12: a tabela cobre os 6 motivos nomeados no claim e os 3 itens do claim. «Vendido» (AC 16) cai em «id desconhecido», que é o mesmo caminho de `penaltyTakers` (só olha `onPitch`).
- C9: dos dois casos de exibição de «Automático» do claim, só o do reserva está provado. Veja a linha C9 da tabela.

## Critérios do plano contra o código (AC 1-20)

| AC | Código | Check | Situação |
| --- | --- | --- | --- |
| 1 | `live.ts:400-402`, `:523` (o `penalty` é gravado antes da cobrança) | C1, C2 | ok |
| 2 | `live.ts:524-531`: uma cobrança só, e o `goal` soma no placar e em `goals` | C1 | ok |
| 3 | `live.ts:525`: `penaltyChance(ownEffective(attacker, taker, players), keeper)` com `keeper = defStrength.gk` (`:402`), ou seja `max(20, 0,7 × keeperStrength + 0,3 × def)` (`:227`) | C3 | **contradiz**: AC 3 nomeia `keeperStrength`. Exemplo: com goleiro 50 e defesa 80, `keeperStrength` = 50 e `Strength.gk` = 59, e um cobrador de 70 converte 0,85 pelo critério contra 0,805 pelo código. A docstring de `inPlayPenalty` (`live.ts:517-518`) também diz `keeperStrength` |
| 4 | `live.ts:531` | C2 | ok |
| 5 | medido em 0,348 por partida e 0,759 de conversão | C2 | ok |
| 6 | as faixas não mudaram | C4 | ok |
| 7 | `narration.ts:41-47` | C5 | ok |
| 8 | `sfx.ts:36`. As cobranças seguem o caso do próprio tipo | C6 | ok |
| 9 | `live.ts:521-522` | C7 | ok |
| 10 | `Squad.tsx:102`, `:186-196` (seletor em :188) | C9, C16 | ok |
| 11 | `Squad.tsx:103` | C9 | caso «ausente» sem assertion (C9) |
| 12 | `store.ts:642-651` | C9 | ok na escolha. Mas `assignStarter` também tira o campo (veja abaixo), e AC 12 diz que só a escolha de «Automático» o remove |
| 13 | `store.ts:626-629` (formação), `:635` (postura, faz spread da `lineup`) | C10 | ok |
| 14 | `rollover.ts:285` | C11 | ok |
| 15 | `live.ts:461`, `:590` | C12, C13 | ok enquanto o campo existe, mas `assignStarter` o apaga (veja abaixo) |
| 16 | `live.ts:461-465` (`onPitch`) | C12 | ok |
| 17 | `live.ts:502` (a disputa usa `penaltyTakers`) | C14 | ok |
| 18 | `live.ts:590` (`isUser ? … : undefined`) | C12, C13 | ok |
| 19 | `saveFile.ts:73` | C15 | ok |
| 20 | layout | C16 | ok |

**`assignStarter` apaga o cobrador.** `store.assignStarter` (`src/store.ts:653-660`) grava o que `assignSlot` devolve, e `assignSlot` monta uma `Lineup` nova só com `{ formation, starters, posture }` (`src/engine/lineup.ts:101`). Quando o usuário troca qualquer titular pelo seletor «Titular N» do Elenco (`src/ui/Squad.tsx:226`), o `penaltyTaker` some, e o seletor volta a «Automático» sem que o usuário tenha escolhido isso. Isso vale também quando o cobrador continua em campo.

Isso contradiz três pontos do plano:
- a regra do door 1 em `Relations`: o id não precisa ser de titular, e fora de campo vale a ordem automática. O campo deveria persistir;
- AC 12, que só remove o campo na escolha de «Automático»;
- na prática, AC 15.

O conjunto «caminhos da escalação que mantêm o cobrador (3)» lista formação, postura e virada e deixa de fora o quarto caminho que reescreve a `Lineup` do usuário. Os outros caminhos conferidos mantêm o campo: `market.ts:146` e `rollover.ts:149` fazem spread da `lineup`. `career.ts:142` e `store.ts:611` trocam de clube ou começam jogo novo, onde perder o campo é o esperado.

## Superseded checks of earlier features

Li o diff de cc9a210 e a mudança de `snapshot-v6.json` em 5002fa4, linha por linha da tabela:

| Linha | O que mudou de fato | Assertion afrouxada? |
| --- | --- | --- |
| partida-ao-vivo C46 / correcoes-validacao C61 | `live.test.ts:316` virou «11 tipos». `:335` passou de `toHaveLength(10)` para `11`, e `:336` (`toContain("penalty")`) é novo. `:338` passou de `size 10` para `11`. `match.test.ts:83` passou de `9` para `10` | não. Ficou mais estrito |
| paises C8 (snapshot v6) | Conferi com Python: só a chave `results` dos 3 seeds mudou (`serieA`, `serieB`, `market` e `rngState` estão idênticos), e 119 das 120 partidas mudaram. A assertion `live.test.ts:451` (`toEqual(snapshot[seed]!.results)`) ficou igual | não. É um golden master regenerado: ele passa a registrar a saída do motor novo, como esperado |
| carreira-dinamica C9 | `career.test.ts:181`: `atRound(3, 13)` virou `atRound(27, 13)`. As metas `toBe(16)` e `toBe(12)` (:199-200) e o resto ficaram iguais | não |
| copa-nacional C63 | `migrate.test.ts:338-345`: o oráculo do replay passou de `aiLineup(club)`/`isAvailable` para `aiLineup(club, competition)`/`isAvailableFor(…, competition)`. Isso vai além de trocar seed ou índice, mas a linha da tabela declara a mudança. As assertions `:358-359` (`toEqual` e `not.toEqual`) ficaram iguais. A migração joga a copa por `catchUpPhase`, que segue `cupLive` e `sideFor` com a competição da copa (`cup.ts:235-239`), então o oráculo ficou mais fiel ao caminho real | não |
| copa-nacional C49 | `Cup.test.tsx:85`: acrescenta um clique na aba da copa nacional antes das mesmas duas assertions | não |
| nucleo-liga-partida C34 | `End.test.tsx:20`: o clube 1 virou o clube 2, com a pré-condição nova `expect(game.pendingJob).toBeUndefined()`. `getByText(…)`, que exigia exatamente 1, virou `getAllByText(…).toHaveLength(1 + cupTitles)`, com `cupTitles` tirado do estado e contado como no teste ao lado (`End.test.tsx:79-80`) | não. O valor esperado continua exato |
| ajustes-audio C5, C6 | `Live.test.tsx`: a seed 182 virou a 27. A pré-condição `userGoalAt90` (:424) e as assertions ficaram iguais | não |
| ajustes-audio C9 | `ties[9]` virou `ties[3]`. As assertions `≥ 10` cobranças (:475), a ordem dos sons (:479) e o jingle conforme o placar (:481) ficaram iguais. O comentário «7 x 6» nunca foi uma assertion | não |
| audio C26 / partida-ao-vivo C9 | `startLive(8)` e `seededGame(8)` viraram 2 | não |
| copa-continental C11 | `clubs[0]` virou `clubs[2]`. As assertions ficaram iguais | não |

Nenhuma assertion foi enfraquecida nem apagada. Há um ponto de documentação: a coluna «Now proven by» diz «C1» em linhas que C1 não prova, como a carreira, a tela Fim e o som ao vivo. Essas linhas continuam provadas pelos próprios testes, que passaram no gate completo.

## Coverage

O profile light não recalcula a Coverage, e as linhas abaixo vêm de checks.md. Fiz uma conferência de leitura de cada membro contra as tabelas dos testes citados acima, e duas linhas ganham membros sem prova:

| Set (size) | Recomputed from | Member -> proof | Unproven |
| --- | --- | --- | --- |
| tipos de cobrança (3) | carried from checks.md | C1 (`live.test.ts:1002`) | - |
| linhas de narração novas (4) | carried from checks.md | C5 (`narration.test.ts:59-67`) | - |
| sons (4) | carried from checks.md | C6 (`sfx.test.ts:253-260`) | - |
| faixas de balanço novas (5) | carried from checks.md | C2 (`balance.test.ts:564-569`) · C3 (`:578-579`) | conversão pela regra de AC 3 (`keeperStrength`): fixture uniforme não distingue, código usa `Strength.gk` |
| faixas de balanço de hoje (7 testes) | carried from checks.md | C4 (7 testes ✓) | - |
| cobrador fora de campo (6) | carried from checks.md | C12 (`cup.test.ts:577-585`) | - |
| quem bate (3 lugares) | carried from checks.md | C12 · C13 · C14 | - |
| caminhos da escalação do usuário que reescrevem a `Lineup` (4, lido em `store.ts` e `rollover.ts`) | código: `setFormation`, `setPosture`, `nextSeason`, `assignStarter` | formação C10 · postura C10 · virada C11 | `assignStarter` (`store.ts:657` via `lineup.ts:101`) apaga o cobrador |
| valores do seletor (2) / exibição de «Automático» (2) | carried from checks.md | titular C9 (`Squad.test.tsx:748`) · reserva → Automático C9 (`:743`) | ausente → «Automático» sem assertion |
| `penaltyTaker` na importação (5) | carried from checks.md | C15 (`saveFile.test.ts:423`, `:430`, `:431`) | - |
| tamanhos de tela (2) | carried from checks.md | C16 (`squad`, `squadDesktop`) | - |
| doors (2) | carried from checks.md | door 1 C9, C15 · door 2 C1, C8 | - |

## Swept existing

Nenhuma linha do `## Swept` de checks.md resolve para `existing`. Todas apontam para um check (C15, C7, C12, C11, C1) ou dizem `n/a`, e as `n/a` são política aprovada, sem nada a conferir no código.

A linha «data lifecycle» cita só a virada e o cobrador vendido. Ela não cobre a troca de titular, que apaga o campo (veja a seção de critérios).

## Convenções (AD-002, AGENTS.md)

- `src/engine/**` não importa React, DOM, zustand nem idb. Os imports que não são relativos se resumem a `node:fs`, e só em testes (`generate.test.ts`, `live.test.ts`, `migrate.test.ts`). As buscas por `document.`, `window.`, `localStorage` e `indexedDB` em `src/engine` só acham comentários («stored document», «save document») e um texto de teste.
- `Math.random` só aparece em `src/deps.test.ts`, que é o próprio teste que proíbe o uso. Nada no diff.
- O diff não traz «Brasfoot» nem `Math.random`.

## Gate

- Provas: a invocação única acima saiu 0, com `Test Files 10 passed (10)` e `Tests 22 passed | 216 skipped (238)`.
- Suíte completa: `npx vitest run` saiu 0, com `Test Files 54 passed (54)` e `Tests 720 passed (720)`.
- Layout: `npm run check:layout` saiu 0, com `as 23 telas cabem em 400 × 700 px e são legíveis em 1366 × 768 px`. A porta 4179 ficou livre depois (nenhum LISTENING).
- Fault injection: nenhuma, porque o profile é light.

## Ranked gaps

1. O código contradiz AC 3. A cobrança usa `defStrength.gk` (`max(20, 0,7 × keeperStrength + 0,3 × def)`) no lugar de `keeperStrength`, e a prova de C3 usa times uniformes, onde os dois coincidem. **C3**: `src/engine/live.ts:402`, `src/engine/live.ts:227`, `src/engine/balance.test.ts:578-579`.
2. `assignStarter` apaga `lineup.penaltyTaker`: trocar qualquer titular volta o cobrador a «Automático», contra AC 12, AC 15 e a regra do door 1. O caminho falta no conjunto de C10/C11. **C10/C11 (conjunto)**: `src/engine/lineup.ts:101`, `src/store.ts:657`.
3. C9 afirma «sem `penaltyTaker` → Automático» sem assertion, porque o teste só exibe o caso do reserva. **C9**: `src/ui/Squad.test.tsx:731-743`.
4. Ponto fraco, sem FAIL: em C3, o time de 60 tem só 254 pênaltis, e a faixa de ± 0,06 dá cerca de 2 desvios padrão. **C3**: `src/engine/balance.test.ts:579`.
5. Ponto fraco, de documentação: a coluna «Now proven by» das superseded diz «C1» em linhas que C1 não prova. Nenhuma assertion foi afrouxada. **checks.md** `## Superseded checks of earlier features`.
