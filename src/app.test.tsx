// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { playRound } from "./engine/season";
import { computeTable } from "./engine/table";
import { loadGame, saveGame } from "./persistence/save";
import { useGame, userClub } from "./store";
import { App } from "./App";
import { nextSeason } from "./engine/rollover";
import { installAudio } from "./audio";
import { fakeBackend, musicRamps, trackStarts, type FakeBackend } from "./audio/test-backend";
import { resetAll, resetStore, seededGame, seededGameIn, skipLive } from "./ui/test-utils";

/** Every save waits on `ctl.gate` when one is set, so a test can observe the order of save and render. */
const ctl = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
vi.mock("./persistence/save", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./persistence/save")>();
  return {
    ...actual,
    saveGame: vi.fn(async (state: Parameters<typeof actual.saveGame>[0]) => {
      if (ctl.gate) await ctl.gate;
      return actual.saveGame(state);
    }),
  };
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  ctl.gate = null;
  resetAll();
});

describe("fluxo do app", () => {
  test("seleção do clube grava save antes do elenco", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Novo jogo" }));
    expect(await screen.findByText("Escolher clube")).toBeInTheDocument();

    const gate = deferred();
    ctl.gate = gate.promise;
    // Audio: the top strip's sound switches come first now; the first club card is the target.
    const [first] = screen.getAllByRole("button").filter((b) => b.classList.contains("club-card"));
    await user.click(first!);
    // Save is in flight and blocked: the squad screen must not be up yet.
    expect(vi.mocked(saveGame)).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("table", { name: "Elenco" })).not.toBeInTheDocument();
    expect(useGame.getState().phase).toBe("chooseClub");

    gate.resolve();
    expect(await screen.findByRole("table", { name: "Elenco" })).toBeInTheDocument();
    const loaded = await loadGame();
    expect(loaded.kind).toBe("ok");
    if (loaded.kind === "ok") expect(loaded.state.userClubId).toBe(useGame.getState().game!.userClubId);
  });

  test("rodada grava save antes de mostrar resultados", async () => {
    const user = userEvent.setup();
    useGame.setState({ phase: "squad", game: seededGame(5), hasSave: true });
    render(<App />);

    const gate = deferred();
    ctl.gate = gate.promise;
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    await skipLive(user);
    expect(vi.mocked(saveGame)).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tabpanel", { name: "Sua partida" })).not.toBeInTheDocument();
    expect(await loadGame()).toEqual({ kind: "none" });

    gate.resolve();
    expect(await screen.findByRole("tabpanel", { name: "Sua partida" })).toBeInTheDocument();
    const loaded = await loadGame();
    expect(loaded.kind).toBe("ok");
    if (loaded.kind === "ok") expect(loaded.state.leagues[0]!.currentRound).toBe(1);
  });

  test("Continuar restaura rodada tabela e escalação", async () => {
    const user = userEvent.setup();
    useGame.setState({ phase: "squad", game: seededGame(7, 3, 2), hasSave: true });
    render(<App />);
    await user.selectOptions(screen.getByLabelText("Formação"), "4-3-3");
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    await skipLive(user);
    await screen.findByRole("tabpanel", { name: "Sua partida" });
    const before = useGame.getState().game!;
    expect(before.leagues[0]!.currentRound).toBe(3);
    expect(userClub(before)!.lineup!.formation).toBe("4-3-3");

    // Reload: fresh store, same storage.
    cleanup();
    resetStore();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Rodada 4 de 38")).toBeInTheDocument();
    const after = useGame.getState().game!;
    expect(after).toEqual(before);
    expect((screen.getByLabelText("Formação") as HTMLSelectElement).value).toBe("4-3-3");
    expect(computeTable(after.leagues[0]!)).toEqual(computeTable(before.leagues[0]!));
    for (let i = 0; i < 11; i++) {
      expect((screen.getByLabelText(new RegExp(`^Titular ${i + 1} `)) as HTMLSelectElement).value).toBe(userClub(before)!.lineup!.starters[i]);
    }
  });

  test("sem IndexedDB joga com aviso", async () => {
    const user = userEvent.setup();
    // @ts-expect-error simulating a browser without IndexedDB
    globalThis.indexedDB = undefined;
    render(<App />);
    expect(await screen.findByText("Salvamento indisponível neste navegador")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Novo jogo" }));
    // Audio: the sound switches come first in the top strip; take the first club card.
    await user.click((await screen.findAllByRole("button")).filter((b) => b.classList.contains("club-card"))[0]!);
    await user.click(await screen.findByRole("button", { name: "Jogar rodada" }));
    await skipLive(user);
    expect(await screen.findByRole("tabpanel", { name: "Sua partida" })).toBeInTheDocument();
    expect(screen.getByText("Salvamento indisponível neste navegador")).toBeInTheDocument();
    expect(useGame.getState().game!.leagues[0]!.currentRound).toBe(1);
  });

  test("reload antes da rodada não muda resultado", async () => {
    const user = userEvent.setup();
    const afterRound1 = seededGame(9, 4, 1);
    // Path A: no reload - play round 2 straight from memory.
    const direct = playRound(afterRound1);

    // Path B: the same state comes back from storage after a reload, then round 2 is played in the app.
    await saveGame(afterRound1);
    resetStore();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Jogar rodada" }));
    await skipLive(user);
    await screen.findByRole("tabpanel", { name: "Sua partida" });

    const viaReload = useGame.getState();
    expect(viaReload.game).toEqual(direct.state);
    expect(viaReload.lastRound!.results).toEqual(direct.results);
    expect(viaReload.lastRound!.userEvents).toEqual(direct.userEvents);
  });

  test("reload antes da rodada repete propostas", async () => {
    const user = userEvent.setup();
    const afterRound1 = seededGame(9, 4, 1);
    const league = afterRound1.leagues[0]!;
    const me = league.clubs.find((c) => c.id === afterRound1.userClubId)!;
    // Offers need players for sale; AI signings need an AI club under 18.
    me.forSale = me.players.filter((p) => !me.lineup!.starters.includes(p.id)).map((p) => p.id);
    const ai = league.clubs.find((c) => c.id !== me.id)!;
    ai.players = ai.players.slice(0, 16);
    const direct = playRound(afterRound1);
    expect(direct.state.market.offers.length).toBeGreaterThan(0);
    expect(direct.state.leagues[0]!.clubs.find((c) => c.id === ai.id)!.players).toHaveLength(18);

    await saveGame(afterRound1);
    resetStore();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Jogar rodada" }));
    await skipLive(user);
    await screen.findByRole("tabpanel", { name: "Sua partida" });

    const viaReload = useGame.getState().game!;
    expect(viaReload.leagues[0]!.rounds).toEqual(direct.state.leagues[0]!.rounds);
    expect(viaReload.market).toEqual(direct.state.market);
    expect(viaReload.leagues[0]!.clubs.find((c) => c.id === ai.id)).toEqual(direct.state.leagues[0]!.clubs.find((c) => c.id === ai.id));
    expect(viaReload).toEqual(direct.state);
  });

  test("fim da rodada ao vivo grava e mostra resultados", async () => {
    const user = userEvent.setup();
    // Penaltis (Superseded checks): seed 2, whose user plays to 90' with no forced stop (seed 8 now has one).
    useGame.setState({ phase: "squad", game: seededGame(2), hasSave: true });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    // Let the clock run to 90' on its own, at 4x.
    await user.click(await screen.findByRole("button", { name: "4x" }));
    // The clock stops at half-time (AC 6); resume it.
    // Generous waits: 20 matches per tick, and the suite runs files in parallel.
    await screen.findByText("Intervalo", {}, { timeout: 25000 });
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("tabpanel", { name: "Sua partida" }, { timeout: 25000 })).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel", { name: "Outros resultados" })).getAllByRole("listitem")).toHaveLength(9);
    expect(within(screen.getByRole("table", { name: "Classificação" })).getAllByRole("row")).toHaveLength(21);
    const saved = await loadGame();
    expect(saved.kind).toBe("ok");
    if (saved.kind === "ok") {
      expect(saved.state.leagues[0]!.currentRound).toBe(1);
      expect(saved.state.leagues[0]!.rounds[0]!.matches.every((m) => m.result !== null)).toBe(true);
    }
  }, 90_000);

  test("recarregar no meio da rodada fecha a data", async () => {
    // Correcoes-validacao C14 (door 1, AD-019) supersedes partida-ao-vivo C12 (door 4): a reload
    // mid-round no longer starts it again; the date is played to its end from the saved state.
    const user = userEvent.setup();
    const before = seededGame(12);
    const direct = playRound(before);
    await saveGame(before);
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Jogar rodada" }));
    await screen.findByRole("timer", { name: "Relógio" });
    await new Promise((r) => setTimeout(r, 700));
    expect(useGame.getState().live!.minute).toBeGreaterThanOrEqual(2);
    expect(await loadGame()).toEqual({ kind: "ok", state: { ...before, pendingLive: true } });

    // Reload mid-round: fresh store, same storage.
    cleanup();
    resetStore();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Rodada 1" })).toBeInTheDocument();
    expect(await loadGame()).toEqual({ kind: "ok", state: direct.state });
    expect(useGame.getState().lastRound!.results).toEqual(direct.results);
  });


