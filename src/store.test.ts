// @vitest-environment jsdom
import { openDB } from "idb";
import { DB_NAME, DB_VERSION, STORE, loadGame, saveGame, slotKey } from "./persistence/save";
import { encodeSaveFile } from "./engine/saveFile";
import type { GameState, MatchEvent } from "./engine/types";
import { TAB_LOCK, useGame, userClub, type GameStore } from "./store";
import { Home } from "./ui/Home";
import { makeMatch, matchSeed, roundSnapshot, runToEnd, sideFor, startRound, step, userMatch, type LiveRound } from "./engine/live";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { Banner } from "./ui/Banner";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { playDate } from "./engine/season";
import { userBoardGoal } from "./engine/board";
import { AI_FORMATION, autoLineup, validateLineup } from "./engine/lineup";
import { nextCompetition } from "./engine/calendar";
import { atCupDate, expectedCupGoal } from "./engine/test-fixtures";
import { liveBeforeIncident, preliminaryWithCupSuspended, resetAll, resetStore, seededGame, userSideOf } from "./ui/test-utils";

/** Every save waits on `ctl.gate` when one is set, so a test can look at the store mid-save. */
const ctl = vi.hoisted(() => ({ gate: null as Promise<void> | null, fail: false, openFails: false }));
/** Correcoes-validacao C5: with `ctl.openFails`, opening a game (the season check it starts with) throws. */
vi.mock("./engine/season", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./engine/season")>();
  return {
    ...actual,
    isSeasonOver: vi.fn((league: Parameters<typeof actual.isSeasonOver>[0]) => {
      if (ctl.openFails) throw new Error("does not open");
      return actual.isSeasonOver(league);
    }),
  };
});
vi.mock("./persistence/save", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./persistence/save")>();
  return {
    ...actual,
    saveGame: vi.fn(async (state: Parameters<typeof actual.saveGame>[0], slot?: number) => {
      if (ctl.gate) await ctl.gate;
      if (ctl.fail) throw new Error("put failed");
      return actual.saveGame(state, slot);
    }),
  };
});

beforeEach(() => {
  ctl.gate = null;
  ctl.fail = false;
  ctl.openFails = false;
  resetAll();
  vi.mocked(saveGame).mockClear();
});

/** A game where every one of the 11 actions is accepted. */
function stage(): GameState {
  const game = seededGame(4);
  const league = game.leagues[0]!;
  const me = userClub(game)!;
  Object.assign(me.finance, { cash: 50_000_000, loan: 1_000_000 });
  game.market.offers = [
    { id: "o1-1", buyerId: league.clubs[1]!.id, playerId: me.players[20]!.id, amount: 800_000 },
    { id: "o1-2", buyerId: league.clubs[2]!.id, playerId: me.players[19]!.id, amount: 600_000 },
  ];
  return game;
}

const seller = (g: GameState) => g.leagues[0]!.clubs[5]!;
const reserveGk = (g: GameState) => seller(g).players.filter((p) => p.position === "GK").sort((a, b) => a.rating - b.rating)[0]!;

const ACTIONS: [string, (s: GameStore, g: GameState) => Promise<boolean>][] = [
  ["comprar", (s, g) => s.buyPlayer(reserveGk(g).id, 40_000_000)],
  ["aceitar proposta", (s) => s.acceptOffer("o1-1")],
  ["recusar proposta", (s) => s.rejectOffer("o1-2")],
  ["marcar à venda", (s, g) => s.toggleForSale(userClub(g)!.players[3]!.id)],
  ["dispensar", (s, g) => s.releasePlayer(userClub(g)!.players[21]!.id)],
  ["contratar livre", (s, g) => s.signFreeAgent(g.market.freeAgents[0]!.id)],
  ["promover júnior", (s, g) => s.promoteJunior(g.market.juniors[0]!.id)],
  ["preço do ingresso", (s) => s.setTicketPrice(55)],
  ["ampliar", (s) => s.expandStadium()],
  ["pegar empréstimo", (s) => s.takeLoan(500_000)],
  ["pagar empréstimo", (s) => s.repayLoan(500_000)],
];

describe("store: ações de mercado e finanças", () => {
  test("ações de mercado gravam antes de mostrar", async () => {
    expect(ACTIONS).toHaveLength(11);
    for (const [name, act] of ACTIONS) {
      const game = stage();
      useGame.setState({ phase: "market", game, hasSave: true, saving: false, marketMessage: null });
      vi.mocked(saveGame).mockClear();
      let release!: () => void;
      ctl.gate = new Promise<void>((r) => (release = r));

      const done = act(useGame.getState(), game);
      // The save is in flight and blocked: the store still shows the old game.
      await vi.waitFor(() => expect(vi.mocked(saveGame), name).toHaveBeenCalledTimes(1));
      expect(useGame.getState().game, name).toBe(game);
      const saved = vi.mocked(saveGame).mock.calls[0]![0];
      expect(saved, name).not.toEqual(game);

      release();
      expect(await done, name).toBe(true);
      expect(useGame.getState().game, name).toBe(saved);
      ctl.gate = null;
    }
  });
});

