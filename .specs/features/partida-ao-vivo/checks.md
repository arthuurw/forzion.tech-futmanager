# Partida ao vivo e dinâmica do elenco - checks

Profile: light
Plan: `.specs/features/partida-ao-vivo/plan.md`

## Intent

47 checks in 6 slices · 7 one-way doors · 0 open

Runner: Vitest (`npx vitest run <arquivo> -t "<nome>"`). Telas com `@testing-library/react` em jsdom e relógio com `vi.useFakeTimers`. Testes de taxa usam 2000 partidas com seeds 1–2000, como o núcleo.

## Checks

### S1 - Rodada ao vivo · ~8 files · ~45 KB · ~11k

**C1** - «Jogar rodada» abre a tela «Ao vivo» com o relógio em 0' e as 10 partidas em 0 x 0 (AC 1)
Proof: `npx vitest run src/ui/Live.test.tsx -t "abre ao vivo em 0 com 10 jogos 0 x 0"`

**C2** - Na velocidade normal, o relógio avança 1 minuto a cada 300 ms: 900 ms depois do início mostra 3' (AC 2)
Proof: `npx vitest run src/ui/Live.test.tsx -t "relógio avança 1 minuto a cada 300 ms"`

**C3** - A cada minuto, os eventos daquele minuto da partida do usuário entram no fim da narração, e o último evento fica dentro da área visível da lista (AC 3)
Proof: `npx vitest run src/ui/Live.test.tsx -t "narração acrescenta eventos do minuto com o último visível"`

**C4** - Um gol muda o placar da partida na lista de jogos no mesmo tick, com a classe de destaque presente por 2000 ms e ausente depois (AC 4)
Proof: `npx vitest run src/ui/Live.test.tsx -t "gol muda placar no mesmo tick e pisca 2 s"`

**C5** - «Pausar» congela o relógio mesmo com o tempo correndo, e «Continuar» retoma do mesmo minuto (AC 5)
Proof: `npx vitest run src/ui/Live.test.tsx -t "pausar para e continuar retoma"`

**C6** - Ao chegar a 45', o relógio para sozinho e a tela mostra «Intervalo» (AC 6)
Proof: `npx vitest run src/ui/Live.test.tsx -t "intervalo pausa no 45"`

**C7** - Em 2x o relógio avança 1 minuto a cada 150 ms; em 4x, a cada 75 ms (AC 7)
Proof: `npx vitest run src/ui/Live.test.tsx -t "velocidades 2x e 4x"`

**C8** - «Pular para o fim» leva o relógio a 90' sem avançar o tempo (AC 8)
Proof: `npx vitest run src/ui/Live.test.tsx -t "pular para o fim vai ao 90"`

**C9** - Ao chegar a 90', o save gravado tem a rodada avançada e a tela Rodada mostra os 10 resultados e a tabela (AC 9)
Proof: `npx vitest run src/app.test.tsx -t "fim da rodada ao vivo grava e mostra resultados"`

**C10** - A mesma rodada, a partir do mesmo save e com as mesmas decisões nos mesmos minutos, produz os mesmos 10 resultados (AC 10)
Proof: `npx vitest run src/engine/live.test.ts -t "mesmas decisões mesmos resultados"`

**C11** - Uma substituição do usuário não muda nenhum dos outros 9 resultados (AC 11, door 2)
Proof: `npx vitest run src/engine/live.test.ts -t "substituição não muda os outros 9 jogos"`

**C12** - Recarregar a página no meio da rodada ao vivo leva à tela Elenco da mesma rodada, com o save igual ao de antes da rodada (AC 12, door 4) - Superseded por correcoes-validacao C14 (door 1, AD-019); o teste virou `recarregar no meio da rodada fecha a data`
Proof: `npx vitest run src/app.test.tsx -t "recarregar no meio da rodada volta ao elenco com save intacto"`

**C13** - `playRound` dá o mesmo resultado que `startRound` seguido de `finish` sem decisões (door 3)
Proof: `npx vitest run src/engine/live.test.ts -t "playRound equivale a rodada ao vivo sem decisões"`

### S2 - Decisões durante o jogo · ~5 files · ~35 KB · ~9k

**C14** - Com o relógio pausado, a tela mostra os 11 em campo e o banco disponível, cada um com condição e moral; rodando, os controles de decisão ficam desabilitados (AC 13)
Proof: `npx vitest run src/ui/Live.test.tsx -t "pausado mostra em campo e banco com condição e moral"`

**C15** - Uma substituição põe o reserva no mesmo slot a partir do minuto seguinte e registra um evento `substitution` com quem sai e quem entra (AC 14)
Proof: `npx vitest run src/engine/live.test.ts -t "substituição entra no slot e narra"`
Proof: `npx vitest run src/ui/Live.test.tsx -t "substituir pela tela"`

