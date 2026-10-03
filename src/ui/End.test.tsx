// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AI_FORMATION, autoLineup } from "../engine/lineup";
import { playRound } from "../engine/season";
import { reputationOffers } from "../engine/career";
import { computeTable } from "../engine/table";
import { zeroAiSurplus } from "../engine/test-fixtures";
import type { Club, GameState } from "../engine/types";
import { App } from "../App";
import { useGame } from "../store";
import { resetAll, seededGame, seededGameIn, skipLive } from "./test-utils";

beforeEach(resetAll);

describe("tela Fim", () => {
  test("fim mostra campeão sem Jogar rodada", async () => {
    const user = userEvent.setup();
    // Penaltis (Superseded checks): club 1 of seed 6 is now fired before round 38; club 2 is not.
    const game = seededGame(6, 2, 37);
    expect(game.pendingJob).toBeUndefined();
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<App />);
    expect(screen.getByText("Rodada 38 de 38")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    await skipLive(user);

    // Supersedes the core's title «Fim da temporada»: it now names the season (multiplas-temporadas C12).
    expect(await screen.findByText("Fim da temporada 1")).toBeInTheDocument();
    const final = useGame.getState().game!.leagues[0]!;
    expect(final.currentRound).toBe(38);
    const table = computeTable(final);
    // Penaltis (Superseded checks): this champion also won a cup, whose card reads the same line.
    const game2 = useGame.getState().game!;
    const cupTitles = game2.cups.filter((c) => c.phases.at(-1)!.ties[0]!.winnerId === table[0]!.clubId).length;
    expect(screen.getAllByText(`Campeão: ${table[0]!.name}`)).toHaveLength(1 + cupTitles);
    const rows = within(screen.getByRole("table", { name: "Classificação" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1]!.textContent)).toEqual(table.map((r) => r.name));
    // Column J (index 3: #, Clube, P, J, ...) reads 38 for every club after a full season.
    expect(rows.map((r) => within(r).getAllByRole("cell")[3]!.textContent)).toEqual(Array(20).fill("38"));
    expect(screen.queryByRole("button", { name: "Jogar rodada" })).not.toBeInTheDocument();
  });
});

