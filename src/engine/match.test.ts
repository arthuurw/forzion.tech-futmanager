import { newGame } from "./generate";
import { autoLineup, starters } from "./lineup";
import { simulateMatch, type TeamSheet } from "./match";
import { narrate, narrationContext } from "./narration";
import { createRng } from "./rng";
import { MATCH_EVENT_TYPES, type MatchEventType } from "./types";

function sheets(seed: number): [TeamSheet, TeamSheet] {
  const league = newGame(seed).leagues[0]!;
  const [h, a] = [league.clubs[0]!, league.clubs[1]!];
  return [
    { clubId: h.id, starters: starters(h, autoLineup(h, "4-4-2")) },
    { clubId: a.id, starters: starters(a, autoLineup(a, "4-3-3")) },
  ];
}

describe("simulação de partida", () => {
  test("log tem kickoff halftime fulltime e minutos válidos", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const [home, away] = sheets(seed);
      const { events } = simulateMatch(home, away, createRng(seed));
      expect(events[0]).toMatchObject({ minute: 1, type: "kickoff" });
      expect(events.at(-1)).toMatchObject({ minute: 90, type: "fulltime" });
      expect(events.filter((e) => e.type === "halftime")).toEqual([expect.objectContaining({ minute: 45 })]);
      let last = 0;
      for (const e of events) {
        expect(e.minute).toBeGreaterThanOrEqual(1);
        expect(e.minute).toBeLessThanOrEqual(90);
        expect(e.minute).toBeGreaterThanOrEqual(last);
        last = e.minute;
        expect([home.clubId, away.clubId]).toContain(e.clubId);
      }
    }
  });

  test("placar bate com gols e artilheiro é titular", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const [home, away] = sheets(seed);
      const { result, events } = simulateMatch(home, away, createRng(seed));
      const goals = events.filter((e) => e.type === "goal");
      expect(result.homeGoals).toBe(goals.filter((g) => g.clubId === home.clubId).length);
      expect(result.awayGoals).toBe(goals.filter((g) => g.clubId === away.clubId).length);
      expect(result.goals).toHaveLength(goals.length);
      for (const g of result.goals) {
        const side = g.clubId === home.clubId ? home : away;
        expect(side.starters.map((p) => p.id)).toContain(g.playerId);
      }
    }
  });

  test("mesmo estado de Rng gera log idêntico", () => {
    const [home, away] = sheets(3);
    const warm = createRng(3);
    for (let i = 0; i < 100; i++) warm.next();
    const state = warm.getState();
    const a = simulateMatch(home, away, createRng(state));
    const b = simulateMatch(home, away, createRng(state));
    expect(a).toEqual(b);
    expect(simulateMatch(home, away, createRng(state + 1))).not.toEqual(a);
  });

  // Supersedes nucleo C33 (6 types): partida-ao-vivo C46 proves all 10 in live rounds. Here: the
  // one-shot simulator has no bench, so it produces every type except substitution.
  // Correcoes-validacao C61: named for its proof, and a line never falls back to a raw id.
  test("todos os tipos de evento ocorrem e têm narração", () => {
    const seen = new Set<MatchEventType>();
    const lines = new Map<MatchEventType, string>();
    const league = newGame(1).leagues[0]!;
    const ctx = narrationContext(league.clubs);
    for (let seed = 1; seed <= 100; seed++) {
      const [home, away] = sheets(1);
      for (const e of simulateMatch(home, away, createRng(seed)).events) {
        seen.add(e.type);
        const text = narrate(e, ctx);
        expect(text.length).toBeGreaterThan(0);
        expect(text, e.type).not.toContain(e.clubId);
        if (e.playerId) expect(text, e.type).not.toContain(e.playerId);
        if (!lines.has(e.type)) lines.set(e.type, text);
      }
    }
    expect([...seen].sort()).toEqual(MATCH_EVENT_TYPES.filter((t) => t !== "substitution").sort());
    // Each type narrates to a line distinct from the others (penaltis C8: 10 with the penalty).
    expect(new Set(lines.values()).size).toBe(10);
  });
});
