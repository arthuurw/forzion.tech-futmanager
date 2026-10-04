import { newGame, makePlayer } from "./generate";
import { AI_FORMATION, autoLineup, isAvailable } from "./lineup";
import { isMarketOpen } from "./market";
import { migrateSave } from "./migrate";
import { FIRST_NAMES_BY_COUNTRY, SURNAME_PARTS_BY_COUNTRY } from "./names";
import { createRng, mix32, randInt } from "./rng";
import { nextSeason } from "./rollover";
import { playRound, seasonReview } from "./season";
import { computeTable } from "./table";
import { busySeason, expectedCupGoal, zeroAiSurplus } from "./test-fixtures";
import { takeJob } from "./career";
import type { Club, GameState, Player, Position } from "./types";

/** Written out here, not imported (L-004). */
const expectedSalary = (rating: number) => Math.round((2000 * 1.09 ** (rating - 40)) / 100) * 100;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const all = (s: GameState): Club[] => s.leagues.flatMap((l) => l.clubs);
const clubOf = (s: GameState, id: string) => all(s).find((c) => c.id === id)!;
const userOf = (s: GameState) => clubOf(s, s.userClubId!);
const everyone = (s: GameState): Player[] => [...all(s).flatMap((c) => c.players), ...s.market.freeAgents];

const cache = new Map<string, GameState>();
/** A finished season: the user manages club `clubIndex` of division `division`; goal 20, so never fired. */
function ended(seed = 30, division = 0, clubIndex = 0): GameState {
  const key = `${seed}-${division}-${clubIndex}`;
  if (!cache.has(key)) {
    let s = newGame(seed);
    const c = s.leagues[division]!.clubs[clubIndex]!;
    s.userClubId = c.id;
    s.boardGoal = 20;
    for (let r = 0; r < 38; r++) {
      userOf(s).lineup = autoLineup(userOf(s), AI_FORMATION);
      zeroAiSurplus(s);
      s = playRound(s).state;
    }
    cache.set(key, s);
  }
  return clone(cache.get(key)!);
}

/**
 * The closed cup as the history keeps it, read off the ties here (L-004): the final's winner and
 * loser, and the last phase the user played (6 when champion).
 */
/** Copa-continental (Superseded checks): `index` 1 is the continental cup, whose final is phase 3. */
function expectedCupRecord(s: GameState, index = 0) {
  const [cupId, finalPhase] = index === 0 ? ["cup-nat", 5] : ["cup-cont", 3];
  const cup = s.cups[index]!;
  const final = cup.phases[finalPhase]!.ties[0]!;
  const runnerUpId = final.winnerId === final.homeId ? final.awayId : final.homeId;
  let userReached: number | null = null;
  cup.phases.forEach((phase, k) => {
    if (phase.ties.some((t) => t.homeId === s.userClubId || t.awayId === s.userClubId)) userReached = k;
  });
  if (final.winnerId === s.userClubId) userReached = finalPhase + 1;
  return { cupId, championId: final.winnerId, runnerUpId, userReached };
}

let pad = 0;
function player(age: number, rating: number, position: Position = "MF", contractSeasons = 0): Player {
  pad++;
  return makePlayer(`t-${pad}`, `Teste ${pad}`, position, age, rating, contractSeasons);
}

