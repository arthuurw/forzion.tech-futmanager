# Correções da validação ampla - checks

Profile: light
Plan: `.specs/features/correcoes-validacao/plan.md`

## Intent

73 checks in 9 slices · 3 one-way doors · 0 open

Runner: Vitest (`npx vitest run <arquivo> -t "<nome>"`). Telas usam `@testing-library/react` em jsdom, e o IndexedDB é `fake-indexeddb`. Scripts de navegador rodam por `npm run <script>`.

Regras dos testes:
- Todo valor esperado é literal ou calculado no próprio teste, nunca pela função de produção sob teste (L-004).
- Toda tabela cobre o conjunto inteiro (L-005).

Lições aplicadas:
- L-003: fiação pelo ponto de entrada da store.
- L-007: fixture com o membro excluído.
- L-008: texto exato de tela afirmado onde é renderizado.
- L-009: door achada no build ganha check antes de fechar.

Faixas estatísticas (C30, C31, C39, C41, C42) rodam com seeds fixas, então cada execução é determinística e uma rodada decide.

## Checks

### S1 - O save sobrevive · 11 files · 82 KB · ~21k

**C1** - ✓ Com `indexedDB.open` lançando só na primeira chamada e um save gravado:
- a tela inicial mostra «Não foi possível ler o jogo salvo» e o botão «Tentar de novo», e não mostra «Continuar»;
- tocar «Tentar de novo» mostra «Continuar»;
- o slot continua com a seed do save original (AC 1, AC 3).

Proof: `npx vitest run src/ui/Home.test.tsx -t "falha de leitura oferece tentar de novo"`

**C2** - ✓ Na mesma falha de leitura:
- «Novo jogo» abre a confirmação `alertdialog` antes de gravar;
- importar um arquivo válido cai em `pendingImport` em vez de gravar;
- cancelar deixa o slot com a seed original (AC 2, L-003).

Proof: `npx vitest run src/store.test.ts -t "falha de leitura exige confirmação"`

**C3** - ✓ Tabela de `decodeSaveFile` sobre um save v8 válido com um campo removido por vez. Cada caso dá `malformed`:
- `leagues[0].rounds`;
- `leagues[0].currentRound`;
- `clubs[0].players`;
- `clubs[0].finance`;
- `clubs[0].forSale`;
- `lineup` do clube do usuário.

O save íntegro dá `ok` (AC 4, L-005, L-007).

Proof: `npx vitest run src/engine/saveFile.test.ts -t "validação profunda do save importado"`

**C4** - ✓ Pela store, com um save gravado (seed 7):
- importar um documento sem `leagues[0].rounds` e confirmar mostra «Arquivo corrompido: não foi possível ler o jogo»;
- o slot continua com a seed 7 (AC 4, L-008).

Proof: `npx vitest run src/store.test.ts -t "import corrompido não toca o slot"`

**C5** - ✓ Um documento que passa no decode mas faz `openingPhase` lançar (stub) não é gravado no slot, e a mensagem de arquivo corrompido aparece (AC 5).

Proof: `npx vitest run src/store.test.ts -t "abrir o importado falha antes de gravar"`

**C6** - ✓ Com um save no slot que faz a abertura lançar, tocar «Continuar» mostra «Não foi possível abrir o jogo salvo». O clique não lança exceção para fora do handler (AC 6, L-008).

Proof: `npx vitest run src/ui/Home.test.tsx -t "continuar com save que não abre"`

**C7** - ✓ Com `navigator.locks` simulado e o lock já em posse de outro dono:
- a tela mostra «O jogo está aberto em outra aba» e o botão «Usar nesta aba»;
- uma ação que grava (`setTicketPrice`) não chama `saveGame` (AC 7).

Proof: `npx vitest run src/store.test.ts -t "segunda aba não grava"`

**C8** - ✓ Com o mesmo simulador:
- «Usar nesta aba» pede o lock com `steal: true` e abre o jogo relido do slot;
- o dono anterior recebe a perda do lock, passa a mostrar «O jogo está aberto em outra aba» e não grava mais (AC 8).

Proof: `npx vitest run src/store.test.ts -t "usar nesta aba toma o lock"`

**C9** - ✓ Sem `navigator.locks`, `init` abre o jogo gravado e as ações gravam como hoje (AC 9).

Proof: `npx vitest run src/store.test.ts -t "sem web locks abre sem guarda"`

**C10** - ✓ Tabela sobre `saveStatus`:
- `failed`: a faixa mostra o botão «Exportar jogo»;
- `unavailable`: a faixa mostra o botão «Exportar jogo»;
- `ok`: não há faixa.

Tocar o botão baixa um arquivo cujo `save.seed` é o do jogo em memória, no envelope `forzion-futmanager-save` (AC 10, L-005).