**C16** - A sexta substituição é recusada e a tela mostra «Limite de 5 substituições» (AC 15)
Proof: `npx vitest run src/engine/live.test.ts -t "sexta substituição recusada"`
Proof: `npx vitest run src/ui/Live.test.tsx -t "mensagem limite de 5"`

**C17** - Quem saiu não pode voltar (AC 16)
Proof: `npx vitest run src/engine/live.test.ts -t "quem saiu não volta"`

**C18** - Substituir um expulso é recusado e a tela mostra «Jogador expulso não pode ser substituído» (AC 17)
Proof: `npx vitest run src/engine/live.test.ts -t "expulso não pode ser substituído"`
Proof: `npx vitest run src/ui/Live.test.tsx -t "mensagem expulso"`

**C19** - Trocar a formação no jogo mantém os mesmos jogadores em campo, e quem cai em slot de outra posição aparece marcado como fora de posição (AC 18)
Proof: `npx vitest run src/engine/live.test.ts -t "mudar formação redistribui sem tirar ninguém"`
Proof: `npx vitest run src/ui/Live.test.tsx -t "formação marca fora de posição"`

**C20** - Em 2000 partidas entre times iguais, o mandante em «Ofensiva» finaliza pelo menos 15% mais e sofre mais finalizações que com os dois em «Equilibrada» (AC 19, AC 20)
Proof: `npx vitest run src/engine/balance.test.ts -t "postura ofensiva cria e sofre mais finalizações"`

**C21** - Em 2000 partidas entre times iguais, o mandante em «Defensiva» sofre pelo menos 15% menos gols que com os dois em «Equilibrada» (AC 21)
Proof: `npx vitest run src/engine/balance.test.ts -t "postura defensiva sofre menos gols"`

**C22** - A IA substitui um lesionado na hora e, a partir do 60', quem está abaixo de 60 de condição com reserva da mesma posição, sem passar de 5 trocas (AC 22)
Proof: `npx vitest run src/engine/live.test.ts -t "IA substitui lesionado e cansado"`

**C23** - Um slot aceita jogador de outra posição, e a força efetiva dele ali é 75% da normal (AC 23, door 6)
Proof: `npx vitest run src/engine/lineup.test.ts -t "fora de posição aceito com 75% da força"`

### S3 - Cartões e suspensões · ~3 files · ~15 KB · ~4k

**C24** - Em 2000 partidas entre times iguais, a média de amarelos fica em [3,0; 5,5] e a de vermelhos em [0,08; 0,30] (AC 24)
Proof: `npx vitest run src/engine/balance.test.ts -t "taxa de cartões"`

**C25** - O 2º amarelo na mesma partida gera um evento `red` e tira o jogador de campo (AC 25, door 5)
Proof: `npx vitest run src/engine/live.test.ts -t "segundo amarelo vira vermelho e sai"`

**C26** - Um expulso deixa o slot vazio até o fim, e a força do setor dele cai (AC 26)
Proof: `npx vitest run src/engine/live.test.ts -t "expulsão deixa time com 10 e setor mais fraco"`

**C27** - O 3º amarelo acumulado suspende por 1 rodada e zera a contagem (AC 27, door 5)
Proof: `npx vitest run src/engine/condition.test.ts -t "três amarelos suspendem e zeram"`

**C28** - Um vermelho suspende por 1 rodada, e a suspensão acaba depois da rodada cumprida (AC 28, door 5)
Proof: `npx vitest run src/engine/condition.test.ts -t "vermelho suspende uma rodada"`

**C29** - Suspenso não entra na escalação e aparece com o selo «SUS» na tela Elenco (AC 29)
Proof: `npx vitest run src/engine/lineup.test.ts -t "indisponível não entra na escalação"`
Proof: `npx vitest run src/ui/Squad.test.tsx -t "suspenso fica fora com selo SUS"`

### S4 - Condição física e lesões · ~3 files · ~15 KB · ~4k

**C30** - Em campo, a condição cai 0,15 por minuto até 30 anos e 0,2 acima de 30 (AC 30, renegociado)
Proof: `npx vitest run src/engine/live.test.ts -t "condição cai por minuto e mais rápido acima de 30"`

**C31** - Ao fim da rodada, quem não jogou recupera 30 e quem jogou recupera 15, com teto 100 (AC 31)
Proof: `npx vitest run src/engine/condition.test.ts -t "recuperação 30 e 15 até 100"`

**C32** - Em 2000 partidas entre times iguais, a média de lesões fica em [0,10; 0,40] (AC 32)
Proof: `npx vitest run src/engine/balance.test.ts -t "taxa de lesões"`

