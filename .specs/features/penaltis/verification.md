# Pênaltis durante o jogo e cobrador verification

**Verdict**: PASS
**Profile**: light
**Diff range**: d09b5c2..fd96e98
**Round**: 2 - scoped
**Verifier**: independent sub-agent (author != verifier)

Resumo: os 18 checks estão provados na HEAD fd96e98. Rodei de novo todas as provas C1-C15, C17 e C18 numa só invocação do vitest, e cada teste nomeado aparece individualmente com ✓. C16 vem do round 1 (`carried from 909b492`), porque o fix não toca nenhuma tela. Os três achados que reprovaram o round 1 estão resolvidos no código e cada um tem uma assertion localizada:

1. A cobrança agora usa `keeperStrength`, e C17 separa o goleiro da defesa.
2. `assignStarter` mantém o cobrador, e C18 prova isso.
3. C9 confere «sem cobrador → Automático».

A varredura de outros caminhos que reescrevem a `Lineup` do usuário não achou nenhum que apague o cobrador fora da troca de clube ou do jogo novo.

O profile é light: não houve fault injection, e a Coverage foi carregada de checks.md e conferida por leitura, sem recálculo obrigatório.

## Binding sources

Carried from 909b492. O plano não marca nenhuma fonte binding além dele mesmo, e o step 1 só roda no profile `ui`. O fix também não toca a interface: `src/ui/Squad.tsx` não está no diff 909b492..fd96e98.

## Checks

Verified at fd96e98, exceto C16 (`carried from 909b492`). Uma só invocação:

`npx vitest run src/engine/live.test.ts src/engine/balance.test.ts src/engine/narration.test.ts src/audio/sfx.test.ts src/engine/match.test.ts src/ui/Squad.test.tsx src/store.test.ts src/engine/rollover.test.ts src/engine/cup.test.ts src/engine/saveFile.test.ts -t "pênalti marcado e cobrado|sem ninguém em campo não tem pênalti|tipos de evento ocorrem e têm narração|cobrador escolhido bate no jogo|pênaltis por partida|conversão do pênalti pelo cobrador e pelo goleiro|times iguais|forte contra fraco|postura ofensiva|postura defensiva|taxa de cartões|taxa de lesões|caixa equilibrado|narração do pênalti no jogo|som do pênalti no jogo|seletor de pênaltis|cobrador mantido na formação e na postura|cobrador na virada|cobrador escolhido na ordem|cobrador escolhido abre a disputa|cobrador no arquivo|pênalti contra o goleiro, não contra a defesa|cobrador mantido na troca de titular" --reporter=verbose --silent=false`

A invocação saiu com 0: `Test Files 10 passed (10)` e `Tests 24 passed | 216 skipped (240)`. São os 22 testes do round 1 mais os 2 novos, e nenhum filtro casou zero. Cada teste aparece com ✓:

- `live.test.ts > rodada ao vivo (engine) > todos os 11 tipos de evento ocorrem e têm narração` ✓ (:316)
- `live.test.ts > pênalti no jogo (penaltis) > pênalti marcado e cobrado` ✓ (:981)
- `live.test.ts > pênalti no jogo (penaltis) > sem ninguém em campo não tem pênalti` ✓ (:1005)
- `live.test.ts > pênalti no jogo (penaltis) > cobrador escolhido bate no jogo` ✓ (:1018)
- `live.test.ts > pênalti contra o goleiro (penaltis round 2) > pênalti contra o goleiro, não contra a defesa` ✓ (:1048), novo
- `match.test.ts > simulação de partida > todos os tipos de evento ocorrem e têm narração` ✓
- `balance.test.ts > pênaltis no jogo (penaltis) > pênaltis por partida` ✓ (:554). O log imprime `C2 pênaltis/partida 0.348 por chance 0.0257 conversão 0.759 defesas 0.560`.
- `balance.test.ts > pênaltis no jogo (penaltis) > conversão do pênalti pelo cobrador e pelo goleiro` ✓ (:572). O log imprime `C3 conversão 90x60 0.903 (1757) 60x90 0.594 (254)`.
- `balance.test.ts > balanceamento >`: `times iguais`, `forte contra fraco`, `postura ofensiva cria e sofre mais finalizações`, `postura defensiva sofre menos gols`, `taxa de cartões` e `taxa de lesões` ✓. Também `equilíbrio financeiro > caixa equilibrado em uma temporada` ✓, com o log `C34 uma temporada: 0.97 / 1.51 / 2.23`.
- `narration.test.ts > pênalti no jogo (penaltis) > narração do pênalti no jogo` ✓
- `sfx.test.ts > pênalti no jogo (penaltis) > som do pênalti no jogo` ✓
- `Squad.test.tsx > cobrador no elenco (penaltis) > seletor de pênaltis` ✓ (:728)
- `store.test.ts > cobrador na store (penaltis) > cobrador mantido na formação e na postura` ✓ (:1111)
- `store.test.ts > cobrador na troca de titular (penaltis round 2) > cobrador mantido na troca de titular` ✓ (:1135), novo
- `rollover.test.ts > cobrador na virada (penaltis) > cobrador na virada` ✓
- `cup.test.ts > cobrador escolhido (penaltis) > cobrador escolhido na ordem` ✓
- `cup.test.ts > cobrador escolhido (penaltis) > cobrador escolhido abre a disputa` ✓
- `saveFile.test.ts > cobrador no arquivo (penaltis) > cobrador no arquivo` ✓

Também rodei `npx vitest run src/engine/balance.test.ts -t "pênaltis por partida|conversão do pênalti" --silent=false`, que saiu com 0 (`Tests 2 passed | 22 skipped (24)`) e imprime os mesmos números.

Os números de balanço continuam nas faixas:

- C2: 0,348 está em [0,2; 0,4]. |0,0257 − 0,025| = 0,0007 ≤ 0,01. 0,759 está em [0,65; 0,85]. |0,560 − 0,6| = 0,04 ≤ 0,1.
- C3: |0,903 − 0,90| = 0,003 e |0,594 − 0,60| = 0,006, os dois ≤ 0,06.

Em relação ao round 1, C2 não mudou. Em C3, 90×60 passou de 0,904 para 0,903, com a mesma contagem de pênaltis (1757 e 254). Isso é o esperado: a troca para `keeperStrength` só muda a probabilidade da cobrança, não o número de sorteios.

