import { boardGoalFor, divisionAt, strengthRanking } from "./board";
import { nextCompetition, nextDate } from "./calendar";
import { boardAfterRound, managerReputation, reputationOffers, takeJob } from "./career";
import { finishCupDate, startCupDate } from "./cup";
import { newGame } from "./generate";
import { AI_FORMATION, autoLineup } from "./lineup";
import { startRound } from "./live";
import { createRng, mix32, shuffle } from "./rng";
import { nextSeason } from "./rollover";
import { finishRound, playDate, seasonReview } from "./season";
import { computeTable } from "./table";
import { atCupDate } from "./test-fixtures";
import type { Club, GameState, SeasonRecord, Verdict } from "./types";

const clubsOf = (s: GameState): Club[] => s.leagues.flatMap((l) => l.clubs);
const clubOf = (s: GameState, id: string): Club => clubsOf(s).find((c) => c.id === id)!;
const tableIds = (s: GameState, league: number): string[] => computeTable(s.leagues[league]!).map((r) => r.clubId);
const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

/** Played with no user until `round` league rounds are closed and the next date is a league round. */
const atRoundCache = new Map<string, GameState>();
function atRound(seed: number, round: number): GameState {
  const key = `${seed}:${round}`;
  if (!atRoundCache.has(key)) {
    let s = newGame(seed);
    while (!(s.leagues[0]!.currentRound === round && nextDate(s).kind === "league")) s = playDate(s).state;
    atRoundCache.set(key, s);
  }
  return copy(atRoundCache.get(key)!);
}

const seasonCache = new Map<number, GameState>();
function seasonOver(seed: number): GameState {
  if (!seasonCache.has(seed)) {
    let s = newGame(seed);
    while (nextDate(s).kind !== "over") s = playDate(s).state;
    seasonCache.set(seed, s);
  }
  return copy(seasonCache.get(seed)!);
}

/** Makes `clubId` the user's, with an auto-filled lineup. */
function asUser(s: GameState, clubId: string, boardGoal: number): GameState {
  s.userClubId = clubId;
  s.boardGoal = boardGoal;
  s.cupGoal = -1;
  const club = clubOf(s, clubId);
  club.lineup = autoLineup(club, AI_FORMATION);
  return s;
}

interface Past {
  verdict?: Verdict | null;
  league?: 0 | 1;
  title?: boolean;
  cups?: string[];
  noClub?: boolean;
}

/** A closed season, written out: the user's league is `leagues[league]`, titles only when asked. */
function record(s: Pick<GameState, "leagues">, season: number, past: Past): SeasonRecord {
  const clubId = "me";
  const leagueId = s.leagues[past.league ?? 0]!.id;
  return {
    season,
    userClubId: past.noClub ? null : clubId,
    userLeagueId: past.noClub ? null : leagueId,
    userPosition: past.noClub ? null : 1,
    verdict: past.noClub ? null : (past.verdict ?? "met"),
    prize: 0,
    divisions: s.leagues.map((l) => ({ leagueId: l.id, championId: past.title && l.id === leagueId ? clubId : "other", promotedIds: [], relegatedIds: [], topScorer: null })),
    cups: [
      { cupId: "cup-nat", championId: past.cups?.includes("cup-nat") ? clubId : "other", runnerUpId: "x", userReached: null },
      { cupId: "cup-cont", championId: past.cups?.includes("cup-cont") ? clubId : "other", runnerUpId: "x", userReached: null },
    ],
  };
}

/** 50 + 5 × 6 (met) + 4 (Série B title) + 6 (national cup) = 90. */
function reputation90(s: GameState): void {
  s.history = [1, 2, 3, 4, 5].map((season) => record(s, season, { league: season === 2 ? 1 : 0, title: season === 2, cups: season === 4 ? ["cup-nat"] : [] }));
}

