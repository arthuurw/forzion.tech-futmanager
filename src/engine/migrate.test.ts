import { readFileSync } from "node:fs";
import { strengthRanking } from "./board";
import { nextDate } from "./calendar";
import { newGame } from "./generate";
import { aiLineup, formationSlots, isAvailable, isAvailableFor } from "./lineup";
import { makeMatch, makeSide, runToEnd, type LivePlayer } from "./live";
import { createRng, mix32, randInt } from "./rng";
import { migrateSave } from "./migrate";
import { expectedCupGoal, v1Document, v2Document, v3Document, v4Document, v5Document, v7Document } from "./test-fixtures";
import type { GameState } from "./types";

/** Written out here, not imported (L-004). */
const expectedSalary = (rating: number) => Math.round((2000 * 1.09 ** (rating - 40)) / 100) * 100;
const expectedFans = (mean: number) => Math.round(Math.min(60_000, Math.max(15_000, 15_000 + (45_000 * (mean - 58)) / 22)) / 1000) * 1000;

type Doc = { leagues: { clubs: { id: string; players: { id: string; rating: number }[] }[]; rounds: unknown }[] };

// Copa-nacional C60 supersedes multiplas-temporadas C48, C49: v3, v2 and v1 reach v5 through v4.
// Gastos-da-ia (Superseded checks): and v6 after it. Paises (Superseded checks): and v7 after it.
function expectV4Finances(state: GameState, doc: Doc) {
  // Copa-continental (Superseded checks): v8 is current.
  expect(state.schemaVersion).toBe(8);
  const league = state.leagues[0]!;
  expect(league.rounds).toEqual(doc.leagues[0]!.rounds);
  league.clubs.forEach((club, i) => {
    const old = doc.leagues[0]!.clubs[i]!;
    expect(club.players.map((p) => [p.id, p.rating])).toEqual(old.players.map((p) => [p.id, p.rating]));
    for (const p of club.players) expect(p.salary, p.id).toBe(expectedSalary(p.rating));
    const wages = club.players.reduce((s, p) => s + expectedSalary(p.rating), 0);
    const fans = expectedFans(club.players.reduce((s, p) => s + p.rating, 0) / club.players.length);
    expect(club.finance).toMatchObject({
      cash: Math.round((wages * 10) / 100_000) * 100_000,
      fans,
      capacity: Math.round((fans * 0.8) / 1000) * 1000,
      ticketPrice: 40,
      loan: 0,
      expansionRoundsLeft: 0,
      lastRound: null,
    });
    expect(club.forSale).toEqual([]);
  });
  expect(state.market.freeAgents).toHaveLength(40);
  expect(state.market.offers).toEqual([]);
  expect(state.market.juniors).toEqual([]);
}

const best11 = (players: { rating: number }[]) =>
  [...players].map((p) => p.rating).sort((a, b) => b - a).slice(0, 11).reduce((a, b) => a + b, 0) / 11;

/** AC 30, written out: rank by the best eleven in the division, ties by id; Série A goal min(16, r + 3). */
function expectedGoalA(state: GameState): number {
  const ranking = [...state.leagues[0]!.clubs].sort((a, b) => best11(b.players) - best11(a.players) || a.id.localeCompare(b.id));
  return Math.min(16, ranking.findIndex((c) => c.id === state.userClubId) + 1 + 3);
}

/** What every v4 migration adds: the Série B caught up, contracts, zeroed numbers, history, goal. */
function expectV4Additions(state: GameState, roundsPlayed: number) {
  // Paises (Superseded checks): 4 leagues.
  expect(state.leagues.map((l) => l.id)).toEqual(["l1", "l2", "l3", "l4"]);
  const b = state.leagues[1]!;
  expect(new Set(b.clubs.map((c) => c.id))).toEqual(new Set(Array.from({ length: 20 }, (_, i) => `c${21 + i}`)));
  expect(b.rounds).toHaveLength(38);
  expect(b.currentRound).toBe(roundsPlayed);
  b.rounds.forEach((r, i) => {
    for (const m of r.matches) expect(m.result === null, `rodada ${i + 1}`).toBe(i >= roundsPlayed);
  });
  const contracts = new Set<number>();
  for (const league of state.leagues) {
    for (const c of league.clubs) {
      for (const p of c.players) {
        expect(Number.isInteger(p.contractSeasons) && p.contractSeasons >= 1 && p.contractSeasons <= 4, p.id).toBe(true);
        if (league === state.leagues[0]) contracts.add(p.contractSeasons);
        expect([p.seasonGames, p.seasonGoals, p.careerGames, p.careerGoals], p.id).toEqual([0, 0, 0, 0]);
      }
    }
  }
  expect([...contracts].sort()).toEqual([1, 2, 3, 4]);
  for (const p of [...state.market.freeAgents, ...state.market.juniors]) {
    expect([p.contractSeasons, p.seasonGames, p.seasonGoals, p.careerGames, p.careerGoals], p.id).toEqual([0, 0, 0, 0, 0]);
  }
  expect(state.history).toEqual([]);
  expect(state.boardGoal).toBe(expectedGoalA(state));
}