As citações dos arquivos que o fix tocou (`live.ts`, `live.test.ts`, `store.ts`, `store.test.ts`, `Squad.test.tsx`) foram relidas em fd96e98. Os outros arquivos de teste (`balance`, `narration`, `sfx`, `match`, `rollover`, `cup`, `saveFile`) não estão no diff 909b492..fd96e98, então as linhas do round 1 continuam valendo e estão marcadas `carried from 909b492`. As linhas de `balance.test.ts` foram conferidas de novo (:554, :572, :578, :579).

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | Cada `penalty` é seguido por exatamente uma cobrança do mesmo minuto e clube com `penalty: true`. Não há órfão. O gol de pênalti entra em `goals`. Os 3 tipos aparecem | `-t "pênalti marcado e cobrado"` ✓, saída 0 | Verified at fd96e98, e as linhas de `live.test.ts` não se moveram antes de :1044. `src/engine/live.test.ts:988`: `if (e.penalty) expect(events[i - 1]?.type, …).toBe("penalty")`. `:992`: `toMatchObject({ minute: e.minute, clubId: e.clubId, penalty: true })`. `:997`: `expect(shots).toEqual([kick])`. `:998`: `result.goals).toContainEqual(…)`. `:1002`: `toEqual(["goal", "shot_missed", "shot_saved"])`. Código: `src/engine/live.ts:400-404`, `:520-533` | PASS |
| C2 | Em 2000 partidas 70×70: 0,2-0,4 pênalti por partida; taxa por chance em `PENALTY_PER_CHANCE` ± 0,01; conversão 0,65-0,85; defesas ÷ perdidos em `PENALTY_SAVED_SHARE` ± 0,1 | `-t "pênaltis por partida"` ✓, saída 0. Log: 0.348 / 0.0257 / 0.759 / 0.560 | Carried from 909b492 (arquivo fora do diff). `src/engine/balance.test.ts:564-565`: `perMatch` ≥ 0.2 e ≤ 0.4. `:566`: `Math.abs(perChance - PENALTY_PER_CHANCE)).toBeLessThanOrEqual(0.01)`. `:567-568`: `conversion` entre 0.65 e 0.85. `:569`: `Math.abs(savedShare - PENALTY_SAVED_SHARE)).toBeLessThanOrEqual(0.1)` | PASS |
| C3 | A cobrança vira gol pela `penaltyChance` (AC 3). Em 4000 partidas, 90×60 fica em `penaltyChance(90, 60)` ± 0,06 e 60×90 em `penaltyChance(60, 90)` ± 0,06 | `-t "conversão do pênalti pelo cobrador e pelo goleiro"` ✓, saída 0. Log: 0.903 (1757) e 0.594 (254) | Re-julgado em fd96e98. `src/engine/balance.test.ts:578`: `expect(Math.abs(strong - penaltyChance(90, 60))).toBeLessThanOrEqual(0.06)`. `:579`: `expect(Math.abs(weak - penaltyChance(60, 90))).toBeLessThanOrEqual(0.06)`. O código agora passa `keeperStrength(defender, players)` (`src/engine/live.ts:403`), que é o valor nomeado por AC 3. Antes passava `defStrength.gk`. A docstring `live.ts:519` concorda. A fraqueza do round 1 (times uniformes não distinguem goleiro de defesa) agora é coberta por C17, que fixa a regra com goleiro ≠ defesa. Fica um ponto fraco: só 254 pênaltis no lado 60 | PASS |
| C4 | As faixas de balanço de hoje passam sem mudança de limite | alternação de 7 nomes ✓ (7 testes), saída 0 | Carried from 909b492 (arquivo fora do diff 909b492..fd96e98). `src/engine/balance.test.ts:58-61`: `meanGoals` 2.3-3.1 e `homeWinRate` 0.4-0.52. `:66`: `homeWinRate` ≥ 0.75. `:72`: `homeShots` ≥ ×1.15. `:79`: `homeConceded` ≤ ×0.85. `:84-87`: cartões. `:92-93`: lesões. `:125-126`: caixa 0.5-2.5 | PASS |
| C5 | `narrate` dá as 4 frases novas com «Azul»/«Fulano», e os 3 tipos sem pênalti mantêm a frase de hoje | `-t "narração do pênalti no jogo"` ✓, saída 0 | Carried from 909b492. `src/engine/narration.test.ts:68`: `for (const [event, line] of rows) expect(narrate(event, ctx), …).toBe(line)` sobre 7 linhas. Código: `src/engine/narration.ts:41-47` | PASS |
| C6 | `effectsFor`: `penalty` → `whistle-short`. Gol de pênalti do usuário → roar e jingle; do outro → groan. Defesa e pra fora → `crowd-ooh` | `-t "som do pênalti no jogo"` ✓, saída 0 | Carried from 909b492. `src/audio/sfx.test.ts:261`: `expect(effectsFor(event, "u"), …).toEqual(expected)` sobre as 6 linhas de :253-260. Código: `src/audio/sfx.ts:36` | PASS |
| C7 | Com todas as vagas `null`, `stepMatch` 1..90 em 200 seeds não grava `penalty` desse time | `-t "sem ninguém em campo não tem pênalti"` ✓, saída 0 | Verified at fd96e98. `src/engine/live.test.ts:1014`: `expect(m.events.filter((e) => e.type === "penalty" && e.clubId === "H"), …).toEqual([])`. Código: `src/engine/live.ts:522-523` (`if (!taker) return` antes do push) | PASS |
| C8 | `MATCH_EVENT_TYPES` tem 11 tipos, com `"penalty"`, e todos aparecem (sem `substitution` em `simulateMatch`) | `-t "…tipos de evento ocorrem e têm narração"` ✓ nos dois arquivos, saída 0 | Verified at fd96e98. `src/engine/live.test.ts:335`: `toHaveLength(11)`. `:336`: `toContain("penalty")`. `:337`: `expect([...seen.keys()].sort()).toEqual([...MATCH_EVENT_TYPES].sort())`. `:338`: `size).toBe(11)`. `src/engine/match.test.ts:81`, `:83` (`size).toBe(10)`), carried from 909b492 | PASS |
| C9 | «Pênaltis» vem logo depois de «Treino». As opções são «Automático» e os 11 na ordem das vagas. Sem `penaltyTaker` → «Automático», e com um reserva também. O titular escolhido vai para a store e o save. «Automático» tira o campo | `-t "seletor de pênaltis"` ✓, saída 0 | Re-julgado em fd96e98. O caso «ausente» agora tem assertion: `src/ui/Squad.test.tsx:735` (pré-condição `expect("penaltyTaker" in me.lineup!).toBe(false)`) e `:738` (`expect((screen.getByLabelText("Pênaltis") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("Automático")`). O caso do reserva está em `:749`. `:745`: `labels.indexOf("Pênaltis")).toBe(labels.indexOf("Treino") + 1)`. `:748`: `toEqual(["Automático", ...starters.map((p) => p.name)])`. `:753`, `:757`: `penaltyTaker).toBe(mf.id)` na store e no save. `:761`, `:764`: `"penaltyTaker" in …lineup).toBe(false)` nos dois. Código: `src/ui/Squad.tsx:103` | PASS |
| C10 | `setFormation` (para outra formação) e `setPosture` mantêm o id na store e no save | `-t "cobrador mantido na formação e na postura"` ✓, saída 0 | Verified at fd96e98. `src/store.test.ts:1126`: `lineup!.penaltyTaker, name).toBe(taker)`. `:1128`: o mesmo no save, para «formação» e para «postura». `:1130`: `formation).toBe("3-5-2")`. Código: `src/store.ts:628-629`, `:635` | PASS |
| C11 | `nextSeason` no mesmo clube mantém `penaltyTaker` | `-t "cobrador na virada"` ✓, saída 0 | Carried from 909b492. `src/engine/rollover.test.ts:783`: `expect(next.userClubId).toBe(s.userClubId)`. `:784`: `lineup!.penaltyTaker).toBe(taker)`. Código: `src/engine/rollover.ts:285` | PASS |
| C12 | O escolhido em campo vem primeiro, seguido da ordem automática. Nos 6 casos fora de campo vale a ordem automática. `makeSide` sem a opção não tem o campo | `-t "cobrador escolhido na ordem"` ✓, saída 0 | Carried from 909b492. `src/engine/cup.test.ts:564`: `toEqual(h(["mf70", "fw90", …, "gk"]))`. `:585`: `expect(penaltyTakers(s, players), name).toEqual(expected)` sobre os 6 casos de :577-584. `:587`: `expect("penaltyTaker" in side("A-")).toBe(false)`. Código: `src/engine/live.ts:460-465` | PASS |
| C13 | Pela entrada (`startRound` → `sideFor`), o usuário leva o `penaltyTaker` e a IA não. O meia escolhido bate o pênalti a favor | `-t "cobrador escolhido bate no jogo"` ✓, saída 0 | Verified at fd96e98. `src/engine/live.test.ts:1031`: `expect(side.penaltyTaker).toBe(side.clubId === club.id ? mf : undefined)`. `:1034`: `expect(auto).not.toBe(mf)`. `:1039`: `m.events[i + 1]!.playerId, …).toBe(mf)`. `:1043`: `expect(checked).toBeGreaterThan(0)`. Código: `src/engine/live.ts:591` | PASS |
| C14 | Na disputa com `H-mf70` em campo, o 1º chute do mandante é dele, e os 9 seguintes seguem a ordem automática | `-t "cobrador escolhido abre a disputa"` ✓, saída 0 | Carried from 909b492. `src/engine/cup.test.ts:602`: `expect(found).not.toBeNull()`. `:604`: `expect(takers.slice(0, 10)).toEqual(h(["mf70", "fw90", …, "df55"]))` | PASS |
| C15 | `decodeSaveFile`: ausente e `"qualquer-id"` → `ok`; `7`, `null` e `{}` → `malformed` | `-t "cobrador no arquivo"` ✓, saída 0 | Carried from 909b492. `src/engine/saveFile.test.ts:422-423`, `:430`: `toEqual({ kind: "ok", … })`. `:431`: `for (const bad of [7, null, {}]) … .toEqual({ kind: "malformed" })`. Código: `src/engine/saveFile.ts:73` | PASS |
| C16 | `npm run check:layout` sai com 0 e mede `squad` e `squadDesktop` já com o seletor | carried from 909b492: `npm run check:layout`, saída 0 | Carried from 909b492. Nenhuma tela, nenhum CSS e nenhum script de layout estão no diff 909b492..fd96e98, que toca só `live.ts`, `store.ts`, três arquivos de teste e `.specs`. Saída do round 1: `ok    squad      scrollHeight 700 scrollWidth 400 …`, `ok    squadDesktop 1366 × 768 … nenhum texto cortado` (`scripts/layout-check.mjs:436`) | PASS |
| C17 | Goleiro 50 atrás de defesa 80, cobrador 70, sorteios fixados: 0,83 e 0,849 → `goal` e 0,851 → `shot_missed`. A cobrança é contra `keeperStrength` = 50 (0,85), não contra a força mista 59 (0,805) (AC 3) | `-t "pênalti contra o goleiro, não contra a defesa"` ✓, saída 0 | Verified at fd96e98. `src/engine/live.test.ts:1057`: `expect(keeperStrength(side("A", away), players)).toBe(50)`. `:1058-1062`: a tabela `[0.83, "goal"]`, `[0.849, "goal"]`, `[0.851, "shot_missed"]`. `:1068`: `expect(m.events.map((e) => e.type), String(roll)).toEqual(["kickoff", "penalty", type])`. `:1069`: `toMatchObject({ clubId: "H", penalty: true })`. O sorteio 0,83 separa as duas regras: ele fica acima de 0,805 (a regra antiga daria `shot_missed`) e abaixo de 0,85. Os sorteios 0,849 e 0,851 prendem a probabilidade em (0,849; 0,851], ou seja, `penaltyChance(70, 50)` = 0,85 | PASS |
| C18 | Com `penaltyTaker` definido, `assignStarter` de um reserva na vaga de outro titular mantém o id na store e no save (AC 12, AC 13) | `-t "cobrador mantido na troca de titular"` ✓, saída 0 | Verified at fd96e98. `src/store.test.ts:1146`: pré-condição `expect(me.lineup!.starters[slot]).not.toBe(taker)`. `:1149`: `expect(after.starters[slot]).toBe(bench.id)`, que confirma que a troca aconteceu. `:1150`: `expect(after.penaltyTaker).toBe(taker)`. `:1152`: `expect(saved.kind === "ok" && userClub(saved.state)!.lineup!.penaltyTaker).toBe(taker)`. Código: `src/store.ts:659-660` | PASS |