describe("store: mensagens de recusa", () => {
  test("mensagens de recusa exatas", async () => {
    const reserve = (g: GameState, i: number) => g.leagues[0]!.clubs[i]!.players.filter((p) => p.position === "GK").sort((a, b) => a.rating - b.rating)[0]!;
    const pad = (g: GameState, to: number) => {
      const me = userClub(g)!;
      const extra = g.leagues[0]!.clubs[9]!.players;
      while (me.players.length < to) me.players.push({ ...extra[me.players.length % extra.length]!, id: `pad-${me.players.length}` });
    };
    const cases: [string, (g: GameState) => void, (s: GameStore, g: GameState) => Promise<boolean>, string][] = [
      // C23: every spend above the cash.
      ["compra acima do caixa", (g) => (userClub(g)!.finance.cash = 1000), (s, g) => s.buyPlayer(reserve(g, 5).id, 50_000_000), "Caixa insuficiente"],
      ["luvas acima do caixa", (g) => (userClub(g)!.finance.cash = 1000), (s, g) => s.signFreeAgent(g.market.freeAgents[0]!.id), "Caixa insuficiente"],
      ["rescisão acima do caixa", (g) => (userClub(g)!.finance.cash = 1000), (s, g) => s.releasePlayer(userClub(g)!.players[21]!.id), "Caixa insuficiente"],
      ["ampliação acima do caixa", (g) => (userClub(g)!.finance.cash = 1000), (s) => s.expandStadium(), "Caixa insuficiente"],
      ["pagamento acima do caixa", (g) => Object.assign(userClub(g)!.finance, { cash: 1000, loan: 1_000_000 }), (s) => s.repayLoan(500_000), "Caixa insuficiente"],
      // C50: negative cash.
      ["compra com caixa negativo", (g) => (userClub(g)!.finance.cash = -100_000), (s, g) => s.buyPlayer(reserve(g, 5).id, 50_000_000), "Caixa insuficiente"],
      ["luvas com caixa negativo", (g) => (userClub(g)!.finance.cash = -100_000), (s, g) => s.signFreeAgent(g.market.freeAgents[0]!.id), "Caixa insuficiente"],
      ["rescisão com caixa negativo", (g) => (userClub(g)!.finance.cash = -100_000), (s, g) => s.releasePlayer(userClub(g)!.players[21]!.id), "Caixa insuficiente"],
      ["ampliação com caixa negativo", (g) => (userClub(g)!.finance.cash = -100_000), (s) => s.expandStadium(), "Caixa insuficiente"],
      // C24.
      ["compra com 30", (g) => pad(g, 30), (s, g) => s.buyPlayer(reserve(g, 5).id, 50_000_000), "Elenco cheio (30)"],
      ["livre com 30", (g) => pad(g, 30), (s, g) => s.signFreeAgent(g.market.freeAgents[0]!.id), "Elenco cheio (30)"],
      ["júnior com 30", (g) => pad(g, 30), (s, g) => s.promoteJunior(g.market.juniors[0]!.id), "Elenco cheio (30)"],
      // C25.
      [
        "vendedor com 18",
        (g) => {
          const seller = g.leagues[0]!.clubs[5]!;
          const target = reserve(g, 5);
          seller.players = [target, ...seller.players.filter((p) => p.id !== target.id).slice(0, 17)];
        },
        (s, g) => s.buyPlayer(reserve(g, 5).id, 50_000_000),
        "O clube não vende: elenco no mínimo",
      ],
      // C32.
      [
        "aceitar com 18",
        (g) => {
          const me = userClub(g)!;
          const offered = me.players[19]!;
          me.players = [offered, ...me.players.filter((p) => p.id !== offered.id).slice(0, 17)];
        },
        (s) => s.acceptOffer("o1-2"),
        "Elenco no mínimo (18)",
      ],
      ["dispensar com 18", (g) => (userClub(g)!.players = userClub(g)!.players.slice(0, 18)), (s, g) => s.releasePlayer(userClub(g)!.players[0]!.id), "Elenco no mínimo (18)"],
      // C45.
      ["capacidade acima de 80.000", (g) => (userClub(g)!.finance.capacity = 76_000), (s) => s.expandStadium(), "Capacidade máxima: 80.000"],
      // C47: X is what can still be borrowed.
      ["empréstimo acima do limite", (g) => Object.assign(userClub(g)!.finance, { loanLimit: 3_000_000, loan: 2_000_000 }), (s) => s.takeLoan(1_500_000), "Limite de empréstimo: R$ 1.000.000"],
    ];
    expect(cases).toHaveLength(17);
    for (const [name, prepare, act, text] of cases) {
      const game = stage();
      prepare(game);
      useGame.setState({ phase: "market", game, hasSave: true, saving: false, marketMessage: null });
      expect(await act(useGame.getState(), game), name).toBe(false);
      expect(useGame.getState().marketMessage, name).toBe(text);
      expect(useGame.getState().game, name).toBe(game);
    }
  });
});

let ended: GameState | null = null;
function endedSeason(): GameState {
  ended ??= seededGame(40, 2, 38);
  const copy = JSON.parse(JSON.stringify(ended)) as GameState;
  copy.boardGoal = 20;
  return copy;
}