describe("migração do save", () => {
  test("migra v3 para v4", () => {
    const v3 = v3Document(4, 5);
    const r = migrateSave(v3);
    if (r.kind !== "ok") throw new Error("v3 not migrated");
    const state = r.state;
    const oldA = (v3 as unknown as { leagues: GameState["leagues"] }).leagues[0]!;
    const a = state.leagues[0]!;
    // The Série A is the same save, plus contracts and zeroed numbers.
    const withoutV4 = (x: unknown) =>
      JSON.parse(JSON.stringify(x), (k, v) =>
        ["contractSeasons", "seasonGames", "seasonGoals", "careerGames", "careerGoals", "cupDiscipline", "transfers", "country", "tier"].includes(k) ? undefined : v,
      );
    expect(withoutV4(a)).toEqual(oldA);
    expect(a.currentRound).toBe(5);
    expect(withoutV4(state.market)).toEqual((v3 as { market: unknown }).market);
    expect(state.userClubId).toBe((v3 as { userClubId: string }).userClubId);
    expect(state.rngState).toBe((v3 as { rngState: number }).rngState);
    expectV4Additions(state, 5);
  });

  // Supersedes elenco-mercado-financas C51 (v2 and v1 to v3): they now reach v4.
  test("migra v2 e v1 para v4", () => {
    const v2 = v2Document();
    const fromV2 = migrateSave(v2);
    if (fromV2.kind !== "ok") throw new Error("v2 not migrated");
    expectV4Finances(fromV2.state, v2 as unknown as Doc);
    expectV4Additions(fromV2.state, 0);

    const v1 = v1Document();
    const fromV1 = migrateSave(v1);
    if (fromV1.kind !== "ok") throw new Error("v1 not migrated");
    expectV4Finances(fromV1.state, v1 as unknown as Doc);
    expectV4Additions(fromV1.state, 0);
    for (const club of fromV1.state.leagues[0]!.clubs) {
      for (const p of club.players) {
        expect(p).toMatchObject({ fitness: 100, morale: 0, injuryRounds: 0, suspendedRounds: 0, yellowCards: 0, idleRounds: 0 });
      }
    }
    const user = fromV1.state.leagues[0]!.clubs.find((c) => c.id === fromV1.state.userClubId)!;
    expect(user.lineup).toMatchObject({ formation: "4-3-3", posture: "balanced" });
    // Same seed, same free agents.
    expect(fromV1.state.market.freeAgents).toEqual(fromV2.state.market.freeAgents);
  });

  // Copa-nacional C56, C61 supersede multiplas-temporadas C50, C51: v5 is current, v4 migrates, 6 is incompatible.
  // Gastos-da-ia C30 (Superseded checks): v6 is current and 7 is incompatible.
  // Paises C30 (Superseded checks): v7 is current and 8 is incompatible.
  test("v5 passa direto", () => {
    const r = migrateSave(v3Document(5, 2));
    if (r.kind !== "ok") throw new Error("v3 not migrated");
    expect(r.state.schemaVersion).toBe(8);
    const copy = JSON.parse(JSON.stringify(r.state));
    expect(migrateSave(copy)).toEqual({ kind: "ok", state: r.state });
    // Copa-continental (Superseded checks): v8 is current and 9 is incompatible.
    expect(migrateSave({ schemaVersion: 9 })).toEqual({ kind: "incompatible", version: 9 });
  });

  test("série B migrada vem da seed", () => {
    const doc = v3Document(6, 3);
    const a = migrateSave(JSON.parse(JSON.stringify(doc)));
    const b = migrateSave(JSON.parse(JSON.stringify(doc)));
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("not migrated");
    expect(a.state).toEqual(b.state);
    // Door 5: the Série B is the same league a new game of this seed gets, before its scores.
    const clubsAndSchedule = (l: GameState["leagues"][number]) => ({
      clubs: l.clubs.map((c) => [c.id, c.name]),
      fixtures: l.rounds.map((r) => r.matches.map((m) => [m.homeId, m.awayId])),
    });
    expect(clubsAndSchedule(a.state.leagues[1]!)).toEqual(clubsAndSchedule(newGame(6).leagues[1]!));
    // A different seed in the same document gives different scores.
    const other = migrateSave({ ...JSON.parse(JSON.stringify(doc)), seed: 7 });
    if (other.kind !== "ok") throw new Error("not migrated");
    const scores = (s: GameState) => s.leagues[1]!.rounds.slice(0, 3).flatMap((r) => r.matches.map((m) => m.result));
    expect(scores(other.state)).not.toEqual(scores(a.state));
  });

  test("partidas migradas da série B usam a semente da porta 5", () => {
    const seed = 8;
    const r = migrateSave(v3Document(seed, 2));
    if (r.kind !== "ok") throw new Error("not migrated");
    const b = r.state.leagues[1]!;
    // Replay round 1 of the Série B here, as scores only, with the seed written out.
    const players: Record<string, LivePlayer> = {};
    for (const c of b.clubs) for (const p of c.players) players[p.id] = { ...p };
    const clubs = new Map(b.clubs.map((c) => [c.id, c]));
    const side = (id: string) => {
      const club = clubs.get(id)!;
      const lineup = aiLineup(club);
      const starters = lineup.starters.map((pid) => (pid && isAvailable(club.players.find((p) => p.id === pid)!) ? pid : null));
      return makeSide(id, formationSlots(lineup.formation), starters, club.players.filter((p) => !starters.includes(p.id)).map((p) => p.id), players, { formation: lineup.formation });
    };
    const replay = (n: number, seedOf: (i: number) => number) =>
      runToEnd({
        roundIndex: n - 1,
        roundNumber: n,
        minute: 0,
        userClubId: null,
        players,
        matches: b.rounds[n - 1]!.matches.map((m, i) => makeMatch(m.id, side(m.homeId), side(m.awayId), seedOf(i), "l2")),
      }).matches.map((m) => [m.homeGoals, m.awayGoals]);
    // Both rounds already played, so the round number n is part of what is pinned.
    for (const n of [1, 2]) {
      const stored = b.rounds[n - 1]!.matches.map((m) => [m.result!.homeGoals, m.result!.awayGoals]);
      expect(stored, `rodada ${n}`).toEqual(replay(n, (i) => mix32(mix32(seed, 0xb), n * 16 + i)));
      // The Série A scheme (rejected in door 2) would give other scores.
      expect(stored, `rodada ${n}`).not.toEqual(replay(n, (i) => mix32(seed, n * 16 + i)));
    }
  });

  test("contratos migrados da série A vêm de mix32(seed, 5)", () => {
    const seed = 9;
    const r = migrateSave(v3Document(seed, 0));
    if (r.kind !== "ok") throw new Error("not migrated");
    const rng = createRng(mix32(seed, 5));
    const expected = r.state.leagues[0]!.clubs.flatMap((c) => c.players.map(() => randInt(rng, 1, 4)));
    expect(r.state.leagues[0]!.clubs.flatMap((c) => c.players.map((p) => p.contractSeasons))).toEqual(expected);
    const other = createRng(mix32(seed, 6));
    expect(expected).not.toEqual(expected.map(() => randInt(other, 1, 4)));
  });
});