Nível e amostragem:

- C17 prova o motor direto (`stepMatch`), que é o nível de AC 3, com sorteios roteirizados. Ele dispensa a amostragem: em vez de uma taxa com faixa, prende o limiar exato da probabilidade.
- C18 prova pela store, que é o caminho da tela «Titular N» (`Squad.tsx` chama `assignStarter`), e lê o save por `loadGame`. É o mesmo nível de C10.
- C3 continua com 254 pênaltis no lado 60, com desvio padrão em torno de 0,03, e a faixa de ± 0,06 dá cerca de 2 desvios. Com C17 prendendo a regra de AC 3, isso deixa de ser um gap de precisão e fica só como ponto fraco de amostragem.
- Light não faz fault injection, então não confirmei por mutação que C17 e C18 falhariam no código do round 1. Pela leitura, os dois falhariam: no round 1, `live.ts:402` passava `defStrength.gk` = max(20, 0,7 × 50 + 0,3 × 80) = 59, o que dá 0,805 e falharia o caso 0,83 em `live.test.ts:1068`. E `assignSlot` monta a `Lineup` sem o campo (`src/engine/lineup.ts:101`), o que falharia `store.test.ts:1150`.

## Critérios afetados pelo fix (AC 3, 11, 12, 13, 15)

Verified at fd96e98. Os outros ACs vêm do round 1 (`carried from 909b492`), porque os arquivos que os implementam não estão no diff.