describe("duas divisões e várias temporadas", () => {
  test("rodada joga as duas divisões", async () => {
    const user = userEvent.setup();
    useGame.setState({ phase: "squad", game: seededGameIn(1, 23, 2), hasSave: true });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    await skipLive(user);
    expect(await screen.findByRole("heading", { name: "Rodada 1" })).toBeInTheDocument();
    const saved = await loadGame();
    if (saved.kind !== "ok") throw new Error("no save");
    for (const state of [useGame.getState().game!, saved.state]) {
      // Paises (Superseded checks): 4 leagues.
      expect(state.leagues).toHaveLength(4);
      for (const league of state.leagues) {
        expect(league.currentRound, league.id).toBe(1);
        const round1 = league.rounds[0]!.matches;
        expect(round1).toHaveLength(10);
        for (const m of round1) expect(m.result, `${league.id} ${m.id}`).not.toBeNull();
        for (const m of league.rounds[1]!.matches) expect(m.result).toBeNull();
      }
    }
  });

  test("escolher clube fixa a meta", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Novo jogo" }));
    await screen.findByText("Escolher clube");
    const game = useGame.getState().game!;
    const byName = [...game.leagues[0]!.clubs].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const chosen = byName[7]!;
    await user.click(screen.getAllByRole("button").filter((b) => b.classList.contains("club-card"))[7]!);
    await screen.findByRole("table", { name: "Elenco" });
    // Written out (L-004): rank by the best eleven in the division, ties by id; Série A goal min(16, r + 3).
    const best11 = (ratings: number[]) => [...ratings].sort((a, b) => b - a).slice(0, 11).reduce((a, b) => a + b, 0) / 11;
    const ranking = [...game.leagues[0]!.clubs].sort((a, b) => best11(b.players.map((p) => p.rating)) - best11(a.players.map((p) => p.rating)) || a.id.localeCompare(b.id));
    const goal = Math.min(16, ranking.findIndex((c) => c.id === chosen.id) + 1 + 3);
    const saved = await loadGame();
    if (saved.kind !== "ok") throw new Error("no save");
    expect(saved.state.userClubId).toBe(chosen.id);
    expect(saved.state.boardGoal).toBe(goal);
    expect(useGame.getState().game!.boardGoal).toBe(goal);
  });

  test("recarregar no fim mostra o mesmo resumo", async () => {
    const user = userEvent.setup();
    const game = seededGame(24, 3, 38);
    // Carreira-dinamica (fixture only): the engine played on past a sacking the store would have stopped at.
    delete game.pendingJob;
    await saveGame(game);
    resetStore();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Fim da temporada 1")).toBeInTheDocument();
    const tableA = computeTable(game.leagues[0]!);
    const tableB = computeTable(game.leagues[1]!);
    const position = tableA.findIndex((r) => r.clubId === game.userClubId) + 1;
    const prize = (21 - position) * 250_000;
    const verdict = position <= game.boardGoal ? "Meta cumprida" : position >= game.boardGoal + 5 || (game.boardGoal === 16 && position > 16) ? "Demitido" : "Meta não cumprida";
    const brl = (n: number) => `R$ ${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
    // Copa-continental: a cup's champion can also be a league's, so each is read in its league's box.
    const boxes = [...document.querySelectorAll<HTMLElement>(".champions .division-result")];
    expect(within(boxes[0]!).getByText(`Campeão: ${tableA[0]!.name}`)).toBeInTheDocument();
    expect(within(boxes[1]!).getByText(`Campeão: ${tableB[0]!.name}`)).toBeInTheDocument();
    expect(screen.getByText(`Sua posição: ${position}º na Série A`)).toBeInTheDocument();
    expect(screen.getByText(`Prêmio: ${brl(prize)}`)).toBeInTheDocument();
    expect(screen.getByText(verdict)).toBeInTheDocument();
    // The next season from the reloaded save is the same as from the original, field by field.
    const reloaded = useGame.getState().game!;
    expect(reloaded).toEqual(game);
    const jobs = verdict === "Demitido" ? (await import("./engine/season")).seasonReview(game).jobOffers[0] : undefined;
    expect(nextSeason(reloaded, jobs)).toEqual(nextSeason(game, jobs));
  }, 60_000);
});
});

describe("copa no app (copa-nacional)", () => {
  test("data de copa sem o usuário fecha direto", async () => {
    const user = userEvent.setup();
    const game = seededGame(161, 0, 4);
    // A Série A club: the preliminary is the 16 last of the seeding, all from the Série B.
    expect(game.cups[0]!.phases[0]!.ties.some((t) => t.homeId === game.userClubId || t.awayId === game.userClubId)).toBe(false);
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Copa Nacional · Preliminar" })).toBeInTheDocument();
    expect(screen.queryByRole("timer", { name: "Relógio" })).not.toBeInTheDocument();
    expect(useGame.getState().live).toBeNull();
    const ties = useGame.getState().game!.cups[0]!.phases[0]!.ties;
    expect(ties).toHaveLength(8);
    for (const t of ties) expect(t.winnerId, t.id).not.toBeNull();
    const loaded = await loadGame();
    if (loaded.kind !== "ok") throw new Error("no save");
    expect(loaded.state.cups[0]!.currentPhase).toBe(1);
    expect(loaded.state.leagues.map((l) => l.currentRound)).toEqual([4, 4, 4, 4]);
  });
});

describe("países no app (paises)", () => {
  test("usuário em Portugal joga e vê a tabela", async () => {
    // C23 (AC 21, L-003): through the app, from a new game.
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Novo jogo" }));
    expect(await screen.findByText("Escolher clube")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Liga Portuguesa" }));
    const card = screen.getAllByRole("button").filter((b) => b.classList.contains("club-card"))[5]!;
    await user.click(card);
    await screen.findByRole("table", { name: "Elenco" });
    const game = useGame.getState().game!;
    const me = userClub(game)!;
    expect(game.leagues[3]!.clubs.some((c) => c.id === me.id)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    await skipLive(user);
    await screen.findByRole("heading", { name: "Rodada 1" });
    const select = screen.getByLabelText("Divisão") as HTMLSelectElement;
    expect(select.selectedOptions[0]!.textContent).toBe("Liga Portuguesa");
    const rows = within(screen.getByRole("table", { name: "Classificação" })).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(20);
    const names = rows.map((r) => r.querySelector(".club-name-text")!.textContent);
    expect(new Set(names)).toEqual(new Set(useGame.getState().game!.leagues[3]!.clubs.map((c) => c.name)));
    expect(names).toContain(me.name);
  });
});

describe("som no app (audio)", () => {
  let backend: FakeBackend;
  beforeEach(() => {
    localStorage.clear();
    backend = fakeBackend();
    installAudio(backend);
  });

  const pressed = (buttons: HTMLElement[]) => buttons.map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
  const GESTAO = ["audio/music/gestao-1.mp3", "audio/music/gestao-2.mp3", "audio/music/gestao-3.mp3"];

  test("botões de áudio na tela inicial e no top strip", async () => {
    // C1: nothing stored, both on, «Música» before «Efeitos».
    const view = render(<App />);
    await screen.findByRole("button", { name: "Novo jogo" });
    const title = view.container.querySelector<HTMLElement>(".title-audio")!;
    expect(pressed(within(title).getAllByRole("button"))).toEqual([
      ["Música", "true"],
      ["Efeitos", "true"],
    ]);
    view.unmount();

    useGame.setState({ phase: "squad", game: seededGame(3), hasSave: true });
    const squad = render(<App />);
    expect(screen.getByRole("table", { name: "Elenco" })).toBeInTheDocument();
    const strip = squad.container.querySelector<HTMLElement>(".top-strip")!;
    expect(pressed(within(strip).getAllByRole("button"))).toEqual([
      ["Música", "true"],
      ["Efeitos", "true"],
    ]);
  });

  test("preferências de áudio gravadas e relidas", async () => {
    // C2 (door 1, L-001).
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(await screen.findByRole("button", { name: "Música" }));
    expect(localStorage.getItem("forzion-futmanager:audio")).toBe('{"music":false,"sfx":true}');
    expect(screen.getByRole("button", { name: "Música" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Efeitos" }));
    expect(localStorage.getItem("forzion-futmanager:audio")).toBe('{"music":false,"sfx":false}');
    expect(screen.getByRole("button", { name: "Efeitos" })).toHaveAttribute("aria-pressed", "false");
    view.unmount();

    // Reload with the key written first.
    localStorage.setItem("forzion-futmanager:audio", '{"music":false,"sfx":false}');
    resetStore();
    installAudio(fakeBackend());
    render(<App />);
    expect(await screen.findByRole("button", { name: "Música" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Efeitos" })).toHaveAttribute("aria-pressed", "false");
  });

  for (const gesture of ["pointerdown", "keydown"] as const) {
    test(`primeiro gesto inicia a música de abertura (${gesture})`, async () => {
      // C5 through the app.
      render(<App />);
      await screen.findByRole("button", { name: "Novo jogo" });
      expect(backend.calls).toEqual([]);
      if (gesture === "pointerdown") fireEvent.pointerDown(document);
      else fireEvent.keyDown(document, { key: "a" });
      expect(backend.calls[0]).toEqual({ kind: "start" });
      await waitFor(() => expect(trackStarts(backend.calls)).toEqual(["audio/music/abertura.mp3"]));
    });
  }

  test("tela ao vivo cala a música", async () => {
    // C13 through the app.
    const user = userEvent.setup();
    useGame.setState({ phase: "squad", game: seededGame(5), hasSave: true });
    render(<App />);
    fireEvent.pointerDown(document);
    await waitFor(() => expect(trackStarts(backend.calls)).toHaveLength(1));
    expect(GESTAO).toContain(trackStarts(backend.calls)[0]);
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    expect(await screen.findByRole("timer", { name: "Relógio" })).toBeInTheDocument();
    expect(musicRamps(backend.calls)).toEqual([{ kind: "music-ramp", gain: 0, seconds: 1 }]);
  });

  test("trocar de tela de gestão não recomeça a faixa", async () => {
    // C16 through the app.
    const user = userEvent.setup();
    useGame.setState({ phase: "squad", game: seededGame(5), hasSave: true });
    render(<App />);
    fireEvent.pointerDown(document);
    await waitFor(() => expect(trackStarts(backend.calls)).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Mercado" }));
    await user.click(await screen.findByRole("button", { name: "Voltar ao elenco" }));
    expect(await screen.findByRole("table", { name: "Elenco" })).toBeInTheDocument();
    expect(trackStarts(backend.calls)).toHaveLength(1);
    expect(backend.calls.filter((c) => c.kind === "stop-track")).toEqual([]);
    expect(musicRamps(backend.calls)).toEqual([]);
  });
});

describe("lançamento no app (lancamento)", () => {
  afterEach(() => vi.restoreAllMocks());

  test("uma tela que quebra mostra a tela de erro", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const game = seededGame(3);
    // A club with no player list: the squad screen throws while rendering.
    (game.leagues[0]!.clubs[0] as unknown as { players: unknown }).players = undefined;
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<App />);
    expect(await screen.findByText("Algo deu errado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument();
  });

  test("a tela Sobre fica no título", async () => {
    const backend = fakeBackend();
    installAudio(backend);
    localStorage.clear();
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(await screen.findByRole("button", { name: "Sobre" }));
    expect(screen.getByText("Clubes, jogadores e competições são fictícios.")).toBeInTheDocument();
    expect(view.container.querySelector(".title-audio")).not.toBeNull();
    expect(view.container.querySelector(".top-strip")).toBeNull();
    await waitFor(() => expect(trackStarts(backend.calls)).toEqual(["audio/music/abertura.mp3"]));
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.getByRole("button", { name: "Novo jogo" })).toBeInTheDocument();
  });
});
