# Pênaltis durante o jogo e cobrador - checks

Profile: light
Plan: `.specs/features/penaltis/plan.md`

16 checks in 2 slices · 2 one-way doors · 0 open

Runner: Vitest (`npx vitest run <arquivo> -t "<nome>"`); layout pelo `npm run check:layout` (Chrome headless sobre `vite preview`).

Lições aplicadas:

- L-003: o cobrador é provado pela entrada (`startRound` → `sideFor` → cobrança no jogo, C13), não só por `penaltyTakers`.
- L-005: tabela sobre o conjunto inteiro (as 4 linhas de narração, os 4 casos de som, os 6 motivos de cobrador fora de campo, os 3 caminhos da escalação).
- L-006: a regra de quem bate nomeia o escolhido e o fallback, com fixture em que o escolhido (um meia) e o automático (o melhor atacante) são diferentes.
- L-007: os casos de fora de campo têm o escolhido presente no clube, mas fora das vagas.
- L-008: o texto da narração e o rótulo do seletor são conferidos onde aparecem.
- L-009: os dois doors têm check (door 1: C9, C15; door 2: C1).
- L-030: C4 roda as faixas de balanço que já existem; elas passam hoje e prendem o comportamento de antes. Todas as outras provas falham no código de antes.

## Checks

### S1 - Pênalti dentro do jogo · 9 files · ~139 KB · ~35k

**C1** - Em `simulateMatch` entre times iguais de rating 70, seeds 1..500, todo evento `penalty` (AC 1) é seguido, na posição seguinte do log, por exatamente um evento do mesmo minuto e do mesmo `clubId` com `penalty: true` e tipo `goal`, `shot_saved` ou `shot_missed` (AC 2). Nenhum outro `goal`/`shot_saved`/`shot_missed` desse clube cai nesse minuto, e nenhum evento com `penalty: true` aparece sem um `penalty` logo antes. Cada cobrança `goal` tem um item em `result.goals` com o mesmo minuto, clube e jogador. Os três tipos de cobrança aparecem pelo menos uma vez nas 500 partidas.
Proof: `npx vitest run src/engine/live.test.ts -t "pênalti marcado e cobrado"`

**C2** - Em 2000 partidas `simulateMatch` entre times iguais de rating 70 (seeds 1..2000):
- pênaltis por partida (soma dos dois times) entre 0,2 e 0,4 (AC 5);
- pênaltis ÷ chances, contando como chance cada finalização mais cada pênalti, dentro de `PENALTY_PER_CHANCE` ± 0,01 (AC 1);
- conversão entre 0,65 e 0,85 (AC 5);
- defesas ÷ cobranças perdidas dentro de `PENALTY_SAVED_SHARE` ± 0,1 (AC 4).

Proof: `npx vitest run src/engine/balance.test.ts -t "pênaltis por partida"`

**C3** - A cobrança vira gol pela `penaltyChance` (AC 3). Em 4000 partidas `simulateMatch` de um time inteiro de rating 90 contra um de rating 60, a conversão dos pênaltis do time 90 fica dentro de `penaltyChance(90, 60)` = 0,90 ± 0,06, e a do time 60 dentro de `penaltyChance(60, 90)` = 0,60 ± 0,06.
Proof: `npx vitest run src/engine/balance.test.ts -t "conversão do pênalti pelo cobrador e pelo goleiro"`

**C4** - As faixas de balanço de hoje continuam passando sem mudança de limite (AC 6):
- média de gols 2,3–3,1 e vitória do mandante 0,40–0,52 entre iguais;
- forte contra fraco ≥ 0,75;
- as duas de postura;
- cartões e lesões;
- equilíbrio financeiro.

Proof: `npx vitest run src/engine/balance.test.ts -t "times iguais|forte contra fraco|postura ofensiva|postura defensiva|taxa de cartões|taxa de lesões|caixa equilibrado"`

