import { userBoardGoal } from "./board";
import { newGame } from "./generate";
import { AI_FORMATION, autoLineup } from "./lineup";
import { migrateSave } from "./migrate";
import { nextSeason } from "./rollover";
import { nextDate } from "./calendar";
import { playDate, playRound } from "./season";
import { decodeSaveFile, encodeSaveFile, saveFileName } from "./saveFile";
import { v1Document, v7Document } from "./test-fixtures";
import type { GameState } from "./types";

const ISO = "2026-09-28T12:00:00.000Z";

function withClub(seed = 1): GameState {
  const state = newGame(seed);
  const club = state.leagues[0]!.clubs[0]!;
  state.userClubId = club.id;
  state.boardGoal = userBoardGoal(state);
  club.lineup = autoLineup(club, AI_FORMATION);
  return state;
}

function played(state: GameState, rounds: number): GameState {
  let s = state;
  for (let i = 0; i < rounds; i++) s = playRound(s).state;
  return s;
}

const envelope = (save: unknown) => JSON.stringify({ format: "forzion-futmanager-save", exportedAt: ISO, save });

describe("arquivo de save (lancamento door 1)", () => {
  test("envelope tem só format, exportedAt e save", () => {
    const game = withClub();
    const parsed = JSON.parse(encodeSaveFile(game, ISO)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["exportedAt", "format", "save"]);
    expect(parsed.format).toBe("forzion-futmanager-save");
    expect(parsed.exportedAt).toBe(ISO);
    expect(parsed.save).toEqual(game);
  });

  test("nome do arquivo sem acento e com hífen", () => {
    expect(saveFileName(2026, "São Paulo")).toBe("forzion-futmanager-t2026-sao-paulo.json");
    expect(saveFileName(3, "Rubro-Negro Carioca")).toBe("forzion-futmanager-t3-rubro-negro-carioca.json");
    expect(saveFileName(1, "Grêmio  Porto-Alegrense")).toBe("forzion-futmanager-t1-gremio-porto-alegrense.json");
  });

  test("ida e volta devolve o mesmo jogo", () => {
    const fresh = withClub(4);
    const midSeason = played(withClub(5), 20);
    let second = newGame(6);
    while (nextDate(second).kind !== "over") second = playDate(second).state;
    second = nextSeason(second).state;
    second.userClubId = second.leagues[0]!.clubs[3]!.id;
    // Correcoes-validacao C3: the user's club has a lineup, as after choosing it.
    second.leagues[0]!.clubs[3]!.lineup = autoLineup(second.leagues[0]!.clubs[3]!, AI_FORMATION);
    expect(second.history.length).toBeGreaterThan(0);
    for (const g of [fresh, midSeason, second]) {
      const r = decodeSaveFile(encodeSaveFile(g, ISO));
      expect(r.kind).toBe("ok");
      if (r.kind === "ok") expect(r.state).toEqual(g);
    }
  });

  test("save antigo chega migrado", () => {
    const v7 = v7Document(3, 4);
    const r7 = decodeSaveFile(envelope(v7));
    expect(r7.kind).toBe("ok");
    const expected = migrateSave(v7);
    if (r7.kind === "ok" && expected.kind === "ok") expect(r7.state).toEqual(expected.state);
    else throw new Error("v7 did not migrate");
    // Correcoes-validacao C3: the user's club needs its lineup, so the v1 save keeps its own user
    // club (which has one) instead of pointing at a club without.
    const v1 = v1Document(3);
    const r1 = decodeSaveFile(envelope(v1));
    expect(r1.kind).toBe("ok");
    if (r1.kind === "ok") expect(r1.state.schemaVersion).toBe(8);
  });

  test("texto que não é JSON", () => {
    expect(decodeSaveFile("isto não é json")).toEqual({ kind: "invalid_json" });
    expect(decodeSaveFile("")).toEqual({ kind: "invalid_json" });
  });

  test("JSON que não é arquivo de save", () => {
    const game = withClub();
    const cases = [
      JSON.stringify({ exportedAt: ISO, save: game }),
      JSON.stringify({ format: "outro-jogo", exportedAt: ISO, save: game }),
      JSON.stringify([game]),
      "null",
      JSON.stringify(game),
    ];
    for (const text of cases) expect(decodeSaveFile(text), text.slice(0, 60)).toEqual({ kind: "not_a_save" });
  });

  test("versão não suportada", () => {
    expect(decodeSaveFile(envelope({ ...withClub(), schemaVersion: 9 }))).toEqual({ kind: "unsupported_version", version: 9 });
  });

  test("save v8 sem a forma de um jogo", () => {
    const breaks: [string, (s: Record<string, unknown>) => void][] = [
      ["leagues ausente", (s) => delete s.leagues],
      ["leagues vazio", (s) => (s.leagues = [])],
      ["liga sem clubs em lista", (s) => ((s.leagues as Record<string, unknown>[])[1]!.clubs = "x")],
      ["market ausente", (s) => delete s.market],
      ["history não lista", (s) => (s.history = {})],
      ["cups não lista", (s) => (s.cups = null)],
      ["seed não inteiro", (s) => (s.seed = 1.5)],
      ["rngState não inteiro", (s) => (s.rngState = "7")],
      ["season não inteiro", (s) => (s.season = null)],
      ["userClubId fora das ligas", (s) => (s.userClubId = "nenhum")],
    ];
    expect(breaks).toHaveLength(10);
    for (const [name, brk] of breaks) {
      const s = JSON.parse(JSON.stringify(withClub())) as Record<string, unknown>;
      brk(s);
      expect(decodeSaveFile(envelope(s)), name).toEqual({ kind: "malformed" });
    }
    expect(decodeSaveFile(envelope(withClub())).kind).toBe("ok");
  });
});

