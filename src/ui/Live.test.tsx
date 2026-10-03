// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { startCupDate } from "../engine/cup";
import { runToEnd, startRound, step, userMatch, type LiveSide } from "../engine/live";
import type { GameState, MatchEvent } from "../engine/types";
import { narrate, narrationContext } from "../engine/narration";
import { App } from "../App";
import { installAudio } from "../audio";
import { effects, fakeBackend, type FakeBackend } from "../audio/test-backend";
import { useGame } from "../store";
import { Live } from "./Live";
import { cupGame, resetAll, seededGame, seededGameIn, userSideOf } from "./test-utils";

const scrollIntoView = vi.fn();

beforeEach(() => {
  resetAll();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Renders the squad screen and clicks «Jogar rodada», with real timers. */
async function startLive(seed = 3): Promise<UserEvent> {
  const user = userEvent.setup();
  useGame.setState({ phase: "squad", game: seededGame(seed), hasSave: true });
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
  return user;
}

/**
 * Same, on fake timers. Clicks use fireEvent: userEvent waits on a setTimeout(0) after each
 * action, which never fires while timers are fake.
 */
function startLiveFake(seed = 3): void {
  vi.useFakeTimers();
  useGame.setState({ phase: "squad", game: seededGame(seed), hasSave: true });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Jogar rodada" }));
}

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const clockText = () => screen.getByRole("timer", { name: "Relógio" }).textContent;
const liveMinute = () => useGame.getState().live!.minute;

function mySide(): LiveSide {
  const live = useGame.getState().live!;
  const m = userMatch(live)!;
  return m.home.clubId === live.userClubId ? m.home : m.away;
}

async function pauseNow(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "Pausar" }));
}