| AC | Código | Check | Situação |
| --- | --- | --- | --- |
| 3 | `src/engine/live.ts:403`: `inPlayPenalty(…, keeperStrength(defender, players), …)`, com `defender` = o lado sem a bola (`live.ts:392`). `keeperStrength` (`live.ts:196-203`) é o goleiro da vaga GK, ou o melhor de linha × 0,75 sem goleiro. Os chutes de jogo aberto continuam contra `defStrength.gk` (`live.ts:408`), o que está fora de AC 3 | C3, C17 | ok, a contradição do round 1 foi resolvida |
| 11 | `src/ui/Squad.tsx:103` | C9 (`Squad.test.tsx:738`, `:749`) | ok, os dois casos de «Automático» têm assertion |
| 12, 13, 15 | `src/store.ts:659-660`: `assignStarter` copia `club.lineup?.penaltyTaker` para a `Lineup` que `assignSlot` devolve. Quando o cobrador é tirado da vaga, o id continua e vale a ordem automática (AC 16, door 1). O seletor mostra «Automático» porque o id não é de titular (`Squad.tsx:103`) | C18 | ok, só «Automático» (`store.ts:642-648`) remove o campo |

### Outros caminhos que reescrevem a `Lineup` do usuário (AC 12)

Busca: `grep -nE "lineup\s*[:=][^=]|\.lineup\s*=[^=]|lineup:\s"` em `src/store.ts` e `src/engine/*.ts`, sem testes. Depois, `grep -rn "starters:\|formation:\|editUserClub("` em `src`. Cada escrita encontrada:

| Escrita | Clube | Cobrador |
| --- | --- | --- |
| `src/store.ts:611` (`chooseClub`) | o clube escolhido no jogo novo | some, o que é legítimo: não havia escolha antes |
| `src/store.ts:626-629` (`setFormation`) | o do usuário | mantido (C10) |
| `src/store.ts:635` (`setPosture`, spread) | o do usuário | mantido (C10) |
| `src/store.ts:642-648` (`setPenaltyTaker`) | o do usuário | é a escolha. Só «Automático» remove o campo (C9) |
| `src/store.ts:655-660` (`assignStarter`) | o do usuário | mantido (C18) |
| `src/engine/career.ts:115` (`leaveClub`) | o clube que o usuário deixa | `lineup = null`, o que é legítimo: o clube passa para a IA |
| `src/engine/career.ts:142` (`takeJob`) | o clube novo | some, o que é legítimo: o usuário trocou de clube |
| `src/engine/rollover.ts:281` + `:285` (`nextSeason`) | o do usuário | mantido sem troca de clube (C11). Com `moved`, some, o que é legítimo |
| `src/engine/rollover.ts:149` (spread) | os que saem na virada | mantido pelo spread, e de todo modo sobrescrito por `:281`/`:285` |
| `src/engine/market.ts:146` (spread, venda) | quem vende | mantido pelo spread. Se o vendido era o cobrador, vale AC 16 (id desconhecido → automático, C12) |
| `src/engine/migrate.ts:33` (spread) | todos, na migração de saves antigos | mantido pelo spread. Saves antigos não têm o campo |