describe("save importado íntegro (correcoes-validacao)", () => {
  test("validação profunda do save importado", () => {
    // C3 (AC 4, L-005, L-007): a valid v8 save with one field taken out at a time.
    const start = newGame(8);
    const mine = start.leagues[0]!.clubs[5]!;
    start.userClubId = mine.id;
    start.boardGoal = userBoardGoal(start);
    mine.lineup = autoLineup(mine, AI_FORMATION);
    const game = played(start, 3);
    const breaks: [string, (s: GameState) => void][] = [
      ["leagues[0].rounds", (s) => delete (s.leagues[0] as Partial<GameState["leagues"][0]>).rounds],
      ["leagues[0].currentRound", (s) => delete (s.leagues[0] as Partial<GameState["leagues"][0]>).currentRound],
      ["clubs[0].players", (s) => delete (s.leagues[0]!.clubs[0] as Partial<GameState["leagues"][0]["clubs"][0]>).players],
      ["clubs[0].finance", (s) => delete (s.leagues[0]!.clubs[0] as Partial<GameState["leagues"][0]["clubs"][0]>).finance],
      ["clubs[0].forSale", (s) => delete (s.leagues[0]!.clubs[0] as Partial<GameState["leagues"][0]["clubs"][0]>).forSale],
      [
        "lineup do clube do usuário",
        (s) => delete (s.leagues.flatMap((l) => l.clubs).find((c) => c.id === s.userClubId) as Partial<GameState["leagues"][0]["clubs"][0]>).lineup,
      ],
    ];
    expect(breaks).toHaveLength(6);
    // The user is not club 0 of the first league, so the club fields and the lineup are two cases.
    expect(game.userClubId).not.toBe(game.leagues[0]!.clubs[0]!.id);
    for (const [name, brk] of breaks) {
      const s = JSON.parse(JSON.stringify(game)) as GameState;
      brk(s);
      expect(decodeSaveFile(encodeSaveFile(s, ISO)), name).toEqual({ kind: "malformed" });
    }
    expect(decodeSaveFile(encodeSaveFile(game, ISO))).toEqual({ kind: "ok", state: game });
  });
});