**C33** - Um lesionado sai de campo no mesmo minuto e fica fora entre 1 e 4 rodadas (AC 33)
Proof: `npx vitest run src/engine/live.test.ts -t "lesionado sai na hora"`
Proof: `npx vitest run src/engine/condition.test.ts -t "lesão de 1 a 4 rodadas"`

**C34** - Lesionado não entra na escalação e aparece com «LES» e as rodadas que faltam na tela Elenco (AC 34)
Proof: `npx vitest run src/ui/Squad.test.tsx -t "lesionado fica fora com selo LES e rodadas"`

**C35** - Uma escalação salva com um lesionado ou suspenso deixa «Jogar rodada» desabilitado com «Faltam 1 titulares» (AC 35)
Proof: `npx vitest run src/ui/Squad.test.tsx -t "escalação com indisponível desabilita"`

**C36** - Condição 50 dá força efetiva de 85% da de condição 100 (AC 36, door 6)
Proof: `npx vitest run src/engine/live.test.ts -t "condição 50 rende 85%"`

### S5 - Moral · ~2 files · ~10 KB · ~3k

**C37** - Vitória dá +1 de moral a quem jogou, com teto +2 (AC 37)
Proof: `npx vitest run src/engine/condition.test.ts -t "vitória sobe moral até \+2"`

**C38** - Derrota tira 1 de moral de quem jogou, com piso −2 (AC 38)
Proof: `npx vitest run src/engine/condition.test.ts -t "derrota baixa moral até -2"`

**C39** - 3 rodadas seguidas sem entrar em campo tiram 1 de moral e zeram `idleRounds` (AC 39, door 7)
Proof: `npx vitest run src/engine/condition.test.ts -t "três rodadas sem jogar baixa moral"`

**C40** - Moral +2 dá força efetiva 6% maior que moral 0 (AC 40, door 6)
Proof: `npx vitest run src/engine/live.test.ts -t "moral \+2 rende 6% a mais"`

**C41** - A tela Elenco mostra a moral como seta de 5 níveis: ↓ (−2), ↘ (−1), → (0), ↗ (+1), ↑ (+2), cada uma com sua classe de cor (AC 41)
Proof: `npx vitest run src/ui/Squad.test.tsx -t "setas de moral em 5 níveis"`

### S6 - Save compatível · ~3 files · ~10 KB · ~3k

**C42** - Um save v1 lido vira v2 com condição 100, moral 0, contadores em 0 e postura «balanced» em cada escalação (AC 42) - Superseded por multiplas-temporadas C49
Proof: `npx vitest run src/engine/migrate.test.ts -t "migra save v1 para v2"`
Proof: `npx vitest run src/persistence/save.test.ts -t "carrega save v1 migrado"`

**C43** - Um save com `schemaVersion` 3 mostra «Jogo salvo incompatível (versão 3)» e só «Novo jogo» (AC 43) - Superseded por elenco-mercado-financas C52
Proof: `npx vitest run src/ui/Home.test.tsx -t "save de versão futura incompatível"`

**C44** - Com condição 100, moral 0 e postura «Equilibrada», as faixas de gols e de vitória do mandante do núcleo continuam valendo (AC 44)
Proof: `npx vitest run src/engine/balance.test.ts -t "times iguais"`
Proof: `npx vitest run src/engine/balance.test.ts -t "forte contra fraco"`

**C45** - O documento gravado tem `schemaVersion: 2`, e cada jogador tem `fitness`, `morale`, `injuryRounds`, `suspendedRounds`, `yellowCards` e `idleRounds` (door 1, door 7) - Superseded por elenco-mercado-financas C54
Proof: `npx vitest run src/persistence/save.test.ts -t "documento tem schemaVersion 2 com condição"`

**C46** - Cada um dos 10 tipos de evento ocorre ao menos uma vez em 200 rodadas simuladas e tem uma narração PT-BR distinta (plano Impact, `MatchEvent`) - Superseded por penaltis C8
Proof: `npx vitest run src/engine/live.test.ts -t "todos os 10 tipos de evento ocorrem e têm narração"`

**C48** - Ao escalar um clube de IA, um jogador abaixo de 60 de condição fica fora quando há reserva disponível da mesma posição com 60 ou mais, e um com exatamente 60 continua titular (AC 45)
Proof: `npx vitest run src/engine/live.test.ts -t "IA poupa quem está abaixo de 60 de condição"`