Proof: `npx vitest run src/ui/Banner.test.tsx -t "faixa oferece exportar quando não salva"`

**C11** - ✓ Tabela sobre as três ações: `setFormation("3-5-2")`, `setPosture("attacking")` e `assignStarter`. Depois de cada uma, `resetStore` + `init` restauram o valor mudado (AC 11, L-003).

Proof: `npx vitest run src/store.test.ts -t "escalação é gravada"`

**C12** - ✓ Com `setTicketPrice(45)` em voo, `setFormation("4-3-3")` durante o await deixa, no estado final e no slot, o preço 45 **e** a formação 4-3-3 (AC 12).

Proof: `npx vitest run src/store.test.ts -t "escalação durante gravação de mercado"`

**C13** - ✓ Depois de `playRound` com partida do usuário, antes de `finishLive`, o slot tem `pendingLive: true`, o `currentRound` de antes da rodada e a escalação do início. Depois de `finishLive`, o slot não tem `pendingLive` (AC 13, door 1).

Proof: `npx vitest run src/store.test.ts -t "marcador de ao vivo gravado e limpo"`

**C14** - ✓ Com `pendingLive` no slot:
- `init` fecha a data e abre a fase `round`;
- o slot fica sem o marcador e com `currentRound` + 1;
- o placar do usuário é igual ao de `runToEnd(makeMatch(...))` com as mesmas seeds e a escalação gravada, calculado no teste.

Com decisões diferentes tomadas antes do reload, o placar continua o mesmo (AC 14, door 1).

Proof: `npx vitest run src/store.test.ts -t "reload no ao vivo fecha a rodada"`

**C15** - ✓ Um save v8 sem `pendingLive` abre na fase de sempre, sem jogar data nenhuma (door 1, ausência).

Proof: `npx vitest run src/store.test.ts -t "save sem marcador abre normal"`

### S2 - Nenhum save fica sem saída · 7 files · 89 KB · ~22k

**C16** - ✓ Na virada com o elenco do usuário em 9:
- o elenco fica com 18;
- os 9 novos têm id `-y<season>-`;
- a força de cada um fica em `[média − 12, média − 4]`, com a média calculada no teste.

Com o elenco em 20, nenhum júnior entra (AC 15, L-007).

Proof: `npx vitest run src/engine/rollover.test.ts -t "base repõe o elenco do usuário até 18"`

**C17** - ✓ Tabela de `validateLineup` com aptos = 12, 11, 10 e 7:
- 12 e 11 exigem 11 válidos;
- com 10 aptos, os 10 escalados dão `ok` e 9 dão `missing: 1`;
- com 7 aptos, os 7 escalados dão `ok` (AC 16, L-005).

Proof: `npx vitest run src/engine/lineup.test.ts -t "mínimo é o menor entre 11 e os aptos"`

**C18** - ✓ Pela tela, com 10 aptos todos escalados, «Jogar rodada» está ligado no Elenco e na Rodada. A partida roda com um slot `null` no time do usuário e termina com placar (AC 16, AC 17, L-003).

Proof: `npx vitest run src/ui/Squad.test.tsx -t "joga com vaga quando faltam aptos"`
Proof: `npx vitest run src/engine/live.test.ts -t "time do usuário com vaga joga"`

**C19** - ✓ A seed 11, clube índice 10, sem renovar contratos e escalando por `autoLineup` a cada data, passa da temporada 3, rodada 24, e chega ao fim da temporada 4 sem data travada (AC 15, AC 16).

Proof: `npx vitest run src/engine/balance.test.ts -t "carreira sem renovação não trava"`

**C20** - ✓ Tabela sobre a tela Rodada com a escalação inválida:
- `missing` 1: mostra «Falta 1 titular» com `role="status"`;
- `missing` 3: mostra «Faltam 3 titulares» com `role="status"`.

Nos dois casos, «Jogar rodada» está desligado (AC 18, L-008).

Proof: `npx vitest run src/ui/Round.test.tsx -t "rodada explica o botão desligado"`

### S3 - Escalação de copa pela disciplina certa · 2 files · 25 KB · ~6k

**C21** - ✓ Na primeira data de copa que o usuário joga (seed 5), tabela sobre `store.assignStarter`:
- reserva suspenso só na liga: aceito;
- reserva suspenso na copa: recusado, e a escalação não muda (AC 19, AC 20, L-003, L-007).

Proof: `npx vitest run src/store.test.ts -t "titular de copa pela disciplina da copa"`

**C22** - ✓ Na mesma data, com um titular suspenso na copa:
- `setFormation("4-3-3")` deixa uma escalação válida, sem o suspenso;
- a postura `attacking` escolhida antes continua `attacking` (AC 21).

Proof: `npx vitest run src/store.test.ts -t "formação de copa sem suspenso de copa"`