describe("virada de temporada", () => {
  test("4 sobem e 4 descem", () => {
    const before = ended();
    const tableA = computeTable(before.leagues[0]!).map((r) => r.clubId);
    const tableB = computeTable(before.leagues[1]!).map((r) => r.clubId);
    const down = tableA.slice(16);
    const up = tableB.slice(0, 4);
    const { state } = nextSeason(before);
    const idsA = state.leagues[0]!.clubs.map((c) => c.id);
    const idsB = state.leagues[1]!.clubs.map((c) => c.id);
    expect(idsA).toEqual([...before.leagues[0]!.clubs.map((c) => c.id).filter((id) => !down.includes(id)), ...up]);
    expect(idsB).toEqual([...before.leagues[1]!.clubs.map((c) => c.id).filter((id) => !up.includes(id)), ...down]);
    expect(idsA).toHaveLength(20);
    expect(idsB).toHaveLength(20);
    // Paises: the clubs of Brazil; the leagues abroad are C11's.
    expect(new Set([...idsA, ...idsB])).toEqual(new Set(before.leagues.filter((l) => l.country === "BR").flatMap((l) => l.clubs).map((c) => c.id)));
    for (const c of all(state)) expect(c.name).toBe(clubOf(before, c.id).name);
  });

  test("calendário novo e mercado aberto", () => {
    const { state } = nextSeason(ended());
    expect(state.season).toBe(2);
    for (const league of state.leagues) {
      expect(league.currentRound).toBe(0);
      expect(league.rounds).toHaveLength(38);
      const meetings = new Map<string, number>();
      for (const r of league.rounds) {
        expect(r.matches).toHaveLength(10);
        for (const m of r.matches) {
          expect(m.result).toBeNull();
          meetings.set(`${m.homeId}>${m.awayId}`, (meetings.get(`${m.homeId}>${m.awayId}`) ?? 0) + 1);
        }
      }
      const ids = league.clubs.map((c) => c.id);
      for (const a of ids) for (const b of ids) if (a !== b) expect(meetings.get(`${a}>${b}`), `${a}>${b}`).toBe(1);
    }
    expect(isMarketOpen(state)).toBe(true);
    expect(state.market.juniors.map((j) => j.id)).toEqual(["jr-2-1-1", "jr-2-1-2", "jr-2-1-3"]);
  });

  test("condição renovada mantém lesão e moral", () => {
    const before = ended();
    const marked = all(before).map((c) => c.players[0]!);
    marked.forEach((p, i) => Object.assign(p, { age: 22, contractSeasons: 3, injuryRounds: 1 + (i % 4), morale: (i % 5) - 2 || 1, suspendedRounds: 1, yellowCards: 2, fitness: 40 }));
    const { state } = nextSeason(before);
    for (const league of state.leagues) {
      for (const c of league.clubs) {
        for (const p of c.players) {
          expect([p.fitness, p.yellowCards, p.suspendedRounds], p.id).toEqual([100, 0, 0]);
        }
      }
    }
    for (const p of marked) {
      const now = everyone(state).find((x) => x.id === p.id)!;
      expect([now.injuryRounds, now.morale], p.id).toEqual([p.injuryRounds, p.morale]);
    }
  });

  test("caixa estádio e empréstimo continuam", () => {
    const before = ended();
    Object.assign(userOf(before).finance, { loan: 1_500_000, expansionRoundsLeft: 2 });
    before.market.offers = [{ id: "o-x", buyerId: before.leagues[0]!.clubs[1]!.id, playerId: userOf(before).players[0]!.id, amount: 900_000 }];
    const { state } = nextSeason(before);
    expect(state.market.offers).toEqual([]);
    for (const c of all(before)) {
      expect(c.finance.lastRound!.prize, c.id).toBeGreaterThan(0);
      expect(clubOf(state, c.id).finance, c.id).toEqual(c.finance);
    }
  });

  test("virada usa o próprio Rng", () => {
    const before = ended();
    // Treino-evolucao C7 (supersedes multiplas-temporadas C19): the first 8 players of the first
    // Série A club that stays up are 34 with long contracts, so each draws the dropped age draw,
    // randInt(-6, -2), then retires at 35 below 0,5 - in squad order, first in the turn's stream.
    const down = computeTable(before.leagues[0]!).slice(16).map((r) => r.clubId);
    const stays = before.leagues[0]!.clubs.find((c) => !down.includes(c.id))!;
    const probe = stays.players.slice(0, 8);
    probe.forEach((p) => Object.assign(p, { age: 34, contractSeasons: 3, rating: 60 }));
    const a = nextSeason(clone(before)).state;
    expect(nextSeason(clone(before)).state).toEqual(a);
    const advanced = createRng(before.rngState);
    advanced.next();
    expect(a.rngState).toBe(advanced.getState());
    expect(a.leagues[0]!.clubs[0]!.id).toBe(stays.id);
    const gone = probe.map((p) => !everyone(a).some((x) => x.id === p.id));
    const retirements = (rng: ReturnType<typeof createRng>, dropped: boolean) =>
      probe.map(() => {
        if (dropped) randInt(rng, -6, -2);
        return rng.next() < 0.5;
      });
    // Door 3: createRng(mix32(rngState, 0x5E45 + season)), written out, the age's draw still made.
    expect(gone).toEqual(retirements(createRng(mix32(before.rngState, 0x5e45 + before.season)), true));
    // Neither skipping the age's draw nor the save's own Rng gives these retirements.
    expect(gone).not.toEqual(retirements(createRng(mix32(before.rngState, 0x5e45 + before.season)), false));
    expect(gone).not.toEqual(retirements(createRng(before.rngState), true));
    for (const p of probe.filter((_, k) => !gone[k])) expect(everyone(a).find((x) => x.id === p.id)!.rating).toBe(60);
    const other = nextSeason({ ...clone(before), rngState: before.rngState + 1 }).state;
    const ratings = (s: GameState) => [...all(s).flatMap((c) => c.players), ...s.market.freeAgents, ...s.market.juniors].map((p) => `${p.id}:${p.rating}`);
    expect(ratings(other)).not.toEqual(ratings(a));
  });
});