**C5** - `narrate`, em tabela, com clube «Azul» e jogador «Fulano» (AC 7):
- `penalty` → «Pênalti para o Azul!»;
- `goal` com `penalty: true` → «GOL do Azul! Fulano cobra o pênalti e marca.»;
- `shot_saved` com `penalty: true` → «Fulano (Azul) cobra o pênalti e o goleiro defende!»;
- `shot_missed` com `penalty: true` → «Fulano (Azul) cobra o pênalti pra fora!».

Os mesmos três tipos sem `penalty` continuam com as frases de hoje.
Proof: `npx vitest run src/engine/narration.test.ts -t "narração do pênalti no jogo"`

**C6** - `effectsFor`, em tabela (AC 8):
- `penalty` de qualquer lado → `["whistle-short"]`;
- `goal` com `penalty: true` do usuário → `["crowd-roar", "goal-jingle"]`; do outro lado → `["crowd-groan"]`;
- `shot_saved` e `shot_missed` com `penalty: true` → `["crowd-ooh"]`.

Proof: `npx vitest run src/audio/sfx.test.ts -t "som do pênalti no jogo"`

**C7** - Com o time que ataca sem ninguém em campo (todas as vagas `null`), `stepMatch` dos minutos 1..90 em 200 seeds não grava nenhum `penalty` desse time (AC 9).
Proof: `npx vitest run src/engine/live.test.ts -t "sem ninguém em campo não tem pênalti"`

**C8** - `MATCH_EVENT_TYPES` tem 11 tipos, com `"penalty"`, e todos aparecem em `simulateMatch`, exceto `substitution`, que não acontece sem banco (door 2; os testes que já enumeram os tipos passam a contar 11).
Proof: `npx vitest run src/engine/match.test.ts -t "todos os tipos de evento ocorrem e têm narração"`
Proof: `npx vitest run src/engine/live.test.ts -t "tipos de evento ocorrem e têm narração"` (o nome do teste passa de «10» para «11» tipos)

### S2 - Cobrador escolhido · 9 files · ~250 KB · ~63k

**C9** - Na tela Elenco, o seletor rotulado «Pênaltis» vem logo depois de «Treino» nos controles da escalação (AC 10). As opções são «Automático» e os nomes dos 11 titulares, na ordem das vagas. Sem `penaltyTaker` aparece «Automático»; com `penaltyTaker` igual a um reserva, também «Automático» (AC 11). Escolher um titular grava `lineup.penaltyTaker` com o id dele no jogo da store e no save lido por `loadGame`. Escolher «Automático» tira o campo dos dois: `"penaltyTaker" in lineup` é `false` (AC 12).
Proof: `npx vitest run src/ui/Squad.test.tsx -t "seletor de pênaltis"`

**C10** - Com `lineup.penaltyTaker` definido, `setFormation` (para outra formação) e `setPosture` mantêm o mesmo id no jogo da store e no save (AC 13).
Proof: `npx vitest run src/store.test.ts -t "cobrador mantido na formação e na postura"`

**C11** - `nextSeason` com o usuário no mesmo clube mantém `lineup.penaltyTaker` (AC 14).
Proof: `npx vitest run src/engine/rollover.test.ts -t "cobrador na virada"`

**C12** - `penaltyTakers` com `side.penaltyTaker`, no elenco do teste «ordem dos batedores»:
- Com o escolhido em campo (o meia `mf70`), ele é o primeiro e os outros seguem a ordem automática sem ele (AC 15).
- Em tabela, cada caso devolve exatamente a ordem automática (AC 16): escolhido fora das vagas (no banco), substituído, expulso, lesionado no jogo, id que não é de ninguém, e sem escolha.
- Um `makeSide` sem a opção (IA) não tem `penaltyTaker` (AC 18).

Proof: `npx vitest run src/engine/cup.test.ts -t "cobrador escolhido na ordem"`

**C13** - Pela entrada (L-003): num jogo com o usuário escalado e `lineup.penaltyTaker` = um meia titular, `startRound` monta o lado do usuário com esse `penaltyTaker`, e nenhum lado da IA tem um. Rodando seeds até sair um pênalti a favor do usuário com o meia em campo, a cobrança tem `playerId` igual ao meia, que não é o primeiro da ordem automática (AC 15).
Proof: `npx vitest run src/engine/live.test.ts -t "cobrador escolhido bate no jogo"`