### S4 - Economia sem dinheiro do nada · 5 files · 128 KB · ~32k

**C23** - ✓ Tabela de luvas de livre:
- salário 10.000 com valor 500.000: 250.000;
- salário 10.000 com valor 60.000: 40.000.

A conta é feita no teste. A rescisão de dispensa do mesmo jogador continua 40.000. A contratação de livre pela IA debita o mesmo valor do caixa dela (AC 22, L-005).

Proof: `npx vitest run src/engine/market.test.ts -t "luvas pelo valor de mercado"`

**C24** - ✓ Tabela sobre `arrivedSeason = temporada atual`:
- `signFreeAgent`: grava;
- `promoteJunior`: grava;
- compra (`buyPlayer`): grava.

Um jogador do elenco inicial não tem o campo (AC 23, door 3).

Proof: `npx vitest run src/engine/market.test.ts -t "chegada registra a temporada"`

**C25** - ✓ Pôr «À venda» um jogador com `arrivedSeason` igual à temporada é recusado. A tela Mercado mostra «Chegou nesta temporada: só pode ser vendido na próxima». Com `arrivedSeason` da temporada anterior, ou sem o campo, é aceito (AC 24, door 3, L-007, L-008).

Proof: `npx vitest run src/engine/market.test.ts -t "trava de revenda na temporada de chegada"`
Proof: `npx vitest run src/ui/Market.test.tsx -t "trava de revenda na temporada de chegada"`

**C26** - ✓ Em 40 seeds, `closeRoundMarket` com todo o elenco à venda e um jogador de `arrivedSeason` igual à temporada nunca gera proposta por esse jogador (AC 25).

Proof: `npx vitest run src/engine/market.test.ts -t "sem proposta por quem chegou"`

**C27** - ✓ Em 40 seeds, com os 12 jogadores mais valiosos à venda, para cada comprador:
- a soma das propostas ≤ caixa;
- o elenco + as propostas ≤ 30 (AC 26).

Proof: `npx vitest run src/engine/market.test.ts -t "propostas cabem no comprador"`

**C28** - ✓ Aceitar uma proposta cujo comprador ficou com caixa menor que o valor é recusado. A proposta some da lista, e a tela mostra «O comprador desistiu da proposta». O mesmo acontece com um comprador com 30 jogadores (AC 27, L-008).

Proof: `npx vitest run src/engine/market.test.ts -t "comprador desistiu"`
Proof: `npx vitest run src/ui/Market.test.tsx -t "comprador desistiu"`

**C29** - ✓ O preço pedido por um DF 74 entre os 11 mais fortes é o mesmo nos três estados: saudável, com `injuryRounds` 1 e com condição 55. Os três custam 1,5 × o valor, com a conta feita no teste. Um jogador fora dos 11 mais fortes custa 1 × (AC 28, L-007).

Proof: `npx vitest run src/engine/market.test.ts -t "titular pela força no preço"`

**C30** - ✓ Depois da virada com 300 livres, restam 80, e o de menor força entre eles é ≥ o de maior força entre os podados (AC 29).

Proof: `npx vitest run src/engine/rollover.test.ts -t "poda dos livres"`

**C31** - ✓ Seed 5, sem usuário, 20 temporadas: a média dos 18 melhores de cada clube da Série A fica a no máximo 5 pontos da temporada 1 em todas as temporadas (AC 30).

Proof: `npx vitest run src/engine/balance.test.ts -t "força estável em 20 temporadas"`

**C32** - ✓ Na mesma simulação, o fim de cada temporada tem no máximo 10 dos 80 clubes com caixa negativo (AC 31).

Proof: `npx vitest run src/engine/balance.test.ts -t "caixa em 20 temporadas"`

**C33** - ✓ O ciclo que era o exploit, em seeds 5 e 21: contratar livres de melhor razão até 30, marcar à venda, aceitar tudo até a rodada 5. O caixa termina ≤ o de quem só jogou (AC 22–25).

Proof: `npx vitest run src/engine/balance.test.ts -t "revenda de livres não dá lucro"`

**C34** - ✓ As faixas de gastos-da-ia continuam verdes: C19 com a mediana revisada para entre 2× e 6,5× (máximo 15× mantido) e paises C24 com a mediana de AR e PT revisada para entre 1,2× e 6,5× (decisões do usuário, Impact do plano), e C20, C21 e C34 de lá e a vantagem do mandante sem mudar limite (Impact)

Proof: `npx vitest run src/engine/balance.test.ts -t "caixa em 5 temporadas"`
Proof: `npx vitest run src/engine/balance.test.ts -t "caixa em 5 temporadas dos países novos"`
Proof: `npx vitest run src/engine/balance.test.ts -t "compras da IA em 5 temporadas"`
Proof: `npx vitest run src/engine/balance.test.ts -t "força estável em 5 temporadas"`
Proof: `npx vitest run src/engine/balance.test.ts -t "caixa equilibrado em uma temporada"`
Proof: `npx vitest run src/engine/balance.test.ts -t "times iguais"`