const migrated = (doc: unknown): GameState => {
  const r = migrateSave(doc);
  if (r.kind !== "ok") throw new Error("not migrated");
  return r.state;
};
type V4Club = { id: string; finance: { cash: number }; players: Record<string, unknown>[] };
type V4Doc = { leagues: { clubs: V4Club[] }[]; market: { freeAgents: Record<string, unknown>[]; juniors: Record<string, unknown>[] } };
const CONDITION = ["fitness", "morale", "injuryRounds", "suspendedRounds", "yellowCards", "idleRounds"] as const;

describe("migração v4 -> v5 (copa-nacional)", () => {
  test("v4 na rodada 0 ganha preliminar", () => {
    const s = migrated(v4Document(92, 0));
    const cup = s.cups[0]!;
    expect(cup.id).toBe("cup-nat");
    expect(cup.currentPhase).toBe(0);
    expect(cup.phases[0]!.ties).toHaveLength(8);
    for (const t of cup.phases[0]!.ties) expect(t.result).toBeNull();
    for (const phase of cup.phases.slice(1)) expect(phase.ties).toEqual([]);
  });

  test("v4 no meio da temporada ganha copa", () => {
    const doc = v4Document(93, 12) as unknown as V4Doc;
    const s = migrated(JSON.parse(JSON.stringify(doc)));
    expect(s.schemaVersion).toBe(8);
    const cup = s.cups[0]!;
    for (const k of [0, 1]) {
      expect(cup.phases[k]!.ties).toHaveLength(k === 0 ? 8 : 16);
      for (const t of cup.phases[k]!.ties) {
        expect(t.result, t.id).not.toBeNull();
        expect([t.homeId, t.awayId]).toContain(t.winnerId);
      }
    }
    expect(cup.phases[2]!.ties).toHaveLength(8);
    for (const t of cup.phases[2]!.ties) expect([t.result, t.winnerId]).toEqual([null, null]);
    for (const phase of cup.phases.slice(3)) expect(phase.ties).toEqual([]);
    expect(cup.currentPhase).toBe(2);
    expect(nextDate(s)).toEqual({ kind: "league", roundIndex: 12 });
    // No money and no condition moved.
    const oldClubs = new Map(doc.leagues.flatMap((l) => l.clubs).map((c) => [c.id, c]));
    // Paises: the clubs of the v4 document, the ones of Brazil.
    for (const c of s.leagues.filter((l) => l.country === "BR").flatMap((l) => l.clubs)) {
      const old = oldClubs.get(c.id)!;
      expect(c.finance.cash, c.id).toBe(old.finance.cash);
      c.players.forEach((p, i) => {
        for (const k of CONDITION) expect(p[k], `${p.id}.${k}`).toBe(old.players[i]![k]);
      });
    }
  });

  test("v4 no fim da temporada ganha copa decidida", () => {
    const s = migrated(v4Document(94, 38));
    const cup = s.cups[0]!;
    expect(cup.currentPhase).toBe(6);
    expect(cup.phases.map((p) => p.ties.length)).toEqual([8, 16, 8, 4, 2, 1]);
    for (const phase of cup.phases) for (const t of phase.ties) expect(t.winnerId, t.id).not.toBeNull();
    expect(nextDate(s)).toEqual({ kind: "over" });
  }, 60_000);

  test("campos novos da v5", () => {
    const doc = v4Document(95, 3, 1);
    expect((doc as { history: unknown[] }).history).toHaveLength(1);
    const s = migrated(doc);
    const players = [...s.leagues.flatMap((l) => l.clubs.flatMap((c) => c.players)), ...s.market.freeAgents, ...s.market.juniors];
    expect(s.market.juniors.length).toBeGreaterThan(0);
    for (const p of players) expect(p.cupDiscipline, p.id).toEqual({});
    expect(s.history).toHaveLength(1);
    for (const r of s.history) expect(r.cups).toEqual([]);
    expect(s.cupGoal).toBe(expectedCupGoal(s));
  }, 60_000);

  test("meta de copa na migração", () => {
    // A Série B club in the preliminary (goal 1) and the Série A club of the fixture.
    const base = v4Document(96, 0) as Record<string, unknown> & { leagues: { clubs: { id: string }[] }[]; userClubId: string };
    const fromA = migrated(JSON.parse(JSON.stringify(base)));
    expect(fromA.cupGoal).toBe(expectedCupGoal(fromA));
    const preliminary = fromA.cups[0]!.phases[0]!.ties[0]!.homeId;
    const fromB = migrated({ ...JSON.parse(JSON.stringify(base)), userClubId: preliminary });
    expect(fromB.cupGoal).toBe(1);
    const noClub = migrated({ ...JSON.parse(JSON.stringify(base)), userClubId: null });
    expect(noClub.cupGoal).toBe(-1);
  });

  test("v1 v2 e v3 viram v5", () => {
    for (const doc of [v1Document(), v2Document(), v3Document(3, 6)]) {
      const s = migrated(doc);
      expect(s.schemaVersion).toBe(8);
      expect(s.leagues).toHaveLength(4);
      const cup = s.cups[0]!;
      expect(cup.seeding).toHaveLength(40);
      expect(cup.phases[0]!.ties).toHaveLength(8);
      for (const p of s.leagues.flatMap((l) => l.clubs.flatMap((c) => c.players))) expect(p.cupDiscipline).toEqual({});
      expect(s.cupGoal).toBe(expectedCupGoal(s));
    }
    // v3 six rounds in: the preliminary (after round 4) is already played.
    expect(migrated(v3Document(3, 6)).cups[0]!.currentPhase).toBe(1);
  });

  // Gastos-da-ia C30 supersedes copa-nacional C61 («versão acima de 5 incompatível»).
  // Paises C30 supersedes gastos-da-ia C30: 8 is incompatible, 7 loads as it is.
  // Copa-continental (Superseded checks): 9 is incompatible, 8 loads as it is.
  test("versão acima de 8 incompatível", () => {
    expect(migrateSave({ schemaVersion: 9 })).toEqual({ kind: "incompatible", version: 9 });
    expect(migrateSave({ schemaVersion: "x" })).toEqual({ kind: "incompatible", version: "x" });
    const v8 = JSON.parse(JSON.stringify(newGame(98)));
    expect(v8.schemaVersion).toBe(8);
    const r = migrateSave(v8);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.state).toBe(v8);
  });

  test("sementes da migração da copa", () => {
    const seed = 97;
    const s = migrated(v4Document(seed, 5));
    const cup = s.cups[0]!;
    // Door 3 over mix32(seed, 6): the preliminary's draw, written out.
    const rng = createRng(mix32(mix32(mix32(seed, 6), 0xd0), 0));
    const drawn = cup.seeding.slice(24);
    for (let i = drawn.length - 1; i > 0; i--) {
      const j = randInt(rng, 0, i);
      [drawn[i], drawn[j]] = [drawn[j]!, drawn[i]!];
    }
    const expectedPairs = Array.from({ length: 8 }, (_, i) => {
      const [a, b] = [drawn[2 * i]!, drawn[2 * i + 1]!];
      return cup.seeding.indexOf(a) > cup.seeding.indexOf(b) ? [a, b] : [b, a];
    });
    expect(cup.phases[0]!.ties.map((t) => [t.homeId, t.awayId])).toEqual(expectedPairs);

    // Door 2 over mix32(seed, 7): replay the preliminary here, scores only, AI elevens.
    const players: Record<string, LivePlayer> = {};
    const clubs = new Map(s.leagues.flatMap((l) => l.clubs).map((c) => [c.id, c]));
    for (const c of clubs.values()) for (const p of c.players) players[p.id] = { ...p };
    // Penaltis (Superseded checks): the cup's own availability, as `cupLive` plays it - a player
    // suspended in the league plays the cup.
    const competition = { kind: "cup", cupId: cup.id } as const;
    const side = (id: string) => {
      const club = clubs.get(id)!;
      const lineup = aiLineup(club, competition);
      const starters = lineup.starters.map((pid) => (pid && isAvailableFor(club.players.find((p) => p.id === pid)!, competition) ? pid : null));
      const bench = club.players.filter((p) => isAvailableFor(p, competition) && !starters.includes(p.id)).map((p) => p.id);
      return makeSide(id, formationSlots(lineup.formation), starters, bench, players, { formation: lineup.formation });
    };
    const replay = (seedOf: (i: number) => number) =>
      runToEnd({
        roundIndex: 5,
        roundNumber: 5,
        minute: 0,
        userClubId: null,
        players,
        matches: cup.phases[0]!.ties.map((t, i) => ({ ...makeMatch(t.id, side(t.homeId), side(t.awayId), seedOf(i), "cup-nat"), knockout: true })),
      }).matches.map((m) => [m.homeGoals, m.awayGoals, m.penalties ?? null]);
    const stored = cup.phases[0]!.ties.map((t) => [t.result!.homeGoals, t.result!.awayGoals, t.penalties]);
    expect(stored).toEqual(replay((i) => mix32(mix32(mix32(seed, 7), 0xc0), i)));
    expect(stored).not.toEqual(replay((i) => mix32(mix32(mix32(seed, 6), 0xc0), i)));
  });
});