**C14** - Numa disputa de pênaltis com `penaltyTaker` = `H-mf70` em campo, o primeiro chute do mandante é de `H-mf70`, e os nove seguintes seguem a ordem automática sem ele (AC 17).
Proof: `npx vitest run src/engine/cup.test.ts -t "cobrador escolhido abre a disputa"`

**C15** - `decodeSaveFile` de um jogo válido, em tabela, sobre `lineup.penaltyTaker` do usuário (AC 19):
- ausente e `"qualquer-id"` → `ok`, com o jogo igual ao exportado;
- `7`, `null` e `{}` → `malformed`.

Proof: `npx vitest run src/engine/saveFile.test.ts -t "cobrador no arquivo"`

**C16** - `npm run check:layout` sai com 0, medindo a tela Elenco (`squad`, `squadDesktop`) em 400 × 700 e 1366 × 768, já com o seletor «Pênaltis» (AC 20).
Proof: `npm run check:layout`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| tipos de cobrança (3) | `goal` C1 · `shot_saved` C1 · `shot_missed` C1 | - |
| linhas de narração novas (4) | `penalty` C5 · `goal` pênalti C5 · `shot_saved` pênalti C5 · `shot_missed` pênalti C5 | - |
| sons (4) | `penalty` C6 · gol de pênalti do usuário C6 · gol de pênalti do outro C6 · defesa/pra fora C6 | - |
| faixas de balanço novas (5) | pênaltis por partida C2 · taxa por chance C2 · conversão C2 · divisão defesa/pra fora C2 · conversão por rating C3 | - |
| faixas de balanço de hoje (7 testes) | times iguais C4 · forte contra fraco C4 · postura ofensiva C4 · postura defensiva C4 · cartões C4 · lesões C4 · caixa equilibrado C4 | - |
| cobrador fora de campo (6) | no banco C12 · substituído C12 · expulso C12 · lesionado C12 · id desconhecido C12 · sem escolha C12 | - |
| quem bate (3 lugares) | jogo pela ordem C12 · jogo pela entrada C13 · disputa C14 | - |
| caminhos da escalação que mantêm o cobrador (3) | formação C10 · postura C10 · virada C11 | - |
| valores do seletor (2) | titular C9 · Automático C9 | - |
| `penaltyTaker` na importação (5) | ausente C15 · texto C15 · número C15 · `null` C15 · objeto C15 | - |
| tamanhos de tela (2) | 400 × 700 C16 · 1366 × 768 C16 | - |
| doors (2) | door 1 `Lineup.penaltyTaker` C9, C15 · door 2 evento `penalty` + `penalty: true` C1, C8 | - |

- Claims que citam texto de tela: C5 e C9, cada um conferido onde o texto é gerado ou mostrado.
- Nenhum check afirma mais que os casos que a prova dele percorre.

## Swept

- validation: C15
- failure modes: C7 (time sem ninguém), C12 (cobrador fora de campo)
- idempotency: n/a - escolher o mesmo cobrador duas vezes grava o mesmo valor; não há efeito acumulado
- authorization: n/a - jogo local, sem contas
- concurrency: n/a - a escalação é gravada pela fila do `persist` que os outros seletores já usam; a partida roda num passo só
- data lifecycle: C11 (virada mantém), C12 (vendido ou desconhecido cai no automático, sem limpeza)
- dependency failure: n/a - nenhuma dependência externa
- state transitions: C1 (marcação → cobrança no mesmo minuto)
- observability: n/a - sem log no jogo; a narração é a saída visível (C5)

## Superseded checks of earlier features

Achados na build: o sorteio do pênalti muda o resultado de cada seed, e os testes abaixo dependiam de um cenário que uma seed dava por acaso. Em todos, a pré-condição do cenário é conferida no próprio teste ou foi buscada com o motor novo, e nenhum valor esperado nem faixa muda, salvo onde a linha diz.