**C73** - ✓ Seed 5, sem usuário, 20 temporadas: ao fim de cada temporada a mediana do caixa dos 80 clubes é ≤ 20 × a mediana do caixa inicial (AC 68)
Proof: `npx vitest run src/engine/balance.test.ts -t "caixa da IA limitado em 20 temporadas"`

### S5 - Regras de temporada e diretoria coerentes · 6 files · 43 KB · ~11k

**C35** - ✓ Tabela de `verdictFor` na Série A sobre as metas 13, 14, 15 e 16, cada uma com as posições 17 e 20: todas dão «fired» (AC 32, L-005).

Proof: `npx vitest run src/engine/board.test.ts -t "rebaixado é sempre demitido"`

**C36** - ✓ Tabela de `boardGoalFor` numa divisão sem rebaixamento (Série B e Argentina), sobre os postos 1–20: nenhuma meta passa de 17. O posto 14 dá 17 (AC 33, L-005).

Proof: `npx vitest run src/engine/board.test.ts -t "meta máxima sem rebaixamento"`

**C37** - ✓ Em divisão sem rebaixamento, sobre as metas 4, 12 e 17, terminar em 20º dá «fired» (AC 34).

Proof: `npx vitest run src/engine/board.test.ts -t "último lugar é demitido"`

**C38** - ✓ Com um jogador que marcou 2 gols pela Série A e depois foi para a Série B e marcou 3:
- a artilharia da Série B conta 3;
- a da Série A conta 2, com o clube em que ele marcou (AC 35).

Proof: `npx vitest run src/engine/season.test.ts -t "artilharia por liga"`

**C39** - ✓ Tabela de texto de eliminação da copa sobre as 6 fases da nacional e as 4 da continental: «Eliminado na Preliminar», «nos 16 avos», «nas Oitavas», «nas Quartas», «na Semifinal» e «na Final» (AC 36, L-005, L-008).

Proof: `npx vitest run src/ui/Cup.test.tsx -t "concordância da eliminação"`

**C40** - ✓ Tabela de número sobre N = 1 e N = 3:
- Elenco: «Falta 1 titular» / «Faltam 3 titulares»;
- Finanças: «Obras: 1 rodada» / «Obras: 3 rodadas» (AC 36, L-008).

Proof: `npx vitest run src/ui/Squad.test.tsx -t "concordância de titulares"`
Proof: `npx vitest run src/ui/Finance.test.tsx -t "concordância das obras"`

**C41** - ✓ Na virada, os juniores da base de um clube AR e de um clube PT têm nome da lista do país: prenome e sobrenome em `names` AR/PT, verificados no teste contra as listas (AC 37).

Proof: `npx vitest run src/engine/rollover.test.ts -t "base estrangeira com nome do país"`

### S6 - Partida coerente · 3 files · 46 KB · ~11k

**C42** - ✓ Com o slot GK vazio e o melhor jogador de linha em campo de força 80, a força de goleiro é 60 (80 × 0,75, conta no teste) (AC 38).

Proof: `npx vitest run src/engine/live.test.ts -t "goleiro efetivo sem goleiro"`

**C43** - ✓ 2000 partidas, seed fixa, contra time sem goleiro: a conversão de chutes no alvo fica < 0,8 (AC 39).

Proof: `npx vitest run src/engine/balance.test.ts -t "conversão sem goleiro"`

**C44** - ✓ IA com goleiro expulso:
- com substituição restante e goleiro reserva disponível, o slot GK recebe o reserva e sai um jogador de linha;
- sem substituição, nada muda;
- sem goleiro reserva, nada muda (AC 40, L-007).

Proof: `npx vitest run src/engine/live.test.ts -t "IA repõe goleiro expulso"`

**C45** - ✓ Com os 11 de força 70, `sideStrength` do ataque:
- 4-3-3 ≥ 1,2 × 4-5-1;
- defesa de 5-3-2 > defesa de 3-5-2 (AC 41).

Proof: `npx vitest run src/engine/live.test.ts -t "setor cresce com a contagem"`

**C46** - ✓ 2000 partidas com os mesmos clubes: os gols do mandante em 4-3-3 contra 4-4-2 são ≥ 1,05 × os gols em 4-5-1 contra 4-4-2 (AC 42).

Proof: `npx vitest run src/engine/balance.test.ts -t "formação muda o placar"`

**C47** - ✓ Tabela de `changeFormation` com 10 homens:
- expulso um DF, de 4-5-1 para 4-4-2: a vaga fica num slot DF;
- expulso o FW, de 4-4-2 para 4-5-1: a vaga fica no slot FW (AC 43, L-005).