describe("evolução e aposentadoria", () => {
  test("virada sem delta de idade", () => {
    // Treino-evolucao C6 (supersedes multiplas-temporadas C21): the rating moved during the season,
    // so the turn keeps it for every age band, and every player's season log is emptied.
    const before = ended();
    const ages = [17, 20, 21, 23, 24, 27, 28, 30, 31, 33];
    const fixture = ages.flatMap((age) => Array.from({ length: 20 }, () => player(age, 60, "MF", 3)));
    fixture.forEach((p, k) => (p.ratingLog = k % 2 ? [{ round: 5, delta: 1 }] : []));
    const host = before.leagues[2]!.clubs[0]!;
    host.players.push(...fixture);
    before.market.freeAgents[0]!.ratingLog = [{ round: 3, delta: -1 }];
    for (const j of before.market.juniors) j.ratingLog = [{ round: 3, delta: 1 }];
    const stayers = new Map(all(before).flatMap((c) => c.players).map((p) => [p.id, p.rating]));
    const { state } = nextSeason(before);
    const after = new Map(clubOf(state, host.id).players.map((p) => [p.id, p]));
    const kept = fixture.filter((p) => after.has(p.id));
    expect(kept.length).toBeGreaterThan(150);
    for (const age of ages) expect(kept.some((p) => p.age === age), `idade ${age}`).toBe(true);
    for (const p of kept) expect(after.get(p.id)!.rating, `idade ${p.age}`).toBe(60);
    for (const c of all(state)) for (const p of c.players) if (stayers.has(p.id)) expect(p.rating, p.id).toBe(stayers.get(p.id));
    for (const p of [...all(state).flatMap((c) => c.players), ...state.market.freeAgents, ...state.market.juniors]) {
      expect(p.ratingLog ?? [], p.id).toEqual([]);
    }
    const advanced = createRng(before.rngState);
    advanced.next();
    expect(state.rngState).toBe(advanced.getState());
  });

  test("relatório da temporada pelo ratingLog", () => {
    // Treino-evolucao C15: «Antes» = rating − the season's log, «Depois» = rating.
    const before = ended();
    const me = userOf(before);
    const [moved, still] = me.players.filter((p) => p.age < 30).slice(0, 2);
    Object.assign(moved!, { rating: 70, contractSeasons: 3, ratingLog: [{ round: 3, delta: 1 }, { round: 9, delta: 1 }, { round: 20, delta: -1 }] });
    Object.assign(still!, { rating: 70, contractSeasons: 3, ratingLog: [] });
    const { report } = nextSeason(before);
    expect(report.changes.find((c) => c.playerId === moved!.id)).toMatchObject({ before: 69, after: 70 });
    expect(report.changes.find((c) => c.playerId === still!.id)).toMatchObject({ before: 70, after: 70 });
  });

  test("todos envelhecem um ano", () => {
    const before = ended();
    // Some of the user's contracts end now, so leavers are among the players checked.
    userOf(before).players.slice(0, 3).forEach((p) => Object.assign(p, { contractSeasons: 1, age: 25 }));
    const leavers = userOf(before).players.slice(0, 3).map((p) => p.id);
    const { state } = nextSeason(before);
    const ages = new Map(everyone(before).map((p) => [p.id, p.age]));
    let checked = 0;
    for (const p of everyone(state)) {
      if (!ages.has(p.id)) continue;
      expect(p.age, p.id).toBe(ages.get(p.id)! + 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(800);
    for (const id of leavers) expect(state.market.freeAgents.find((p) => p.id === id)!.age).toBe(26);
  });

  test("aposentadoria por idade", () => {
    const before = ended();
    // Ages before the birthday: 32..36, so 33..37 after it.
    const byAge = new Map([32, 33, 34, 35, 36].map((age) => [age + 1, Array.from({ length: 1000 }, () => player(age, 60, "MF", 3))]));
    // Correcoes-validacao C30: at an AI club abroad under contract, since the free agents are cut to 80.
    const host = before.leagues[2]!.clubs[0]!;
    host.players.push(...[...byAge.values()].flat());
    // A 35-year-old starter of the user retires: gone from the squad, the lineup and the free agents.
    const me = userOf(before);
    const veteran = me.players[0]!;
    Object.assign(veteran, { age: 35, contractSeasons: 3 });
    me.lineup = autoLineup(me, AI_FORMATION);
    me.lineup.starters[0] = veteran.id;
    const { state } = nextSeason(before);
    const left = new Set(clubOf(state, host.id).players.map((p) => p.id));
    const retiredShare = (age: number) => byAge.get(age)!.filter((p) => !left.has(p.id)).length / 1000;
    expect(retiredShare(33)).toBe(0);
    expect(retiredShare(34)).toBeGreaterThanOrEqual(0.15);
    expect(retiredShare(34)).toBeLessThanOrEqual(0.25);
    expect(retiredShare(35)).toBeGreaterThanOrEqual(0.45);
    expect(retiredShare(35)).toBeLessThanOrEqual(0.55);
    expect(retiredShare(36)).toBe(1);
    expect(retiredShare(37)).toBe(1);
    expect(everyone(state).some((p) => p.id === veteran.id)).toBe(false);
    expect(userOf(state).lineup!.starters).not.toContain(veteran.id);
  });

  test("IA repõe com juniores até 22", () => {
    const before = ended();
    const shape = (c: Club) => {
      const keep = [...c.players.filter((p) => p.position === "GK").slice(0, 3), ...c.players.filter((p) => p.position === "DF").slice(0, 6), ...c.players.filter((p) => p.position === "MF").slice(0, 6)];
      keep.forEach((p) => Object.assign(p, { age: 25, contractSeasons: 3 }));
      c.players = keep;
      c.lineup = null;
    };
    const ai = before.leagues[0]!.clubs.find((c) => c.id !== before.userClubId)!;
    shape(ai);
    shape(userOf(before));
    const kept = new Set(ai.players.map((p) => p.id));
    const { state } = nextSeason(before);
    const now = clubOf(state, ai.id);
    expect(now.players).toHaveLength(22);
    // Correcoes-validacao C16 (Impact): the user's academy fills the squad up to 18, was none.
    expect(userOf(state).players).toHaveLength(18);
    const mean = now.players.filter((p) => kept.has(p.id)).reduce((s, p) => s + p.rating, 0) / 15;
    const juniors = now.players.filter((p) => !kept.has(p.id));
    expect(juniors).toHaveLength(7);
    expect(juniors.slice(0, 3).map((p) => p.position)).toEqual(["FW", "FW", "FW"]);
    for (const j of juniors) {
      expect(j.age).toBeGreaterThanOrEqual(18);
      expect(j.age).toBeLessThanOrEqual(20);
      expect(j.rating).toBeGreaterThanOrEqual(Math.round(mean) - 12);
      expect(j.rating).toBeLessThanOrEqual(Math.round(mean) - 4);
      expect(j.contractSeasons).toBe(3);
    }
  });

  test("livres voltam a 40", () => {
    const before = ended();
    before.market.freeAgents = before.market.freeAgents.slice(0, 5).map((p) => ({ ...p, age: 22 }));
    // No club player leaves, so only new free agents can fill the list.
    for (const c of all(before)) for (const p of c.players) Object.assign(p, { contractSeasons: 3, age: Math.min(p.age, 30) });
    const old = new Set(before.market.freeAgents.map((p) => p.id));
    const { state } = nextSeason(before);
    expect(state.market.freeAgents.length).toBeGreaterThanOrEqual(40);
    const fresh = state.market.freeAgents.filter((p) => !old.has(p.id));
    expect(fresh.length).toBeGreaterThanOrEqual(35);
    for (const p of fresh) {
      expect(p.age).toBeGreaterThanOrEqual(19);
      expect(p.age).toBeLessThanOrEqual(31);
      expect(p.rating).toBeGreaterThanOrEqual(45);
      expect(p.rating).toBeLessThanOrEqual(70);
    }
  });
});

describe("contratos na virada", () => {
  test("contrato cai e último ano vai para os livres", () => {
    const before = ended();
    const me = userOf(before);
    me.players.forEach((p, i) => Object.assign(p, { age: 24, contractSeasons: 1 + (i % 4) }));
    me.lineup = autoLineup(me, AI_FORMATION);
    const last = me.players.filter((p) => p.contractSeasons === 1).map((p) => p.id);
    expect(last.length).toBeGreaterThan(0);
    const { state } = nextSeason(before);
    const now = userOf(state);
    for (const p of me.players) {
      if (last.includes(p.id)) {
        expect(now.players.some((x) => x.id === p.id), p.id).toBe(false);
        expect(now.lineup!.starters).not.toContain(p.id);
        expect(state.market.freeAgents.find((x) => x.id === p.id)?.contractSeasons, p.id).toBe(0);
      } else {
        expect(now.players.find((x) => x.id === p.id)!.contractSeasons, p.id).toBe(p.contractSeasons - 1);
      }
    }
  });

  test("IA renova até 32 anos", () => {
    const before = ended();
    const ai = before.leagues[1]!.clubs.find((c) => c.id !== before.userClubId)!;
    const young = ai.players.slice(0, 6);
    const old = ai.players.slice(6, 12);
    young.forEach((p) => Object.assign(p, { age: 32, contractSeasons: 1 }));
    old.forEach((p) => Object.assign(p, { age: 33, contractSeasons: 1 }));
    const { state } = nextSeason(before);
    const now = clubOf(state, ai.id);
    const lengths = new Set<number>();
    for (const p of young) {
      const x = now.players.find((q) => q.id === p.id)!;
      expect(x, p.id).toBeDefined();
      expect(x.contractSeasons).toBeGreaterThanOrEqual(1);
      expect(x.contractSeasons).toBeLessThanOrEqual(3);
      expect(x.salary).toBe(expectedSalary(x.rating));
      lengths.add(x.contractSeasons);
    }
    expect(lengths.size).toBeGreaterThan(1);
    const free = new Set(state.market.freeAgents.map((p) => p.id));
    let gone = 0;
    for (const p of old) {
      expect(now.players.some((q) => q.id === p.id), p.id).toBe(false);
      if (free.has(p.id)) gone++;
    }
    // 33-year-olds become 34: up to a fifth retire, the rest are free agents.
    expect(gone).toBeGreaterThan(0);
  });
});

describe("diretoria e histórico na virada", () => {
  test("demitido assume o novo clube", () => {
    const before = ended(31, 0, 5);
    const position = computeTable(before.leagues[0]!).findIndex((r) => r.clubId === before.userClubId) + 1;
    // A goal 5+ places above the final position fires the manager.
    expect(position).toBeGreaterThanOrEqual(6);
    before.boardGoal = position - 5;
    const review = seasonReview(before);
    expect(review.user!.verdict).toBe("fired");
    expect(review.jobOffers).toHaveLength(3);
    expect(() => nextSeason(clone(before))).toThrow();
    const pick = review.jobOffers[1]!;
    const { state } = nextSeason(before, pick);
    expect(state.userClubId).toBe(pick);
    const club = userOf(state);
    const starters = club.lineup!.starters.filter((id): id is string => !!id);
    expect(new Set(starters).size).toBe(11);
    for (const id of starters) expect(isAvailable(club.players.find((p) => p.id === id)!)).toBe(true);
    expect(clubOf(state, before.userClubId!).lineup).toBeNull();
    // The goal is the new club's, by its strength rank in its division (written out, L-004).
    const division = state.leagues.findIndex((l) => l.clubs.some((c) => c.id === pick));
    const best11 = (c: Club) => [...c.players].map((p) => p.rating).sort((a, b) => b - a).slice(0, 11).reduce((a, b) => a + b, 0) / 11;
    const rank = [...state.leagues[division]!.clubs].sort((a, b) => best11(b) - best11(a) || a.id.localeCompare(b.id)).findIndex((c) => c.id === pick) + 1;
    // Correcoes-validacao C36: at most the 17th without relegation, was 20.
    const goal = division === 0 ? Math.min(16, rank + 3) : rank <= 4 ? 4 : Math.min(17, rank + 3);
    expect(state.boardGoal).toBe(goal);
  });

  test("estatísticas vão para a carreira", () => {
    const before = ended();
    for (const p of everyone(before)) Object.assign(p, { careerGames: 100, careerGoals: 20 });
    const played = everyone(before).filter((p) => p.seasonGames > 0 && p.seasonGoals > 0);
    expect(played.length).toBeGreaterThan(0);
    const { state } = nextSeason(before);
    const was = new Map(everyone(before).map((p) => [p.id, p]));
    for (const p of everyone(state)) {
      const b = was.get(p.id);
      if (!b) continue;
      expect([p.seasonGames, p.seasonGoals], p.id).toEqual([0, 0]);
      expect([p.careerGames, p.careerGoals], p.id).toEqual([100 + b.seasonGames, 20 + b.seasonGoals]);
    }
  });

  test("histórico da temporada", () => {
    const before = ended();
    const topScorer = (division: number) => {
      const rows = before.leagues[division]!.clubs.flatMap((c) => c.players.map((p) => ({ name: p.name, clubName: c.name, goals: p.seasonGoals })));
      rows.sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name, "pt-BR"));
      return rows[0]!;
    };
    const tA = computeTable(before.leagues[0]!).map((r) => r.clubId);
    const tB = computeTable(before.leagues[1]!).map((r) => r.clubId);
    // Paises (Superseded checks): the leagues abroad have a record too, with nobody up or down.
    const tAr = computeTable(before.leagues[2]!).map((r) => r.clubId);
    const tPt = computeTable(before.leagues[3]!).map((r) => r.clubId);
    const position = tA.indexOf(before.userClubId!) + 1;
    const one = nextSeason(before).state;
    expect(one.history).toEqual([
      {
        season: 1,
        userClubId: before.userClubId,
        userLeagueId: "l1",
        userPosition: position,
        verdict: "met",
        prize: (21 - position) * 250_000,
        cups: [expectedCupRecord(before), expectedCupRecord(before, 1)],
        divisions: [
          { leagueId: "l1", championId: tA[0], promotedIds: [], relegatedIds: tA.slice(16), topScorer: topScorer(0) },
          { leagueId: "l2", championId: tB[0], promotedIds: tB.slice(0, 4), relegatedIds: [], topScorer: topScorer(1) },
          { leagueId: "l3", championId: tAr[0], promotedIds: [], relegatedIds: [], topScorer: topScorer(2) },
          { leagueId: "l4", championId: tPt[0], promotedIds: [], relegatedIds: [], topScorer: topScorer(3) },
        ],
      },
    ]);
    // A second season appends and leaves the first record as it was (Relations: only grows).
    let s = one;
    s.boardGoal = 20;
    for (let r = 0; r < 38; r++) {
      userOf(s).lineup = autoLineup(userOf(s), AI_FORMATION);
      s = playRound(s).state;
    }
    s.boardGoal = 20;
    const two = nextSeason(s).state;
    expect(two.history).toHaveLength(2);
    expect(two.history[0]).toEqual(one.history[0]);
    expect(two.history[1]!.season).toBe(2);
    // The saved document reads back with both records, oldest first.
    const read = migrateSave(clone(two));
    if (read.kind !== "ok") throw new Error("not read");
    expect(read.state.history.map((h) => h.season)).toEqual([1, 2]);
  }, 60_000);

  test("contrato de clube nunca abaixo de 1", () => {
    const s = busySeason();
    s.boardGoal = 20;
    const check = (state: GameState) => {
      for (const c of all(state)) for (const p of c.players) expect(p.contractSeasons, `${c.id} ${p.id}`).toBeGreaterThanOrEqual(1);
      for (const p of state.market.freeAgents) expect(p.contractSeasons, p.id).toBe(0);
    };
    check(s);
    check(nextSeason(s).state);
  });
});