**C47** - Um jogador fora de posição aparece marcado no campo da tela Elenco, e o seletor do slot oferece jogadores de todas as posições (AC 23)
Proof: `npx vitest run src/ui/Squad.test.tsx -t "slot aceita outra posição e marca fora de posição"`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| estados do relógio (4) | rodando C2 · pausado C5 · intervalo C6 · encerrado C9 | - |
| velocidades (3) | 1x C2 · 2x C7 · 4x C7 | - |
| recusas de substituição (3) | limite C16 · volta de quem saiu C17 · expulso C18 | - |
| posturas (3) | balanced C44 · attacking C20 · defensive C21 | - |
| tipos de `MatchEvent` (10) | kickoff C46 · halftime C46 · fulltime C46 · goal C46 · shot_saved C46 · shot_missed C46 · yellow C46 · red C25 · injury C33 · substitution C15; C46 table-driven over all 10 | - |
| regras de disciplina (4) | 3 amarelos C27 · 2º amarelo no jogo C25 · vermelho C28 · expulso sem troca C18 | - |
| indisponibilidade (2) | lesionado C34 · suspenso C29 | - |
| fatores de força efetiva (3) | condição C36 · moral C40 · fora de posição C23 | - |
| variação de moral (3) | vitória C37 · derrota C38 · sem jogar C39 | - |
| versões de save (3) | v1 migra C42 · v2 lê C45 · v3 recusa C43 | - |
| portas de mão única (7) | door 1 C45 · door 2 C11 · door 3 C13 · door 4 C12 · door 5 C27 · door 6 C36 · door 7 C39 | - |
| entidades de `Relations` (5) | Condition C45 · Lineup.posture C42 · LiveRound C1 · LiveMatch C11 · Player C45 | - |

- `Surface` do plano é `None`; nenhuma rota.
- Claims que cruzam a persistência: C9, C12, C42, C45.

## Renegotiated

Aprovado pelo usuário em 26/09/2026 («sim, menos desgaste»), depois da primeira verificação. O plano registra o motivo em `## Renegotiated`.

| Check | Antes | Depois |
| --- | --- | --- |
| C30 | cai 0,3 por minuto até 30 anos e 0,4 acima de 30 | cai 0,15 por minuto até 30 anos e 0,2 acima de 30 |
| C48 | - | nova: IA poupa quem está abaixo de 60 de condição (AC 45) |

## Superseded checks of nucleo-liga-partida

O plano aprovado muda contratos que o núcleo provou. Os testes abaixo mudam junto, no mesmo commit, e a mudança é declarada aqui:

| Núcleo | O que muda | Substituído por |
| --- | --- | --- |
| C19 (slot rejeita posição diferente) | fora de posição passa a ser aceito | C23, C47 |
| C33 (6 tipos de evento) | passam a ser 10 | C46 |
| C15 (documento com `schemaVersion: 1`) | passa a ser 2 | C45 |
| C36 (≠ 1 é incompatível) | v1 migra; só > 2 é incompatível | C42, C43 |
| C21, C29, C30, C31, C34, C35, C37, C39 (fluxo «Jogar rodada» → resultados) | a rodada agora passa pela tela «Ao vivo»; os testes clicam «Pular para o fim» antes de esperar os resultados, com as mesmas asserções | C8, C9 |

## Swept

- validation: C16, C17, C18, C23
- failure modes: C9
- idempotency: C10
- authorization: n/a - sem contas nem chamada externa
- concurrency: C5
- data lifecycle: C12, C42
- dependency failure: C9
- state transitions: C5, C6, C8, C27, C28
- observability: n/a - sem requisito de log; recusas aparecem na tela (C16, C18)

## Handoff

- S1 ≈ 8 arquivos (`engine/live`, `engine/strength`, `engine/types`, `match` virando passo, store, tela «Ao vivo», CSS, testes), ~45 KB → ~11k
- S2 ≈ 5 arquivos, ~35 KB → ~9k (entra no mesmo `engine/live` e na mesma tela: 20k acumulado)
- S3 + S4 ≈ 6 arquivos, ~30 KB → ~8k (28k acumulado)
- S5 + S6 ≈ 5 arquivos, ~20 KB → ~6k (34k acumulado)
- Total ≈ 34k, abaixo do budget de 150k - one builder

- **Boundary:** C1–C47 closed across `bd7340b` (engine) and the `feat(ui)` commit that follows it
- **Boundary (renegotiation):** C30 and C48 re-closed, and the C47 proof widened to every position, in the commit after `1650910`
- **Settled mid-build:** nothing asked. Tunables recalibrated over 2000 matches (home midfield bonus 1.25 → 1.2, booked-player caution 0.3 → 0.2) to keep the core's home-win ceiling of 52%. The goal-flash un-highlight timer lives per match, not per minute, or a 300 ms tick would cancel it. Clock tests click with `fireEvent`, since `userEvent` waits on a timeout that fake timers never fire
- **Abandoned:** copying the whole live round on every minute of `runToEnd` - one copy per round instead; importing a fixture from a test file - it re-registered that file's tests, moved to `src/engine/test-fixtures.ts`