describe("migração v5 -> v6 (gastos-da-ia)", () => {
  test("v5 vira v6", () => {
    const doc = v5Document(99, 3);
    expect(doc.schemaVersion).toBe(5);
    expect("transfers" in (doc.market as object)).toBe(false);
    const s = migrated(JSON.parse(JSON.stringify(doc)));
    expect(s.schemaVersion).toBe(8);
    expect(s.market.transfers).toEqual([]);
    // Without those two fields, the document is the v5 one (paises: and without v7's leagues abroad, country and tier).
    const without = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { market: Record<string, unknown>; leagues: Record<string, unknown>[] };
    delete without.market.transfers;
    without.schemaVersion = 5;
    without.leagues = without.leagues.slice(0, 2);
    for (const l of without.leagues) {
      delete l.country;
      delete l.tier;
    }
    // Copa-continental (Superseded checks): and without v8's continental cup.
    without.cups = (without.cups as unknown[]).slice(0, 1);
    expect(without).toEqual(doc);
  });

  // Paises C29 supersedes gastos-da-ia C29 («cadeia até v6»): every older version reaches v7 with 4 leagues.
  test("cadeia até v7", () => {
    const docs: [number, Record<string, unknown>][] = [
      [1, v1Document()],
      [2, v2Document()],
      [3, v3Document(3, 2)],
      [4, v4Document(3, 2)],
      [5, v5Document(3, 2)],
    ];
    expect(docs.map(([v, d]) => [v, d.schemaVersion])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ]);
    for (const [v, doc] of docs) {
      expect("transfers" in ((doc.market as object | undefined) ?? {}), `v${v}`).toBe(false);
      expect((doc.leagues as unknown[]).length, `v${v}`).toBeLessThanOrEqual(2);
      const s = migrated(doc);
      expect(s.schemaVersion, `v${v}`).toBe(8);
      expect(s.market.transfers, `v${v}`).toEqual([]);
      expect(s.leagues.map((l) => [l.id, l.country, l.tier]), `v${v}`).toEqual([
        ["l1", "BR", 0],
        ["l2", "BR", 1],
        ["l3", "AR", 0],
        ["l4", "PT", 0],
      ]);
    }
  });
});