describe("copa na virada (copa-nacional)", () => {
  test("chaveamento da copa na virada", () => {
    const before = ended(32);
    // The final tables, read here from the scores.
    const tA = computeTable(before.leagues[0]!).map((r) => r.clubId);
    const tB = computeTable(before.leagues[1]!).map((r) => r.clubId);
    const { state } = nextSeason(before);
    expect(state.cups[0]!.seeding).toEqual([...tA.slice(0, 16), ...tB.slice(0, 4), ...tA.slice(16), ...tB.slice(4)]);
    // The preliminary is the 16 who stayed in the Série B; the 4 relegated go straight to the «16 avos».
    expect(new Set(state.cups[0]!.phases[0]!.ties.flatMap((t) => [t.homeId, t.awayId]))).toEqual(new Set(tB.slice(4)));
    for (const t of state.cups[0]!.phases[0]!.ties) expect(state.cups[0]!.seeding.indexOf(t.homeId)).toBeGreaterThan(state.cups[0]!.seeding.indexOf(t.awayId));
  });

  test("copa nova na virada", () => {
    const before = ended(33);
    const suspended = userOf(before).players.find((p) => p.age <= 25 && p.contractSeasons > 1)!;
    suspended.cupDiscipline = { "cup-nat": { yellowCards: 2, suspendedRounds: 1 } };
    before.market.freeAgents[0]!.cupDiscipline = { "cup-nat": { yellowCards: 1, suspendedRounds: 0 } };
    expect(before.cups[0]!.currentPhase).toBe(6);
    const { state } = nextSeason(before);
    const players = [...all(state).flatMap((c) => c.players), ...state.market.freeAgents, ...state.market.juniors];
    expect(players.some((p) => p.id === suspended.id)).toBe(true);
    for (const p of players) expect(p.cupDiscipline, p.id).toEqual({});
    const cup = state.cups[0]!;
    expect(state.cups).toHaveLength(2);
    expect(cup.currentPhase).toBe(0);
    expect(cup.phases[0]!.ties).toHaveLength(8);
    for (const t of cup.phases[0]!.ties) expect([t.result, t.winnerId]).toEqual([null, null]);
    for (const phase of cup.phases.slice(1)) expect(phase.ties).toEqual([]);
    // Door 3: drawn from the new season's state.
    const rng = createRng(mix32(mix32(state.rngState, 0xd0), 0));
    const drawn = cup.seeding.slice(24);
    for (let i = drawn.length - 1; i > 0; i--) {
      const j = randInt(rng, 0, i);
      [drawn[i], drawn[j]] = [drawn[j]!, drawn[i]!];
    }
    expect(cup.phases[0]!.ties.map((t) => [t.homeId, t.awayId].sort())).toEqual(
      Array.from({ length: 8 }, (_, i) => [drawn[2 * i]!, drawn[2 * i + 1]!].sort()),
    );
  });

  test("meta de copa na virada", () => {
    const { state } = nextSeason(ended(34));
    expect(state.cupGoal).toBe(expectedCupGoal(state));
    // Also for the new club of a fired manager.
    const before = ended(31, 0, 5);
    const position = computeTable(before.leagues[0]!).findIndex((r) => r.clubId === before.userClubId) + 1;
    before.boardGoal = position - 5;
    const pick = seasonReview(before).jobOffers[0]!;
    const fired = nextSeason(before, pick).state;
    expect(fired.userClubId).toBe(pick);
    expect(fired.cupGoal).toBe(expectedCupGoal(fired));
  });

  test("veredito combinado no histórico", () => {
    const before = ended(31, 0, 5);
    const position = computeTable(before.leagues[0]!).findIndex((r) => r.clubId === before.userClubId) + 1;
    before.boardGoal = position - 5;
    const reached = expectedCupRecord(before).userReached!;
    before.cupGoal = reached;
    const review = seasonReview(before);
    expect(review.user!.leagueVerdict).toBe("fired");
    expect(review.user!.verdict).toBe("missed");
    expect(review.jobOffers).toEqual([]);
    const { state } = nextSeason(before);
    expect(state.userClubId).toBe(before.userClubId);
    expect(state.history[0]!.verdict).toBe("missed");
  });

  test("copa no histórico", () => {
    const before = ended(35);
    const record = expectedCupRecord(before);
    expect(record.championId).not.toBeNull();
    const { state } = nextSeason(before);
    expect(state.history[0]!.cups).toEqual([record, expectedCupRecord(before, 1)]);
  });
});