Proof: `npx vitest run src/engine/live.test.ts -t "vaga fica no setor perdido"`

### S7 - Telas nas bordas · 10 files · 134 KB · ~34k

**C48** - ✓ A tela Rodada:
- após uma data de copa em que o usuário não joga, começa com a aba «Resultados» selecionada e o painel dela com `m-active`;
- numa data em que ele joga, começa em «Partida» (AC 44, L-007).

Proof: `npx vitest run src/ui/Round.test.tsx -t "aba inicial sem partida do usuário"`

**C49** - ✓ Tabela de oferta no Mercado: vazia, 0, −5 e 12,5. Em cada caso, o botão fica desligado ou a mensagem é «Valor inválido», e «Jogador não encontrado» nunca aparece (AC 45, L-005, L-008).

Proof: `npx vitest run src/ui/Market.test.tsx -t "oferta inválida"`

**C50** - ✓ Num jogador do jogo do usuário vendido para outra divisão no fechamento da rodada:
- a narração da Rodada mostra o nome dele e não contém o id cru;
- o mesmo vale na tela Ao vivo (AC 46).

Proof: `npx vitest run src/ui/Round.test.tsx -t "narração com jogador que mudou de clube"`
Proof: `npx vitest run src/ui/Live.test.tsx -t "narração sem id cru"`

**C51** - ✓ Tabela sobre três origens de erro:
- exceção no `tick` do relógio;
- promise rejeitada em `finishLive`;
- evento `unhandledrejection`.

Nas três, a tela mostra «Algo deu errado» e «Exportar jogo» (AC 47, L-005).

Proof: `npx vitest run src/ui/ErrorBoundary.test.tsx -t "erro fora do render"`

**C52** - ✓ Nas abas:
- cada `role="tab"` tem `aria-controls` apontando para um `role="tabpanel"` existente;
- seta direita e seta esquerda mudam a aba selecionada;
- no Elenco em desktop, uma aba visível começa com `aria-selected="true"` (AC 48).

Proof: `npx vitest run src/ui/ScreenTabs.test.tsx -t "abas acessíveis"`
Proof: `npx vitest run src/ui/Squad.test.tsx -t "aba selecionada visível no desktop"`

**C53** - ✓ O cartão amarelo do Ao vivo e a seta de moral da Condição têm `role="img"` e o `aria-label` «amarelo» e o da moral (AC 49).

Proof: `npx vitest run src/ui/Live.test.tsx -t "ícones rotulados"`
Proof: `npx vitest run src/ui/Condition.test.tsx -t "ícones rotulados"`

**C54** - ✓ Tabela sobre as 4 confirmações (Novo jogo, Dispensar, Renovar, Ampliar): ao abrir, `document.activeElement` é o botão principal da confirmação (AC 50, L-005).

Proof: `npx vitest run src/ui/Home.test.tsx -t "foco na confirmação"`
Proof: `npx vitest run src/ui/Squad.test.tsx -t "foco na confirmação"`
Proof: `npx vitest run src/ui/Finance.test.tsx -t "foco na confirmação"`

**C55** - ✓ Nenhum `font-size` em `src/styles.css` fica abaixo de 0,65rem, verificado por varredura de todos os valores `rem`/`em`/`px` do arquivo (AC 51).

Proof: `npx vitest run src/launch.test.ts -t "fonte mínima"`

### S8 - Som que respeita a aba · 4 files · 29 KB · ~7k

**C56** - ✓ Com `doc.hidden = true` e o evento `visibilitychange`, 6 eventos de partida não chegam ao backend como efeito. Depois de `hidden = false`, o próximo evento toca e nenhum dos 6 é tocado (AC 52).

Proof: `npx vitest run src/audio/sfx.test.ts -t "aba escondida não acumula efeitos"`

**C57** - ✓ Desmontar a tela Ao vivo com a torcida tocando chama `crowd("over")` (AC 53).

Proof: `npx vitest run src/ui/Live.test.tsx -t "desmontar para a torcida"`

**C58** - ✓ Com o download de `abertura.mp3` falhando na primeira vez e a rede de volta, a próxima vez que o contexto «home» toca baixa de novo e começa a faixa (AC 54).

Proof: `npx vitest run src/audio/music.test.ts -t "falha de download tenta de novo"`

### S9 - Guardas que guardam · 12 files · 70 KB · ~17k

**C59** - ✓ `deps.test`:
- varre todo arquivo de `src/` exceto `engine/rng.ts` e `*.test.*` procurando `Math.random` (inclusive via `globalThis`);
- varre `src/engine/` procurando import estático e `import()` de `react`, `react-dom`, `zustand` e `idb`.