describe("carreira no arquivo (carreira-dinamica)", () => {
  test("proposta pendente no arquivo", () => {
    // C19 (AC 26): an offer naming a club that does not exist, or the user's own, is refused.
    const game = withClub();
    const other = game.leagues[1]!.clubs[0]!.id;
    const withJob = (clubIds: string[]) => envelope({ ...game, pendingJob: { reason: "offer", clubIds } });
    expect(decodeSaveFile(withJob(["no-such-club"])).kind).toBe("malformed");
    expect(decodeSaveFile(withJob([other, game.userClubId!])).kind).toBe("malformed");
    const ok = decodeSaveFile(withJob([other]));
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") expect(ok.state.pendingJob).toEqual({ reason: "offer", clubIds: [other] });
    expect("pendingJob" in game).toBe(false);
    expect(decodeSaveFile(envelope(game)).kind).toBe("ok");
  });

  test("carreira no arquivo", () => {
    // C2: absent and two moves import unchanged; one wrong field at a time is refused.
    const g = withClub(3);
    expect("career" in g).toBe(false);
    expect(decodeSaveFile(encodeSaveFile(g, ISO))).toEqual({ kind: "ok", state: g });
    const [me, x, y] = [g.userClubId!, g.leagues[0]!.clubs[6]!.id, g.leagues[1]!.clubs[1]!.id];
    const moves: NonNullable<GameState["career"]> = [
      { season: 1, round: 14, fromId: y, toId: x, reason: "fired" },
      { season: 2, round: 38, fromId: x, toId: me, reason: "offer" },
    ];
    const s = { ...g, career: moves };
    expect(decodeSaveFile(encodeSaveFile(s, ISO))).toEqual({ kind: "ok", state: s });
    const edit = (change: Record<string, unknown>) => [moves[0], { ...moves[1], ...change }];
    const cases: [string, unknown][] = [
      ["career objeto", { 0: moves[0] }],
      ["item null", [moves[0], null]],
      ["season 1.5", edit({ season: 1.5 })],
      ["round texto", edit({ round: "3" })],
      ["fromId inexistente", edit({ fromId: "no-such-club" })],
      ["toId inexistente", edit({ toId: "no-such-club" })],
      ["reason quit", edit({ reason: "quit" })],
    ];
    expect(cases).toHaveLength(7);
    for (const [name, career] of cases) expect(decodeSaveFile(envelope({ ...g, career })), name).toEqual({ kind: "malformed" });
  });
});

describe("empréstimo no arquivo (emprestimos)", () => {
  test("empréstimo atravessa o arquivo", () => {
    // C16 (door 1): two players on loan, one each way, export and import unchanged.
    const g = withClub(4);
    const [me, x] = [g.leagues[0]!.clubs[0]!, g.leagues[0]!.clubs[3]!];
    const out = me.players.pop()!;
    x.players.push({ ...out, loanFrom: me.id });
    const inn = x.players.shift()!;
    me.players.push({ ...inn, loanFrom: x.id });
    const r = decodeSaveFile(encodeSaveFile(g, ISO));
    expect(r).toEqual({ kind: "ok", state: g });
    if (r.kind !== "ok") throw new Error(r.kind);
    const loaned = r.state.leagues.flatMap((l) => l.clubs).flatMap((c) => c.players).filter((p) => p.loanFrom);
    expect(loaned.map((p) => [p.id, p.loanFrom]).sort()).toEqual([[out.id, me.id], [inn.id, x.id]].sort());
  });
});