/** Written out here, not imported (L-004). */
const brl = (n: number) => `R$ ${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const best11 = (c: Club) => [...c.players].map((p) => p.rating).sort((a, b) => b - a).slice(0, 11).reduce((a, b) => a + b, 0) / 11;

let ended: GameState | null = null;
/** One finished season, shared: the user's club is chosen afterwards by each test. */
function endedSeason(): GameState {
  // Gastos-da-ia, rule for older tests: the same season with the AI kept out of the market.
  ended ??= (() => {
    let s = seededGame(34, 0, 0);
    for (let r = 0; r < 38; r++) {
      zeroAiSurplus(s);
      s = playRound(s).state;
    }
    const club = s.leagues[0]!.clubs[0]!;
    club.lineup = autoLineup(club, club.lineup?.formation ?? AI_FORMATION);
    return s;
  })();
  return JSON.parse(JSON.stringify(ended)) as GameState;
}

describe("fim de temporada com duas divisões", () => {
  test("resumo da temporada", () => {
    const game = endedSeason();
    const tableA = computeTable(game.leagues[0]!);
    const tableB = computeTable(game.leagues[1]!);
    game.userClubId = tableA[6]!.clubId;
    game.boardGoal = 8;
    useGame.setState({ phase: "end", game, hasSave: true });
    render(<App />);
    expect(screen.getByRole("heading", { name: "Fim da temporada 1" })).toBeInTheDocument();
    // Treino-evolucao (Superseded checks): a division's champion may also have won a cup, whose card
    // reads the same line; each name shows once per title, the cups' winners read off the finals here.
    const cupTitles = (clubId: string) => game.cups.filter((c) => c.phases.at(-1)!.ties[0]!.winnerId === clubId).length;
    for (const row of [tableA[0]!, tableB[0]!]) expect(screen.getAllByText(`Campeão: ${row.name}`), row.name).toHaveLength(1 + cupTitles(row.clubId));
    const listed = (region: string) => within(screen.getByRole("region", { name: region })).getAllByRole("listitem").map((li) => li.textContent);
    expect(listed("Sobem")).toEqual(tableB.slice(0, 4).map((r) => r.name));
    expect(listed("Descem")).toEqual(tableA.slice(16).map((r) => r.name));
    expect(screen.getByText("Sua posição: 7º na Série A")).toBeInTheDocument();
    expect(screen.getByText(`Prêmio: ${brl(14 * 250_000)}`)).toBeInTheDocument();
    expect(screen.getByText("Meta cumprida")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Propostas de emprego" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima temporada" })).toBeEnabled();
  });

  test("demitido escolhe proposta", async () => {
    const user = userEvent.setup();
    const game = endedSeason();
    const tableA = computeTable(game.leagues[0]!);
    game.userClubId = tableA[9]!.clubId;
    game.boardGoal = 5;
    useGame.setState({ phase: "end", game, hasSave: true });
    render(<App />);
    expect(screen.getByText("Demitido")).toBeInTheDocument();
    const ranking = game.leagues.flatMap((l) => l.clubs).sort((a, b) => best11(b) - best11(a) || a.id.localeCompare(b.id));
    const at = ranking.findIndex((c) => c.id === game.userClubId);
    const below = ranking.slice(at + 1, at + 4);
    const offers = within(screen.getByRole("region", { name: "Propostas de emprego" })).getAllByRole("button");
    expect(offers).toHaveLength(3);
    offers.forEach((b, i) => expect(b.textContent!.startsWith(below[i]!.name)).toBe(true));
    const next = screen.getByRole("button", { name: "Próxima temporada" });
    expect(next).toBeDisabled();
    await user.click(offers[2]!);
    expect(next).toBeEnabled();
    await user.click(next);
    expect(await screen.findByRole("heading", { name: "Nova temporada" })).toBeInTheDocument();
    expect(useGame.getState().game!.userClubId).toBe(below[2]!.id);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: below[2]!.name })).toBeInTheDocument();
    expect(screen.queryByText(/Faltam \d+ titulares/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar rodada" })).toBeEnabled();
  }, 60_000);
});

describe("veredito na tela", () => {
  test("textos do veredito", () => {
    const base = endedSeason();
    const tableA = computeTable(base.leagues[0]!);
    // The user finishes 10th of the Série A; the goal decides the verdict (C38, the on-screen text).
    const cases: [number, string][] = [
      [10, "Meta cumprida"],
      [8, "Meta não cumprida"],
      [5, "Demitido"],
    ];
    for (const [goal, text] of cases) {
      resetAll();
      const game = JSON.parse(JSON.stringify(base)) as GameState;
      game.userClubId = tableA[9]!.clubId;
      game.boardGoal = goal;
      useGame.setState({ phase: "end", game, hasSave: true });
      const view = render(<App />);
      expect(screen.getByText("Sua posição: 10º na Série A")).toBeInTheDocument();
      const shown = ["Meta cumprida", "Meta não cumprida", "Demitido"].filter((t) => screen.queryByText(t));
      expect(shown, `meta ${goal}`).toEqual([text]);
      view.unmount();
    }
  });
});


describe("copa no fim (copa-nacional)", () => {
  const PHASES = ["Preliminar", "16 avos", "Oitavas", "Quartas", "Semifinal", "Final"];
  /** The last phase the club played, 6 for the champion, read off the ties here (L-004). */
  const reachedBy = (game: GameState, clubId: string) => {
    const cup = game.cups[0]!;
    if (cup.phases[5]!.ties[0]!.winnerId === clubId) return 6;
    let reached = -1;
    cup.phases.forEach((p, k) => {
      if (p.ties.some((t) => t.homeId === clubId || t.awayId === clubId)) reached = k;
    });
    return reached;
  };
  const nameIn = (game: GameState, id: string) => game.leagues.flatMap((l) => l.clubs).find((c) => c.id === id)!.name;

  test("copa salva o emprego", async () => {
    const user = userEvent.setup();
    const game = endedSeason();
    const tableA = computeTable(game.leagues[0]!);
    game.userClubId = tableA[9]!.clubId;
    game.boardGoal = 5;
    game.cupGoal = reachedBy(game, game.userClubId);
    expect(game.cupGoal).toBeGreaterThanOrEqual(1);
    useGame.setState({ phase: "end", game, hasSave: true });
    render(<App />);
    expect(screen.getByText("Meta não cumprida")).toBeInTheDocument();
    expect(screen.queryByText("Demitido")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Propostas de emprego" })).not.toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Próxima temporada" });
    expect(next).toBeEnabled();
    await user.click(next);
    expect(await screen.findByRole("heading", { name: "Nova temporada" })).toBeInTheDocument();
    const after = useGame.getState().game!;
    expect(after.userClubId).toBe(tableA[9]!.clubId);
    expect(after.history[0]!.verdict).toBe("missed");
  }, 60_000);

  test("copa no fim da temporada", () => {
    const base = endedSeason();
    const final = base.cups[0]!.phases[5]!.ties[0]!;
    const runnerUp = final.winnerId === final.homeId ? final.awayId : final.homeId;
    const userId = computeTable(base.leagues[0]!).map((r) => r.clubId).find((id) => id !== final.winnerId)!;
    const game = { ...clone(base), userClubId: userId };
    useGame.setState({ phase: "end", game, hasSave: true });
    const view = render(<App />);
    const section = screen.getByRole("region", { name: "Copa Nacional" });
    expect(within(section).getByText(`Campeão: ${nameIn(game, final.winnerId!)}`)).toBeInTheDocument();
    expect(within(section).getByText(`Vice: ${nameIn(game, runnerUp)}`)).toBeInTheDocument();
    expect(within(section).getByText(`Sua campanha: ${PHASES[reachedBy(game, userId)]}`)).toBeInTheDocument();
    view.unmount();
    resetAll();

    useGame.setState({ phase: "end", game: { ...clone(base), userClubId: final.winnerId }, hasSave: true });
    render(<App />);
    expect(within(screen.getByRole("region", { name: "Copa Nacional" })).getByText("Sua campanha: Campeão")).toBeInTheDocument();
  }, 60_000);
});

describe("fim com países (paises)", () => {
  test("fim com usuário em Portugal", () => {
    // C22 (AC 22, AD-010): the league of a user in Portugal, the goal «até o Nº», 4 champions.
    const game = seededGameIn(3, 36, 2, 38);
    game.boardGoal = 16;
    const me = game.userClubId!;
    const position = computeTable(game.leagues[3]!).findIndex((r) => r.clubId === me) + 1;
    useGame.setState({ phase: "end", game, hasSave: true });
    render(<App />);
    expect(screen.getByText(`Sua posição: ${position}º na Liga Portuguesa`)).toBeInTheDocument();
    // In the Série A, 16 would read «não cair».
    expect(screen.getByText("Meta: até o 16º")).toBeInTheDocument();
    const labels = [...document.querySelectorAll(".champions .division-name")].map((e) => e.textContent);
    expect(labels.slice(0, 4)).toEqual(["Série A", "Série B", "Liga Argentina", "Liga Portuguesa"]);
    // Copa-continental: a cup's champion can also be a league's, so each is read in its league's box.
    const boxes = [...document.querySelectorAll<HTMLElement>(".champions .division-result")].slice(0, 4);
    for (const k of [0, 1, 2, 3]) {
      const champion = computeTable(game.leagues[k]!)[0]!.name;
      const shown = within(boxes[k]!).getByText(`Campeão: ${champion}`);
      expect(shown.closest(".fill"), champion).not.toBeNull();
    }
    expect(screen.getByText(`Sua posição: ${position}º na Liga Portuguesa`).closest(".fill")).not.toBeNull();
  }, 60_000);
});

describe("campanha por copa (copa-continental)", () => {
  test("campanha com as fases de cada copa", () => {
    // C20 (AC 20): the club that went out in each phase, read off the ties here (L-004).
    const base = endedSeason();
    const loserOf = (cup: number, phase: number) => {
      const t = base.cups[cup]!.phases[phase]!.ties[0]!;
      return t.winnerId === t.homeId ? t.awayId : t.homeId;
    };
    const winnerOf = (cup: number, phase: number) => base.cups[cup]!.phases[phase]!.ties[0]!.winnerId!;
    const cases: [string, string, string][] = [
      ["Copa Continental", loserOf(1, 0), "Oitavas"],
      ["Copa Continental", loserOf(1, 1), "Quartas"],
      ["Copa Continental", loserOf(1, 3), "Final"],
      ["Copa Continental", winnerOf(1, 3), "Campeão"],
      ["Copa Nacional", loserOf(0, 3), "Quartas"],
      ["Copa Nacional", loserOf(0, 5), "Final"],
      ["Copa Nacional", winnerOf(0, 5), "Campeão"],
    ];
    for (const [cup, userClubId, reached] of cases) {
      useGame.setState({ phase: "end", game: { ...clone(base), userClubId }, hasSave: true });
      const view = render(<App />);
      const region = screen.getByRole("region", { name: cup });
      expect(within(region).getByText(`Sua campanha: ${reached}`), `${cup} ${reached}`).toBeInTheDocument();
      if (cup === "Copa Continental") expect(region.textContent).not.toMatch(/16 avos|Preliminar/);
      view.unmount();
      resetAll();
    }
  }, 60_000);
});

describe("propostas na virada (carreira-dinamica)", () => {
  test("propostas com a meta cumprida", async () => {
    // C17: a met goal with reputation 90 lists the offers; none picked keeps the club, one picked moves.
    const setup = () => {
      const game = endedSeason();
      const ranking = game.leagues.flatMap((l) => l.clubs).sort((a, b) => best11(b) - best11(a) || a.id.localeCompare(b.id));
      const me = ranking[29]!;
      game.userClubId = me.id;
      me.lineup = autoLineup(me, AI_FORMATION);
      game.boardGoal = 20;
      game.cupGoal = -1;
      delete game.pendingJob;
      const other = game.leagues[0]!.clubs[1]!.id;
      // 50 + 5 x 6 (met) + 4 (Série B title) + 6 (national cup) = 90.
      game.history = [1, 2, 3, 4, 5].map((season) => ({
        season,
        userClubId: "me",
        userLeagueId: game.leagues[season === 2 ? 1 : 0]!.id,
        userPosition: 1,
        verdict: "met" as const,
        prize: 0,
        divisions: game.leagues.map((l, i) => ({ leagueId: l.id, championId: season === 2 && i === 1 ? "me" : l.clubs[0]!.id, promotedIds: [], relegatedIds: [], topScorer: null })),
        cups: season === 4 ? [{ cupId: "cup-nat", championId: "me", runnerUpId: other, userReached: 6 }] : [],
      }));
      return { game, me, offers: reputationOffers(game, 38) };
    };
    const { game, me, offers } = setup();
    expect(offers).toHaveLength(2);
    const user = userEvent.setup();
    useGame.setState({ phase: "end", game, hasSave: true });
    const { unmount } = render(<App />);
    expect(screen.getByText("Meta cumprida")).toBeInTheDocument();
    const clubs = game.leagues.flatMap((l) => l.clubs);
    const buttons = within(screen.getByRole("region", { name: "Propostas de emprego" })).getAllByRole("button");
    expect(buttons.map((b) => b.textContent!.split(" · ")[0])).toEqual(offers.map((id) => clubs.find((c) => c.id === id)!.name));
    expect(screen.getByRole("button", { name: "Próxima temporada" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Próxima temporada" }));
    expect(await screen.findByRole("heading", { name: "Nova temporada" })).toBeInTheDocument();
    expect(useGame.getState().game!.userClubId).toBe(me.id);
    unmount();

    resetAll();
    const again = setup();
    useGame.setState({ phase: "end", game: again.game, hasSave: true });
    render(<App />);
    await user.click(within(screen.getByRole("region", { name: "Propostas de emprego" })).getAllByRole("button")[0]!);
    await user.click(screen.getByRole("button", { name: "Próxima temporada" }));
    expect(await screen.findByRole("heading", { name: "Nova temporada" })).toBeInTheDocument();
    expect(useGame.getState().game!.userClubId).toBe(again.offers[0]);
  }, 60_000);
});