// ---------- paises ----------

/** Real v6 saves recorded from 889aa71: seed 5, the user at c4, at round 0 and at round 12. */
const v6Saves = () =>
  JSON.parse(readFileSync(new URL("./__fixtures__/v6-saves.json", import.meta.url), "utf8")) as { round0: Record<string, unknown>; round12: Record<string, unknown> };

/** The migrated document without what v7 adds: the leagues abroad, and country and tier. */
function backToV6(s: GameState): Record<string, unknown> {
  const doc = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { leagues: Record<string, unknown>[] };
  doc.schemaVersion = 6;
  doc.leagues = doc.leagues.slice(0, 2);
  // Copa-continental (Superseded checks): v8 adds the continental cup.
  doc.cups = (doc.cups as unknown[]).slice(0, 1);
  for (const l of doc.leagues) {
    delete l.country;
    delete l.tier;
  }
  return doc;
}

describe("migração v6 -> v7 (paises)", () => {
  test("v6 vira v7 na rodada 0", () => {
    // C27 (AC 26, door 1, door 5).
    const v6 = v6Saves().round0;
    expect(v6.schemaVersion).toBe(6);
    expect((v6.leagues as unknown[]).length).toBe(2);
    const s = migrated(JSON.parse(JSON.stringify(v6)));
    expect(s.schemaVersion).toBe(8);
    const fresh = newGame(v6.seed as number);
    expect(s.leagues[2]).toEqual(fresh.leagues[2]);
    expect(s.leagues[3]).toEqual(fresh.leagues[3]);
    expect(s.leagues.map((l) => [l.id, l.country, l.tier])).toEqual([
      ["l1", "BR", 0],
      ["l2", "BR", 1],
      ["l3", "AR", 0],
      ["l4", "PT", 0],
    ]);
    expect(backToV6(s)).toEqual(v6);
  });

  test("v6 no meio da temporada ganha os países", () => {
    // C28 (AC 27, door 5).
    const v6 = v6Saves().round12;
    const seed = v6.seed as number;
    expect((v6.leagues as { currentRound: number }[])[0]!.currentRound).toBe(12);
    const s = migrated(JSON.parse(JSON.stringify(v6)));
    expect(backToV6(s)).toEqual(v6);
    for (const k of [2, 3]) {
      const league = s.leagues[k]!;
      expect(league.currentRound, league.id).toBe(12);
      league.rounds.forEach((r, n) => {
        for (const m of r.matches) expect(m.result === null, `${league.id} rodada ${n + 1}`).toBe(n >= 12);
      });
      // Scores only, replayed here with door 2 over mix32(seed, 10), written out.
      const players: Record<string, LivePlayer> = {};
      for (const c of league.clubs) for (const p of c.players) players[p.id] = { ...p };
      const clubs = new Map(league.clubs.map((c) => [c.id, c]));
      const side = (id: string) => {
        const club = clubs.get(id)!;
        const lineup = aiLineup(club);
        const starters = lineup.starters.map((pid) => (pid && isAvailable(club.players.find((p) => p.id === pid)!) ? pid : null));
        return makeSide(id, formationSlots(lineup.formation), starters, club.players.filter((p) => !starters.includes(p.id)).map((p) => p.id), players, { formation: lineup.formation });
      };
      const base = mix32(mix32(mix32(seed, 10), 0xe0), k);
      for (let n = 1; n <= 12; n++) {
        const replay = runToEnd({
          roundIndex: n - 1,
          roundNumber: n,
          minute: 0,
          userClubId: null,
          players,
          matches: league.rounds[n - 1]!.matches.map((m, i) => makeMatch(m.id, side(m.homeId), side(m.awayId), mix32(base, n * 16 + i), league.id)),
        }).matches.map((m) => [m.homeGoals, m.awayGoals]);
        expect(league.rounds[n - 1]!.matches.map((m) => [m.result!.homeGoals, m.result!.awayGoals]), `${league.id} rodada ${n}`).toEqual(replay);
      }
      for (const c of league.clubs) {
        const wages = c.players.reduce((sum, p) => sum + p.salary, 0);
        expect(c.finance.cash, c.id).toBe(Math.round((wages * 10) / 100_000) * 100_000);
        expect(c.finance.lastRound, c.id).toBeNull();
        for (const p of c.players) expect(p.fitness, p.id).toBe(100);
      }
    }
  });
});