Nenhum caminho que sobrou apaga `penaltyTaker` no clube do usuário fora da troca de clube ou do jogo novo. A `Lineup` do usuário só é reconstruída sem spread por `autoLineup` (formação, jogo novo, `takeJob`, virada) e por `assignSlot` (troca de titular). Os dois caminhos sem troca de clube copiam o campo.

## Superseded checks of earlier features

Carried from 909b492, porque nenhuma assertion dessas linhas mudou em fd96e98. O diff só acrescenta testes em `live.test.ts`, `store.test.ts` e `Squad.test.tsx`. O único trecho alterado em teste antigo é `Squad.test.tsx:742`, que passou de `game` para `{ ...game }` no segundo `setState`, e nenhuma assertion mudou com isso.

O ponto de documentação do round 1 foi corrigido. A coluna «Now proven by» de checks.md agora diz «C8» só na linha dos tipos de evento, e «o mesmo teste do check de origem…» nas outras.

O snapshot `snapshot-v6.json` não foi regenerado no fix, e o teste dele (`live.test.ts`, «semente das ligas novas») passa no gate completo. A troca para `keeperStrength` não moveu nenhum resultado fixado.

## Coverage

Carried from checks.md at fd96e98 e conferida por leitura. Light não recalcula. As duas linhas novas do round 2 foram conferidas contra o código e as provas acima:

| Set (size) | Recomputed from | Member -> proof | Unproven |
| --- | --- | --- | --- |
| tipos de cobrança (3) | carried from checks.md | C1 (`live.test.ts:1002`) | - |
| linhas de narração novas (4) | carried from checks.md | C5 (`narration.test.ts:68`) | - |
| sons (4) | carried from checks.md | C6 (`sfx.test.ts:261`) | - |
| faixas de balanço novas (5) | carried from checks.md | C2 (`balance.test.ts:564-569`) · C3 (`:578-579`) | - |
| faixas de balanço de hoje (7 testes) | carried from checks.md | C4 (7 testes ✓) | - |
| cobrador fora de campo (6) | carried from checks.md | C12 (`cup.test.ts:577-585`) | - |
| quem bate (3 lugares) | carried from checks.md | C12 · C13 · C14 | - |
| caminhos da escalação que mantêm o cobrador (4) | sanity-read em `store.ts` e `rollover.ts` (busca acima) | formação C10 (`store.test.ts:1126`) · postura C10 · virada C11 (`rollover.test.ts:784`) · troca de titular C18 (`store.test.ts:1150`) | - |
| contra quem a cobrança é batida (2) | sanity-read em `live.ts:403` | goleiro = defesa C3 (`balance.test.ts:578-579`) · goleiro ≠ defesa C17 (`live.test.ts:1068`) | - |
| valores do seletor (2) e exibição de «Automático» (2) | carried from checks.md | titular C9 (`Squad.test.tsx:753`) · Automático C9 (`:761`) · ausente → Automático C9 (`:738`) · reserva → Automático C9 (`:749`) | - |
| `penaltyTaker` na importação (5) | carried from checks.md | C15 (`saveFile.test.ts:423`, `:430`, `:431`) | - |
| tamanhos de tela (2) | carried from checks.md | C16 (`squad`, `squadDesktop`, carried from 909b492) | - |
| doors (2) | carried from checks.md | door 1 C9, C15 · door 2 C1, C8 | - |

## Swept existing

Carried from 909b492. Nenhuma linha do `## Swept` resolve para `existing`. A linha «data lifecycle» ainda não cita C18. É só documentação, porque o caminho está provado.

## Convenções (AD-002, AGENTS.md)

Verified at fd96e98 sobre o diff do fix. `git diff 909b492..fd96e98 -- src | grep -E "^\+" | grep -E "Brasfoot|Math\.random|^\+import"` não devolve nada (exit 1): o fix não acrescenta import, «Brasfoot» nem `Math.random`. `keeperStrength` já existia em `live.ts` e já era exportado.