| Check | What changes | Now proven by |
| --- | --- | --- |
| partida-ao-vivo C46 / correcoes-validacao C61 (`live.test.ts` «todos os 10 tipos de evento…») | o conjunto passa a 11 tipos com `penalty`; o teste vira «todos os 11 tipos…» e as frases distintas passam a 11 (`match.test.ts`: 10 sem a substituição) | C8 |
| paises C8 (`live.test.ts` «semente das ligas novas», snapshot v6) | só o campo `results` do `snapshot-v6.json` é regenerado com o motor novo (119 de 120 partidas mudam); o resto do fixture fica igual | C1 |
| carreira-dinamica C9 (`career.test.ts` «assumir no meio da temporada») | o fixture passa da seed 3 à 27, a primeira com o 18º de meta 16 e o 5º de meta 12 depois de 13 rodadas; mesmos valores | C1 |
| copa-nacional C63 (`migrate.test.ts` «sementes da migração da copa») | o replay da preliminar passa a usar a disponibilidade da copa, como `cupLive`: um suspenso na liga joga a copa (5 clubes da preliminar têm um agora) | C1 |
| copa-nacional C49 (`Cup.test.tsx` «situação do usuário») | o campeão da nacional da seed 111 agora também joga a continental, e a tela abre nessa aba (copa-continental AC 16); o teste abre a aba da nacional antes de ler «Campeão» | C1 |
| nucleo-liga-partida C34 (`End.test.tsx` «fim mostra campeão sem Jogar rodada») | o clube 1 da seed 6 é demitido antes da rodada 38 (8 de 21 jogos de teste antes, 10 de 21 agora); passa ao clube 2, conferido sem `pendingJob`; o campeão também ganhou uma copa, e as linhas «Campeão: …» são contadas como no teste ao lado | C1 |
| ajustes-audio C5, C6 (`Live.test.tsx`, gol do usuário aos 90') | a seed 182 perdeu o gol; passa à 27, a primeira com gol do usuário aos 90' e sem parada obrigatória | C1 |
| ajustes-audio C9 (`Live.test.tsx` «disputa de pênaltis soa pela tela ao vivo») | o confronto passa do 10º ao 4º da seed 3, o primeiro com disputa de 10 ou mais cobranças e sem parada obrigatória | C1 |
| audio C26 / partida-ao-vivo C9 («rodada sem AudioContext», «fim da rodada ao vivo grava») | a seed 8 agora tem uma parada obrigatória do usuário, e o relógio livre não chega aos 90'; passam à seed 2, a primeira sem parada | C1 |
| copa-continental C11 (`Live.test.tsx` «continental fecha sem tela») | a escalação do 1º clube da Série B (seed 132) fica inválida para a próxima data; passa ao 3º, o primeiro com escalação válida, fora da continental e não demitido | C1 |

## Handoff

- S1 = `live.ts` 32 KB + `live.test.ts` 46 KB + `balance.test.ts` 26 KB + `types.ts` 13 KB + `sfx.test.ts` 10 KB + `match.test.ts`, `narration.ts`, `narration.test.ts`, `sfx.ts` 12 KB = 139 KB ÷ 4 ≈ 35k
- S2 entra em Elenco/store/virada: `store.test.ts` 51 KB + `rollover.test.ts` 39 KB + `Squad.test.tsx` 36 KB + `store.ts` 36 KB + `cup.test.ts` 25 KB + `saveFile.test.ts` 23 KB + `Squad.tsx` 18 KB + `rollover.ts` 15 KB + `saveFile.ts` 7 KB = 250 KB ≈ 63k; 98k no total, abaixo do budget de 150k: um builder
- Mechanism: one builder (abaixo do budget, sem pergunta)
- **Boundary:** C1-C8 closed at `5002fa4` (motor) and `cc9a210` (fixtures de seed); C9-C16 closed at `648ca60`
- **Settled mid-build:** nenhuma pergunta ao autor; as trocas de fixture seguem a suposição aprovada no plano («Testes que fixam resultado de seed») e estão em `## Superseded checks of earlier features`. Medido com o motor novo: 0,348 pênalti por partida, 2,57% das chances, conversão 0,759, defesas 0,560 dos perdidos; 90×60 converte 0,904 e 60×90 0,594
- **Abandoned:** nada