describe("boletim na virada (gastos-da-ia)", () => {
  test("virada esvazia o boletim", () => {
    const before = ended();
    const [a, b] = [before.leagues[0]!.clubs[4]!, before.leagues[1]!.clubs[6]!];
    const p = b.players[3]!;
    before.market.transfers = [
      { round: 2, kind: "buy", playerId: p.id, playerName: p.name, fromId: b.id, toId: a.id, amount: 950_000 },
      { round: 2, kind: "release", playerId: "x1", playerName: "Um", fromId: a.id, toId: null, amount: 60_000 },
      { round: 3, kind: "free", playerId: "x2", playerName: "Dois", fromId: null, toId: b.id, amount: 44_000 },
      { round: 18, kind: "buy", playerId: "x3", playerName: "Três", fromId: a.id, toId: b.id, amount: 1_220_000 },
      { round: 21, kind: "free", playerId: "x4", playerName: "Quatro", fromId: null, toId: a.id, amount: 52_000 },
    ];
    expect(before.market.transfers).toHaveLength(5);
    const { state } = nextSeason(before);
    expect(state.market.transfers).toHaveLength(0);
  });
});

describe("demitido na virada (paises)", () => {
  test("clube do demitido passa pela virada da IA", () => {
    // C34 (AC 30): the club a fired manager picks goes through the turn as an AI club.
    const before = ended(31, 0, 5);
    const oldId = before.userClubId!;
    const position = computeTable(before.leagues[0]!).findIndex((r) => r.clubId === oldId) + 1;
    before.boardGoal = position - 5;
    const pick = seasonReview(before).jobOffers[0]!;
    const dest = clubOf(before, pick);
    // Ten young players in their last season, which the AI renews (age 32 or less, written out),
    // and one of 34 in his last season, which it does not (L-007).
    const young = dest.players.slice(0, 10);
    for (const p of young) Object.assign(p, { age: 24, contractSeasons: 1 });
    const veteran = dest.players[10]!;
    Object.assign(veteran, { age: 34, contractSeasons: 1 });
    const { state } = nextSeason(before, pick);
    expect(state.userClubId).toBe(pick);
    const after = clubOf(state, pick);
    expect(after.players.length).toBeGreaterThanOrEqual(22);
    expect(clubOf(state, oldId).players.length).toBeGreaterThanOrEqual(22);
    for (const p of young) {
      const now = after.players.find((x) => x.id === p.id);
      expect(now, p.id).toBeDefined();
      expect(now!.contractSeasons, p.id).toBeGreaterThanOrEqual(1);
    }
    expect(after.players.some((x) => x.id === veteran.id)).toBe(false);
  });
});