describe("notícias no arquivo (noticias)", () => {
  /** One item of each of the 8 kinds, league and cup dates, clubs from both leagues and the user's. */
  function newsOfEveryKind(g: GameState): NonNullable<GameState["news"]> {
    const [me, x, y] = [g.userClubId!, g.leagues[0]!.clubs[4]!.id, g.leagues[1]!.clubs[2]!.id];
    const league = { kind: "league", round: 3 } as const;
    const cup = { kind: "cup", cupId: "cup-nat", phase: 0 } as const;
    return [
      { season: 1, date: league, kind: "injury", playerName: "Fulano", rounds: 2 },
      { season: 1, date: league, kind: "suspension", playerName: "Beltrano", rounds: 1 },
      { season: 1, date: cup, kind: "suspension", playerName: "Beltrano", rounds: 1, cupId: "cup-nat" },
      { season: 1, date: league, kind: "rating", playerName: "Ciclano", rating: 71, delta: 1 },
      { season: 1, date: league, kind: "rating", playerName: "Ciclano", rating: 70, delta: -1 },
      { season: 1, date: league, kind: "offer", playerName: "Fulano", clubId: x, amount: 900_000 },
      { season: 1, date: league, kind: "transfer", playerName: "Fulano", fromId: me, toId: y, amount: 1_200_000 },
      { season: 1, date: league, kind: "board", warnings: 2 },
      { season: 2, date: league, kind: "job", clubIds: [x, y] },
      { season: 2, date: cup, kind: "cup", cupId: "cup-nat", phase: 0, result: "advanced", opponentId: x },
      { season: 2, date: cup, kind: "cup", cupId: "cup-nat", phase: 1, result: "champion", opponentId: y },
      { season: 2, date: cup, kind: "cup", cupId: "cup-nat", phase: 0, result: "out", opponentId: y },
    ];
  }

  test("notícias atravessam o arquivo", () => {
    // C12 of noticias (door 1) and C3: every kind, both dates, export and import unchanged.
    const g = withClub(6);
    g.news = newsOfEveryKind(g);
    expect(new Set(g.news.map((n) => n.kind)).size).toBe(8);
    expect(decodeSaveFile(encodeSaveFile(g, ISO))).toEqual({ kind: "ok", state: g });
    // C3: the engine keeps at most 60, and 60 is accepted.
    const full = withClub(6);
    full.news = Array.from({ length: 60 }, (_, i) => ({ season: 1, date: { kind: "league", round: i + 1 }, kind: "board", warnings: 1 }) as const);
    expect(decodeSaveFile(encodeSaveFile(full, ISO))).toEqual({ kind: "ok", state: full });
    // C3: a save from before the news has none, and imports.
    const before = withClub(6);
    expect("news" in before).toBe(false);
    expect(decodeSaveFile(encodeSaveFile(before, ISO))).toEqual({ kind: "ok", state: before });
  });

  test("notícias no arquivo recusa a forma errada", () => {
    // C3 (L-005, L-007): one wrong field at a time over a valid list; ids refused are not of the game.
    const g = withClub(6);
    const valid = newsOfEveryKind(g);
    const at = (kind: string) => valid.findIndex((n) => n.kind === kind);
    const edit = (i: number, change: Record<string, unknown>) => valid.map((n, j) => (j === i ? { ...n, ...change } : n));
    const cases: [string, unknown][] = [
      ["news objeto", { 0: valid[0] }],
      ["61 itens", Array.from({ length: 61 }, (_, i) => ({ season: 1, date: { kind: "league", round: i + 1 }, kind: "board", warnings: 1 }))],
      ["item null", [...valid, null]],
      ["kind goal", edit(0, { kind: "goal" })],
      ["season texto", edit(0, { season: "1" })],
      ["date.kind week", edit(0, { date: { kind: "week", round: 3 } })],
      ["data de liga round 1.5", edit(0, { date: { kind: "league", round: 1.5 } })],
      ["data de copa cupId número", edit(0, { date: { kind: "cup", cupId: 7, phase: 0 } })],
      ["data de copa phase texto", edit(0, { date: { kind: "cup", cupId: "cup-nat", phase: "0" } })],
      ["injury rounds texto", edit(at("injury"), { rounds: "2" })],
      ["injury sem playerName", valid.map((n, j) => (j === at("injury") ? { season: 1, date: n.date, kind: "injury", rounds: 2 } : n))],
      ["suspension cupId número", edit(at("suspension"), { cupId: 7 })],
      ["rating delta 2", edit(at("rating"), { delta: 2 })],
      ["rating rating texto", edit(at("rating"), { rating: "70" })],
      ["offer clubId inexistente", edit(at("offer"), { clubId: "no-such-club" })],
      ["offer amount texto", edit(at("offer"), { amount: "900000" })],
      ["transfer fromId inexistente", edit(at("transfer"), { fromId: "no-such-club" })],
      ["transfer toId inexistente", edit(at("transfer"), { toId: "no-such-club" })],
      ["board warnings texto", edit(at("board"), { warnings: "1" })],
      ["job clubIds vazio", edit(at("job"), { clubIds: [] })],
      ["job clubIds inexistente", edit(at("job"), { clubIds: [g.leagues[0]!.clubs[4]!.id, "no-such-club"] })],
      ["cup result lost", edit(at("cup"), { result: "lost" })],
      ["cup opponentId inexistente", edit(at("cup"), { opponentId: "no-such-club" })],
      ["cup phase texto", edit(at("cup"), { phase: "0" })],
    ];
    expect(cases).toHaveLength(24);
    for (const [name, news] of cases) expect(decodeSaveFile(envelope({ ...g, news })), name).toEqual({ kind: "malformed" });
    expect(decodeSaveFile(envelope({ ...g, news: valid })).kind).toBe("ok");
  });

  test("notícias no arquivo recusa os demais campos", () => {
    // C4: the kind fields the table above left out, one at a time over the same valid list.
    const g = withClub(6);
    const valid = newsOfEveryKind(g);
    const at = (kind: string) => valid.findIndex((n) => n.kind === kind);
    const edit = (i: number, change: Record<string, unknown>) => valid.map((n, j) => (j === i ? { ...n, ...change } : n));
    const without = (i: number, field: string) => valid.map((n, j) => (j === i ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== field)) : n));
    const cases: [string, unknown][] = [
      ["suspension sem playerName", without(at("suspension"), "playerName")],
      ["suspension rounds texto", edit(at("suspension"), { rounds: "1" })],
      ["rating sem playerName", without(at("rating"), "playerName")],
      ["offer sem playerName", without(at("offer"), "playerName")],
      ["transfer sem playerName", without(at("transfer"), "playerName")],
      ["transfer amount texto", edit(at("transfer"), { amount: "1200000" })],
      ["cup cupId número no item", edit(at("cup"), { cupId: 7 })],
    ];
    expect(cases).toHaveLength(7);
    for (const [name, news] of cases) expect(decodeSaveFile(envelope({ ...g, news })), name).toEqual({ kind: "malformed" });
    expect(decodeSaveFile(envelope({ ...g, news: valid })).kind).toBe("ok");
  });

  test("notícias no arquivo recusa valores fora do motor", () => {
    // C4 of ajustes-importacao (L-005, L-007): bounds the engine never crosses, one field at a time,
    // next to the edge values it does write.
    const g = withClub(6);
    const valid = newsOfEveryKind(g);
    const at = (kind: string) => valid.findIndex((n) => n.kind === kind);
    const cupAt = valid.findIndex((n) => n.date.kind === "cup");
    const edit = (i: number, change: Record<string, unknown>) => valid.map((n, j) => (j === i ? { ...n, ...change } : n));
    const refused: [string, unknown][] = [
      ["season 0", edit(0, { season: 0 })],
      ["data de liga round 0", edit(0, { date: { kind: "league", round: 0 } })],
      ["data de copa phase -1", edit(cupAt, { date: { kind: "cup", cupId: "cup-nat", phase: -1 } })],
      ["injury rounds 0", edit(at("injury"), { rounds: 0 })],
      ["suspension rounds 0", edit(at("suspension"), { rounds: 0 })],
      ["board warnings 0", edit(at("board"), { warnings: 0 })],
      ["board warnings 4", edit(at("board"), { warnings: 4 })],
      ["offer amount -1", edit(at("offer"), { amount: -1 })],
      ["transfer amount -1", edit(at("transfer"), { amount: -1 })],
      ["cup phase -1", edit(at("cup"), { phase: -1 })],
      ["injury playerName vazio", edit(at("injury"), { playerName: "" })],
      ["suspension playerName vazio", edit(at("suspension"), { playerName: "" })],
      ["rating playerName vazio", edit(at("rating"), { playerName: "" })],
      ["offer playerName vazio", edit(at("offer"), { playerName: "" })],
      ["transfer playerName vazio", edit(at("transfer"), { playerName: "" })],
      ["injury playerName só espaços", edit(at("injury"), { playerName: "  " })],
    ];
    expect(refused).toHaveLength(16);
    for (const [name, news] of refused) expect(decodeSaveFile(envelope({ ...g, news })), name).toEqual({ kind: "malformed" });
    const accepted: [string, unknown][] = [
      ["season 1", edit(0, { season: 1 })],
      ["data de liga round 1", edit(0, { date: { kind: "league", round: 1 } })],
      ["data de copa phase 0", edit(cupAt, { date: { kind: "cup", cupId: "cup-nat", phase: 0 } })],
      ["injury rounds 1", edit(at("injury"), { rounds: 1 })],
      ["board warnings 1", edit(at("board"), { warnings: 1 })],
      ["board warnings 3", edit(at("board"), { warnings: 3 })],
      ["offer amount 0", edit(at("offer"), { amount: 0 })],
      ["transfer amount 0", edit(at("transfer"), { amount: 0 })],
    ];
    expect(accepted).toHaveLength(8);
    for (const [name, news] of accepted) {
      const s = { ...g, news } as GameState;
      expect(decodeSaveFile(encodeSaveFile(s, ISO)), name).toEqual({ kind: "ok", state: s });
    }
  });
});