describe("tela Ao vivo", () => {
  test("abre ao vivo em 0 com 10 jogos 0 x 0", async () => {
    startLiveFake();
    expect(useGame.getState().phase).toBe("live");
    expect(clockText()).toBe("0'");
    const games = within(screen.getByRole("tabpanel", { name: "Jogos da rodada" })).getAllByRole("listitem");
    expect(games).toHaveLength(10);
    for (const g of games) expect(g.querySelector("b")!.textContent).toBe("0 x 0");
  });

  test("relógio avança 1 minuto a cada 300 ms", async () => {
    startLiveFake();
    advance(900);
    expect(clockText()).toBe("3'");
    advance(299);
    expect(clockText()).toBe("3'");
    advance(1);
    expect(clockText()).toBe("4'");
  });

  test("narração acrescenta eventos do minuto com o último visível", async () => {
    startLiveFake();
    const league = useGame.getState().game!.leagues[0]!;
    const ctx = narrationContext(league.clubs);
    let before = 0;
    for (let i = 0; i < 90 && useGame.getState().clock === "running"; i++) {
      advance(300);
      const events = userMatch(useGame.getState().live!)!.events;
      const lines = within(screen.getByRole("list", { name: "Narração" })).getAllByRole("listitem");
      // Every event up to this minute is on screen, in order, the newest last.
      expect(lines).toHaveLength(events.length);
      expect(events.every((e) => e.minute <= liveMinute())).toBe(true);
      if (events.length > before && events.length > 1) {
        const last = events.at(-1)!;
        expect(lines.at(-1)!.textContent).toBe(`${last.minute}' ${narrate(last, ctx)}`);
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(lines.at(-1));
        return;
      }
      before = events.length;
    }
    throw new Error("no event after kick-off in the first half");
  });

  test("gol muda placar no mesmo tick e pisca 2 s", async () => {
    startLiveFake();
    for (let i = 0; i < 44; i++) {
      advance(300);
      // Paises: match ids repeat in every league; only the user's league is on screen.
      const live = useGame.getState().live!;
      const shown = userMatch(live)!.leagueId;
      const scored = live.matches.find((m) => m.leagueId === shown && m.homeGoals + m.awayGoals > 0);
      if (!scored) continue;
      const row = screen.getByRole("tabpanel", { name: "Jogos da rodada" }).querySelector(`[data-match="${scored.matchId}"]`)!;
      expect(row.querySelector("b")!.textContent).toBe(`${scored.homeGoals} x ${scored.awayGoals}`);
      expect(row).toHaveClass("flash");
      act(() => useGame.getState().pause());
      advance(1999);
      expect(row).toHaveClass("flash");
      advance(1);
      expect(row).not.toHaveClass("flash");
      return;
    }
    throw new Error("no goal in the first half");
  });

  test("pausar para e continuar retoma", async () => {
    startLiveFake();
    advance(600);
    expect(clockText()).toBe("2'");
    press("Pausar");
    advance(3000);
    expect(clockText()).toBe("2'");
    press("Continuar");
    advance(300);
    expect(clockText()).toBe("3'");
  });

  test("intervalo pausa no 45", async () => {
    startLiveFake();
    advance(45 * 300);
    expect(clockText()).toBe("45'");
    expect(screen.getByText("Intervalo")).toBeInTheDocument();
    advance(3000);
    expect(clockText()).toBe("45'");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeInTheDocument();
  });

  test("velocidades 2x e 4x", async () => {
    startLiveFake();
    press("2x");
    advance(300);
    expect(clockText()).toBe("2'");
    press("4x");
    advance(300);
    expect(clockText()).toBe("6'");
    expect(screen.getByRole("button", { name: "4x" })).toHaveAttribute("aria-pressed", "true");
  });

  test("pular para o fim vai ao 90", async () => {
    const user = await startLive();
    const started = Date.now();
    await user.click(screen.getByRole("button", { name: "Pular para o fim" }));
    expect(await screen.findByRole("tabpanel", { name: "Sua partida" })).toBeInTheDocument();
    // Far less than the 27 s the clock would take.
    expect(Date.now() - started).toBeLessThan(5000);
    const last = useGame.getState().lastRound!;
    expect(last.userEvents.at(-1)).toMatchObject({ minute: 90, type: "fulltime" });
    expect(last.results).toHaveLength(10);
  });

  test("pausado mostra em campo e banco com condição e moral", async () => {
    const user = await startLive();
    // Running: decisions are locked.
    expect(screen.getByRole("button", { name: "Substituir" })).toBeDisabled();
    expect(screen.getByLabelText("Sai")).toBeDisabled();
    expect(screen.getByText("Pause para mexer no time")).toBeInTheDocument();
    await pauseNow(user);
    const team = screen.getByRole("tabpanel", { name: "Seu time" });
    const onPitch = within(within(team).getByRole("table", { name: "Em campo" })).getAllByRole("row");
    const bench = within(within(team).getByRole("table", { name: "Banco" })).getAllByRole("row");
    expect(onPitch).toHaveLength(11);
    expect(bench).toHaveLength(mySide().bench.length);
    expect(bench.length).toBeGreaterThan(0);
    for (const row of [...onPitch, ...bench]) {
      expect(row.querySelector(".fnum")!.textContent).toMatch(/^\d+$/);
      expect(row.querySelector(".morale")!.textContent).toMatch(/^[↓↘→↗↑]$/);
    }
    expect(screen.getByRole("button", { name: "Substituir" })).toBeEnabled();
  });

  test("substituir pela tela", async () => {
    const user = await startLive();
    await pauseNow(user);
    const inId = mySide().bench[0]!;
    const inName = useGame.getState().live!.players[inId]!.name;
    await user.selectOptions(screen.getByLabelText("Sai"), "10");
    await user.selectOptions(screen.getByLabelText("Entra"), inId);
    await user.click(screen.getByRole("button", { name: "Substituir" }));
    const rows = within(screen.getByRole("table", { name: "Em campo" })).getAllByRole("row");
    expect(rows[10]).toHaveTextContent(inName);
    expect(screen.getByText("Substituições: 1/5")).toBeInTheDocument();
    const lines = within(screen.getByRole("list", { name: "Narração" })).getAllByRole("listitem");
    expect(lines.at(-1)!.textContent).toContain(`entra ${inName}.`);
  });

  test("mensagem limite de 5", async () => {
    const user = await startLive();
    await pauseNow(user);
    for (let i = 0; i < 5; i++) {
      await user.selectOptions(screen.getByLabelText("Sai"), String(10 - i));
      await user.click(screen.getByRole("button", { name: "Substituir" }));
    }
    expect(screen.getByText("Substituições: 5/5")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Sai"), "1");
    await user.click(screen.getByRole("button", { name: "Substituir" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Limite de 5 substituições");
    expect(screen.getByText("Substituições: 5/5")).toBeInTheDocument();
  });

  test("mensagem expulso", async () => {
    const user = await startLive();
    await pauseNow(user);
    act(() => {
      const live = structuredClone(useGame.getState().live!);
      const m = userMatch(live)!;
      const side = m.home.clubId === live.userClubId ? m.home : m.away;
      const id = side.slots[4]!;
      side.slots[4] = null;
      side.vacancy[4] = { why: "red", playerId: id };
      side.sentOff.push(id);
      useGame.setState({ live });
    });
    const sai = screen.getByLabelText("Sai") as HTMLSelectElement;
    expect(sai.options[4]!.textContent).toContain("(expulso)");
    await user.selectOptions(sai, "4");
    await user.click(screen.getByRole("button", { name: "Substituir" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Jogador expulso não pode ser substituído");
  });

  test("formação marca fora de posição", async () => {
    const user = await startLive();
    await pauseNow(user);
    const team = screen.getByRole("tabpanel", { name: "Seu time" });
    expect(within(team).queryByText("fora de posição")).not.toBeInTheDocument();
    await user.selectOptions(within(team).getByLabelText("Formação"), "3-5-2");
    expect(within(team).getAllByText("fora de posição")).toHaveLength(1);
    expect(within(within(team).getByRole("table", { name: "Em campo" })).getAllByRole("row")).toHaveLength(11);
  });
});

describe("ao vivo com duas divisões", () => {
  test("jogos da rodada só da divisão do usuário", async () => {
    for (const division of [1, 0]) {
      resetAll();
      const user = userEvent.setup();
      const game = seededGameIn(division, 25, 6);
      useGame.setState({ phase: "squad", game, hasSave: true });
      const view = render(<App />);
      await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
      await user.click(await screen.findByRole("button", { name: "Pausar" }));
      // Paises (Superseded checks): 4 leagues of 10 matches.
      expect(useGame.getState().live!.matches).toHaveLength(40);
      const names = new Set(game.leagues[division]!.clubs.map((c) => c.name));
      const others = game.leagues[1 - division]!.clubs.map((c) => c.name);
      const games = within(screen.getByRole("tabpanel", { name: "Jogos da rodada" })).getAllByRole("listitem");
      expect(games, `divisão ${division}`).toHaveLength(10);
      for (const g of games) {
        const home = g.querySelector(".h")!.textContent!;
        const away = g.querySelector(".a")!.textContent!;
        expect(names.has(home) && names.has(away), `${home} x ${away}`).toBe(true);
        for (const other of others) expect(g.textContent).not.toContain(other);
      }
      view.unmount();
    }
  });
});

describe("ao vivo na copa (copa-nacional)", () => {
  const nameIn = (s: GameState, id: string) => s.leagues.flatMap((l) => l.clubs).find((c) => c.id === id)!.name;

  test("ao vivo da copa", async () => {
    const user = userEvent.setup();
    const game = cupGame(121, 2, (s) => s.cups[0]!.phases[2]!.ties[3]!.awayId);
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ao vivo · Copa Nacional · Oitavas");
    const items = within(screen.getByRole("tabpanel", { name: "Jogos da rodada" })).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    game.cups[0]!.phases[2]!.ties.forEach((t, i) => {
      expect(items[i]).toHaveTextContent(nameIn(game, t.homeId));
      expect(items[i]).toHaveTextContent(nameIn(game, t.awayId));
    });
  });

  test("placar com pênaltis ao vivo", () => {
    const game = cupGame(122, 0, (s) => s.cups[0]!.phases[0]!.ties[0]!.homeId);
    const live = runToEnd(startCupDate(game));
    const mine = userMatch(live)!;
    Object.assign(mine, { homeGoals: 1, awayGoals: 1, penalties: { home: 4, away: 3 } });
    useGame.setState({ phase: "live", game, live, clock: "paused", finishing: false });
    render(<Live />);
    expect(screen.getByRole("timer", { name: "Relógio" })).toHaveTextContent("90'");
    expect(within(screen.getByRole("tabpanel", { name: "Partida ao vivo" })).getByRole("heading")).toHaveTextContent("1 x 1 (pên. 4 x 3)");
    const item = within(screen.getByRole("tabpanel", { name: "Jogos da rodada" })).getAllByRole("listitem")[0]!;
    expect(item).toHaveTextContent(`${nameIn(game, mine.home.clubId)} 1 x 1 (pên. 4 x 3) ${nameIn(game, mine.away.clubId)}`);
  });
});

describe("som ao vivo (audio)", () => {
  let backend: FakeBackend;
  beforeEach(() => {
    localStorage.clear();
    backend = fakeBackend();
    installAudio(backend);
  });

  /** The first gesture, then «Jogar rodada», on fake timers. */
  function startWithSound(seed = 3): void {
    vi.useFakeTimers();
    useGame.setState({ phase: "squad", game: seededGame(seed), hasSave: true });
    render(<App />);
    fireEvent.pointerDown(document);
    fireEvent.click(screen.getByRole("button", { name: "Jogar rodada" }));
  }

  /** Plays the match to 90' at 4x, on fake timers; the round closes at the last tick. */
  function playAt4x(): void {
    press("4x");
    advance(45 * 75);
    expect(useGame.getState().clock).toBe("halftime");
    press("Continuar");
    advance(45 * 75);
    expect(useGame.getState().lastRound).not.toBeNull();
  }

  test("som só da partida do usuário", () => {
    // C8 (AC 7, AC 8, L-003, L-007): a minute with a goal of the user's club and a goal in another match.
    // Seed 8: the user's club scores at 10' while another match of the round scores too.
    startWithSound(8);
    const userId = useGame.getState().live!.userClubId!;
    let userGoalBefore = false;
    for (let minute = 1; minute <= 90; minute++) {
      if (useGame.getState().clock === "halftime") press("Continuar");
      const from = backend.calls.length;
      advance(300);
      const live = useGame.getState().live!;
      const mine = userMatch(live)!;
      const now = mine.events.filter((e) => e.minute === live.minute);
      const userGoal = now.some((e) => e.type === "goal" && e.clubId === userId);
      const opponentGoal = now.some((e) => e.type === "goal" && e.clubId !== userId);
      const otherGoal = live.matches.some((m) => m !== mine && m.events.some((e) => e.type === "goal" && e.minute === live.minute));
      if (userGoal && !opponentGoal && otherGoal && !userGoalBefore) {
        const heard = effects(backend.calls.slice(from));
        expect(heard.filter((id) => id === "crowd-roar")).toHaveLength(1);
        expect(heard).not.toContain("crowd-groan");
        return;
      }
      userGoalBefore = userGoal;
    }
    throw new Error("no minute with a user goal and another match's goal");
  });

  test("ambiente acompanha o relógio da tela ao vivo", () => {
    // C9 through the live screen.
    startWithSound();
    expect(backend.calls.filter((c) => c.kind === "ambience-start")).toHaveLength(1);
    const ramps = () => backend.calls.filter((c) => c.kind === "ambience-ramp");
    expect(ramps().at(-1)).toMatchObject({ gain: 1 });
    advance(600);
    press("Pausar");
    expect(ramps().at(-1)).toMatchObject({ gain: 0 });
  });

  test("pular para o fim toca só o apito final", async () => {
    // C12 (AC 12, L-007).
    const user = await startLive(3);
    await pauseNow(user);
    const live = useGame.getState().live!;
    const ahead = userMatch(runToEnd(live))!.events.filter((e) => e.minute > live.minute);
    expect(ahead.some((e) => e.type === "goal")).toBe(true);
    expect(ahead.some((e) => e.type === "shot_saved" || e.type === "shot_missed")).toBe(true);
    const from = backend.calls.length;
    await user.click(screen.getByRole("button", { name: "Pular para o fim" }));
    expect(await screen.findByRole("tabpanel", { name: "Sua partida" })).toBeInTheDocument();
    expect(effects(backend.calls.slice(from))).toEqual(["whistle-long"]);
  });

  /**
   * Like `startWithSound`, with the audio installed after the fake clock: its 400 ms gap (audio
   * AC 11) and its schedule then count the game's time, not how fast the test runs.
   */
  function startOnFakeClock(seed: number, game = seededGame(seed)): void {
    vi.useFakeTimers();
    backend = fakeBackend();
    installAudio(backend);
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<App />);
    fireEvent.pointerDown(document);
    fireEvent.click(screen.getByRole("button", { name: "Jogar rodada" }));
  }

  /** Lets the clock run at 1x, on fake timers, until the given minute. */
  function runTo(minute: number): void {
    while (liveMinute() < minute) {
      if (useGame.getState().clock === "halftime") press("Continuar");
      advance(300);
    }
    expect(liveMinute()).toBe(minute);
  }

  /**
   * Seed 27: the user's club scores at 90' in the first round (L-007: the goal the skip must not sound).
   * Penaltis (Superseded checks): seed 182 lost that goal once penalties moved the scores.
   */
  function userGoalAt90(): void {
    const live = useGame.getState().live!;
    const at90 = userMatch(runToEnd(live))!.events.filter((e) => e.minute === 90);
    expect(at90.some((e) => e.type === "goal" && e.clubId === live.userClubId)).toBe(true);
  }

  test("pular para o fim em qualquer minuto toca só o apito final", async () => {
    // C5 (AC 5, L-007): the skip at 1' and at 89', the second a single minute before the end.
    for (const minute of [1, 89]) {
      cleanup();
      resetAll();
      startOnFakeClock(27);
      runTo(minute);
      userGoalAt90();
      const from = backend.calls.length;
      press("Pular para o fim");
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(useGame.getState().lastRound, `minuto ${minute}`).not.toBeNull();
      expect(effects(backend.calls.slice(from)), `minuto ${minute}`).toEqual(["whistle-long"]);
      vi.useRealTimers();
    }
  });

  test("tick do minuto 90 toca os eventos do minuto", () => {
    // C6 (AC 6): no skip, the clock runs from 89' to 90'.
    startOnFakeClock(27);
    runTo(89);
    userGoalAt90();
    const from = backend.calls.length;
    advance(300);
    expect(useGame.getState().lastRound).not.toBeNull();
    const heard = effects(backend.calls.slice(from));
    expect(heard).toContain("crowd-roar");
    expect(heard).toContain("goal-jingle");
    expect(heard).toContain("whistle-long");
  });

  test("disputa de pênaltis soa pela tela ao vivo", async () => {
    // Ajustes-audio C9 (AC 7, AC 9, L-003): the user home in a tie of the cup's second phase, level
    // at 90' and through on penalties. Copa-continental: the continental date after round 7 changes
    // the squads before this phase. Penaltis (Superseded checks): the tie is now seed 3's fourth.
    startOnFakeClock(3, cupGame(3, 1, (s) => s.cups[0]!.phases[1]!.ties[3]!.homeId));
    runTo(89);
    expect(userMatch(runToEnd(useGame.getState().live!))!.penalties).not.toBeNull();
    const userId = useGame.getState().live!.userClubId!;
    const from = backend.calls.length;
    advance(300);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    // The kicks as the match played them.
    const kicks = useGame.getState().lastRound!.userEvents.filter((e) => e.type === "penalty_scored" || e.type === "penalty_missed");
    expect(kicks.length).toBeGreaterThanOrEqual(10);
    const expected = kicks.map((k) => (k.type === "penalty_missed" ? "crowd-ooh" : k.clubId === userId ? "crowd-roar" : "crowd-groan"));
    const heard = effects(backend.calls.slice(from));
    const afterWhistle = heard.slice(heard.indexOf("whistle-long") + 1);
    expect(afterWhistle.slice(0, kicks.length)).toEqual(expected);
    const goals = (mine: boolean) => kicks.filter((k) => k.type === "penalty_scored" && (k.clubId === userId) === mine).length;
    expect(afterWhistle.slice(kicks.length)).toEqual(goals(true) > goals(false) ? ["goal-jingle"] : []);
  });

  test("áudio não mexe no sorteio do jogo", () => {
    // C14: the same match with the audio on and muted.
    startWithSound(7);
    playAt4x();
    expect(effects(backend.calls).length).toBeGreaterThan(0);
    const withSound = { rngState: useGame.getState().game!.rngState, results: useGame.getState().lastRound!.results };
    vi.useRealTimers();
    cleanup();
    resetAll();

    localStorage.setItem("forzion-futmanager:audio", '{"music":false,"sfx":false}');
    const muted = fakeBackend();
    installAudio(muted);
    startWithSound(7);
    playAt4x();
    expect(effects(muted.calls)).toEqual([]);
    expect(useGame.getState().game!.rngState).toBe(withSound.rngState);
    expect(useGame.getState().lastRound!.results).toEqual(withSound.results);
  });

  test("rodada sem AudioContext joga até o fim", async () => {
    // C26: jsdom has no AudioContext; the default backend.
    expect((window as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    installAudio();
    // Penaltis (Superseded checks): seed 2, whose user plays to 90' with no forced stop (seed 8 now has one).
    const user = await startLive(2);
    await user.click(await screen.findByRole("button", { name: "4x" }));
    await screen.findByText("Intervalo", {}, { timeout: 25000 });
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("tabpanel", { name: "Sua partida" }, { timeout: 25000 })).toBeInTheDocument();
    expect(useGame.getState().lastRound!.userEvents.at(-1)).toMatchObject({ minute: 90, type: "fulltime" });
  }, 90_000);
});

describe("ao vivo na continental (copa-continental)", () => {
  test("continental ao vivo para o classificado", async () => {
    // C10 (AC 10, L-003): stopped after round 7, the user's club in the Oitavas.
    const user = userEvent.setup();
    const game = cupGame(131, 0, (s) => s.cups[1]!.phases[0]!.ties[0]!.homeId, 1);
    expect(game.leagues[0]!.currentRound).toBe(7);
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    expect(useGame.getState().phase).toBe("live");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ao vivo · Copa Continental · Oitavas");
  });

  test("continental fecha sem tela para quem não joga", async () => {
    // C11 (AC 11, L-007): a Série B club, never in a new game's continental cup.
    const user = userEvent.setup();
    // Penaltis (Superseded checks): the third club, whose eleven is valid for the next date (the first's is not).
    const game = cupGame(132, 0, (s) => s.leagues[1]!.clubs[2]!.id, 1);
    expect(game.cups[1]!.seeding).not.toContain(game.userClubId);
    useGame.setState({ phase: "squad", game, hasSave: true });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Jogar rodada" }));
    // L-026: the date closes after its save; wait for it, or the save lands in a later test.
    await waitFor(() => expect(useGame.getState().phase).toBe("round"));
    expect(screen.queryByRole("heading", { level: 1, name: /^Ao vivo/ })).not.toBeInTheDocument();
    const cup = useGame.getState().game!.cups[1]!;
    expect(cup.currentPhase).toBe(1);
    expect(cup.phases[0]!.ties).toHaveLength(8);
    for (const t of cup.phases[0]!.ties) expect(t.winnerId, t.id).not.toBeNull();
  });
});

describe("narração ao vivo (correcoes-validacao)", () => {
  test("narração sem id cru", () => {
    // C50 (AC 46): an opponent named in the ticker leaves every club (released to the free agents).
    startLiveFake();
    const me = useGame.getState().game!.userClubId!;
    let event;
    for (let i = 0; i < 200 && !event; i++) {
      advance(300);
      event = userMatch(useGame.getState().live!)!.events.find((e) => e.playerId && e.clubId !== me);
    }
    expect(event).toBeDefined();
    const game = JSON.parse(JSON.stringify(useGame.getState().game)) as GameState;
    const from = game.leagues.flatMap((l) => l.clubs).find((c) => c.id === event!.clubId)!;
    const player = from.players.find((p) => p.id === event!.playerId)!;
    from.players = from.players.filter((p) => p.id !== player.id);
    game.market.freeAgents.push(player);
    act(() => useGame.setState({ game }));
    const lines = within(screen.getByRole("list", { name: "Narração" })).getAllByRole("listitem");
    const events = userMatch(useGame.getState().live!)!.events;
    expect(lines).toHaveLength(events.length);
    expect(lines[events.indexOf(event!)]).toHaveTextContent(player.name);
    for (const li of lines) {
      expect(li.textContent).not.toContain(player.id);
      expect(li.textContent).not.toMatch(/\bc\d+-p\d+\b/);
    }
  });
});

describe("ícones do ao vivo (correcoes-validacao)", () => {
  test("ícones rotulados", () => {
    // C53 (AC 49): a booked starter's yellow card is an image named «amarelo»; the others have none.
    startLiveFake();
    const live = useGame.getState().live!;
    const me = userMatch(live)!;
    const side = me.home.clubId === live.userClubId ? me.home : me.away;
    const booked = side.slots.find((id): id is string => !!id)!;
    const edited = { ...side, yellows: { ...side.yellows, [booked]: 1 } };
    const match = { ...me, ...(me.home === side ? { home: edited } : { away: edited }) };
    act(() => useGame.setState({ live: { ...live, matches: live.matches.map((m) => (m === me ? match : m)) } }));
    const team = screen.getByRole("tabpanel", { name: "Seu time" });
    const cards = within(team).getAllByRole("img", { name: "amarelo" });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.closest("tr")).toHaveTextContent(live.players[booked]!.name);
  });
});

describe("torcida ao desmontar (correcoes-validacao)", () => {
  test("desmontar para a torcida", () => {
    // C57 (AC 53): the live screen goes away with the clock running (an error screen replaces it).
    localStorage.clear();
    const backend = fakeBackend();
    installAudio(backend);
    vi.useFakeTimers();
    useGame.setState({ phase: "squad", game: seededGame(3), hasSave: true });
    const view = render(<App />);
    fireEvent.pointerDown(document);
    fireEvent.click(screen.getByRole("button", { name: "Jogar rodada" }));
    advance(600);
    expect(useGame.getState().clock).toBe("running");
    expect(backend.calls.filter((c) => c.kind === "ambience-start")).toHaveLength(1);
    expect(backend.calls.filter((c) => c.kind === "ambience-stop")).toHaveLength(0);
    const before = backend.calls.length;
    view.unmount();
    const after = backend.calls.slice(before);
    expect(after).toContainEqual({ kind: "ambience-ramp", gain: 0, seconds: 2 });
    expect(after.filter((c) => c.kind === "ambience-stop")).toHaveLength(1);
  });
});

describe("parada obrigatória (parada-obrigatoria)", () => {
  /**
   * The live screen stopped at minute 10 of round 1, after the user lost the player of `slot`
   * (`"GK"`: the keeper's slot) for `why`; `tweak` runs on the user's side before the render.
   */
  function stoppedBy(stops: [number | "GK", "injury" | "red"][], tweak: (side: LiveSide) => void = () => undefined): string[] {
    const game = seededGame(4);
    for (const p of game.leagues[0]!.clubs[0]!.players) Object.assign(p, { injuryRounds: 0, suspendedRounds: 0 });
    let live = startRound(game);
    while (live.minute < 10) live = step(live);
    const side = userSideOf(live);
    const names: string[] = [];
    const events: MatchEvent[] = [];
    for (const [at, why] of stops) {
      const slot = at === "GK" ? side.slotPos.indexOf("GK") : at;
      const id = side.slots[slot]!;
      side.slots[slot] = null;
      side.vacancy[slot] = { why, playerId: id };
      if (why === "red") side.sentOff.push(id);
      names.push(live.players[id]!.name);
      events.push({ minute: 10, type: why, clubId: game.userClubId!, playerId: id });
    }
    tweak(side);
    useGame.setState({ phase: "live", game, hasSave: true, live, clock: "paused", liveStop: events });
    render(<Live />);
    return names;
  }

  const notice = () => screen.getByRole("status", { name: "Parada" });

  test("aviso da parada", () => {
    // C8 (L-008): the exact text of each of the 4 notices.
    const cases: [string, [number | "GK", "injury" | "red"], (side: LiveSide) => void, (name: string) => string][] = [
      ["lesão obrigatória", [10, "injury"], () => undefined, (n) => `Lesão: ${n} saiu. Faça a substituição.`],
      ["lesão sem troca", [10, "injury"], (s) => (s.subsUsed = 5), (n) => `Lesão: ${n} saiu.`],
      ["goleiro obrigatório", ["GK", "red"], () => undefined, (n) => `Goleiro expulso: ${n}. Coloque o goleiro reserva.`],
      ["linha expulso", [4, "red"], () => undefined, (n) => `${n} expulso.`],
    ];
    for (const [name, stop, tweak, text] of cases) {
      cleanup();
      resetAll();
      const [who] = stoppedBy([stop], tweak);
      expect(notice().textContent, name).toBe(text(who!));
    }
  });

  test("continuar desabilitado até substituir", () => {
    // C9.
    stoppedBy([[10, "injury"]]);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    expect((screen.getByLabelText("Sai") as HTMLSelectElement).value).toBe("10");
    fireEvent.click(screen.getByRole("button", { name: "Substituir" }));
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(useGame.getState().clock).toBe("running");
    expect(screen.queryByRole("status", { name: "Parada" })).toBeNull();
  });

  test("seguir com 10", () => {
    // C10: 10 on the pitch after one red card, 9 after two; the button starts the clock.
    stoppedBy([[4, "red"]]);
    expect(screen.queryByRole("button", { name: "Continuar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Seguir com 10" }));
    expect(useGame.getState().clock).toBe("running");

    cleanup();
    resetAll();
    stoppedBy([
      [4, "red"],
      [5, "red"],
    ]);
    expect(screen.getByRole("button", { name: "Seguir com 9" })).toBeEnabled();
  });

  test("parada abre seu time", () => {
    // C11: the stop arrives while the screen is on «Partida».
    stoppedBy([[10, "injury"]]);
    const stop = useGame.getState().liveStop;
    cleanup();
    act(() => useGame.setState({ liveStop: null }));
    render(<Live />);
    fireEvent.click(screen.getByRole("tab", { name: "Partida" }));
    expect(screen.getByRole("tab", { name: "Seu time" })).toHaveAttribute("aria-selected", "false");
    act(() => useGame.setState({ liveStop: stop }));
    expect(screen.getByRole("tab", { name: "Seu time" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("posição na substituição (posicao-na-substituicao)", () => {
  /** The live screen paused at minute 10 of round 1; with `red`, the defender of slot 2 was sent off. */
  function paused(red: boolean) {
    const game = seededGame(4);
    for (const p of game.leagues[0]!.clubs[0]!.players) Object.assign(p, { injuryRounds: 0, suspendedRounds: 0 });
    let live = startRound(game);
    while (live.minute < 10) live = step(live);
    const side = userSideOf(live);
    expect(side.slots.filter(Boolean)).toHaveLength(11);
    const expelled = side.slots[2]!;
    if (red) {
      side.slots[2] = null;
      side.vacancy[2] = { why: "red", playerId: expelled };
      side.sentOff.push(expelled);
    }
    useGame.setState({ phase: "live", game, hasSave: true, live, clock: "paused", liveStop: null });
    render(<Live />);
    const name = (id: string) => live.players[id]!.name;
    const defender = side.bench.find((id) => live.players[id]!.position === "DF")!;
    return { expelled: name(expelled), striker: name(side.slots[9]!), defender, defenderName: name(defender) };
  }

  test("substituição na vaga do expulso", async () => {
    // C5 (L-008): the case of the author's print; the defender plays in defence, not out of position.
    const user = userEvent.setup();
    const { expelled, striker, defender, defenderName } = paused(true);
    const team = screen.getByRole("tabpanel", { name: "Seu time" });
    await user.selectOptions(within(team).getByLabelText("Sai"), "9");
    const posicao = within(team).getByLabelText("Posição") as HTMLSelectElement;
    expect([...posicao.options].map((o) => o.textContent)).toEqual([`no lugar de ${striker} (ATA)`, `na vaga de ${expelled} (ZAG, expulso)`]);
    await user.selectOptions(within(team).getByLabelText("Entra"), defender);
    await user.selectOptions(posicao, "2");
    await user.click(within(team).getByRole("button", { name: "Substituir" }));
    const rows = within(within(team).getByRole("table", { name: "Em campo" })).getAllByRole("row");
    expect(rows[2]!.textContent).toContain("ZAG");
    expect(rows[2]!.textContent).toContain(defenderName);
    expect(rows[2]!.textContent).not.toContain("fora de posição");
    expect(rows[9]!.textContent).toBe(`ATA${expelled} (expulso)`);
    expect(within(team).getByText("Substituições: 1/5")).toBeInTheDocument();
  });

  test("sem expulso não há posição", () => {
    // C6: without a red card the «Posição» field is not there.
    paused(false);
    const team = screen.getByRole("tabpanel", { name: "Seu time" });
    expect(within(team).getByLabelText("Sai")).toBeInTheDocument();
    expect(within(team).queryByLabelText("Posição")).not.toBeInTheDocument();
  });

  test("posição sem quem sai", async () => {
    // C9: with «Sai» on the red card's own empty slot, no red slot is offered.
    const user = userEvent.setup();
    const { expelled } = paused(true);
    const team = screen.getByRole("tabpanel", { name: "Seu time" });
    await user.selectOptions(within(team).getByLabelText("Sai"), "2");
    const posicao = within(team).getByLabelText("Posição") as HTMLSelectElement;
    expect([...posicao.options].map((o) => o.textContent)).toEqual([`no lugar de ${expelled} (ZAG)`]);
  });

  test("goleiro reserva vai para o gol", async () => {
    // C10: a keeper chosen for an outfield player defaults to the goal of the keeper sent off.
    const user = userEvent.setup();
    const game = seededGame(4);
    for (const p of game.leagues[0]!.clubs[0]!.players) Object.assign(p, { injuryRounds: 0, suspendedRounds: 0 });
    let live = startRound(game);
    while (live.minute < 10) live = step(live);
    const side = userSideOf(live);
    const goalSlot = side.slotPos.indexOf("GK");
    const keeper = side.slots[goalSlot]!;
    side.slots[goalSlot] = null;
    side.vacancy[goalSlot] = { why: "red", playerId: keeper };
    side.sentOff.push(keeper);
    const reserve = side.bench.find((id) => live.players[id]!.position === "GK")!;
    const leaving = side.slots[2]!;
    useGame.setState({ phase: "live", game, hasSave: true, live, clock: "paused", liveStop: null });
    render(<Live />);
    const team = screen.getByRole("tabpanel", { name: "Seu time" });
    await user.selectOptions(within(team).getByLabelText("Sai"), "2");
    await user.selectOptions(within(team).getByLabelText("Entra"), reserve);
    const posicao = within(team).getByLabelText("Posição") as HTMLSelectElement;
    expect(posicao.selectedOptions[0]!.textContent).toBe(`na vaga de ${live.players[keeper]!.name} (GOL, expulso)`);
    await user.click(within(team).getByRole("button", { name: "Substituir" }));
    const after = userSideOf(useGame.getState().live!);
    expect(after.slots[goalSlot]).toBe(reserve);
    expect(after.slots[2]).toBeNull();
    expect(after.subbedOff).toContain(leaving);
  });
});

describe("ajustes da substituição (ajustes-substituicao)", () => {
  /** The live screen paused at minute 10 of round 1, with the user's `slots` emptied for `why`. */
  function pausedWith(stops: [number | "GK", "injury" | "red"][]) {
    const game = seededGame(4);
    for (const p of game.leagues[0]!.clubs[0]!.players) Object.assign(p, { injuryRounds: 0, suspendedRounds: 0 });
    let live = startRound(game);
    while (live.minute < 10) live = step(live);
    const side = userSideOf(live);
    expect(side.formation).toBe("4-4-2");
    const names: string[] = [];
    for (const [at, why] of stops) {
      const slot = at === "GK" ? side.slotPos.indexOf("GK") : at;
      const id = side.slots[slot]!;
      side.slots[slot] = null;
      side.vacancy[slot] = { why, playerId: id };
      if (why === "red") side.sentOff.push(id);
      names.push(live.players[id]!.name);
    }
    useGame.setState({ phase: "live", game, hasSave: true, live, clock: "paused", liveStop: null });
    render(<Live />);
    const reserve = side.bench.find((id) => live.players[id]!.position === "GK")!;
    return { names, reserve, team: screen.getByRole("tabpanel", { name: "Seu time" }) };
  }

  test("posição com sai lesionado", async () => {
    // C1 (L-029): «Sai» on an injury's empty slot while a red card's slot is elsewhere.
    const user = userEvent.setup();
    const {
      names: [, injured],
      team,
    } = pausedWith([
      [2, "red"],
      [5, "injury"],
    ]);
    await user.selectOptions(within(team).getByLabelText("Sai"), "5");
    const posicao = within(team).getByLabelText("Posição") as HTMLSelectElement;
    expect([...posicao.options].map((o) => o.textContent)).toEqual([`no lugar de ${injured} (MEI)`]);
  });

  test("goleiro reserva só no gol", async () => {
    // C2: a keeper coming on for an outfield player is offered the goal only, already chosen.
    const user = userEvent.setup();
    const {
      names: [keeper],
      reserve,
      team,
    } = pausedWith([["GK", "red"]]);
    await user.selectOptions(within(team).getByLabelText("Sai"), "2");
    await user.selectOptions(within(team).getByLabelText("Entra"), reserve);
    const posicao = within(team).getByLabelText("Posição") as HTMLSelectElement;
    expect([...posicao.options].map((o) => o.textContent)).toEqual([`na vaga de ${keeper} (GOL, expulso)`]);
    expect(posicao.selectedOptions[0]!.textContent).toBe(`na vaga de ${keeper} (GOL, expulso)`);
  });
});