describe("migração v7 -> v8 (copa-continental)", () => {
  const byStrength = (s: GameState, country: string, n: number) =>
    strengthRanking(s.leagues.find((l) => l.country === country && l.tier === 0)!.clubs).slice(0, n);

  test("v7 para v8 cria a continental", () => {
    // C24 (AC 24, door 3).
    const doc = v7Document(5, 0);
    expect(doc.schemaVersion).toBe(7);
    expect(doc.cups as unknown[]).toHaveLength(1);
    const s = migrated(JSON.parse(JSON.stringify(doc)));
    expect(s.schemaVersion).toBe(8);
    expect(s.cups.map((c) => c.id)).toEqual(["cup-nat", "cup-cont"]);
    const expected = [...byStrength(s, "BR", 6), ...byStrength(s, "AR", 5), ...byStrength(s, "PT", 5)];
    expect(new Set(s.cups[1]!.seeding)).toEqual(new Set(expected));
    expect(s.cups[1]!.seeding).toHaveLength(16);
    // A v8 document passes unchanged.
    const again = JSON.parse(JSON.stringify(s));
    expect(migrateSave(again)).toEqual({ kind: "ok", state: s });
  });

  test("v7 no meio da temporada joga as fases passadas só com placar", () => {
    // C25 (AC 25, door 3): stopped after round 14, past the anchors 7 and 13.
    const doc = v7Document(5, 14) as unknown as GameState;
    expect(doc.leagues[0]!.currentRound).toBe(14);
    const s = migrated(JSON.parse(JSON.stringify(doc)));
    const cup = s.cups[1]!;
    for (const k of [0, 1]) for (const t of cup.phases[k]!.ties) expect(t.winnerId, t.id).not.toBeNull();
    expect(cup.phases[2]!.ties).toHaveLength(2);
    for (const t of cup.phases[2]!.ties) expect([t.result, t.winnerId]).toEqual([null, null]);
    expect(cup.phases[3]!.ties).toEqual([]);
    expect(cup.currentPhase).toBe(2);
    const clubs = (g: GameState) => g.leagues.flatMap((l) => l.clubs);
    const before = new Map(clubs(doc).map((c) => [c.id, c]));
    for (const c of clubs(s)) {
      const b = before.get(c.id)!;
      expect(c.finance.cash, c.id).toBe(b.finance.cash);
      const was = new Map(b.players.map((p) => [p.id, p]));
      for (const p of c.players) {
        const q = was.get(p.id)!;
        expect([p.fitness, p.injuryRounds, p.cupDiscipline], p.id).toEqual([q.fitness, q.injuryRounds, q.cupDiscipline]);
      }
    }
  }, 60_000);

  test("v7 para v8 não mexe no histórico nem na nacional", () => {
    // C26 (AC 26, door 3): one closed season, 20 rounds into the next.
    const doc = v7Document(6, 20, 1) as unknown as GameState;
    expect(doc.history).toHaveLength(1);
    const s = migrated(JSON.parse(JSON.stringify(doc)));
    expect(s.history).toEqual(doc.history);
    expect(s.cups[0]).toEqual(doc.cups[0]);
  }, 120_000);
});