describe("reputação do técnico (carreira-dinamica)", () => {
  test("reputação: tabela", () => {
    // C1 (L-005, L-007): every weight, the window of 5, a season without a club, floor and ceiling.
    const base = newGame(1);
    const rep = (history: Past[], career: GameState["career"] = undefined, season = 9) =>
      managerReputation({ leagues: base.leagues, season, career, history: history.map((p, i) => record(base, i + 1, p)) });
    expect(base.leagues[0]!.tier).toBe(0);
    expect(base.leagues[1]!.tier).toBe(1);
    expect(managerReputation({ leagues: base.leagues, season: 1, history: [] })).toBe(50);
    const rows: [Past[], number][] = [
      [[{ verdict: "met" }], 56],
      [[{ verdict: "missed" }], 47],
      [[{ verdict: "fired" }], 42],
      [[{ verdict: "met", league: 0, title: true }], 64],
      [[{ verdict: "met", league: 1, title: true }], 60],
      [[{ verdict: "met", cups: ["cup-nat"] }], 62],
      [[{ verdict: "met", cups: ["cup-cont"] }], 66],
      [[{}, {}, { title: true }], 76],
      [[{}, {}, {}, {}, {}, {}], 80],
      [[{}, { noClub: true }, {}], 62],
    ];
    for (const [history, expected] of rows) expect(rep(history), JSON.stringify(history)).toBe(expected);
    const move = (season: number, reason: "fired" | "offer") => ({ season, round: 13, fromId: "a", toId: "b", reason });
    expect(rep([], [move(9, "fired")])).toBe(42);
    expect(rep([], [move(8, "fired"), move(9, "offer")])).toBe(50);
    const fired: Past = { verdict: "fired" };
    expect(rep([fired, fired, fired, fired, fired], [move(9, "fired"), move(9, "fired")])).toBe(0);
    const best: Past = { verdict: "met", title: true, cups: ["cup-cont"] };
    expect(rep([best, best, best, best, best])).toBe(100);
  });
});

describe("a diretoria avisa e demite (carreira-dinamica)", () => {
  test("avisos da diretoria: tabela", () => {
    // C3 (L-005): the window's edges and the three firing zones; out of the zone resets.
    const base = atRound(3, 12);
    const a = tableIds(base, 0);
    const ar = tableIds(base, 2);
    expect(base.leagues[0]!.rounds.length).toBe(38);
    expect(base.leagues[2]!.name).toMatch(/Argentina/);
    const warnings = (clubId: string, goal: number, before: number | undefined, round: number) => {
      const s = asUser(copy(base), clubId, goal);
      if (before === undefined) delete s.boardWarnings;
      else s.boardWarnings = before;
      return boardAfterRound(s, round).boardWarnings;
    };
    // Goal 8, 13th: five below the goal.
    expect(warnings(a[12]!, 8, 1, 9)).toBe(0);
    expect(warnings(a[12]!, 8, 1, 10)).toBe(2);
    expect(warnings(a[12]!, 8, 1, 34)).toBe(2);
    expect(warnings(a[12]!, 8, 1, 35)).toBe(0);
    // Goal 8, 12th: four below, out of the zone.
    expect(warnings(a[11]!, 8, 2, 12)).toBe(0);
    // Série A, goal 16, 17th: the relegation zone.
    expect(warnings(a[16]!, 16, 0, 12)).toBe(1);
    // Liga Argentina (no relegation), goal 17, 20th: the last place.
    expect(warnings(ar[19]!, 17, 0, 12)).toBe(1);
    // Absent counts as 0.
    expect(warnings(a[12]!, 8, undefined, 12)).toBe(1);
  });

  test("quarta rodada demite", () => {
    // C4: the 3 clubs just below the user's in the ranking of every club.
    const base = atRound(3, 12);
    const me = tableIds(base, 0)[12]!;
    const s = asUser(copy(base), me, 8);
    s.boardWarnings = 3;
    const after = boardAfterRound(s, 12);
    const ranking = strengthRanking(clubsOf(base));
    const at = ranking.indexOf(me);
    expect(at + 4).toBeLessThanOrEqual(ranking.length);
    expect(after.pendingJob).toEqual({ reason: "fired", clubIds: ranking.slice(at + 1, at + 4) });
    expect(after.boardWarnings).toBe(0);
  });

  test("finishRound checa a diretoria", () => {
    // C5 (L-003, L-007): through the round's close; a cup date leaves the count alone.
    const before = asUser(atRound(3, 12), tableIds(atRound(3, 12), 0)[14]!, 1);
    before.boardWarnings = 3;
    const { state: after } = finishRound(before, startRound(before));
    expect(after.leagues[0]!.currentRound).toBe(13);
    expect(tableIds(after, 0).indexOf(before.userClubId!) + 1).toBeGreaterThan(5);
    expect(after.pendingJob?.reason).toBe("fired");

    const cupDay = atCupDate(6, 0, newGame(6).leagues[0]!.clubs[0]!.id);
    cupDay.boardWarnings = 2;
    const { state: cupAfter } = finishCupDate(cupDay, startCupDate(cupDay));
    expect(cupAfter.boardWarnings).toBe(2);
  });
});