describe("ajustes da importação (ajustes-importacao)", () => {
  test("proposta pendente sem clubes", () => {
    // C2: an empty list is refused for both reasons; one club of another league imports unchanged.
    const g = withClub(8);
    const other = g.leagues[1]!.clubs[0]!.id;
    for (const reason of ["fired", "offer"] as const) {
      expect(decodeSaveFile(envelope({ ...g, pendingJob: { reason, clubIds: [] } })), reason).toEqual({ kind: "malformed" });
      const s: GameState = { ...g, pendingJob: { reason, clubIds: [other] } };
      expect(decodeSaveFile(encodeSaveFile(s, ISO)), reason).toEqual({ kind: "ok", state: s });
    }
  });

  test("avisos da diretoria no arquivo", () => {
    // C3 (L-005, L-007): absent and 0..3 import unchanged; anything else is refused.
    const g = withClub(8);
    expect("boardWarnings" in g).toBe(false);
    expect(decodeSaveFile(encodeSaveFile(g, ISO))).toEqual({ kind: "ok", state: g });
    for (const boardWarnings of [0, 1, 3]) {
      const s = { ...g, boardWarnings };
      expect(decodeSaveFile(encodeSaveFile(s, ISO)), String(boardWarnings)).toEqual({ kind: "ok", state: s });
    }
    for (const boardWarnings of [-1, 4, 1.5, "1", null]) {
      expect(decodeSaveFile(envelope({ ...g, boardWarnings })), String(boardWarnings)).toEqual({ kind: "malformed" });
    }
  });

  test("carreira no arquivo recusa valores fora do motor", () => {
    // C5: season 0 and round -1 are refused; season 1 and round 0 import unchanged.
    const g = withClub(8);
    const [x, y] = [g.leagues[0]!.clubs[6]!.id, g.leagues[1]!.clubs[1]!.id];
    const moves: NonNullable<GameState["career"]> = [
      { season: 1, round: 14, fromId: y, toId: x, reason: "fired" },
      { season: 2, round: 38, fromId: x, toId: g.userClubId!, reason: "offer" },
    ];
    const edit = (change: Record<string, unknown>) => [moves[0], { ...moves[1], ...change }];
    for (const [name, career] of [["season 0", edit({ season: 0 })], ["round -1", edit({ round: -1 })]] as const) {
      expect(decodeSaveFile(envelope({ ...g, career })), name).toEqual({ kind: "malformed" });
    }
    for (const [name, career] of [["season 1", edit({ season: 1 })], ["round 0", edit({ round: 0 })]] as const) {
      const s = { ...g, career } as GameState;
      expect(decodeSaveFile(encodeSaveFile(s, ISO)), name).toEqual({ kind: "ok", state: s });
    }
  });
});

describe("dificuldade no arquivo (dificuldade)", () => {
  test("dificuldade no arquivo", () => {
    // C1: the three levels and absent import unchanged; anything else is refused.
    const g = withClub(7);
    expect("difficulty" in g).toBe(false);
    expect(decodeSaveFile(encodeSaveFile(g, ISO))).toEqual({ kind: "ok", state: g });
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const s = { ...g, difficulty };
      expect(decodeSaveFile(encodeSaveFile(s, ISO)), difficulty).toEqual({ kind: "ok", state: s });
    }
    for (const difficulty of ["medio", 1, null]) {
      expect(decodeSaveFile(envelope({ ...g, difficulty })), String(difficulty)).toEqual({ kind: "malformed" });
    }
  });
});
