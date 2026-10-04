// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { playDate } from "../engine/season";
import { POSITIONS, type GameState } from "../engine/types";
import { loadGame, saveGame } from "../persistence/save";
import { useGame, userClub } from "../store";
import { Squad } from "./Squad";
import { preliminaryWithCupSuspended, resetAll, seededGame, seededGameIn, skipLive } from "./test-utils";
import { computeTable } from "../engine/table";
import { AI_FORMATION, autoLineup } from "../engine/lineup";

beforeEach(resetAll);

/** Written out here, not imported (L-004). */
const brl = (n: number) => `${n < 0 ? "-" : ""}R$ ${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

describe("tela Elenco", () => {
  test("22 jogadores ordenados por posição e força", () => {
    const game = seededGame(4, 2);
    useGame.setState({ phase: "squad", game });
    render(<Squad />);
    const rows = within(screen.getByRole("table", { name: "Elenco" })).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(22);
    const club = userClub(game)!;
    const expected = [...club.players].sort(
      (a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || b.rating - a.rating || a.name.localeCompare(b.name),
    );
    rows.forEach((row, i) => {
      const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
      const p = expected[i]!;
      expect(cells[0]).toBe(p.name);
      expect(cells[2]).toBe(String(p.age));
      expect(cells[3]).toBe(String(p.rating));
    });
    const positionsInOrder = rows.map((r) => within(r).getAllByRole("cell")[1]!.textContent);
    expect(positionsInOrder.join(",")).toBe([...Array(3).fill("GOL"), ...Array(7).fill("ZAG"), ...Array(7).fill("MEI"), ...Array(5).fill("ATA")].join(","));
  });

  test("oferece 4-4-2 4-3-3 3-5-2 4-5-1", () => {
    useGame.setState({ phase: "squad", game: seededGame() });
    render(<Squad />);
    const options = within(screen.getByLabelText("Formação")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["4-4-2", "4-3-3", "3-5-2", "4-5-1"]);
  });

  test("escalação incompleta desabilita Jogar rodada", async () => {
    const user = userEvent.setup();
    useGame.setState({ phase: "squad", game: seededGame() });
    render(<Squad />);
    const play = screen.getByRole("button", { name: "Jogar rodada" });
    expect(play).toBeEnabled();
    expect(screen.queryByText(/Faltam/)).not.toBeInTheDocument();

    // Move the starter of the first DF slot into the second DF slot: the first slot empties.
    const slot2 = screen.getByLabelText("Titular 2 (ZAG)") as HTMLSelectElement;
    const slot3 = screen.getByLabelText("Titular 3 (ZAG)") as HTMLSelectElement;
    await user.selectOptions(slot3, slot2.value);
    expect(screen.getByText("Falta 1 titular")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar rodada" })).toBeDisabled();

    // Selecting a bench DF (not starting anywhere) for the empty slot makes it valid again.
    const empty = screen.getByLabelText("Titular 2 (ZAG)") as HTMLSelectElement;
    expect(empty.value).toBe("");
    const starting = new Set(userClub(useGame.getState().game!)!.lineup!.starters);
    const spare = [...empty.options].map((o) => o.value).find((v) => v && !starting.has(v))!;
    expect(spare).toBeTruthy();
    await user.selectOptions(empty, spare);
    expect(screen.queryByText(/Faltam/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar rodada" })).toBeEnabled();
  });

  test("suspenso fica fora com selo SUS", () => {
    const game = seededGame(4, 2);
    const club = userClub(game)!;
    const benchDf = club.players.find((p) => p.position === "DF" && !club.lineup!.starters.includes(p.id))!;
    benchDf.suspendedRounds = 1;
    useGame.setState({ phase: "squad", game });
    render(<Squad />);
    const row = within(screen.getByRole("table", { name: "Elenco" })).getByText(benchDf.name).closest("tr")!;
    expect(within(row).getByText("SUS")).toBeInTheDocument();
    const slot = screen.getByLabelText("Titular 2 (ZAG)") as HTMLSelectElement;
    expect([...slot.options].map((o) => o.value)).not.toContain(benchDf.id);
  });

  test("lesionado fica fora com selo LES e rodadas", () => {
    const game = seededGame(4, 2);
    const club = userClub(game)!;
    const benchMf = club.players.find((p) => p.position === "MF" && !club.lineup!.starters.includes(p.id))!;
    benchMf.injuryRounds = 3;
    useGame.setState({ phase: "squad", game });
    render(<Squad />);
    const row = within(screen.getByRole("table", { name: "Elenco" })).getByText(benchMf.name).closest("tr")!;
    expect(within(row).getByText("LES 3")).toBeInTheDocument();
    for (const select of screen.getAllByLabelText(/^Titular /) as HTMLSelectElement[]) {
      expect([...select.options].map((o) => o.value)).not.toContain(benchMf.id);
    }
  });

  test("escalação com indisponível desabilita", () => {
    const game = seededGame(4, 2);
    const club = userClub(game)!;
    const starter = club.players.find((p) => p.id === club.lineup!.starters[1])!;
    starter.injuryRounds = 2;
    useGame.setState({ phase: "squad", game });
    render(<Squad />);
    expect(screen.getByText("Falta 1 titular")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar rodada" })).toBeDisabled();
  });

  test("setas de moral em 5 níveis", () => {
    const game = seededGame(4, 2);
    const club = userClub(game)!;
    const levels: [number, string, string][] = [
      [-2, "↓", "mn2"],
      [-1, "↘", "mn1"],
      [0, "→", "mp0"],
      [1, "↗", "mp1"],
      [2, "↑", "mp2"],
    ];
    levels.forEach(([morale], i) => (club.players[i]!.morale = morale));
    useGame.setState({ phase: "squad", game });
    render(<Squad />);
    const table = screen.getByRole("table", { name: "Elenco" });
    levels.forEach(([, arrow, cls], i) => {
      const row = within(table).getByText(club.players[i]!.name).closest("tr")!;
      const el = row.querySelector(".morale")!;
      expect(el.textContent).toBe(arrow);
      expect(el).toHaveClass(cls);
    });
  });

  test("slot aceita outra posição e marca fora de posição", async () => {
    const user = userEvent.setup();
    const game = seededGame(4, 2);
    const club = userClub(game)!;
    const benchDf = club.players.find((p) => p.position === "DF" && !club.lineup!.starters.includes(p.id))!;
    useGame.setState({ phase: "squad", game });
    render(<Squad />);
    expect(screen.queryByText("fora de posição")).not.toBeInTheDocument();
    // Every slot offers an available bench player of each of the 4 positions, its own and the 3 foreign ones.
    for (const pos of POSITIONS) {
      const spare = club.players.find((p) => p.position === pos && !club.lineup!.starters.includes(p.id))!;
      expect(spare).toBeTruthy();
      for (const select of screen.getAllByLabelText(/^Titular /) as HTMLSelectElement[]) {
        expect([...select.options].map((o) => o.value)).toContain(spare.id);
      }
    }
    const fwSlot = screen.getByLabelText("Titular 11 (ATA)") as HTMLSelectElement;
    await user.selectOptions(fwSlot, benchDf.id);
    expect(fwSlot.closest(".token")).toHaveClass("oop");
    expect(screen.getByText("fora de posição")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar rodada" })).toBeEnabled();
  });

  test("coluna salário", () => {
    const game = seededGame(4, 2);
    const club = userClub(game)!;
    useGame.setState({ phase: "squad", game });
    render(<Squad />);
    const table = screen.getByRole("table", { name: "Elenco" });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    const col = headers.indexOf("Salário");
    expect(col).toBeGreaterThan(-1);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(22);
    for (const row of rows) {
      const cells = within(row).getAllByRole("cell");
      const player = club.players.find((p) => p.name === cells[0]!.textContent)!;
      expect(cells[col]!.textContent, player.name).toBe(brl(player.salary));
    }
  });

  test("marcar à venda", async () => {
    const user = userEvent.setup();
    const game = seededGame(4, 2);
    const player = userClub(game)!.players[7]!;
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<Squad />);
    await user.click(screen.getByRole("checkbox", { name: `À venda: ${player.name}` }));
    await vi.waitFor(() => expect(userClub(useGame.getState().game!)!.forSale).toEqual([player.id]));
    expect(screen.getByRole("checkbox", { name: `À venda: ${player.name}` })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: `À venda: ${player.name}` }));
    await vi.waitFor(() => expect(userClub(useGame.getState().game!)!.forSale).toEqual([]));
  });

  test("marcar à venda recusa quem chegou na temporada", async () => {
    // Correcoes-validacao AC 24: the Squad screen, where the box is, shows the refusal too.
    const user = userEvent.setup();
    const game = seededGame(4, 2);
    const player = userClub(game)!.players[7]!;
    player.arrivedSeason = game.season;
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<Squad />);
    await user.click(screen.getByRole("checkbox", { name: `À venda: ${player.name}` }));
    expect(await screen.findByText("Chegou nesta temporada: só pode ser vendido na próxima")).toBeInTheDocument();
    expect(userClub(useGame.getState().game!)!.forSale).toEqual([]);
    expect(screen.getByRole("checkbox", { name: `À venda: ${player.name}` })).not.toBeChecked();
  });

  test("marcar à venda só com mercado aberto", () => {
    useGame.setState({ phase: "squad", game: seededGame(4, 2, 5), hasSave: true });
    render(<Squad />);
    expect(screen.queryAllByRole("checkbox", { name: /^À venda/ })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /^Dispensar/ })).toHaveLength(0);
  });

  test("dispensar com confirmação", async () => {
    const user = userEvent.setup();
    const game = seededGame(4, 2);
    const club = userClub(game)!;
    const player = club.players.find((p) => !club.lineup!.starters.includes(p.id))!;
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<Squad />);
    await user.click(screen.getByRole("button", { name: `Dispensar ${player.name}` }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(`Dispensar ${player.name} custa ${brl(4 * player.salary)}. Confirmar?`);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(useGame.getState().game).toBe(game);
    await user.click(screen.getByRole("button", { name: `Dispensar ${player.name}` }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    await vi.waitFor(() => expect(useGame.getState().game).not.toBe(game));
    const after = useGame.getState().game!;
    expect(userClub(after)!.finance.cash).toBe(club.finance.cash - 4 * player.salary);
    expect(userClub(after)!.players.map((p) => p.id)).not.toContain(player.id);
    expect(after.market.freeAgents.map((p) => p.id)).toContain(player.id);
  });

});

/** Written out here, not imported (L-004). */
const expectedSalary = (rating: number) => Math.round((2000 * 1.09 ** (rating - 40)) / 100) * 100;

describe("elenco com divisões, contratos e meta", () => {
  test("classificação com seletor de divisão", async () => {
    const user = userEvent.setup();
    const game = seededGameIn(1, 26, 3, 2);
    useGame.setState({ phase: "squad", game });
    render(<Squad />);
    const names = () => within(screen.getByRole("table", { name: "Classificação" })).getAllByRole("row").slice(1).map((r) => r.querySelector(".club-name-text")!.textContent);
    const select = screen.getByLabelText("Divisão") as HTMLSelectElement;
    // Paises (Superseded checks): the 4 leagues.
    expect([...select.options].map((o) => o.textContent)).toEqual(["Série A", "Série B", "Liga Argentina", "Liga Portuguesa"]);
    expect(select.selectedOptions[0]!.textContent).toBe("Série B");
    expect(names()).toEqual(computeTable(game.leagues[1]!).map((r) => r.name));
    await user.selectOptions(select, "Série A");
    expect(names()).toEqual(computeTable(game.leagues[0]!).map((r) => r.name));
    expect(names()).toHaveLength(20);
  });

  test("coluna contrato e último ano", () => {
    const game = seededGame(27);
    userClub(game)!.players.forEach((p, i) => (p.contractSeasons = 1 + (i % 4)));
    useGame.setState({ phase: "squad", game });
    render(<Squad />);
    const table = screen.getByRole("table", { name: "Elenco" });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    const col = headers.indexOf("Contr.");
    expect(col).toBe(headers.indexOf("Salário") + 1);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(22);
    let lastYear = 0;
    for (const r of rows) {
      const cells = within(r).getAllByRole("cell");
      const p = userClub(game)!.players.find((x) => x.name === cells[0]!.textContent)!;
      const cell = cells[col]!;
      expect(cell.textContent!.startsWith(String(p.contractSeasons)), p.name).toBe(true);
      expect(within(cell).queryByText("Último ano") !== null, p.name).toBe(p.contractSeasons === 1);
      if (p.contractSeasons === 1) lastYear++;
    }
    expect(lastYear).toBeGreaterThan(0);
  });

  test("renovar mostra salário novo", async () => {
    const user = userEvent.setup();
    const game = seededGame(28);
    const [last, other] = userClub(game)!.players;
    Object.assign(last!, { contractSeasons: 1, rating: 77, salary: 5_000 });
    Object.assign(other!, { contractSeasons: 2 });
    // The rest spread over 1 to 4, so the rule is checked on every row, not on one sample.
    userClub(game)!.players.slice(2).forEach((p, i) => (p.contractSeasons = 1 + (i % 4)));
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<Squad />);
    expect(screen.queryByRole("button", { name: `Renovar ${other!.name}` })).not.toBeInTheDocument();
    // Every row: «Renovar» exactly on the last-year contracts.
    for (const p of userClub(game)!.players) {
      const has = screen.queryByRole("button", { name: `Renovar ${p.name}` }) !== null;
      expect(has, `${p.name} contrato ${p.contractSeasons}`).toBe(p.contractSeasons === 1);
    }
    expect(screen.getAllByRole("button", { name: /^Renovar / })).toHaveLength(userClub(game)!.players.filter((p) => p.contractSeasons === 1).length);
    const y = expectedSalary(77);
    await user.click(screen.getByRole("button", { name: `Renovar ${last!.name}` }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(`Renovar ${last!.name} por 3 temporadas com salário ${brl(y)} por rodada. Confirmar?`);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(userClub(useGame.getState().game!)!.players[0]).toMatchObject({ contractSeasons: 1, salary: 5_000 });
    await user.click(screen.getByRole("button", { name: `Renovar ${last!.name}` }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    await vi.waitFor(() => expect(userClub(useGame.getState().game!)!.players[0]).toMatchObject({ contractSeasons: 3, salary: y }));
    expect(screen.queryByRole("button", { name: `Renovar ${last!.name}` })).not.toBeInTheDocument();
  });

  test("meta da temporada", () => {
    const cases: [number, number, string][] = [
      [0, 8, "Meta: até o 8º"],
      [0, 16, "Meta: não cair"],
      [1, 4, "Meta: subir"],
    ];
    for (const [division, goal, text] of cases) {
      resetAll();
      const game = seededGameIn(division, 29);
      game.boardGoal = goal;
      useGame.setState({ phase: "squad", game });
      const view = render(<Squad />);
      expect(screen.getByText(text)).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("elenco com a copa (copa-nacional)", () => {
  test("próxima data de copa no elenco", () => {
    const game = seededGame(101, 0, 4);
    useGame.setState({ phase: "squad", game });
    const { unmount } = render(<Squad />);
    expect(screen.getByText("Copa Nacional · Preliminar")).toBeInTheDocument();
    expect(screen.queryByText(/^Rodada \d+ de 38$/)).not.toBeInTheDocument();
    unmount();
    useGame.setState({ game: playDate(game).state });
    render(<Squad />);
    expect(screen.getByText("Rodada 5 de 38")).toBeInTheDocument();
    expect(screen.queryByText(/Copa Nacional ·/)).not.toBeInTheDocument();
  });

  test("suspensões pela próxima data", () => {
    const rowOf = (name: string) => within(screen.getByRole("table", { name: "Elenco" })).getByText(name).closest("tr")!;
    const mark = (game: GameState) => {
      const club = userClub(game)!;
      const bench = club.players.filter((p) => !club.lineup!.starters.includes(p.id) && p.injuryRounds === 0);
      const [cupOnly, leagueOnly] = [bench[0]!, bench[1]!];
      cupOnly.cupDiscipline = { "cup-nat": { yellowCards: 0, suspendedRounds: 1 } };
      cupOnly.suspendedRounds = 0;
      leagueOnly.suspendedRounds = 1;
      return { cupOnly, leagueOnly };
    };
    // Next date: the cup's preliminary, which the user plays (ajustes-4a: a cup date without the
    // user reads the league). Seed 102's Série B club 0 is in the Preliminar.
    const cupNext = seededGameIn(1, 102, 0, 4);
    expect(cupNext.cups[0]!.phases[0]!.ties.some((t) => t.homeId === cupNext.userClubId || t.awayId === cupNext.userClubId)).toBe(true);
    const a = mark(cupNext);
    useGame.setState({ phase: "squad", game: cupNext });
    const { unmount } = render(<Squad />);
    expect(within(rowOf(a.cupOnly.name)).getByText("Suspenso (copa)")).toBeInTheDocument();
    expect(rowOf(a.cupOnly.name)).toHaveClass("out");
    expect(within(rowOf(a.leagueOnly.name)).queryByText(/SUS|Suspenso/)).not.toBeInTheDocument();
    expect(rowOf(a.leagueOnly.name)).not.toHaveClass("out");
    unmount();
    // Next date: a league round.
    const leagueNext = seededGame(102, 0, 5);
    const b = mark(leagueNext);
    useGame.setState({ phase: "squad", game: leagueNext });
    render(<Squad />);
    expect(within(rowOf(b.leagueOnly.name)).getByText("SUS")).toBeInTheDocument();
    expect(rowOf(b.leagueOnly.name)).toHaveClass("out");
    expect(within(rowOf(b.cupOnly.name)).queryByText(/SUS|Suspenso/)).not.toBeInTheDocument();
    expect(rowOf(b.cupOnly.name)).not.toHaveClass("out");
  });

  test("botão copa", async () => {
    const user = userEvent.setup();
    useGame.setState({ phase: "squad", game: seededGame(103), hasSave: true });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Copa" }));
    expect(screen.getByRole("heading", { level: 1, name: "Copa Nacional" })).toBeInTheDocument();
    expect(useGame.getState().phase).toBe("cup");
  });
});

describe("elenco em data de copa sem o usuário (ajustes-4a)", () => {
  test("data de copa sem o usuário libera o suspenso de copa", () => {
    const rowOf = (name: string) => within(screen.getByRole("table", { name: "Elenco" })).getByText(name).closest("tr")!;
    // The top seed skips the Preliminar: the next date is the cup's, without the user.
    const off = preliminaryWithCupSuspended(141, (s) => s.cups[0]!.seeding[0]!);
    expect(off.game.cups[0]!.phases[0]!.ties.some((t) => t.homeId === off.game.userClubId || t.awayId === off.game.userClubId)).toBe(false);
    useGame.setState({ phase: "squad", game: off.game });
    const { unmount } = render(<Squad />);
    expect(screen.getByText("Copa Nacional · Preliminar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar rodada" })).toBeEnabled();
    expect(screen.queryByText(/Faltam/)).not.toBeInTheDocument();
    expect(within(rowOf(off.suspended.name)).queryByText("Suspenso (copa)")).not.toBeInTheDocument();
    expect(rowOf(off.suspended.name)).not.toHaveClass("out");
    unmount();
    // A club in the Preliminar: blocked and marked, as before.
    const on = preliminaryWithCupSuspended(141, (s) => s.cups[0]!.phases[0]!.ties[0]!.homeId);
    useGame.setState({ phase: "squad", game: on.game });
    render(<Squad />);
    expect(screen.getByRole("button", { name: "Jogar rodada" })).toBeDisabled();
    expect(screen.getByText("Falta 1 titular")).toBeInTheDocument();
    expect(within(rowOf(on.suspended.name)).getByText("Suspenso (copa)")).toBeInTheDocument();
    expect(rowOf(on.suspended.name)).toHaveClass("out");
  });
});

describe("textos do elenco (correcoes-validacao)", () => {
  test("concordância de titulares", () => {
    // C40 (AC 36, L-008): 1 and 3 empty slots, with the whole squad available.
    const rows: [number, string][] = [
      [1, "Falta 1 titular"],
      [3, "Faltam 3 titulares"],
    ];
    for (const [empty, text] of rows) {
      const game = seededGame(5);
      const club = userClub(game)!;
      for (const p of club.players) Object.assign(p, { injuryRounds: 0, suspendedRounds: 0 });
      club.lineup = { ...club.lineup!, starters: club.lineup!.starters.map((id, i) => (i >= 1 && i <= empty ? null : id)) };
      useGame.setState({ phase: "squad", game });
      const view = render(<Squad />);
      expect(screen.getByRole("status"), text).toHaveTextContent(text);
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Jogar rodada" })).toBeDisabled();
      view.unmount();
    }
  });
});

describe("elenco curto (correcoes-validacao)", () => {
  test("joga com vaga quando faltam aptos", async () => {
    // C18 (AC 16, AC 17, L-003): 10 available, all in the eleven; the rest out for 5 rounds.
    const user = userEvent.setup();
    const game = seededGame(12);
    const me = userClub(game)!;
    me.players.forEach((p, i) => Object.assign(p, { injuryRounds: i < 10 ? 0 : 5, suspendedRounds: 0 }));
    me.lineup = autoLineup(me, AI_FORMATION);
    expect(me.lineup.starters.filter((id) => id === null)).toHaveLength(1);
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<App />);
    const play = screen.getByRole("button", { name: "Jogar rodada" });
    expect(play).toBeEnabled();
    expect(screen.queryByText(/Falta/)).not.toBeInTheDocument();
    await user.click(play);
    await skipLive(user);
    await screen.findByRole("tabpanel", { name: "Sua partida" });
    expect(useGame.getState().phase).toBe("round");
    expect(useGame.getState().lastRound!.results.some((r) => r.homeId === me.id || r.awayId === me.id)).toBe(true);
    expect(screen.getByRole("button", { name: "Jogar rodada" })).toBeEnabled();
  }, 60_000);
});

describe("abas do elenco (correcoes-validacao)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const layout = (narrow: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 900px)" ? narrow : false, media: query, addEventListener() {}, removeEventListener() {} }));

  test("aba selecionada visível no desktop", () => {
    // C52 (AC 48): «Campo» is mobile-only; a wide screen starts on a tab it shows.
    layout(false);
    useGame.setState({ phase: "squad", game: seededGame(4), hasSave: true });
    const wide = render(<Squad />);
    const selected = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("Elenco");
    expect(selected[0]).not.toHaveClass("mobile-only");
    expect(document.getElementById(selected[0]!.getAttribute("aria-controls")!)).toHaveClass("m-active");
    wide.unmount();

    // A narrow screen still starts on the pitch.
    layout(true);
    render(<Squad />);
    expect(screen.getByRole("tab", { name: "Campo" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("confirmações com foco (correcoes-validacao)", () => {
  test("foco na confirmação", async () => {
    // C54 (AC 50, L-005): «Dispensar» and «Renovar»; the focus lands on each «Confirmar».
    const user = userEvent.setup();
    const game = seededGame(28);
    const club = userClub(game)!;
    const bench = club.players.find((p) => !club.lineup!.starters.includes(p.id))!;
    bench.contractSeasons = 1;
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<Squad />);
    const rows: [string, string][] = [
      [`Dispensar ${bench.name}`, "Confirmar dispensa"],
      [`Renovar ${bench.name}`, "Confirmar renovação"],
    ];
    for (const [open, dialogName] of rows) {
      await user.click(screen.getByRole("button", { name: open }));
      const dialog = screen.getByRole("alertdialog", { name: dialogName });
      expect(document.activeElement, dialogName).toBe(within(dialog).getByRole("button", { name: "Confirmar" }));
      await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    }
  });
});

describe("treino no elenco (treino-evolucao)", () => {
  test("seletor de treino", async () => {
    // C13 (L-008): the three options in order, each saved and explained by its exact line.
    const user = userEvent.setup();
    const game = seededGame(4);
    expect(userClub(game)!.training).toBeUndefined();
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<Squad />);
    const select = screen.getByLabelText("Treino") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Leve", "Normal", "Forte"]);
    expect(select.selectedOptions[0]!.textContent).toBe("Normal");
    expect(screen.getByText("Equilíbrio entre físico e evolução.")).toBeInTheDocument();
    const lines: [string, string, string][] = [
      ["light", "Leve", "Recupera mais o físico e evolui menos."],
      ["hard", "Forte", "Evolui mais, recupera menos o físico e lesiona mais."],
      ["normal", "Normal", "Equilíbrio entre físico e evolução."],
    ];
    for (const [value, label, line] of lines) {
      await user.selectOptions(select, label);
      expect(userClub(useGame.getState().game!)!.training, label).toBe(value);
      expect(screen.getByText(line), label).toBeInTheDocument();
    }
  });

  test("seta de evolução", () => {
    // C14: ▲/▼ from the last change, none without a log.
    const game = seededGame(4);
    const [up, down, empty, none] = userClub(game)!.players;
    up!.ratingLog = [
      { round: 3, delta: -1 },
      { round: 14, delta: 1 },
    ];
    down!.ratingLog = [{ round: 20, delta: -1 }];
    empty!.ratingLog = [];
    delete none!.ratingLog;
    useGame.setState({ phase: "squad", game });
    render(<Squad />);
    const table = screen.getByRole("table", { name: "Elenco" });
    const row = (name: string) => within(table).getAllByRole("row").find((r) => within(r).queryAllByRole("cell")[0]?.textContent === name)!;
    expect(within(row(up!.name)).getByLabelText("+1 na rodada 14").textContent).toBe("▲");
    expect(within(row(down!.name)).getByLabelText("−1 na rodada 20").textContent).toBe("▼");
    for (const p of [empty!, none!]) {
      expect(within(row(p.name)).queryByLabelText(/na rodada/), p.name).toBeNull();
      expect(within(row(p.name)).getAllByRole("cell")[3]!.textContent, p.name).toBe(String(p.rating));
    }
  });
});

describe("carreira no Elenco (carreira-dinamica)", () => {
  test("aviso da diretoria", () => {
    // C6: 1 to 3 show the warning; 0 and absent show nothing.
    for (const warnings of [1, 2, 3, 0, undefined]) {
      const game = seededGame(4, 2);
      if (warnings !== undefined) game.boardWarnings = warnings;
      useGame.setState({ phase: "squad", game });
      const { unmount } = render(<Squad />);
      if (warnings) expect(screen.getByText(`Aviso da diretoria (${warnings}/3): a campanha está abaixo do aceitável.`)).toBeInTheDocument();
      else expect(screen.queryByText(/Aviso da diretoria/)).not.toBeInTheDocument();
      unmount();
    }
  });

  test("proposta de emprego", async () => {
    // C15: two «Aceitar» and one «Recusar»; turning down keeps the club, accepting opens the new one.
    const game = seededGame(4, 2);
    const [a, b] = game.leagues[1]!.clubs;
    game.pendingJob = { reason: "offer", clubIds: [a!.id, b!.id] };
    const me = game.userClubId;
    useGame.setState({ phase: "squad", game, hasSave: true });
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    const dialog = screen.getByRole("dialog", { name: "Proposta de emprego" });
    expect(within(dialog).getAllByRole("button", { name: /^Aceitar/ })).toHaveLength(2);
    await user.click(within(dialog).getByRole("button", { name: "Recusar" }));
    // The panel goes once the save is written: wait for it.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Proposta de emprego" })).not.toBeInTheDocument());
    let saved = ((await loadGame()) as { state: GameState }).state;
    expect(saved.pendingJob).toBeUndefined();
    expect(saved.userClubId).toBe(me);
    unmount();

    resetAll();
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<App />);
    await user.click(screen.getAllByRole("button", { name: /^Aceitar/ })[1]!);
    expect(await screen.findByRole("heading", { name: b!.name })).toBeInTheDocument();
    saved = ((await loadGame()) as { state: GameState }).state;
    expect(saved.userClubId).toBe(b!.id);
  });
});

describe("menu principal (menu-no-elenco)", () => {
  test("menu principal pelo elenco", async () => {
    // C1 (L-003, L-008): out to the title menu and back to the same game.
    const user = userEvent.setup();
    const game = seededGame(4, 2);
    const club = userClub(game)!;
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Menu principal" }));
    expect(useGame.getState().phase).toBe("home");
    const continuar = await screen.findByRole("button", { name: "Continuar" });
    expect(continuar).toBeEnabled();
    await user.click(continuar);
    expect(await screen.findByRole("heading", { name: club.name })).toBeInTheDocument();
    expect(useGame.getState().phase).toBe("squad");
    expect(useGame.getState().game).toEqual(game);
  });
});

describe("empréstimo no Elenco (emprestimos)", () => {
  /** Opens the app on `game` saved in IndexedDB and goes to the squad (L-001). */
  async function openSaved(game: GameState) {
    await saveGame(game);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: userClub(game)!.name });
    return user;
  }
  const rowOf = (name: string) => within(screen.getByRole("table", { name: "Elenco" })).getByRole("row", { name: new RegExp(name) });
  const allClubsOf = (g: GameState) => g.leagues.flatMap((l) => l.clubs);
  /** Every Brazilian AI club rated `rating`, so a lent player starts nowhere unless he beats it. */
  const rateBrazil = (g: GameState, rating: number) =>
    g.leagues.filter((l) => l.country === "BR").flatMap((l) => l.clubs).filter((c) => c.id !== g.userClubId).forEach((c) => c.players.forEach((p) => (p.rating = rating)));

  test("botão emprestar no elenco", async () => {
    // C17: every own row has «Emprestar»; the borrowed one says «Emprestado» and has no action.
    const game = seededGame(4, 2);
    const club = userClub(game)!;
    const owner = game.leagues[0]!.clubs[6]!;
    const borrowed = { ...owner.players.pop()!, contractSeasons: 1, loanFrom: owner.id };
    club.players.push(borrowed);
    await openSaved(game);
    for (const p of club.players.filter((x) => x.id !== borrowed.id)) {
      expect(within(rowOf(p.name)).getByRole("button", { name: `Emprestar ${p.name}` })).toBeInTheDocument();
    }
    const row = rowOf(borrowed.name);
    expect(row).toHaveTextContent("Emprestado");
    expect(within(row).queryByLabelText(`À venda: ${borrowed.name}`)).not.toBeInTheDocument();
    for (const action of ["Dispensar", "Emprestar", "Renovar"]) {
      expect(within(row).queryByRole("button", { name: `${action} ${borrowed.name}` }), action).not.toBeInTheDocument();
    }
  });

  test("botão emprestar no elenco com o mercado fechado", () => {
    // C17: no «Emprestar» while the market is closed.
    const game = seededGame(4, 2, 5);
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<Squad />);
    expect(screen.queryAllByRole("button", { name: /^Emprestar / })).toHaveLength(0);
  });

  test("emprestar com confirmação", async () => {
    // C18 (L-001, L-003): the club door 2 picks is named; «Cancelar» changes nothing; «Confirmar» saves.
    const game = seededGame(4, 2);
    const club = userClub(game)!;
    rateBrazil(game, 90);
    const dest = game.leagues[1]!.clubs[11]!;
    dest.players.forEach((p) => (p.rating = 50));
    const player = club.players.find((p) => p.position === "MF" && !club.lineup!.starters.includes(p.id))!;
    Object.assign(player, { rating: 80, contractSeasons: 3 });
    const user = await openSaved(game);
    await user.click(screen.getByRole("button", { name: `Emprestar ${player.name}` }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirmar empréstimo" });
    expect(dialog).toHaveTextContent(`Emprestar ${player.name} para ${dest.name} até o fim da temporada? O salário fica com o clube que o recebe.`);
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Confirmar" }));
    expect(rowOf(player.name)).toBeInTheDocument();
    const before = useGame.getState().game;
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog", { name: "Confirmar empréstimo" })).not.toBeInTheDocument();
    expect(useGame.getState().game).toBe(before);
    await user.click(screen.getByRole("button", { name: `Emprestar ${player.name}` }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Confirmar empréstimo" })).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Elenco" })).queryByText(player.name)).not.toBeInTheDocument());
    await waitFor(async () => {
      const saved = await loadGame();
      if (saved.kind !== "ok") throw new Error(saved.kind);
      const there = allClubsOf(saved.state).find((c) => c.id === dest.id)!;
      expect(there.players.find((p) => p.id === player.id)?.loanFrom).toBe(club.id);
    });
  });

  test("recusas do emprestar na tela", async () => {
    // C19 (L-005, L-008): the refusal is in the bar and no confirmation opens.
    const cases: [string, (g: GameState) => string, string][] = [
      [
        "sem destino",
        (g) => {
          rateBrazil(g, 90);
          const c = userClub(g)!;
          return c.players.find((p) => !c.lineup!.starters.includes(p.id) && p.contractSeasons > 1)!.name;
        },
        "Nenhum clube quer esse jogador agora",
      ],
      [
        "último ano",
        (g) => {
          const c = userClub(g)!;
          const p = c.players.find((x) => !c.lineup!.starters.includes(x.id))!;
          p.contractSeasons = 1;
          return p.name;
        },
        "Renove o contrato antes de emprestar",
      ],
      [
        "elenco com 18",
        (g) => {
          const c = userClub(g)!;
          c.players = c.players.slice(0, 18);
          c.lineup = autoLineup(c, AI_FORMATION);
          return c.players.find((x) => x.contractSeasons > 1)!.name;
        },
        "Elenco no mínimo (18)",
      ],
    ];
    for (const [name, arrange, text] of cases) {
      cleanup();
      resetAll();
      const game = seededGame(4, 2);
      const who = arrange(game);
      useGame.setState({ phase: "squad", game, hasSave: true });
      render(<Squad />);
      await userEvent.setup().click(screen.getByRole("button", { name: `Emprestar ${who}` }));
      expect(screen.getByRole("status"), name).toHaveTextContent(text);
      expect(screen.queryByRole("alertdialog", { name: "Confirmar empréstimo" }), name).not.toBeInTheDocument();
      expect(useGame.getState().game, name).toBe(game);
    }
  });
});

describe("cobrador no elenco (penaltis)", () => {
  test("seletor de pênaltis", async () => {
    // C9 (AC 10-12, L-008): after «Treino»; «Automático» then the eleven in slot order; a bench
    // player reads as «Automático»; each choice saved, «Automático» removes the field.
    const user = userEvent.setup();
    const game = seededGame(4);
    const me = userClub(game)!;
    const bench = me.players.find((p) => !me.lineup!.starters.includes(p.id))!;
    me.lineup = { ...me.lineup!, penaltyTaker: bench.id };
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<Squad />);
    const labels = [...document.querySelectorAll(".formation-controls > label")].map((l) => l.firstChild?.textContent?.trim());
    expect(labels.indexOf("Pênaltis")).toBe(labels.indexOf("Treino") + 1);
    const select = screen.getByLabelText("Pênaltis") as HTMLSelectElement;
    const starters = me.lineup.starters.map((id) => me.players.find((p) => p.id === id)!);
    expect([...select.options].map((o) => o.textContent)).toEqual(["Automático", ...starters.map((p) => p.name)]);
    expect(select.selectedOptions[0]!.textContent).toBe("Automático");

    const mf = starters.find((p) => p.position === "MF")!;
    await user.selectOptions(select, mf.name);
    expect(userClub(useGame.getState().game!)!.lineup!.penaltyTaker).toBe(mf.id);
    expect(select.selectedOptions[0]!.textContent).toBe(mf.name);
    await waitFor(async () => {
      const saved = await loadGame();
      expect(saved.kind === "ok" && userClub(saved.state)!.lineup!.penaltyTaker).toBe(mf.id);
    });

    await user.selectOptions(select, "Automático");
    expect("penaltyTaker" in userClub(useGame.getState().game!)!.lineup!).toBe(false);
    await waitFor(async () => {
      const saved = await loadGame();
      expect(saved.kind === "ok" && "penaltyTaker" in userClub(saved.state)!.lineup!).toBe(false);
    });
  });
});
