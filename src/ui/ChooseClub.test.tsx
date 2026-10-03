// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { loadGame } from "../persistence/save";
import { newGame } from "../engine/generate";
import { bestElevenMean } from "../engine/lineup";
import { useGame } from "../store";
import { ChooseClub } from "./ChooseClub";
import { resetAll } from "./test-utils";

beforeEach(resetAll);

describe("tela Escolher clube", () => {
  test("lista 20 clubes em ordem alfabética com força", () => {
    const game = newGame(21);
    useGame.setState({ phase: "chooseClub", game });
    render(<ChooseClub />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(20);
    const clubs = [...game.leagues[0]!.clubs].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    buttons.forEach((button, i) => {
      const club = clubs[i]!;
      expect(button).toHaveTextContent(club.name);
      expect(button).toHaveTextContent(`força ${bestElevenMean(club).toFixed(1)}`);
    });
  });

  test("abas Série A e Série B", async () => {
    const user = userEvent.setup();
    const game = newGame(22);
    useGame.setState({ phase: "chooseClub", game });
    render(<App />);
    // Paises (Superseded checks): a tab per league, 4.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Série A", "Série B", "Liga Argentina", "Liga Portuguesa"]);
    const cards = () => screen.getAllByRole("button").filter((b) => b.classList.contains("club-card"));
    const expectDivision = (division: number) => {
      const clubs = [...game.leagues[division]!.clubs].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      expect(cards()).toHaveLength(20);
      cards().forEach((card, i) => {
        expect(card).toHaveTextContent(clubs[i]!.name);
        expect(card).toHaveTextContent(`força ${bestElevenMean(clubs[i]!).toFixed(1)}`);
      });
      return clubs;
    };
    expectDivision(0);
    await user.click(screen.getByRole("tab", { name: "Série B" }));
    expect(screen.getByRole("tab", { name: "Série B" })).toHaveAttribute("aria-selected", "true");
    const serieB = expectDivision(1);
    const chosen = serieB[3]!;
    await user.click(cards()[3]!);
    expect(await screen.findByRole("heading", { name: chosen.name })).toBeInTheDocument();
    const saved = await loadGame();
    if (saved.kind !== "ok") throw new Error("no save");
    expect(saved.state.userClubId).toBe(chosen.id);
    expect(within(screen.getByRole("table", { name: "Elenco" })).getAllByRole("row")).toHaveLength(23);
  });
});

describe("escolher clube em quatro ligas (paises)", () => {
  test("abas das quatro ligas", async () => {
    // C21 (AC 21).
    const user = userEvent.setup();
    const game = newGame(23);
    useGame.setState({ phase: "chooseClub", game });
    render(<App />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Série A", "Série B", "Liga Argentina", "Liga Portuguesa"]);
    await user.click(screen.getByRole("tab", { name: "Liga Portuguesa" }));
    const cards = screen.getAllByRole("button").filter((b) => b.classList.contains("club-card"));
    const clubs = [...game.leagues[3]!.clubs].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    expect(clubs.map((c) => c.id).every((id) => Number(id.slice(1)) >= 61)).toBe(true);
    expect(cards).toHaveLength(20);
    cards.forEach((card, i) => expect(card).toHaveTextContent(clubs[i]!.name));
    await user.click(cards[7]!);
    expect(await screen.findByRole("heading", { name: clubs[7]!.name })).toBeInTheDocument();
    expect(useGame.getState().game!.userClubId).toBe(clubs[7]!.id);
    const saved = await loadGame();
    if (saved.kind !== "ok") throw new Error("no save");
    expect(saved.state.userClubId).toBe(clubs[7]!.id);
  });
});

describe("dificuldade na escolha do clube (dificuldade)", () => {
  const LINES = {
    Fácil: "Mais caixa no começo, diretoria mais paciente e IA comprando menos.",
    Normal: "O jogo de sempre.",
    Difícil: "Menos caixa no começo, diretoria exigente e IA comprando mais.",
  };

  test("campo dificuldade", async () => {
    // C1 (AC 1, L-005, L-008): three radios in order, Normal checked, the line of each level.
    const user = userEvent.setup();
    useGame.setState({ phase: "chooseClub", game: newGame(21) });
    render(<ChooseClub />);
    const group = screen.getByRole("group", { name: "Dificuldade" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")!.textContent)).toEqual(["Fácil", "Normal", "Difícil"]);
    expect(within(group).getByRole("radio", { name: "Normal" })).toBeChecked();
    expect(group).toHaveTextContent(LINES.Normal);
    for (const level of ["Fácil", "Difícil", "Normal"] as const) {
      await user.click(within(group).getByRole("radio", { name: level }));
      expect(within(group).getByRole("radio", { name: level }), level).toBeChecked();
      expect(group, level).toHaveTextContent(LINES[level]);
    }
  });

  /** Picks `level` (or leaves Normal) on the screen, chooses the first card and returns the saved game. */
  async function choose(level: "Fácil" | "Normal" | "Difícil" | null, seed = 31) {
    const user = userEvent.setup();
    const game = newGame(seed);
    useGame.setState({ phase: "chooseClub", game });
    const view = render(<App />);
    if (level) await user.click(screen.getByRole("radio", { name: level }));
    const card = screen.getAllByRole("button").find((b) => b.classList.contains("club-card"))!;
    await user.click(card);
    await screen.findByRole("button", { name: "Mercado" });
    const saved = await loadGame();
    if (saved.kind !== "ok") throw new Error(saved.kind);
    view.unmount();
    return { game, saved: saved.state };
  }

  test("dificuldade gravada", async () => {
    // C2 (AC 2, L-001): the level goes into the saved game; untouched, Normal.
    expect((await choose("Difícil")).saved.difficulty).toBe("hard");
    resetAll();
    expect((await choose(null)).saved.difficulty).toBe("normal");
  });

  test("caixa pela dificuldade", async () => {
    // C3 (AC 3, L-005): the chosen club's cash by level, to R$ 100.000; another club unchanged.
    const cases: ["Fácil" | "Normal" | "Difícil", (c: number) => number][] = [
      ["Fácil", (c) => 2 * c],
      ["Normal", (c) => c],
      ["Difícil", (c) => Math.round(c / 2 / 100_000) * 100_000],
    ];
    for (const [level, expected] of cases) {
      resetAll();
      const { game, saved } = await choose(level);
      const id = saved.userClubId!;
      const cashOf = (s: typeof game, clubId: string) => s.leagues.flatMap((l) => l.clubs).find((c) => c.id === clubId)!.finance.cash;
      expect(cashOf(saved, id), level).toBe(expected(cashOf(game, id)));
      const other = game.leagues[0]!.clubs.find((c) => c.id !== id)!.id;
      expect(cashOf(saved, other), level).toBe(cashOf(game, other));
    }
  });

  test("teto de empréstimo pela dificuldade", async () => {
    // C1 of ajustes-importacao (L-003, L-005): the chosen club's loan limit is twice the cash the
    // level gave it; another club keeps the generated one.
    const cases: ["Fácil" | "Normal" | "Difícil", (limit: number) => number][] = [
      ["Fácil", (l) => 2 * l],
      ["Normal", (l) => l],
      ["Difícil", (l) => 2 * Math.round(l / 2 / 2 / 100_000) * 100_000],
    ];
    for (const [level, expected] of cases) {
      resetAll();
      const { game, saved } = await choose(level);
      const id = saved.userClubId!;
      const financeOf = (s: typeof game, clubId: string) => s.leagues.flatMap((l) => l.clubs).find((c) => c.id === clubId)!.finance;
      expect(financeOf(saved, id).loanLimit, level).toBe(2 * financeOf(saved, id).cash);
      expect(financeOf(saved, id).loanLimit, level).toBe(expected(financeOf(game, id).loanLimit));
      const other = game.leagues[0]!.clubs.find((c) => c.id !== id)!.id;
      expect(financeOf(saved, other).loanLimit, level).toBe(financeOf(game, other).loanLimit);
    }
  });
});