Uma autoverificação sobre textos de exemplo mostra que a busca pega cada forma (AC 55, L-005).

Proof: `npx vitest run src/deps.test.ts -t "Math.random fora do Rng"`
Proof: `npx vitest run src/deps.test.ts -t "motor sem dependência de UI"`

**C60** - ✓ Um texto em `src/engine/x.ts` com `globalThis.Math.random()` e outro com `import("react")`, passados ao ESLint programaticamente, dão erro cada um (AC 56).

Proof: `npx vitest run src/deps.test.ts -t "eslint barra as formas indiretas"`

**C61** - ✓ `narration.test`: - Superseded por penaltis C8
- uma tabela com a linha literal esperada de cada tipo de evento que `narrate` trata, todos, com nome de jogador e de clube;
- os testes de match e live que percorrem os tipos afirmam que o texto não contém `playerId` nem `clubId` (AC 57, L-005).

Proof: `npx vitest run src/engine/narration.test.ts -t "linha de cada tipo de evento"`
Proof: `npx vitest run src/engine/match.test.ts -t "todos os tipos de evento ocorrem e têm narração"`
Proof: `npx vitest run src/engine/live.test.ts -t "todos os 10 tipos de evento ocorrem e têm narração"`

**C62** - ✓ O script de seletores varre `.specs/features/*/checks.md` e termina com 0 seletores órfãos. Os checks que eram órfãos estão marcados «Superseded por <feature> <check>» (AC 58).

Proof: `npx vitest run src/launch.test.ts -t "provas dos checks existem"`

**C63** - ✓ A migração v7→v8:
- sorteia a continental igual a um replay feito no teste com `createRng(mix32(seed, 8))`;
- joga as partidas com `mix32(seed, 9)`.

Trocar o sal faz o teste falhar (AC 59).

Proof: `npx vitest run src/engine/migrate.test.ts -t "sementes da migração v8"`

**C64** - ✓ `layout-check.mjs --seed=3` usa a seed 3, e sem a flag usa a seed 1: o script imprime `seed <n>`, verificado pelo selftest (AC 60).

Proof: `npm run check:layout:selftest`

**C65** - ✓ O C13 da copa continental conta o amarelo pelo `playerId` do evento: um amarelo de outro jogador na mesma partida não conta (AC 61, L-007).

Proof: `npx vitest run src/engine/continental.test.ts -t "amarelo ligado ao evento"`

**C66** - ✓ Exportar chama `URL.revokeObjectURL` só depois do `setTimeout`: antes de avançar os timers, 0 chamadas; depois, 1 com a URL criada (AC 62).

Proof: `npx vitest run src/ui/download.test.ts -t "revoga a url depois do clique"`

**C67** - ✓ `vite.config.ts` define `test.maxWorkers: 4` (AC 63).

Proof: `npx vitest run src/launch.test.ts -t "vitest limita workers"`

**C68** - ✓ O `layout-check`:
- tem timeout de animações de 20000 ms;
- depois da execução com falha e da normal do selftest, nenhum diretório `layout-check-*` criado por elas fica em `%TEMP%` (AC 64).

Proof: `npm run check:layout:selftest`

**C69** - ✓ O selftest termina com código ≠ 0 quando a execução normal sai com 1, comprovado por uma flag de injeção que força a falha normal (AC 65).

Proof: `npm run check:layout:selftest`

**C70** - ✓ `deploy.yml` roda `npm run check:dist` depois do `npm run build`, e `package.json` tem `check:dist` = `node scripts/dist-check.mjs` (AC 66).

Proof: `npx vitest run src/launch.test.ts -t "deploy roda o dist-check"`

**C71** - ✓ O `index.html` tem:
- `og:image` com URL absoluta `https://arthuurw.github.io/forzion.tech-futmanager/og-image.png`;
- `og:url`;
- `apple-touch-icon` relativo;
- `manifest.webmanifest` relativo.

Os PNGs em `public/` têm 1200×630 e 180×180, lidos do cabeçalho IHDR (AC 67).

Proof: `npx vitest run src/launch.test.ts -t "metadados de compartilhamento"`

**C72** - ✓ A suíte inteira, o lint, o build e o dist-check passam no HEAD final (todas as slices).