describe("virada por país (paises)", () => {
  test("sobe e desce só no Brasil", () => {
    // C11 (AC 11).
    const before = ended();
    const { state } = nextSeason(before);
    const ids = (s: GameState, k: number) => new Set(s.leagues[k]!.clubs.map((c) => c.id));
    for (const k of [0, 1]) {
      const was = ids(before, k);
      const now = ids(state, k);
      expect(now.size).toBe(20);
      expect([...now].filter((id) => !was.has(id)), `liga ${k}`).toHaveLength(4);
    }
    for (const k of [2, 3]) expect(ids(state, k), `liga ${k}`).toEqual(ids(before, k));
  });

  test("histórico com as quatro ligas", () => {
    // C12 (AC 12).
    const { state } = nextSeason(ended());
    const record = state.history.at(-1)!;
    expect(record.divisions.map((d) => d.leagueId)).toEqual(["l1", "l2", "l3", "l4"]);
    for (const d of record.divisions) {
      expect(d.championId, d.leagueId).toMatch(/^c\d+$/);
      expect(d.topScorer, d.leagueId).not.toBeNull();
      expect(d.topScorer!.goals, d.leagueId).toBeGreaterThan(0);
    }
    for (const d of record.divisions.slice(2)) {
      expect(d.promotedIds, d.leagueId).toEqual([]);
      expect(d.relegatedIds, d.leagueId).toEqual([]);
    }
    const abroad = ended().leagues.slice(2);
    record.divisions.slice(2).forEach((d, i) => expect(abroad[i]!.clubs.map((c) => c.id), d.leagueId).toContain(d.championId));
  });
});

