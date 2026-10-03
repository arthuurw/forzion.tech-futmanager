// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { nextDate } from "../engine/calendar";
import { newGame } from "../engine/generate";
import { playDate } from "../engine/season";
import type { GameState } from "../engine/types";
import { useGame } from "../store";
import { Cup } from "./Cup";
import { resetAll } from "./test-utils";

beforeEach(resetAll);

const PHASES = ["Preliminar", "16 avos", "Oitavas", "Quartas", "Semifinal", "Final"];
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const nameOf = (s: GameState, id: string) => s.leagues.flatMap((l) => l.clubs).find((c) => c.id === id)!.name;

let full: GameState | null = null;
/** One whole season with no user, shared. */
function wholeSeason(): GameState {
  if (!full) {
    let s = newGame(111);
    while (nextDate(s).kind !== "over") s = playDate(s).state;
    full = s;
  }
  return clone(full);
}

function show(game: GameState) {
  useGame.setState({ phase: "cup", game });
  return render(<Cup />);
}

describe("tela Copa", () => {
  test("fases e confrontos", () => {
    const game = newGame(112);
    game.userClubId = game.leagues[0]!.clubs[0]!.id;
    const { unmount } = show(game);
    const regions = PHASES.map((p) => screen.getByRole("region", { name: p }));
    // In calendar order on the page.
    for (let i = 1; i < regions.length; i++) {
      expect(regions[i - 1]!.compareDocumentPosition(regions[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const ties = within(regions[0]!).getAllByRole("listitem");
    expect(ties).toHaveLength(8);
    game.cups[0]!.phases[0]!.ties.forEach((t, i) => {
      expect(ties[i]).toHaveTextContent(nameOf(game, t.homeId));
      expect(ties[i]).toHaveTextContent(nameOf(game, t.awayId));
    });
    for (const region of regions.slice(1)) expect(within(region).getByText("a sortear")).toBeInTheDocument();
    unmount();

    // After the preliminary: its scores, and the drawn «16 avos».
    let s = game;
    while (s.cups[0]!.currentPhase === 0) s = playDate(s).state;
    show(s);
    const played = within(screen.getByRole("region", { name: "Preliminar" })).getAllByRole("listitem");
    s.cups[0]!.phases[0]!.ties.forEach((t, i) => {
      const r = t.result!;
      const score = `${r.homeGoals} x ${r.awayGoals}${t.penalties ? ` (pên. ${t.penalties.home} x ${t.penalties.away})` : ""}`;
      expect(played[i]).toHaveTextContent(`${nameOf(s, t.homeId)} ${score} ${nameOf(s, t.awayId)}`);
    });
    expect(within(screen.getByRole("region", { name: "16 avos" })).getAllByRole("listitem")).toHaveLength(16);
    expect(within(screen.getByRole("region", { name: "Oitavas" })).getByText("a sortear")).toBeInTheDocument();
  }, 60_000);

  test("situação do usuário", () => {
    const alive = newGame(113);
    alive.userClubId = alive.leagues[0]!.clubs[3]!.id;
    const first = show(alive);
    expect(screen.getByText(/Na disputa/)).toBeInTheDocument();
    first.unmount();

    const s = wholeSeason();
    const cup = s.cups[0]!;
    const oitavas = cup.phases[2]!.ties[0]!;
    const out = oitavas.winnerId === oitavas.homeId ? oitavas.awayId : oitavas.homeId;
    const second = show({ ...s, userClubId: out });
    // Correcoes-validacao C39 (Impact): «nas Oitavas», was «na Oitavas».
    expect(screen.getByText(/Eliminado nas Oitavas/)).toBeInTheDocument();
    second.unmount();

    show({ ...s, userClubId: cup.phases[5]!.ties[0]!.winnerId });
    // Penaltis (Superseded checks): this champion also plays the continental, so the screen opens on
    // that tab (copa-continental AC 16); the national cup's tab is the one under test.
    fireEvent.click(screen.getByRole("tab", { name: cup.name }));
    expect(screen.getByText(/^Campeão/)).toBeInTheDocument();
    expect(screen.queryByText(/Na disputa|Eliminado/)).not.toBeInTheDocument();
  }, 60_000);

  test("placar com pênaltis na copa", () => {
    const s = wholeSeason();
    const tie = s.cups[0]!.phases[0]!.ties[0]!;
    tie.result = { homeGoals: 1, awayGoals: 1, goals: [] };
    tie.penalties = { home: 4, away: 3 };
    tie.winnerId = tie.homeId;
    s.userClubId = tie.homeId;
    show(s);
    const item = within(screen.getByRole("region", { name: "Preliminar" })).getAllByRole("listitem")[0]!;
    expect(item).toHaveTextContent("1 x 1 (pên. 4 x 3)");
  }, 60_000);
});

describe("tela Copa com a continental (copa-continental)", () => {
  const CONT = ["Oitavas", "Quartas", "Semifinal", "Final"];
  /** Written out (L-004). */
  const CODE: Record<string, string> = { BR: "BRA", AR: "ARG", PT: "POR" };
  const countryOf = (s: GameState, id: string) => s.leagues.find((l) => l.clubs.some((c) => c.id === id))!.country;
  const regionNames = () => screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
  const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

  test("duas abas com as fases de cada copa", () => {
    // C16 (AC 16): a Série B club, so the screen opens on the national cup.
    const game = newGame(141);
    game.userClubId = game.leagues[1]!.clubs[0]!.id;
    show(game);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Copa Nacional", "Copa Continental"]);
    expect(regionNames()).toEqual(PHASES);
    tab("Copa Continental");
    expect(regionNames()).toEqual(CONT);
    const ties = within(screen.getByRole("region", { name: "Oitavas" })).getAllByRole("listitem");
    expect(ties).toHaveLength(8);
    game.cups[1]!.phases[0]!.ties.forEach((t, i) => {
      expect(ties[i]).toHaveTextContent(nameOf(game, t.homeId));
      expect(ties[i]).toHaveTextContent(nameOf(game, t.awayId));
    });
    for (const p of CONT.slice(1)) expect(within(screen.getByRole("region", { name: p })).getByText("a sortear")).toBeInTheDocument();
  });

  test("aba inicial da tela Copa", () => {
    // C17 (AC 17).
    const base = newGame(142);
    const cases: [string, string | null, string][] = [
      ["classificado", base.cups[1]!.seeding[0]!, "Copa Continental"],
      ["só na nacional", base.leagues[1]!.clubs[0]!.id, "Copa Nacional"],
      ["sem clube", null, "Copa Nacional"],
    ];
    for (const [label, userClubId, title] of cases) {
      const view = show({ ...clone(base), userClubId });
      expect(screen.getByRole("heading", { level: 1 }), label).toHaveTextContent(title);
      view.unmount();
    }
  });

  test("sigla do país na continental", () => {
    // C18 (AC 18).
    const game = newGame(143);
    game.userClubId = game.cups[1]!.seeding[0]!;
    show(game);
    const items = within(screen.getByRole("region", { name: "Oitavas" })).getAllByRole("listitem");
    const seen = new Set<string>();
    game.cups[1]!.phases[0]!.ties.forEach((t, i) => {
      const tags = [...items[i]!.querySelectorAll(".country-tag")].map((e) => e.textContent);
      expect(tags, t.id).toEqual([CODE[countryOf(game, t.homeId)], CODE[countryOf(game, t.awayId)]]);
      tags.forEach((c) => seen.add(c!));
    });
    expect(seen).toEqual(new Set(["BRA", "ARG", "POR"]));
    tab("Copa Nacional");
    expect(document.querySelectorAll(".country-tag")).toHaveLength(0);
  });

  test("fora da competição", () => {
    // C19 (AC 19, L-007).
    const game = newGame(144);
    const argentine = game.cups[1]!.seeding.find((id) => countryOf(game, id) === "AR")!;
    let view = show({ ...clone(game), userClubId: argentine });
    tab("Copa Nacional");
    expect(screen.getByText(/Fora da competição/)).toBeInTheDocument();
    view.unmount();

    const outside = game.leagues[0]!.clubs.find((c) => !game.cups[1]!.seeding.includes(c.id))!.id;
    view = show({ ...clone(game), userClubId: outside });
    tab("Copa Continental");
    expect(screen.getByText(/Fora da competição/)).toBeInTheDocument();
    view.unmount();

    show({ ...clone(game), userClubId: game.cups[1]!.seeding[0]! });
    expect(screen.getByText(/Na disputa/)).toBeInTheDocument();
    expect(screen.queryByText(/Fora da competição/)).not.toBeInTheDocument();
  });
});

describe("textos da copa (correcoes-validacao)", () => {
  test("concordância da eliminação", () => {
    // C39 (AC 36, L-005, L-008): the 6 phases of the national cup and the 4 of the continental.
    const s = wholeSeason();
    const rows: [number, number, string][] = [
      [0, 0, "Eliminado na Preliminar"],
      [0, 1, "Eliminado nos 16 avos"],
      [0, 2, "Eliminado nas Oitavas"],
      [0, 3, "Eliminado nas Quartas"],
      [0, 4, "Eliminado na Semifinal"],
      [0, 5, "Eliminado na Final"],
      [1, 0, "Eliminado nas Oitavas"],
      [1, 1, "Eliminado nas Quartas"],
      [1, 2, "Eliminado na Semifinal"],
      [1, 3, "Eliminado na Final"],
    ];
    expect(rows).toHaveLength(s.cups[0]!.phases.length + s.cups[1]!.phases.length);
    for (const [c, k, text] of rows) {
      const tie = s.cups[c]!.phases[k]!.ties[0]!;
      const loser = tie.winnerId === tie.homeId ? tie.awayId : tie.homeId;
      const view = show({ ...clone(s), userClubId: loser });
      fireEvent.click(screen.getByRole("tab", { name: s.cups[c]!.name }));
      expect(screen.getByRole("heading", { level: 1 }), text).toHaveTextContent(s.cups[c]!.name);
      expect(screen.getByText(text), `${s.cups[c]!.name} ${k}`).toBeInTheDocument();
      view.unmount();
    }
  }, 60_000);
});