describe("sementes da continental migrada (correcoes-validacao)", () => {
  test("sementes da migração v8", () => {
    // C63 (AC 59, L-024): stopped after round 8, past the Oitavas (anchor 7); the Quartas are drawn.
    const seed = 5;
    const doc = v7Document(seed, 8) as unknown as GameState;
    const s = migrated(JSON.parse(JSON.stringify(doc)));
    const cup = s.cups[1]!;
    const country = new Map(s.leagues.flatMap((l) => l.clubs.map((c) => [c.id, l.country] as const)));
    const homeFirst = (a: string, b: string) => (cup.seeding.indexOf(a) > cup.seeding.indexOf(b) ? [a, b] : [b, a]);
    const shuffled = (clubs: string[], drawState: number, k: number) => {
      // Door 3 of copa-continental, written out: the draw of phase k over mix32(mix32(state, 0xd1), k).
      const rng = createRng(mix32(mix32(drawState, 0xd1), k));
      const out = [...clubs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = randInt(rng, 0, i);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    };
    // The Oitavas keep clubs of one country apart: the first club of the country with most clubs
    // left meets the first club left of another country.
    const oitavas = (drawState: number) => {
      const left = shuffled(cup.seeding, drawState, 0);
      const count = (c: string | undefined) => left.filter((id) => country.get(id) === c).length;
      const pairs: string[][] = [];
      while (left.length > 1) {
        const a = left.reduce((best, id) => (count(country.get(id)) > count(country.get(best)) ? id : best));
        left.splice(left.indexOf(a), 1);
        const b = left.find((id) => country.get(id) !== country.get(a)) ?? left[0]!;
        left.splice(left.indexOf(b), 1);
        pairs.push(homeFirst(a, b));
      }
      return pairs;
    };
    const stored = (k: number) => cup.phases[k]!.ties.map((t) => [t.homeId, t.awayId]);
    expect(stored(0)).toHaveLength(8);
    expect(stored(0)).toEqual(oitavas(mix32(seed, 8)));
    expect(stored(0)).not.toEqual(oitavas(mix32(seed, 9)));

    // The Oitavas played with scores only over mix32(mix32(mix32(seed, 9), 0xc1), i), AI elevens for the cup.
    const competition = { kind: "cup", cupId: "cup-cont" } as const;
    const replay = (matchState: number) => {
      const players: Record<string, LivePlayer> = {};
      const clubs = new Map(doc.leagues.flatMap((l) => l.clubs).map((c) => [c.id, c]));
      for (const c of clubs.values()) for (const p of c.players) players[p.id] = { ...p };
      const side = (id: string) => {
        const club = clubs.get(id)!;
        const lineup = aiLineup(club, competition);
        const starters = lineup.starters.map((pid) => (pid && isAvailableFor(club.players.find((p) => p.id === pid)!, competition) ? pid : null));
        const bench = club.players.filter((p) => isAvailableFor(p, competition) && !starters.includes(p.id)).map((p) => p.id);
        return makeSide(id, formationSlots(lineup.formation), starters, bench, players, { formation: lineup.formation, posture: "balanced", isUser: false });
      };
      return runToEnd({
        roundIndex: 8,
        roundNumber: 8,
        minute: 0,
        userClubId: null,
        players,
        matches: cup.phases[0]!.ties.map((t, i) => ({ ...makeMatch(t.id, side(t.homeId), side(t.awayId), mix32(mix32(matchState, 0xc1), i), "cup-cont"), knockout: true })),
      }).matches.map((m) => [m.homeGoals, m.awayGoals, m.penalties ?? null]);
    };
    const results = cup.phases[0]!.ties.map((t) => [t.result!.homeGoals, t.result!.awayGoals, t.penalties]);
    expect(results).toEqual(replay(mix32(seed, 9)));
    expect(results).not.toEqual(replay(mix32(seed, 8)));

    // The Quartas drawn from the winners, in seeding order, over the same draw state.
    const winners = cup.phases[0]!.ties.map((t) => t.winnerId!).sort((a, b) => cup.seeding.indexOf(a) - cup.seeding.indexOf(b));
    const quartas = (drawState: number) => {
      const order = shuffled(winners, drawState, 1);
      return Array.from({ length: 4 }, (_, i) => homeFirst(order[2 * i]!, order[2 * i + 1]!));
    };
    expect(stored(1)).toEqual(quartas(mix32(seed, 8)));
    expect(stored(1)).not.toEqual(quartas(mix32(seed, 9)));
  }, 60_000);
});