describe("livres na virada (correcoes-validacao)", () => {
  test("poda dos livres", () => {
    // C30 (AC 29): 300 free agents at 25 (the summer moves them by -1 to +2, AC 16): 80 rated 75
    // and 220 rated 60. No club player leaves, so only these compete.
    const before = ended();
    for (const c of all(before)) for (const p of c.players) Object.assign(p, { contractSeasons: 3, age: Math.min(p.age, 30) });
    const strong = Array.from({ length: 80 }, () => player(25, 75));
    const weak = Array.from({ length: 220 }, () => player(25, 60));
    before.market.freeAgents = [...weak.slice(0, 110), ...strong, ...weak.slice(110)];
    expect(before.market.freeAgents).toHaveLength(300);
    const { state } = nextSeason(before);
    expect(state.market.freeAgents).toHaveLength(80);
    const kept = new Set(state.market.freeAgents.map((p) => p.id));
    expect(kept).toEqual(new Set(strong.map((p) => p.id)));
    const pruned = weak.filter((p) => !kept.has(p.id));
    expect(pruned).toHaveLength(220);
    // The weakest kept is at least the strongest pruned could be after the summer: 60 + 2.
    expect(Math.min(...state.market.freeAgents.map((p) => p.rating))).toBeGreaterThanOrEqual(Math.max(...pruned.map((p) => p.rating)) + 2);
  });
});

describe("base na virada (correcoes-validacao)", () => {
  test("base repõe o elenco do usuário até 18", () => {
    // C16 (AC 15, L-007): 9 players rated 95 at 19 stay 95 after the summer (the cap), so the
    // squad's mean is a whole number; the academy's rule is the mean − 8 ± 4.
    const before = ended();
    const me = userOf(before);
    me.players = me.players.slice(0, 9).map((p) => ({ ...p, age: 19, rating: 95, contractSeasons: 3 }));
    const { state } = nextSeason(before);
    const after = userOf(state);
    expect(after.players).toHaveLength(18);
    const veterans = after.players.filter((p) => me.players.some((q) => q.id === p.id));
    expect(veterans).toHaveLength(9);
    const mean = veterans.reduce((sum, p) => sum + p.rating, 0) / veterans.length;
    const juniors = after.players.filter((p) => !veterans.includes(p));
    expect(juniors).toHaveLength(9);
    for (const j of juniors) {
      expect(j.id, j.id).toContain(`-y${state.season}-`);
      expect(j.id.startsWith(`${me.id}-y2-`), j.id).toBe(true);
      expect(j.rating, j.id).toBeGreaterThanOrEqual(mean - 12);
      expect(j.rating, j.id).toBeLessThanOrEqual(mean - 4);
    }

    // With 20 players, nobody comes up.
    const full = ended();
    const mine = userOf(full);
    mine.players = mine.players.slice(0, 20).map((p) => ({ ...p, age: 24, contractSeasons: 3 }));
    const twenty = userOf(nextSeason(full).state);
    expect(twenty.players).toHaveLength(20);
    expect(twenty.players.filter((p) => p.id.includes("-y2-"))).toEqual([]);
  });

  test("base estrangeira com nome do país", () => {
    // C41 (AC 37): an Argentine and a Portuguese club under 22 get juniors named after their country.
    const before = ended();
    const clubs = [before.leagues[2]!.clubs[0]!, before.leagues[3]!.clubs[0]!];
    for (const c of clubs) c.players = c.players.slice(0, 15).map((p) => ({ ...p, age: 24, contractSeasons: 3 }));
    const { state } = nextSeason(before);
    const alternatives = (list: readonly string[]) => list.filter((x) => x).join("|");
    for (const [c, country] of [[clubs[0]!, "AR"], [clubs[1]!, "PT"]] as const) {
      const parts = SURNAME_PARTS_BY_COUNTRY[country];
      const syllable = `(?:${alternatives(parts.onsets)})(?:${alternatives(parts.nuclei)})`;
      const surname = new RegExp(`^${syllable}(?:(?:${alternatives(parts.codas)})?${syllable})?(?:${alternatives(parts.endings)})?$`);
      const juniors = clubOf(state, c.id).players.filter((p) => p.id.startsWith(`${c.id}-y2-`));
      expect(juniors, country).toHaveLength(7);
      for (const j of juniors) {
        const [first, ...rest] = j.name.split(" ");
        expect(FIRST_NAMES_BY_COUNTRY[country], j.name).toContain(first);
        expect(FIRST_NAMES_BY_COUNTRY.BR, j.name).not.toContain(first);
        expect(rest.join(" ").toLowerCase(), j.name).toMatch(surname);
      }
    }
  });
});