describe("trocar de clube no meio da temporada (carreira-dinamica)", () => {
  /**
   * Seed 27 after 13 rounds: the 18th's goal by strength is 16, the 5th's is 12. Penaltis
   * (Superseded checks): seed 3 lost that table once penalties moved the scores; same values.
   */
  function firedAt13(): { s: GameState; table: string[] } {
    const s = atRound(27, 13);
    const table = tableIds(s, 0);
    s.season = 2;
    asUser(s, table[10]!, 8);
    s.boardWarnings = 2;
    s.pendingJob = { reason: "fired", clubIds: [table[17]!, table[4]!, table[0]!] };
    const old = clubOf(s, table[10]!);
    old.training = "hard";
    old.forSale = [old.players[3]!.id];
    s.market.offers = [{ id: "o1", buyerId: table[1]!, playerId: old.players[3]!.id, amount: 1_000 }];
    return { s, table };
  }

  test("assumir no meio da temporada", () => {
    // C9: user, mark, warnings, career, the old club, the new lineup, the goals.
    const { s, table } = firedAt13();
    const rank = strengthRanking(s.leagues[0]!.clubs);
    const goalByStrength = (id: string) => boardGoalFor(divisionAt(s.leagues, 0), rank.indexOf(id) + 1);
    expect(goalByStrength(table[17]!)).toBe(16);
    expect(goalByStrength(table[4]!)).toBe(12);

    const r = takeJob(s, table[17]!);
    if (!r.ok) throw new Error("refused");
    const got = r.state;
    expect(got.userClubId).toBe(table[17]);
    expect("pendingJob" in got).toBe(false);
    expect(got.boardWarnings).toBe(0);
    expect(got.career).toEqual([{ season: 2, round: 13, fromId: table[10], toId: table[17], reason: "fired" }]);
    const old = clubOf(got, table[10]!);
    expect(old.lineup).toBeNull();
    expect("training" in old).toBe(false);
    expect(old.forSale).toEqual([]);
    expect(got.market.offers).toEqual([]);
    const expectedLineup = autoLineup(clubOf(s, table[17]!), AI_FORMATION, "balanced", 0, nextCompetition({ ...s, userClubId: table[17]! }));
    expect(clubOf(got, table[17]!).lineup).toEqual(expectedLineup);
    expect(got.boardGoal).toBe(18);
    expect(got.cupGoal).toBe(-1);

    const fifth = takeJob(s, table[4]!);
    if (!fifth.ok) throw new Error("refused");
    expect(fifth.state.boardGoal).toBe(12);

    // AC 10: an offer taken mid-season is recorded with its own reason.
    const offered = copy(s);
    offered.pendingJob = { reason: "offer", clubIds: [table[4]!] };
    const moved = takeJob(offered, table[4]!);
    if (!moved.ok) throw new Error("refused");
    expect(moved.state.career).toEqual([{ season: 2, round: 13, fromId: table[10], toId: table[4], reason: "offer" }]);
  });

  test("assumir clube fora da lista", () => {
    // C10 (L-007): an id out of the list, the user's own club, no pending offer.
    const { s, table } = firedAt13();
    const before = JSON.stringify(s);
    expect(takeJob(s, table[2]!)).toEqual({ ok: false });
    expect(takeJob(s, table[10]!)).toEqual({ ok: false });
    const none = copy(s);
    delete none.pendingJob;
    expect(takeJob(none, table[17]!)).toEqual({ ok: false });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("propostas de clubes melhores (carreira-dinamica)", () => {
  test("propostas por reputação", () => {
    // C12 (L-006): ceiling, the window of 8, the draw on its own stream, no candidate, one candidate.
    const s = newGame(1);
    const ranking = strengthRanking(clubsOf(s));
    expect(ranking.length).toBe(80);
    reputation90(s);
    expect(managerReputation(s)).toBe(90);
    s.userClubId = ranking[29]!;
    const rngState = s.rngState;
    const offers = reputationOffers(s, 19);
    const window = ranking.slice(7, 15);
    expect(offers).toEqual(shuffle(createRng(mix32(mix32(rngState, 0xca), s.season * 64 + 19)), window).slice(0, 2));
    expect(offers).toHaveLength(2);
    expect(new Set(offers).size).toBe(2);
    for (const id of offers) expect(window).toContain(id);
    expect(offers).not.toContain(ranking[6]);
    expect(offers).not.toContain(ranking[15]);
    expect(s.rngState).toBe(rngState);

    const unknown = copy(s);
    unknown.history = [];
    expect(managerReputation(unknown)).toBe(50);
    expect(reputationOffers(unknown, 19)).toEqual([]);

    const famous = copy(s);
    famous.history = [1, 2, 3, 4, 5].map((season) => record(s, season, { title: true, cups: ["cup-cont"] }));
    expect(managerReputation(famous)).toBe(100);
    const top = reputationOffers(famous, 19);
    expect(top.length).toBe(2);
    for (const id of top) expect(ranking.slice(0, 8)).toContain(id);

    const ninth = copy(s);
    ninth.userClubId = ranking[8]!;
    expect(reputationOffers(ninth, 19)).toEqual([ranking[7]]);
  });

  test("proposta na rodada do meio", () => {
    // C13 (L-003, L-007): through finishRound, only at round 19, only on target, only with a candidate.
    const s17 = atRound(3, 17);
    reputation90(s17);
    asUser(s17, strengthRanking(clubsOf(s17))[29]!, 20);
    const next = (s: GameState) => finishRound(s, startRound(s)).state;

    const s18 = next(s17);
    expect(s18.leagues[0]!.currentRound).toBe(18);
    expect(s18.pendingJob).toBeUndefined();

    const s19 = next(s18);
    expect(s19.leagues[0]!.currentRound).toBe(19);
    const expected = reputationOffers(s19, 19);
    expect(expected.length).toBeGreaterThan(0);
    expect(s19.pendingJob).toEqual({ reason: "offer", clubIds: expected });

    const s20 = next(s19);
    expect(s20.leagues[0]!.currentRound).toBe(20);
    expect(s20.pendingJob).toBeUndefined();

    const missed = copy(s18);
    missed.boardGoal = 0;
    expect(next(missed).pendingJob).toBeUndefined();

    const unknown = copy(s18);
    unknown.history = [];
    expect(next(unknown).pendingJob).toBeUndefined();

    const fired = copy(s18);
    const firedJob = { reason: "fired" as const, clubIds: strengthRanking(clubsOf(s18)).slice(40, 43) };
    fired.pendingJob = firedJob;
    expect(next(fired).pendingJob).toEqual(firedJob);
  });

  test("jogar recusa a proposta", () => {
    // C14: a league date and a cup date turn the offer down; the club stays.
    const league = asUser(atRound(3, 12), tableIds(atRound(3, 12), 0)[3]!, 20);
    league.pendingJob = { reason: "offer", clubIds: [tableIds(league, 0)[0]!] };
    const afterLeague = finishRound(league, startRound(league)).state;
    expect(afterLeague.pendingJob).toBeUndefined();
    expect(afterLeague.userClubId).toBe(league.userClubId);

    const me = newGame(6).leagues[0]!.clubs[0]!.id;
    const cup = atCupDate(6, 0, me);
    cup.pendingJob = { reason: "offer", clubIds: [cup.leagues[0]!.clubs[1]!.id] };
    const afterCup = finishCupDate(cup, startCupDate(cup)).state;
    expect(afterCup.pendingJob).toBeUndefined();
    expect(afterCup.userClubId).toBe(me);
  });

  test("propostas da virada", () => {
    // C16: met brings the offers of round 38, missed none, fired the board's 3; the turn records the move.
    const end = seasonOver(3);
    const ranking = strengthRanking(clubsOf(end));
    const met = asUser(copy(end), ranking[29]!, 20);
    reputation90(met);
    const review = seasonReview(met);
    expect(review.user?.verdict).toBe("met");
    const offers = reputationOffers(met, 38);
    expect(offers.length).toBeGreaterThan(0);
    expect(review.jobOffers).toEqual(offers);

    const sixth = tableIds(end, 0)[5]!;
    const missed = asUser(copy(end), sixth, 5);
    reputation90(missed);
    expect(seasonReview(missed).user?.verdict).toBe("missed");
    expect(seasonReview(missed).jobOffers).toEqual([]);

    const fired = asUser(copy(end), sixth, 1);
    const firedReview = seasonReview(fired);
    expect(firedReview.user?.verdict).toBe("fired");
    const at = ranking.indexOf(sixth);
    expect(firedReview.jobOffers).toEqual(ranking.slice(at + 1, at + 4));

    const taken = nextSeason(met, offers[0]).state;
    expect(taken.userClubId).toBe(offers[0]);
    expect(taken.career).toEqual([{ season: met.season, round: 38, fromId: ranking[29], toId: offers[0], reason: "offer" }]);

    const stayed = nextSeason(met).state;
    expect(stayed.userClubId).toBe(ranking[29]);
    expect(stayed.career ?? []).toEqual([]);

    const firedTurn = nextSeason(fired, firedReview.jobOffers[0]).state;
    expect(firedTurn.career).toEqual([{ season: fired.season, round: 38, fromId: sixth, toId: firedReview.jobOffers[0], reason: "fired" }]);

    const outsider = ranking.find((id) => id !== met.userClubId && !offers.includes(id))!;
    expect(() => nextSeason(met, outsider)).toThrow();
  }, 60_000);
});

describe("saves de antes (carreira-dinamica)", () => {
  test("save antigo sem os campos", () => {
    // C19: a v8 game without the three fields plays its 38 rounds and turns.
    let s = newGame(8);
    const club = s.leagues[0]!.clubs[0]!;
    asUser(s, club.id, 8);
    expect(s.schemaVersion).toBe(8);
    for (const key of ["boardWarnings", "pendingJob", "career"]) expect(key in s).toBe(false);
    while (nextDate(s).kind !== "over") s = playDate(s).state;
    expect(s.leagues[0]!.currentRound).toBe(38);
    const review = seasonReview(s);
    const turned = nextSeason(s, review.user?.verdict === "fired" ? review.jobOffers[0] : undefined).state;
    expect(turned.season).toBe(s.season + 1);
  }, 60_000);
});