Proof: `npm test`
Proof: `npm run lint`
Proof: `npm run build`
Proof: `npm run check:dist`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| doors do plano (3) | 1 `pendingLive` C13 · C14 · C15 · 2 web locks C7 · C8 · C9 · 3 `arrivedSeason` C24 · C25 | - |
| campos exigidos no import (6) | C3, table-driven sobre os 6 | - |
| estados de `saveStatus` na faixa (3) | C10, table-driven sobre os 3 | - |
| ações de escalação gravadas (3) | C11, table-driven sobre as 3 | - |
| aptos vs mínimo (4 bordas) | 12 C17 · 11 C17 · 10 C17 · 7 C17 | - |
| gravação de `arrivedSeason` (3 caminhos) | C24, table-driven sobre os 3 | - |
| metas com rebaixado (4) | 13 C35 · 14 C35 · 15 C35 · 16 C35 | - |
| fases no texto de eliminação (6) | Preliminar C39 · 16 avos C39 · Oitavas C39 · Quartas C39 · Semifinal C39 · Final C39 | - |
| textos com número (4) | «Falta 1 titular» C20 · «Faltam N titulares» C20 · «Obras: 1 rodada» C40 · «Obras: N rodadas» C40 | - |
| origens de erro fora do render (3) | C51, table-driven sobre as 3 | - |
| confirmações com foco (4) | Novo jogo C54 · Dispensar C54 · Renovar C54 · Ampliar C54 | - |
| ofertas inválidas (4) | C49, table-driven sobre as 4 | - |
| tipos de evento narrados (12) | C61, table-driven sobre os 12 de `MatchEventType` | - |
| pacotes proibidos no motor (4) | `react` C59 · `react-dom` C59 · `zustand` C59 · `idb` C59 | - |

Achados → checks:

| Achado | Checks |
| --- | --- |
| persist/P1, critic/C1 | C1, C2, C10 |
| persist/P2 | C7–C9 |
| persist/P3 | C3–C6 |
| persist/P4 | C13–C15 |
| persist/P5, ui/I3, spec/S3 | C11, C12 |
| spec/S1, comp/C4, eco/M3, critic/C2 | C16–C19 |
| ui/I4 | C20 |
| sim/M1, spec/S2, ui/I2 | C21, C22 |
| eco/M1 | C23–C26, C33 |
| eco/M5 | C27, C28 |
| eco/M2 | C29 |
| eco/M4 | C30 |
| comp/C1 | C31, C32 |
| comp/C2 | C35 |
| comp/C3 | C36, C37 |
| comp/C5 | C38 |
| ui/I8 | C39, C40 |
| comp/C6 | C41 |
| sim/M2 | C42–C44 |
| sim/M3 | C45, C46 |
| sim/M4 | C45, C47 |
| ui/I1 | C48 |
| ui/I5 | C49 |
| ui/I6 | C50 |
| ui/I7 | C51 |
| ui/I9 | C52–C55 |
| audio/A1 | C56 |
| audio/A2 | C57 |
| audio/A3 | C58 |
| conv/C1 | C59, C60 |
| conv/C3 | C61 |
| spec/S5 | C62 |
| spec/S4 | C63–C66 |
| conv/C2 | C67 |
| layout-check sob carga (baseline) | C68, C69 |
| audio/D2 | C70 |
| audio/D3 | C71 |

- Faixas estatísticas (C31, C32, C43, C46) usam seeds fixas; cada uma decide numa execução.
- Nenhum outro check afirma mais do que o caso que a prova exercita.

## Swept

- validation: C3, C4, C49
- failure modes: C1, C5, C6, C10, C51, C58
- idempotency: C14 - reabrir com o marcador fecha a data uma vez e apaga o marcador; um segundo `init` abre sem jogar (C15)
- authorization: n/a - jogo local sem conta; a única exclusão entre donos é a das abas (C7, C8)
- concurrency: C7, C8, C12
- data lifecycle: C30 (poda dos livres), C13 (marcador limpo)
- dependency failure: C1 (IndexedDB), C9 (sem Web Locks), C58 (rede da música)
- state transitions: C13, C14, C16, C35–C37
- observability: n/a - SPA sem telemetria (AD-001); o que o usuário precisa ver vira texto de tela (C1, C6, C20)

## Handoff

Tamanhos por `wc -c` dos arquivos que cada slice toca (produção + testes), divididos por 4. A contagem é só de leitura; os arquivos compartilhados entre slices (`store.ts`, `lineup.ts`, `Round.tsx`, `Squad.tsx`, `Market.tsx`) entram em mais de uma.

- S1 21k + S2 22k + S3 6k + S4 32k = 81k: store, persistência, lineup e mercado
- com S5 (11k) e S6 (11k), o motor fecha em 103k
- S7 (34k) entra nas telas: 137k; S8 (7k): 144k; S9 (17k): 161k. Passa do budget de 150k
- corte proposto na troca de superfície, depois de S6:
  - lote A = S1–S6 (103k, store + motor);
  - lote B = S7–S9 (58k, telas + som + guardas)