describe("empréstimos na virada (emprestimos)", () => {
  /**
   * A finished season with P1 (the user's, 20 years old, 3 seasons left) starting for X on loan,
   * and P2 (Y's) starting for the user on loan.
   */
  function loans() {
    const s = ended();
    const me = userOf(s);
    const [x, y] = [s.leagues[0]!.clubs[4]!, s.leagues[0]!.clubs[9]!];
    const p1 = me.players.find((p) => p.position === "MF")!;
    Object.assign(p1, { age: 20, contractSeasons: 3, rating: 95 });
    me.players = me.players.filter((p) => p.id !== p1.id);
    me.lineup = { ...me.lineup!, starters: me.lineup!.starters.map((id) => (id === p1.id ? null : id)) };
    x.players.push({ ...p1, loanFrom: me.id });
    x.lineup = autoLineup(x, AI_FORMATION);
    expect(x.lineup.starters).toContain(p1.id);
    const p2 = y.players[0]!;
    y.players = y.players.slice(1);
    me.players.push({ ...p2, loanFrom: y.id });
    me.lineup.starters[me.lineup.starters.indexOf(null)] = p2.id;
    return { s, me, x, y, p1, p2 };
  }

  test("virada devolve os emprestados", () => {
    // C13 (door 3): back to the owner before ageing and contracts; nobody left on loan.
    const { s, me, x, y, p1, p2 } = loans();
    const { state } = nextSeason(s);
    const back = userOf(state).players.find((p) => p.id === p1.id);
    expect(back).toBeDefined();
    expect(back).not.toHaveProperty("loanFrom");
    expect(back).toMatchObject({ age: 21, contractSeasons: 2 });
    expect(clubOf(state, x.id).players.map((p) => p.id)).not.toContain(p1.id);
    expect(clubOf(state, x.id).lineup?.starters ?? []).not.toContain(p1.id);
    const home = clubOf(state, y.id).players.find((p) => p.id === p2.id);
    expect(home).toBeDefined();
    expect(home).not.toHaveProperty("loanFrom");
    expect(clubOf(state, me.id).players.map((p) => p.id)).not.toContain(p2.id);
    expect(clubOf(state, me.id).lineup?.starters ?? []).not.toContain(p2.id);
    expect(all(state).flatMap((c) => c.players).filter((p) => p.loanFrom !== undefined)).toEqual([]);
  });

  test("quem volta entra no relatório", () => {
    // C14: the user's player back from loan has his «Antes» row; the one who went home has none.
    const { s, p1, p2 } = loans();
    const start = p1.rating - (p1.ratingLog ?? []).reduce((sum, step) => sum + step.delta, 0);
    const { report } = nextSeason(s);
    expect(report.changes.find((c) => c.playerId === p1.id)?.before).toBe(start);
    expect(report.changes.map((c) => c.playerId)).not.toContain(p2.id);
  });

  test("troca de clube mantém o empréstimo", () => {
    // C15 (carreira-dinamica): the user leaves A for B mid-season; P1 goes back to A at the turn.
    let s = newGame(31);
    const a = s.leagues[0]!.clubs[2]!;
    s.userClubId = a.id;
    s.boardGoal = 20;
    for (let r = 0; r < 10; r++) {
      userOf(s).lineup = autoLineup(userOf(s), AI_FORMATION);
      zeroAiSurplus(s);
      s = playRound(s).state;
    }
    const x = s.leagues[0]!.clubs[6]!;
    const me = userOf(s);
    const p1 = me.players.find((p) => p.position === "DF")!;
    me.players = me.players.filter((p) => p.id !== p1.id);
    x.players.push({ ...p1, loanFrom: a.id });
    const b = s.leagues[0]!.clubs[12]!;
    s.pendingJob = { reason: "offer", clubIds: [b.id] };
    const moved = takeJob(s, b.id);
    if (!moved.ok) throw new Error("takeJob refused");
    s = moved.state;
    expect(s.userClubId).toBe(b.id);
    expect(clubOf(s, x.id).players.find((p) => p.id === p1.id)?.loanFrom).toBe(a.id);
    for (let r = 10; r < 38; r++) {
      userOf(s).lineup = autoLineup(userOf(s), AI_FORMATION);
      zeroAiSurplus(s);
      s = playRound(s).state;
    }
    s.boardGoal = 20;
    const { state } = nextSeason(s);
    expect(clubOf(state, a.id).players.map((p) => p.id)).toContain(p1.id);
    expect(clubOf(state, b.id).players.map((p) => p.id)).not.toContain(p1.id);
  }, 60_000);
});

describe("cobrador na virada (penaltis)", () => {
  test("cobrador na virada", () => {
    // C11 (AC 14): the user stays at the club, and the chosen taker stays in the lineup.
    const s = ended();
    const me = userOf(s);
    const taker = me.players.find((p) => p.position === "MF")!.id;
    me.lineup = { ...me.lineup!, penaltyTaker: taker };
    const next = nextSeason(s).state;
    expect(next.userClubId).toBe(s.userClubId);
    expect(userOf(next).lineup!.penaltyTaker).toBe(taker);
  });
});