describe("store: temporada e contratos", () => {
  test("próxima temporada grava antes de mostrar", async () => {
    const game = endedSeason();
    useGame.setState({ phase: "end", game, hasSave: true });
    let release!: () => void;
    ctl.gate = new Promise<void>((r) => (release = r));
    const done = useGame.getState().nextSeason();
    await vi.waitFor(() => expect(vi.mocked(saveGame)).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(saveGame).mock.calls[0]![0];
    expect(saved.season).toBe(2);
    expect(useGame.getState().phase).toBe("end");
    expect(useGame.getState().game).toBe(game);
    release();
    await done;
    expect(useGame.getState().phase).toBe("newSeason");
    expect(useGame.getState().game).toBe(saved);
    ctl.gate = null;

    // A failed save shows the existing warning, and the new season goes on in memory.
    resetAll();
    ctl.fail = true;
    useGame.setState({ phase: "end", game: endedSeason(), hasSave: true });
    render(createElement(Banner));
    await useGame.getState().nextSeason();
    expect(useGame.getState().saveStatus).toBe("failed");
    expect(await screen.findByText("Não foi possível salvar")).toBeInTheDocument();
    expect(useGame.getState().phase).toBe("newSeason");
  }, 60_000);

  test("renovar grava antes de mostrar", async () => {
    const game = seededGame(41);
    const p = userClub(game)!.players[4]!;
    Object.assign(p, { contractSeasons: 1, rating: 70, salary: 3_000 });
    useGame.setState({ phase: "squad", game, hasSave: true });
    let release!: () => void;
    ctl.gate = new Promise<void>((r) => (release = r));
    const done = useGame.getState().renewContract(p.id);
    await vi.waitFor(() => expect(vi.mocked(saveGame)).toHaveBeenCalledTimes(1));
    expect(useGame.getState().game).toBe(game);
    const saved = vi.mocked(saveGame).mock.calls[0]![0];
    expect(userClub(saved)!.players[4]).toMatchObject({ contractSeasons: 3, salary: Math.round((2000 * 1.09 ** 30) / 100) * 100 });
    release();
    expect(await done).toBe(true);
    expect(useGame.getState().game).toBe(saved);
    // Only the last year renews: a second try is refused with the exact text.
    expect(await useGame.getState().renewContract(p.id)).toBe(false);
    expect(useGame.getState().marketMessage).toBe("Só renova no último ano de contrato");
  });
});

describe("copa pelo store (copa-nacional)", () => {
  test("fim da temporada com a copa decidida", async () => {
    const game = seededGame(98, 0, 37);
    expect(game.leagues[0]!.currentRound).toBe(37);
    useGame.setState({ phase: "squad", game, hasSave: true });
    await useGame.getState().playRound();
    expect(useGame.getState().phase).toBe("live");
    await useGame.getState().skipToEnd();
    const s = useGame.getState();
    expect(s.phase).toBe("end");
    // Paises (Superseded checks): 4 leagues.
    expect(s.game!.leagues.map((l) => l.currentRound)).toEqual([38, 38, 38, 38]);
    expect(s.game!.cups[0]!.phases[5]!.ties[0]!.winnerId).not.toBeNull();
  }, 60_000);

  test("meta de copa ao escolher clube", async () => {
    useGame.getState().newGame(99);
    const game = useGame.getState().game!;
    expect(game.cupGoal).toBe(-1);
    // A Série B club in the preliminary, and the strongest Série A club.
    const preliminary = game.cups[0]!.phases[0]!.ties[0]!.awayId;
    await useGame.getState().chooseClub(preliminary);
    expect(useGame.getState().game!.cupGoal).toBe(1);
    expect(useGame.getState().game!.cupGoal).toBe(expectedCupGoal(useGame.getState().game!));
    useGame.getState().newGame(99);
    const strongest = useGame.getState().game!.cups[0]!.seeding[0]!;
    await useGame.getState().chooseClub(strongest);
    const chosen = useGame.getState().game!;
    expect(chosen.cupGoal).toBe(expectedCupGoal(chosen));
    expect(chosen.cupGoal).toBeGreaterThanOrEqual(3);
  });
});

describe("data de copa sem o usuário pelo store (ajustes-4a)", () => {
  test("eliminado com suspenso de copa joga a data", async () => {
    // Before the Quartas; the user takes the loser of the first Oitavas tie.
    const game = atCupDate(143, 3);
    const tie = game.cups[0]!.phases[2]!.ties[0]!;
    game.userClubId = tie.winnerId === tie.homeId ? tie.awayId : tie.homeId;
    game.boardGoal = userBoardGoal(game);
    game.cupGoal = 2;
    const me = userClub(game)!;
    for (const p of me.players) Object.assign(p, { injuryRounds: 0, suspendedRounds: 0, cupDiscipline: {} });
    me.lineup = autoLineup(me, AI_FORMATION);
    const suspended = me.players.find((p) => p.id === me.lineup!.starters[1])!;
    suspended.cupDiscipline = { "cup-nat": { yellowCards: 0, suspendedRounds: 1 } };
    expect(game.cups[0]!.phases[3]!.ties.some((t) => t.homeId === me.id || t.awayId === me.id)).toBe(false);

    const user = userEvent.setup();
    useGame.setState({ phase: "squad", game, hasSave: true });
    const phases: string[] = [];
    const stop = useGame.subscribe((s) => phases.push(s.phase));
    render(createElement(App));
    const play = screen.getByRole("button", { name: "Jogar rodada" });
    expect(play).toBeEnabled();
    await user.click(play);
    await screen.findByRole("heading", { level: 1, name: "Copa Nacional · Quartas" });
    stop();
    const s = useGame.getState();
    expect(s.phase).toBe("round");
    expect(phases).not.toContain("live");
    expect(s.live).toBeNull();
    expect(s.lastRound!.cup).toEqual({ cupIndex: 0, phase: 3 });
    expect(s.game!.cups[0]!.currentPhase).toBe(4);
    // The suspension is only served by playing the cup (copa-nacional AC 25).
    expect(userClub(s.game!)!.players.find((p) => p.id === suspended.id)!.cupDiscipline["cup-nat"]!.suspendedRounds).toBe(1);
  }, 60_000);
});

describe("importar e armazenamento persistente (lancamento)", () => {
  function stubStorage(storage: unknown) {
    Object.defineProperty(navigator, "storage", { value: storage, configurable: true });
  }
  afterEach(() => stubStorage(undefined));

  async function chooseFirstClub() {
    useGame.getState().newGame(7);
    await useGame.getState().chooseClub(useGame.getState().game!.leagues[0]!.clubs[0]!.id);
  }

  test("importar com gravação falhando abre o jogo e avisa", async () => {
    ctl.fail = true;
    const game = seededGame(6, 1, 2);
    useGame.setState({ phase: "home", hasSave: false, game: null });
    await useGame.getState().importFile(encodeSaveFile(game, "2026-09-28T12:00:00.000Z"));
    expect(useGame.getState().phase).toBe("squad");
    expect(useGame.getState().game).toEqual(game);
    expect(useGame.getState().saveStatus).toBe("failed");
    render(createElement(Banner));
    expect(screen.getByText("Não foi possível salvar")).toBeInTheDocument();
  });

  test("pede armazenamento persistente uma vez por sessão", async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persist });
    await chooseFirstClub();
    expect(useGame.getState().saveStatus).toBe("ok");
    expect(persist).toHaveBeenCalledTimes(1);
    await useGame.getState().playRound();
    await useGame.getState().skipToEnd();
    expect(vi.mocked(saveGame).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  test("sem persist ou com persist rejeitando segue sem erro", async () => {
    stubStorage({});
    await chooseFirstClub();
    expect(useGame.getState().saveStatus).toBe("ok");
    expect(useGame.getState().phase).toBe("squad");

    resetAll();
    const persist = vi.fn(() => Promise.reject(new Error("negado")));
    stubStorage({ persist });
    await chooseFirstClub();
    await new Promise((r) => setTimeout(r, 0));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(useGame.getState().saveStatus).toBe("ok");
    expect(useGame.getState().phase).toBe("squad");
  });

  test("gravação que falha não pede persistência", async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persist });
    ctl.fail = true;
    await chooseFirstClub();
    expect(useGame.getState().saveStatus).toBe("failed");
    expect(persist).not.toHaveBeenCalled();
    ctl.fail = false;
    await useGame.getState().playRound();
    await useGame.getState().skipToEnd();
    expect(useGame.getState().saveStatus).toBe("ok");
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe("escalação de copa pela disciplina da copa (correcoes-validacao)", () => {
  /** Seed 5, right before the Preliminar, the user's club plays its first tie. */
  function firstCupDate() {
    const { game, suspended } = preliminaryWithCupSuspended(5, (s) => s.cups[0]!.phases[0]!.ties[0]!.homeId);
    expect(nextCompetition(game)).toEqual({ kind: "cup", cupId: "cup-nat" });
    useGame.setState({ phase: "squad", game, hasSave: true });
    return { game, suspended };
  }

  test("titular de copa pela disciplina da copa", async () => {
    // C21 (AC 19, AC 20, L-003, L-007): two reserves, one suspended in the league only, one in the cup.
    const { game } = firstCupDate();
    const me = userClub(game)!;
    const bench = me.players.filter((p) => !me.lineup!.starters.includes(p.id));
    const leagueOnly = bench[0]!;
    const cupOnly = bench[1]!;
    leagueOnly.suspendedRounds = 1;
    cupOnly.cupDiscipline = { "cup-nat": { yellowCards: 0, suspendedRounds: 1 } };
    const rows: [string, string, boolean][] = [
      ["suspenso só na liga", leagueOnly.id, true],
      ["suspenso na copa", cupOnly.id, false],
    ];
    for (const [name, id, accepted] of rows) {
      useGame.setState({ game: JSON.parse(JSON.stringify(game)) as GameState });
      const before = userClub(useGame.getState().game!)!.lineup!;
      await useGame.getState().assignStarter(10, id);
      const after = userClub(useGame.getState().game!)!.lineup!;
      if (accepted) expect(after.starters[10], name).toBe(id);
      else expect(after, name).toEqual(before);
    }
  });

  test("formação de copa sem suspenso de copa", async () => {
    // C22 (AC 21): a starter suspended in the cup; the posture chosen before is kept.
    const { suspended } = firstCupDate();
    expect(userClub(useGame.getState().game!)!.lineup!.starters).toContain(suspended.id);
    await useGame.getState().setPosture("attacking");
    await useGame.getState().setFormation("4-3-3");
    const me = userClub(useGame.getState().game!)!;
    expect(me.lineup!.formation).toBe("4-3-3");
    expect(me.lineup!.starters).not.toContain(suspended.id);
    expect(validateLineup(me, me.lineup, { kind: "cup", cupId: "cup-nat" })).toEqual({ ok: true, missing: 0 });
    expect(me.lineup!.posture).toBe("attacking");
  });
});

describe("o save sobrevive (correcoes-validacao)", () => {
  function stubLocks(locks: unknown) {
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
  }
  afterEach(() => stubLocks(undefined));

  /**
   * A stand-in for `navigator.locks`: one holder at a time; `ifAvailable` gets null while it is
   * held; `steal` takes it, and the holder's request rejects with an AbortError.
   */
  function fakeLocks() {
    const requests: { name: string; options: LockOptions }[] = [];
    const other = { lost: false };
    let holder: { reject: (e: unknown) => void } | null = null;
    const locks = {
      request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) {
        requests.push({ name, options });
        return new Promise((resolve, reject) => {
          if (holder && options.ifAvailable) {
            Promise.resolve(callback(null)).then(resolve, reject);
            return;
          }
          if (holder && options.steal) holder.reject(new DOMException("stolen", "AbortError"));
          const me = { reject };
          holder = me;
          Promise.resolve(callback({ name, mode: "exclusive" } as Lock)).then((v) => {
            if (holder === me) holder = null;
            resolve(v);
          }, reject);
        });
      },
    };
    const byOther = () => ({ reject: () => void (other.lost = true) });
    return {
      locks,
      requests,
      other,
      /** Another tab holds the lock; `other.lost` turns true when it is taken from it. */
      heldByOther: () => void (holder = byOther()),
      /** Another tab steals the lock from whoever holds it. */
      stealByOther: () => {
        holder?.reject(new DOMException("stolen", "AbortError"));
        holder = byOther();
      },
    };
  }

  /** `indexedDB.open` throws once, as Safari's «Connection to Indexed Database server lost». */
  function failNextOpen() {
    vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
      throw new DOMException("Connection to Indexed Database server lost", "UnknownError");
    });
  }

  const slotSeed = async () => {
    const r = await loadGame();
    return r.kind === "ok" ? r.state.seed : null;
  };

  test("falha de leitura exige confirmação", async () => {
    // C2 (AC 2, L-003): a save of seed 7, and a read that fails once.
    await saveGame(seededGame(7));
    failNextOpen();
    await useGame.getState().init();
    expect(useGame.getState()).toMatchObject({ phase: "home", hasSave: false, loadFailed: true });
    vi.mocked(saveGame).mockClear();

    const user = userEvent.setup();
    render(createElement(Home));
    await user.click(screen.getByRole("button", { name: "Novo jogo" }));
    expect(screen.getByRole("alertdialog", { name: "Confirmar novo jogo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(useGame.getState().phase).toBe("home");

    // A valid file waits for «Sim, substituir» instead of writing.
    await useGame.getState().importFile(encodeSaveFile(seededGame(8), "2026-09-29T12:00:00.000Z"));
    expect(useGame.getState().pendingImport?.seed).toBe(8);
    expect(await screen.findByRole("alertdialog", { name: "Confirmar importação" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(useGame.getState().pendingImport).toBeNull();
    expect(vi.mocked(saveGame)).not.toHaveBeenCalled();
    expect(await slotSeed()).toBe(7);
  });

  test("import corrompido não toca o slot", async () => {
    // C4 (AC 4, L-008): a save of seed 7; the file has no `leagues[0].rounds`.
    const saved = seededGame(7);
    await saveGame(saved);
    useGame.setState({ phase: "home", hasSave: true, game: saved });
    render(createElement(Home));
    const broken = JSON.parse(JSON.stringify(seededGame(9))) as Record<string, unknown> & { leagues: Record<string, unknown>[] };
    delete broken.leagues[0]!.rounds;
    await act(async () => {
      await useGame.getState().importFile(encodeSaveFile(broken as unknown as GameState, "2026-09-29T12:00:00.000Z"));
      await useGame.getState().confirmImport();
    });
    expect(screen.getByText("Arquivo corrompido: não foi possível ler o jogo")).toBeInTheDocument();
    expect(await slotSeed()).toBe(7);
  });

  test("abrir o importado falha antes de gravar", async () => {
    // C5 (AC 5): the file decodes, but opening it throws. Varios-saves (Superseded): the game would
    // go to the empty slot 2 with no confirmation, so the open fails on the import itself.
    const saved = seededGame(7);
    await saveGame(saved);
    await useGame.getState().init();
    render(createElement(Home));
    vi.mocked(saveGame).mockClear();
    ctl.openFails = true;
    await act(async () => {
      await useGame.getState().importFile(encodeSaveFile(seededGame(9), "2026-09-29T12:00:00.000Z"));
    });
    ctl.openFails = false;
    expect(vi.mocked(saveGame)).not.toHaveBeenCalled();
    expect(screen.getByText("Arquivo corrompido: não foi possível ler o jogo")).toBeInTheDocument();
    expect(useGame.getState().phase).toBe("home");
    expect(await slotSeed()).toBe(7);
    expect(await loadGame(2)).toEqual({ kind: "none" });
  });

  test("segunda aba não grava", async () => {
    // C7 (AC 7, door 2): another tab holds the lock.
    await saveGame(seededGame(7));
    vi.mocked(saveGame).mockClear();
    const fake = fakeLocks();
    fake.heldByOther();
    stubLocks(fake.locks);
    render(createElement(App));
    expect(await screen.findByText("O jogo está aberto em outra aba")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usar nesta aba" })).toBeInTheDocument();
    expect(fake.requests).toEqual([{ name: "forzion-futmanager-save", options: { ifAvailable: true } }]);
    expect(TAB_LOCK).toBe("forzion-futmanager-save");
    // Even with a game in memory, an action that writes does not reach the slot.
    useGame.setState({ game: seededGame(8) });
    await act(async () => {
      await useGame.getState().setTicketPrice(45);
    });
    expect(vi.mocked(saveGame)).not.toHaveBeenCalled();
    expect(await slotSeed()).toBe(7);
  });

  test("usar nesta aba toma o lock", async () => {
    // C8 (AC 8, door 2).
    const saved = seededGame(8);
    await saveGame(saved);
    const fake = fakeLocks();
    fake.heldByOther();
    stubLocks(fake.locks);
    const user = userEvent.setup();
    render(createElement(App));
    await user.click(await screen.findByRole("button", { name: "Usar nesta aba" }));
    expect(await screen.findByRole("table", { name: "Elenco" })).toBeInTheDocument();
    expect(fake.requests.at(-1)).toEqual({ name: "forzion-futmanager-save", options: { steal: true } });
    expect(fake.other.lost).toBe(true);
    expect(useGame.getState().phase).toBe("squad");
    expect(useGame.getState().game).toEqual(saved);

    // Now another tab takes it: this one shows the notice and writes no more.
    vi.mocked(saveGame).mockClear();
    await act(async () => {
      fake.stealByOther();
      await Promise.resolve();
    });
    expect(await screen.findByText("O jogo está aberto em outra aba")).toBeInTheDocument();
    expect(useGame.getState().otherTab).toBe(true);
    await act(async () => {
      await useGame.getState().setTicketPrice(50);
    });
    expect(vi.mocked(saveGame)).not.toHaveBeenCalled();
  });

  test("sem web locks abre sem guarda", async () => {
    // C9 (AC 9).
    stubLocks(undefined);
    const saved = seededGame(9);
    await saveGame(saved);
    await useGame.getState().init();
    expect(useGame.getState()).toMatchObject({ phase: "home", hasSave: true, otherTab: false });
    expect(useGame.getState().game).toEqual(saved);
    useGame.getState().continueGame();
    vi.mocked(saveGame).mockClear();
    expect(await useGame.getState().setTicketPrice(45)).toBe(true);
    expect(vi.mocked(saveGame)).toHaveBeenCalledTimes(1);
    const r = await loadGame();
    expect(r.kind === "ok" && userClub(r.state)!.finance.ticketPrice).toBe(45);
  });

  test("escalação é gravada", async () => {
    // C11 (AC 11, L-003): each of the three actions, then a reload.
    const cases: [string, (s: GameStore, g: GameState) => Promise<void>, (g: GameState, before: GameState) => void][] = [
      ["formação", (s) => s.setFormation("3-5-2"), (g) => expect(userClub(g)!.lineup!.formation).toBe("3-5-2")],
      ["postura", (s) => s.setPosture("attacking"), (g) => expect(userClub(g)!.lineup!.posture).toBe("attacking")],
      [
        "titular",
        (s, g) => s.assignStarter(10, benchOf(g).id),
        (g, before) => expect(userClub(g)!.lineup!.starters[10]).toBe(benchOf(before).id),
      ],
    ];
    const benchOf = (g: GameState) => userClub(g)!.players.find((p) => !userClub(g)!.lineup!.starters.includes(p.id) && p.injuryRounds === 0 && p.suspendedRounds === 0)!;
    for (const [name, change, check] of cases) {
      resetAll();
      const before = seededGame(10);
      await saveGame(before);
      useGame.setState({ phase: "squad", game: before, hasSave: true });
      await change(useGame.getState(), before);
      resetStore();
      await useGame.getState().init();
      const reloaded = useGame.getState().game!;
      expect(reloaded, name).not.toBeNull();
      check(reloaded, before);
    }
  });

  test("escalação durante gravação de mercado", async () => {
    // C12 (AC 12): the formation changes while the ticket price is being saved.
    const before = seededGame(11);
    await saveGame(before);
    useGame.setState({ phase: "squad", game: before, hasSave: true });
    vi.mocked(saveGame).mockClear();
    let release!: () => void;
    ctl.gate = new Promise<void>((r) => (release = r));
    const done = useGame.getState().setTicketPrice(45);
    await vi.waitFor(() => expect(vi.mocked(saveGame)).toHaveBeenCalledTimes(1));
    await useGame.getState().setFormation("4-3-3");
    release();
    expect(await done).toBe(true);
    ctl.gate = null;
    for (const g of [useGame.getState().game!, ((await loadGame()) as { state: GameState }).state]) {
      expect(userClub(g)!.finance.ticketPrice).toBe(45);
      expect(userClub(g)!.lineup!.formation).toBe("4-3-3");
    }
  });

  test("marcador de ao vivo gravado e limpo", async () => {
    // C13 (AC 13, door 1).
    const before = seededGame(12);
    await saveGame(before);
    useGame.setState({ phase: "squad", game: before, hasSave: true });
    await useGame.getState().playRound();
    expect(useGame.getState().phase).toBe("live");
    const marked = ((await loadGame()) as { state: GameState }).state;
    expect(marked.pendingLive).toBe(true);
    expect(marked.leagues[0]!.currentRound).toBe(0);
    expect(userClub(marked)!.lineup).toEqual(userClub(before)!.lineup);
    await useGame.getState().skipToEnd();
    const closed = ((await loadGame()) as { state: GameState }).state;
    expect("pendingLive" in closed).toBe(false);
    expect(closed.leagues[0]!.currentRound).toBe(1);
  });

  /** Written out here (L-004): the user's match of round 1 from the saved state, with no decisions. */
  function expectedScore(game: GameState): [number, number] {
    const league = game.leagues[0]!;
    const round = league.rounds[0]!;
    const i = round.matches.findIndex((m) => m.homeId === game.userClubId || m.awayId === game.userClubId);
    const m = round.matches[i]!;
    const { clubs, players } = roundSnapshot(game);
    const side = (id: string) => sideFor(clubs.get(id)!, game.userClubId, players);
    const match = makeMatch(m.id, side(m.homeId), side(m.awayId), matchSeed(game.rngState, round.number, i, 0), league.id);
    // AD-022: nobody decides after a reload, so the user's holes are filled by the AI's rule.
    const ended = runToEnd(
      { roundIndex: 0, roundNumber: round.number, minute: 0, userClubId: game.userClubId, matches: [match], players },
      { fillUserVacancies: true },
    ).matches[0]!;
    return [ended.homeGoals, ended.awayGoals];
  }

  test("reload no ao vivo fecha a rodada", async () => {
    // C14 (AC 14, door 1): no decisions, then a substitution and another posture, before the reload.
    const decisions: [string, () => void][] = [
      ["sem decisões", () => undefined],
      [
        "com decisões",
        () => {
          const s = useGame.getState();
          s.pause();
          const live = useGame.getState().live!;
          const m = live.matches.find((x) => x.home.clubId === live.userClubId || x.away.clubId === live.userClubId)!;
          const mine = m.home.clubId === live.userClubId ? m.home : m.away;
          useGame.getState().substitute(10, mine.bench[0]!);
          useGame.getState().changeLivePosture("attacking");
          useGame.getState().changeLiveFormation("4-3-3");
          useGame.getState().resume();
          for (let k = 0; k < 20; k++) useGame.getState().tick();
        },
      ],
    ];
    const scores: [number, number][] = [];
    for (const [name, decide] of decisions) {
      resetAll();
      // Parada-obrigatoria: seed 16 has no stop of the user in the first 30 minutes, so 10 ticks reach 10'.
      const before = seededGame(16);
      const expected = expectedScore(before);
      await saveGame(before);
      useGame.setState({ phase: "squad", game: before, hasSave: true });
      await useGame.getState().playRound();
      for (let k = 0; k < 10; k++) useGame.getState().tick();
      decide();
      expect(useGame.getState().live!.minute, name).toBeGreaterThanOrEqual(10);

      resetStore();
      await useGame.getState().init();
      const s = useGame.getState();
      expect(s.phase, name).toBe("round");
      const saved = ((await loadGame()) as { state: GameState }).state;
      expect("pendingLive" in saved, name).toBe(false);
      expect(saved.leagues[0]!.currentRound, name).toBe(before.leagues[0]!.currentRound + 1);
      const mine = s.lastRound!.results.find((r) => r.homeId === before.userClubId || r.awayId === before.userClubId)!;
      expect([mine.result.homeGoals, mine.result.awayGoals], name).toEqual(expected);
      const stored = saved.leagues[0]!.rounds[0]!.matches.find((m) => m.id === mine.matchId)!.result!;
      expect([stored.homeGoals, stored.awayGoals], name).toEqual(expected);
      scores.push(expected);
    }
    expect(scores[1]).toEqual(scores[0]);
  });

  test("save sem marcador abre normal", async () => {
    // C15 (door 1, absence): a v8 save with no mark opens on the title screen, no date played.
    const before = seededGame(14);
    expect("pendingLive" in before).toBe(false);
    await saveGame(before);
    vi.mocked(saveGame).mockClear();
    await useGame.getState().init();
    expect(useGame.getState()).toMatchObject({ phase: "home", hasSave: true, lastRound: null });
    expect(useGame.getState().game).toEqual(before);
    expect(vi.mocked(saveGame)).not.toHaveBeenCalled();

    // After a date closed by a reload, the next opening plays nothing more.
    useGame.getState().continueGame();
    await useGame.getState().playRound();
    resetStore();
    await useGame.getState().init();
    expect(useGame.getState().phase).toBe("round");
    resetStore();
    await useGame.getState().init();
    expect(useGame.getState().phase).toBe("home");
    expect(useGame.getState().game!.leagues[0]!.currentRound).toBe(1);
  });
});

describe("parada obrigatória (parada-obrigatoria)", () => {
  const isUserStop = (me: string) => (e: MatchEvent) => e.clubId === me && (e.type === "injury" || e.type === "red");

  function goLive(game: GameState, live: LiveRound, clock: "running" | "paused" = "running"): void {
    useGame.setState({ phase: "live", game, hasSave: true, live, clock, finishing: false, liveStop: null });
  }

  /** The user's side at minute 10 of round 1, with `slot` emptied for `why`. */
  function withVacancy(seed: number, slot: number, why: "injury" | "red"): { game: GameState; live: LiveRound; out: string } {
    const game = seededGame(seed);
    let live = startRound(game);
    while (live.minute < 10) live = step(live);
    const side = userSideOf(live);
    const out = side.slots[slot]!;
    side.slots[slot] = null;
    side.vacancy[slot] = { why, playerId: out };
    if (why === "red") side.sentOff.push(out);
    return { game, live, out };
  }

  test("lesão do usuário para o relógio", () => {
    // C5: minute 21 stops on "paused", minute 45 stays on "halftime", a rival's injury does not stop.
    const game = seededGame(4);
    const me = game.userClubId!;
    const hurt = liveBeforeIncident(game, 20, (ev) => ev.some((e) => e.clubId === me && e.type === "injury"));
    goLive(game, hurt);
    useGame.getState().tick();
    const stops = userMatch(useGame.getState().live!)!.events.filter((e) => e.minute === 21 && isUserStop(me)(e));
    expect(stops.length).toBeGreaterThan(0);
    expect(useGame.getState().clock).toBe("paused");
    expect(useGame.getState().liveStop).toEqual(stops);

    const half = liveBeforeIncident(game, 44, (ev) => ev.some(isUserStop(me)));
    goLive(game, half);
    useGame.getState().tick();
    expect(useGame.getState().clock).toBe("halftime");
    expect(useGame.getState().liveStop!.map((e) => e.minute)).toContain(45);

    const rival = liveBeforeIncident(game, 20, (ev) => ev.some((e) => e.clubId !== me && e.type === "injury") && !ev.some(isUserStop(me)));
    goLive(game, rival);
    useGame.getState().tick();
    expect(useGame.getState().clock).toBe("running");
    expect(useGame.getState().liveStop).toBeNull();
  });

  test("continuar bloqueado até a troca", () => {
    // C6.
    const { game, live, out } = withVacancy(4, 10, "injury");
    goLive(game, live, "paused");
    useGame.setState({ liveStop: [{ minute: 10, type: "injury", clubId: game.userClubId!, playerId: out }] });
    useGame.getState().resume();
    expect(useGame.getState().clock).toBe("paused");
    useGame.getState().substitute(10, userSideOf(live).bench[0]!);
    useGame.getState().resume();
    expect(useGame.getState().clock).toBe("running");
    expect(useGame.getState().liveStop).toBeNull();

    const red = withVacancy(4, 4, "red");
    goLive(red.game, red.live, "paused");
    useGame.getState().resume();
    expect(useGame.getState().clock).toBe("running");
  });

  test("pular para o fim preenche a lesão", async () => {
    // C7: the injured player's slot is filled the next minute, by the AI's rule (AD-022).
    const { game, live, out } = withVacancy(4, 10, "injury");
    const bench = userSideOf(live).bench;
    goLive(game, live, "paused");
    await useGame.getState().skipToEnd();
    const sub = useGame.getState().lastRound!.userEvents.find((e) => e.type === "substitution" && e.clubId === game.userClubId && e.playerId === out);
    expect(sub).toBeDefined();
    expect(sub!.minute).toBe(11);
    expect(bench).toContain(sub!.playerInId);
  });

  test("reabrir com lesão preenche a vaga", async () => {
    // C7 (reload, AD-022): a save left mid-date whose user match has an injury closes with the slot filled.
    let found: { game: GameState; injured: string } | null = null;
    for (let seed = 1; seed < 80 && !found; seed++) {
      const g = seededGame(seed);
      const ended = runToEnd(startRound(g));
      const hit = userMatch(ended)!.events.find((e) => e.clubId === g.userClubId && e.type === "injury" && e.minute < 90);
      if (hit) found = { game: g, injured: hit.playerId! };
    }
    expect(found).not.toBeNull();
    await saveGame({ ...found!.game, pendingLive: true });
    await useGame.getState().init();
    const sub = useGame.getState().lastRound!.userEvents.find((e) => e.type === "substitution" && e.playerId === found!.injured);
    expect(sub).toBeDefined();
  });
});

describe("treino (treino-evolucao)", () => {
  test("treino gravado", async () => {
    // C12 (L-003): the store saves the user's training, and a reopened game shows it.
    const game = seededGame(4);
    await saveGame(game);
    useGame.setState({ phase: "squad", game, hasSave: true });
    await useGame.getState().setTraining("hard");
    expect(userClub(useGame.getState().game!)!.training).toBe("hard");
    expect(userClub(((await loadGame()) as { state: GameState }).state)!.training).toBe("hard");
    resetStore();
    await useGame.getState().init();
    useGame.getState().continueGame();
    render(createElement(App));
    const select = screen.getByLabelText("Treino") as HTMLSelectElement;
    expect(select.value).toBe("hard");
    expect(select.selectedOptions[0]!.textContent).toBe("Forte");
  });
});

describe("carreira na store (carreira-dinamica)", () => {
  const firedGame = () => {
    const game = seededGame(4);
    const others = game.leagues[1]!.clubs.slice(0, 3).map((c) => c.id);
    game.pendingJob = { reason: "fired", clubIds: others };
    return { game, others };
  };

  test("demitido trava o calendário", async () => {
    // C8: nothing is played while a club must be picked, and «Continuar» opens «Demitido».
    const { game } = firedGame();
    await saveGame(game);
    useGame.setState({ phase: "squad", game, hasSave: true });
    await useGame.getState().playRound();
    expect(useGame.getState().game).toBe(game);
    expect(useGame.getState().phase).toBe("squad");
    expect(useGame.getState().live).toBeNull();
    resetStore();
    await useGame.getState().init();
    useGame.getState().continueGame();
    expect(useGame.getState().phase).toBe("job");
    render(createElement(App));
    expect(screen.getByRole("heading", { name: "Demitido" })).toBeInTheDocument();
  });

  test("assumir grava e abre o elenco", async () => {
    // C11 (L-003): «Assumir» saves the new club and opens its squad.
    const { game, others } = firedGame();
    await saveGame(game);
    useGame.setState({ phase: "job", game, hasSave: true });
    render(createElement(App));
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Assumir" })[1]!);
    // The phase changes once the save is written (AC 15 of the core): wait for it.
    await waitFor(() => expect(useGame.getState().phase).toBe("squad"));
    const saved = ((await loadGame()) as { state: GameState }).state;
    expect(saved.userClubId).toBe(others[1]);
    expect(saved.pendingJob).toBeUndefined();
    const name = game.leagues[1]!.clubs[1]!.name;
    expect(await screen.findByRole("heading", { name })).toBeInTheDocument();
  });
});

describe("posição na substituição (posicao-na-substituicao)", () => {
  test("substituição com posição", () => {
    // C4 (L-003, L-008): the store passes the position on, and a refusal shows its line.
    const game = seededGame(4);
    let live = startRound(game);
    while (live.minute < 10) live = step(live);
    const side = userSideOf(live);
    const expelled = side.slots[2]!;
    side.slots[2] = null;
    side.vacancy[2] = { why: "red", playerId: expelled };
    side.sentOff.push(expelled);
    const defender = side.bench.find((id) => live.players[id]!.position === "DF")!;
    useGame.setState({ phase: "live", game, hasSave: true, live, clock: "paused", finishing: false, liveStop: null });
    useGame.getState().substitute(9, defender, 5);
    expect(useGame.getState().liveMessage).toBe("Escolha a vaga de quem sai ou a de um expulso");
    expect(useGame.getState().live).toBe(live);
    useGame.getState().substitute(9, defender, 2);
    const after = userSideOf(useGame.getState().live!);
    expect(after.slots[2]).toBe(defender);
    expect(after.slots[9]).toBeNull();
    expect(useGame.getState().liveMessage).toBeNull();
  });
});


describe("vários espaços (varios-saves)", () => {
  async function put(slot: number, doc: unknown): Promise<void> {
    const db = await openDB(DB_NAME, DB_VERSION, { upgrade: (d) => d.createObjectStore(STORE) });
    await db.put(STORE, doc, slotKey(slot));
    db.close();
  }

  async function raw(slot: number): Promise<Record<string, unknown> | undefined> {
    const db = await openDB(DB_NAME, DB_VERSION, { upgrade: (d) => d.createObjectStore(STORE) });
    const doc = (await db.get(STORE, slotKey(slot))) as Record<string, unknown> | undefined;
    db.close();
    return doc;
  }

  const at = (game: GameState, savedAt: number) => ({ ...game, savedAt });
  const clubName = (game: GameState) => userClub(game)!.name;
  /** Three games of different clubs, so the screen tells which one opened. */
  const games = () => [seededGame(7, 0), seededGame(9, 3), seededGame(11, 5)] as const;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("espaço ativo na abertura", async () => {
    // C5 (L-001, L-005, L-018): the greatest savedAt; a tie goes to the lowest number; no time = 0.
    const [a, b, c] = games();
    expect(new Set([clubName(a), clubName(b), clubName(c)]).size).toBe(3);
    const cases: [string, [number, unknown][], number, GameState][] = [
      ["1 mais recente", [[1, at(a, 300)], [3, at(c, 200)]], 1, a],
      ["3 mais recente", [[1, at(a, 100)], [3, at(c, 200)]], 3, c],
      ["empate fica com o menor", [[2, at(b, 200)], [3, at(c, 200)]], 2, b],
      ["sem data vale 0", [[1, a], [2, at(b, 1)]], 2, b],
    ];
    for (const [name, docs, slot, game] of cases) {
      cleanup();
      resetAll();
      for (const [n, doc] of docs) await put(n, doc);
      const user = userEvent.setup();
      render(createElement(App));
      await user.click(await screen.findByRole("button", { name: "Continuar" }));
      expect(await screen.findByRole("heading", { name: clubName(game) }), name).toBeInTheDocument();
      expect(useGame.getState().activeSlot, name).toBe(slot);
    }
  });

  test("sem jogo legível usa o menor vazio", async () => {
    // C6: an unsupported save in slot 1 is kept; the new game goes to slot 2.
    await put(1, { schemaVersion: 9 });
    const user = userEvent.setup();
    render(createElement(App));
    await user.click(await screen.findByRole("button", { name: "Novo jogo" }));
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
    expect(useGame.getState()).toMatchObject({ phase: "chooseClub", activeSlot: 2 });
    const clubId = useGame.getState().game!.leagues[0]!.clubs[4]!.id;
    await act(async () => {
      await useGame.getState().chooseClub(clubId);
    });
    expect((await raw(2))?.userClubId).toBe(clubId);
    expect(await raw(1)).toEqual({ schemaVersion: 9 });
  });

  test("abertura sem jogo legível escolhe o menor vazio", async () => {
    // Ajustes-saves C1 (L-005): read before any click, on the title itself.
    const cases: [string, number[], number][] = [
      ["só o 1 incompatível", [1], 2],
      ["só o 2 incompatível", [2], 1],
      ["1 e 2 incompatíveis", [1, 2], 3],
    ];
    for (const [name, broken, slot] of cases) {
      cleanup();
      resetAll();
      for (const n of broken) await put(n, { schemaVersion: 9 });
      render(createElement(App));
      await screen.findByRole("button", { name: "Novo jogo" });
      expect(screen.queryByRole("button", { name: "Continuar" }), name).not.toBeInTheDocument();
      expect(useGame.getState().activeSlot, name).toBe(slot);
    }
  });

  test("data pendente do espaço ativo", async () => {
    // C7 (AD-019): only the active slot's pending date is played and saved, in that slot.
    const [a, b] = games();
    await put(1, at(a, 100));
    await put(2, { ...at(b, 200), pendingLive: true });
    const before = await raw(1);
    render(createElement(App));
    await waitFor(() => expect(useGame.getState().phase).toBe("round"));
    await waitFor(async () => expect((await raw(2))?.pendingLive).toBeUndefined());
    expect((await raw(2))?.leagues).toBeDefined();
    expect(((await raw(2))!.leagues as GameState["leagues"])[0]!.currentRound).toBe(1);
    expect(await raw(1)).toEqual(before);
  });

  test("save de antes abre como Jogo 1", async () => {
    // C8: a v8 document in "slot-1" with no savedAt, as written before this feature.
    const [a] = games();
    await put(1, a);
    const user = userEvent.setup();
    render(createElement(App));
    await user.click(await screen.findByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: clubName(a) })).toBeInTheDocument();
    expect(useGame.getState().activeSlot).toBe(1);
    expect(useGame.getState().game!.leagues[0]!.currentRound).toBe(a.leagues[0]!.currentRound);
  });

  test("gravação só no espaço ativo", async () => {
    // C10 (L-003): a round played through the store writes slot 2 only.
    const [a, b] = games();
    await put(1, at(a, 100));
    await put(2, at(b, 200));
    await useGame.getState().init();
    expect(useGame.getState().activeSlot).toBe(2);
    const one = await raw(1);
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    await act(async () => {
      useGame.getState().continueGame();
      await useGame.getState().playRound();
    });
    expect(await raw(2)).toMatchObject({ savedAt: 1700000000000, pendingLive: true });
    expect(await raw(1)).toEqual(one);
    expect(await raw(3)).toBeUndefined();
  });

  test("fim da data grava só no espaço ativo", async () => {
    // Ajustes-saves C2: the write that closes the date, not only the pendingLive mark of its start.
    const [a, b] = games();
    await put(1, at(a, 100));
    await put(2, at(b, 200));
    await useGame.getState().init();
    expect(useGame.getState().activeSlot).toBe(2);
    const one = await raw(1);
    const round = b.leagues[0]!.currentRound;
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    await act(async () => {
      useGame.getState().continueGame();
      await useGame.getState().playRound();
    });
    expect(useGame.getState().phase).toBe("live");
    expect(await raw(2)).toMatchObject({ pendingLive: true });
    await act(async () => {
      await useGame.getState().skipToEnd();
    });
    await waitFor(async () => expect((await raw(2))?.pendingLive).toBeUndefined());
    const saved = (await raw(2))!;
    expect(saved.savedAt).toBe(1700000000000);
    expect((saved.leagues as GameState["leagues"])[0]!.currentRound).toBe(round + 1);
    expect(await raw(1)).toEqual(one);
    expect(await raw(3)).toBeUndefined();
  }, 60_000);
});

describe("notícias pela store (noticias)", () => {
  test("notícias ao vivo e na reabertura", async () => {
    // C11 (AC 10, L-003): live to the end, reopened with the date pending, and the engine agree.
    // A game a few rounds in, inside a transfer window, so the round brings ratings and offers.
    const game = seededGame(12, 4, 2);
    const engine = playDate(game).state.news ?? [];
    const before = (game.news ?? []).length;
    expect(engine.length).toBeGreaterThan(before);

    useGame.setState({ phase: "squad", game, hasSave: true });
    await act(async () => {
      await useGame.getState().playRound();
    });
    expect(useGame.getState().phase).toBe("live");
    await act(async () => {
      await useGame.getState().skipToEnd();
    });
    await waitFor(() => expect(useGame.getState().phase).toBe("round"));
    expect(useGame.getState().game!.news).toEqual(engine);

    resetAll();
    await saveGame({ ...game, pendingLive: true });
    await useGame.getState().init();
    await waitFor(() => expect(useGame.getState().phase).toBe("round"));
    expect(useGame.getState().game!.news).toEqual(engine);
  }, 60_000);
});

describe("cobrador na store (penaltis)", () => {
  test("cobrador mantido na formação e na postura", async () => {
    // C10 (AC 13): a new formation and a new posture keep the chosen taker, in the store and saved.
    resetAll();
    const game = seededGame(10);
    const me = userClub(game)!;
    const taker = me.lineup!.starters.find((id) => me.players.find((p) => p.id === id)?.position === "MF")!;
    me.lineup = { ...me.lineup!, penaltyTaker: taker };
    await saveGame(game);
    useGame.setState({ phase: "squad", game, hasSave: true });
    const steps: [string, () => Promise<void>][] = [
      ["formação", () => useGame.getState().setFormation("3-5-2")],
      ["postura", () => useGame.getState().setPosture("attacking")],
    ];
    for (const [name, change] of steps) {
      await change();
      expect(userClub(useGame.getState().game!)!.lineup!.penaltyTaker, name).toBe(taker);
      const saved = await loadGame();
      expect(saved.kind === "ok" && userClub(saved.state)!.lineup!.penaltyTaker, name).toBe(taker);
    }
    expect(userClub(useGame.getState().game!)!.lineup!.formation).toBe("3-5-2");
  });
});

describe("cobrador na troca de titular (penaltis round 2)", () => {
  test("cobrador mantido na troca de titular", async () => {
    // C18 (AC 12, AC 13): swapping another starter for a bench player keeps the chosen taker.
    resetAll();
    const game = seededGame(10);
    const me = userClub(game)!;
    const taker = me.lineup!.starters.find((id) => me.players.find((p) => p.id === id)?.position === "MF")!;
    me.lineup = { ...me.lineup!, penaltyTaker: taker };
    await saveGame(game);
    useGame.setState({ phase: "squad", game, hasSave: true });
    const bench = me.players.find((p) => !me.lineup!.starters.includes(p.id) && p.position === "FW" && p.injuryRounds === 0 && p.suspendedRounds === 0)!;
    const slot = 10;
    expect(me.lineup!.starters[slot]).not.toBe(taker);
    await useGame.getState().assignStarter(slot, bench.id);
    const after = userClub(useGame.getState().game!)!.lineup!;
    expect(after.starters[slot]).toBe(bench.id);
    expect(after.penaltyTaker).toBe(taker);
    const saved = await loadGame();
    expect(saved.kind === "ok" && userClub(saved.state)!.lineup!.penaltyTaker).toBe(taker);
  });
});