- Mechanism: handoff - escolha do usuário; lote B só começa com o lote A verde
- **Boundary:** C1-C47 + C73 closed at `4b75b7f`. Tabela de evolução calibrada `[[1,4],[0,3],[-1,1],[-2,0],[-4,-1],[-6,-2]]` e medianas de caixa revisadas pelo usuário (gastos-da-ia C19 e paises C24, até 6,5×). Seed 5, 20 temporadas: deriva máxima 3,22, no máximo 1 clube no vermelho, mediana do caixa no máximo 16,05× a inicial; 5 temporadas: Brasil 1,37 / 5,86 / 14,84, AR mediana 5,54, PT 2,86. Antes da decisão, a mesma tabela deixava as medianas acima de 4 (C31 e C32 abertos em `adc9491`)
- **Settled mid-build:** fixture do C16 com os 9 do elenco em 95 (o teto), para a média ser inteira como na regra da IA, que arredonda; a marca da door 1 fecha a data e abre «Rodada», ou «Fim» se era a última rodada, como qualquer data ao vivo; as gravações passam por uma fila no estado da store, então o slot termina com a última; força do setor × √(vagas / vagas do 4-4-2), o 4-4-2 não muda (gols do mandante 1,91 em 4-3-3 e 1,36 em 4-5-1 contra 4-4-2; conversão contra time sem goleiro 0,505); o acréscimo de titular pelos 11 mais fortes vale para o preço pedido ao usuário, a compra entre clubes da IA segue com `aiLineup`; a poda dos livres mantém a ordem da lista; a prova de tela do C25 aciona a store com o Mercado aberto (a caixa «À venda» fica no Elenco, e um teste extra do Elenco clica nela); recusa com estado novo (`buyer_gone`) grava e mostra lista e mensagem juntas; as sondas de evolução e aposentadoria do `rollover.test` foram da lista de livres para um clube da IA sob contrato (a lista agora para em 80), com as mesmas afirmações; as fixtures de ida e volta e do save v1 do `saveFile.test` dão escalação ao clube do usuário (C3); partida-ao-vivo C12 marcado Superseded pelo C14, e o teste virou «recarregar no meio da rodada fecha a data»
- **Abandoned:** a tabela de evolução calibrada acima (fecha C31/C32, abre o C34) - revertida à de multiplas-temporadas; salário de renovação da IA que nunca cai, junto dessa tabela (fora do plano, só medido): mediana 4,64, máximo 15,12, deriva 4,07 - ainda vermelho; gravar a marca antes de entrar no ao vivo - quebrava o início síncrono da partida de que a tela Ao vivo depende, a marca entra na fila antes; fila de gravação em variável de módulo - uma gravação presa sob relógio falso travava os testes seguintes
- **Boundary:** C48-C72 closed at `f30750a`. Gate no HEAD: `npm test` 45 arquivos, 555 testes; lint, build e `check:dist` verdes; `check:layout:selftest` sai com 0 (seed 3 com falha em squad, seed 1 com as 14 telas, e o selftest com `--fail-normal` sai com 1). `proof-check`: 590 seletores, 21 de checks Superseded, 0 órfãos
- **Settled mid-build:** `--seed` chega ao jogo pelo parâmetro `?seed=<n>` do endereço, que o «Novo jogo» passa ao `store.newGame` (linha em Surface, reversível; o script imprime a semente relida do save); `og:url`/`og:image` absolutos e o `manifest.webmanifest` (`display: "browser"`, sem `id`, então não instala como app) foram julgados reversíveis, sem linha em Landing; os PNGs saem de `scripts/share-images.mjs` pelo Chrome headless; C55 conta todo valor `rem`/`em`/`px` das declarações de fonte, e os `em` menores que 1 viraram `max(0.65rem, Xem)`, o `.logo-sub` virou o mesmo tamanho em rem; C62 marcou 17 checks antigos «Superseded por <feature> <check>» pelas tabelas de Superseded, e três seletores com `+` ou parênteses (partida-ao-vivo C37, C40, multiplas-temporadas C56) foram escapados, porque o `-t` do vitest é regex e eles selecionavam 0 testes; a oferta do Mercado fica como texto digitado (vazia fica vazia) e o motor recusa valor ruim com `invalid`; a Rodada sem partida do usuário não mostra a aba «Partida»; o C52 trocou a consulta `region` por `tabpanel` nos testes que liam as seções que viraram painéis (37 consultas, mesmo nome); o C61 renomeou o teste do match para o nome da prova e o do live passou a usar o contexto com todos os clubes; o selftest do C69 roda a si mesmo com `--fail-normal` (4 execuções, cerca de 2,5 min)
- **Abandoned:** `tabpanel` num invólucro com `display: contents` para manter as seções como `region` - arriscava o layout e o papel no leitor de tela; ler `--seed` por override de `Date.now` na página - a semente do jogo não seria a pedida; depender do evento `error` do jsdom para o `tick` - com relógio falso a exceção sai do `advanceTimers`, então o intervalo do Ao vivo captura e chama `crash`