## Gate

Verified at fd96e98.

- Provas: a invocação única acima saiu 0, com `Test Files 10 passed (10)` e `Tests 24 passed | 216 skipped (240)`.
- Números de balanço: `npx vitest run src/engine/balance.test.ts -t "pênaltis por partida|conversão do pênalti" --silent=false` saiu 0, com `Tests 2 passed | 22 skipped (24)`. C2 deu 0,348 / 0,0257 / 0,759 / 0,560 e C3 deu 0,903 e 0,594, todos nas faixas.
- Suíte completa: `npx vitest run` saiu 0, com `Test Files 54 passed (54)` e `Tests 722 passed (722)`. São os 720 do round 1 mais C17 e C18.
- Layout: carried from 909b492 (`npm run check:layout` saiu 0, `as 23 telas cabem em 400 × 700 px e são legíveis em 1366 × 768 px`). O fix não toca nenhuma tela.
- Fault injection: nenhuma, porque o profile é light.
- Árvore: no fim, `git status --porcelain` mostra ` M .specs/LESSONS.md` e ` M .specs/lessons.json`. Essas mudanças não vêm deste Verifier, que só escreveu este relatório. Ficam fora de `src` e não afetam as provas.

## Weak points

Nenhum gap reprova o round 2. Ficam estes pontos fracos, do maior para o menor:

1. Em C3, o lado de rating 60 tem só 254 pênaltis, e a faixa de ± 0,06 dá cerca de 2 desvios padrão. C17 agora prende a regra de AC 3 com exatidão, então isso deixa de ser gap de precisão e fica só como amostragem fraca. **C3**: `src/engine/balance.test.ts:579`.
2. Sem fault injection (light), o vermelho de C17 e C18 no código do round 1 foi confirmado só por leitura (0,83 > 0,805, e `assignSlot` sem o campo). **C17**: `src/engine/live.test.ts:1068`. **C18**: `src/store.test.ts:1150`, `src/engine/lineup.ts:101`.
3. Documentação em checks.md: a lição L-005 ainda fala em «os 3 caminhos da escalação» (agora são 4, com C18), e a linha «data lifecycle» do `## Swept` não cita C18. Nenhuma prova é afetada. **checks.md** linhas 13 e 137.
4. A venda do cobrador (`src/engine/market.ts:146`) mantém o id pelo spread, sem prova própria. Não há efeito observável: o id desconhecido cai na ordem automática (C12) e o seletor mostra «Automático» (`Squad.tsx:103`). **C12**: `src/engine/cup.test.ts:585`.

## Round 1 e como cada item foi resolvido

O round 1 (909b492) deu FAIL, com C3 e C9 reprovados. Situação de cada item em fd96e98:

| # | Achado do round 1 | Resolução em fd96e98 |
| --- | --- | --- |
| 1 | AC 3 contradito: a cobrança usava `defStrength.gk` (goleiro misturado com a defesa), e C3 não distinguia | resolvido. `src/engine/live.ts:403` passa `keeperStrength(defender, players)`. C17 (`live.test.ts:1047-1071`) prende 0,85 contra 0,805 com goleiro 50 e defesa 80. C3 passa |
| 2 | `assignStarter` apagava `penaltyTaker` | resolvido. `src/store.ts:659-660` copia o campo, e C18 (`store.test.ts:1135-1153`) prova na store e no save. Nenhum outro caminho do usuário apaga o campo (tabela acima) |
| 3 | C9 sem assertion para «sem cobrador → Automático» | resolvido. `src/ui/Squad.test.tsx:735` e `:738`. C9 passa |
| 4 | Ponto fraco: C3 com ± 0,06 sobre 254 pênaltis | continua como ponto fraco (1), atenuado por C17 |
| 5 | Documentação: coluna «Now proven by» das superseded | resolvido em checks.md: «C8» só na linha dos tipos de evento |
