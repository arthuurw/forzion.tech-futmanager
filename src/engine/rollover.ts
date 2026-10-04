/**
 * The turn of the season (S2-S6 of multiplas-temporadas): promotion and relegation, history,
 * evolution, retirements, contracts, refilled squads, new schedules and the board's new goal.
 * Everything is drawn from the rollover's own Rng (door 3).
 */
import { userBoardGoal, userCupGoal } from "./board";
import { leaveClub } from "./career";
import { NATIONAL_CUP_ID, continentalFromTables, countryLookup, newContinentalCup, newCup } from "./cup";
import { salaryFor } from "./finance";
import { generateJuniors, generateSchedule, makePlayer, takenNames } from "./generate";
import { AI_FORMATION, autoLineup } from "./lineup";
import { CONTRACT_JUNIOR, SQUAD_MIN, endLoans } from "./market";
import { generatePlayerName, uniqueName } from "./names";
import { createRng, mix32, randInt, shuffle, type Rng } from "./rng";
import { allClubs, seasonReview, type SeasonReview } from "./season";
import { evolutionRange } from "./training";
import { POSITIONS, RATING_MAX, RATING_MIN, type Club, type Country, type GameState, type Player, type Position, type SeasonRecord } from "./types";

/** Door 3. */
const ROLLOVER_SALT = 0x5e45;

/** AC 18: chance of retiring by age after the birthday; everyone from 36. */
const RETIREMENT: Readonly<Record<number, number>> = { 34: 0.2, 35: 0.5 };
const RETIRE_ALWAYS_FROM = 36;
/** AC 28: AI clubs renew the last year of players up to this age at the end of the season. */
const AI_RENEW_MAX_AGE = 32;
const AI_RENEW_SEASONS = { min: 1, max: 3 } as const;
/** AC 19. */
const AI_SQUAD_TARGET = 22;
const AI_JUNIOR_AGE = { min: 18, max: 20 } as const;
const AI_JUNIOR_BELOW_MEAN = 8;
const AI_JUNIOR_SPREAD = 4;
/** AC 20. */
const FREE_AGENTS_TARGET = 40;
/** Correcoes-validacao AC 29: after the turn, only this many free agents stay, the strongest. */
const FREE_AGENTS_MAX = 80;
const NEW_FREE_AGENT_AGE = { min: 19, max: 31 } as const;
const NEW_FREE_AGENT_RATING = { min: 45, max: 70 } as const;

export interface RatingChange {
  playerId: string;
  name: string;
  position: Position;
  before: number;
  after: number;
}

/** What the «Nova temporada» screen shows (AC 14). In memory only. */
export interface RolloverReport {
  season: number;
  retired: { id: string; name: string }[];
  expired: { id: string; name: string }[];
  changes: RatingChange[];
  divisionIndex: number;
  boardGoal: number;
  /** Copa-nacional AC 40. */
  cupGoal: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}


function retires(rng: Rng, age: number): boolean {
  if (age >= RETIRE_ALWAYS_FROM) return true;
  const chance = RETIREMENT[age];
  return chance !== undefined && rng.next() < chance;
}

/**
 * AC 12, 17, 18, 37: one player through the summer. Returns null when they retire.
 * Stats go to the career; condition is fresh except injury and morale. Treino-evolucao AC 9: the
 * rating moved during the season, so the age's draw is made and dropped, and the rest of the turn
 * draws as before.
 */
function ageOneSeason(rng: Rng, p: Player): Player | null {
  const { min, max } = evolutionRange(p.age);
  randInt(rng, min, max);
  const age = p.age + 1;
  if (retires(rng, age)) return null;
  return {
    ...p,
    age,
    fitness: 100,
    yellowCards: 0,
    suspendedRounds: 0,
    idleRounds: 0,
    careerGames: p.careerGames + p.seasonGames,
    careerGoals: p.careerGoals + p.seasonGoals,
    seasonGames: 0,
    seasonGoals: 0,
  };
}

function thinnestPosition(players: readonly Player[]): Position {
  const count = (pos: Position) => players.filter((p) => p.position === pos).length;
  return [...POSITIONS].sort((a, b) => count(a) - count(b))[0]!;
}

/**
 * AC 19: an AI club under 22 gets juniors from its own academy, thinnest position first.
 * Correcoes-validacao AC 15: the user's club too, up to 18. AC 37: named like the players of the
 * league's country.
 */
function refillFromAcademy(rng: Rng, club: Club, season: number, taken: Set<string>, country: Country, target: number): void {
  const mean = club.players.reduce((sum, p) => sum + p.rating, 0) / Math.max(1, club.players.length);
  let n = 0;
  while (club.players.length < target) {
    const position = thinnestPosition(club.players);
    const name = uniqueName(rng, taken, (r) => generatePlayerName(r, country));
    const age = randInt(rng, AI_JUNIOR_AGE.min, AI_JUNIOR_AGE.max);
    const rating = clamp(Math.round(mean) - AI_JUNIOR_BELOW_MEAN + randInt(rng, -AI_JUNIOR_SPREAD, AI_JUNIOR_SPREAD), RATING_MIN, RATING_MAX);
    club.players.push(makePlayer(`${club.id}-y${season}-${++n}`, name, position, age, rating, CONTRACT_JUNIOR));
  }
}

/** AC 20: new free agents until there are 40, thinnest position first. */
function topUpFreeAgents(rng: Rng, state: GameState, season: number, taken: Set<string>): void {
  let n = 0;
  while (state.market.freeAgents.length < FREE_AGENTS_TARGET) {
    const position = thinnestPosition(state.market.freeAgents);
    const name = uniqueName(rng, taken, generatePlayerName);
    const age = randInt(rng, NEW_FREE_AGENT_AGE.min, NEW_FREE_AGENT_AGE.max);
    const rating = randInt(rng, NEW_FREE_AGENT_RATING.min, NEW_FREE_AGENT_RATING.max);
    state.market.freeAgents.push(makePlayer(`fa-s${season}-${++n}`, name, position, age, rating));
  }
}

/**
 * Copa-nacional AC 6: the new season's seeding from the final tables. In the upper division the
 * clubs that stayed (by its table), then the promoted (by the lower table); in the lower one the
 * relegated (by the upper table), then the clubs that stayed (by its table).
 */
export function seedingFromTables(review: Pick<SeasonReview, "divisions">): string[] {
  return review.divisions.flatMap((d, i) => {
    const above = review.divisions[i - 1];
    const below = review.divisions[i + 1];
    const leaving = new Set([...d.relegatedIds, ...d.promotedIds]);
    const stayed = d.table.map((r) => r.clubId).filter((id) => !leaving.has(id));
    return [...(above?.relegatedIds ?? []), ...stayed, ...(below?.promotedIds ?? [])];
  });
}

/** Drops players who left from a lineup and a sale list. */
function forgetDeparted(club: Club): void {
  const here = new Set(club.players.map((p) => p.id));
  club.forSale = club.forSale.filter((id) => here.has(id));
  if (club.lineup) club.lineup = { ...club.lineup, starters: club.lineup.starters.map((id) => (id && here.has(id) ? id : null)) };
}

/**
 * «Próxima temporada» (AC 10-35). `jobClubId` is the offer a fired user picked (AC 35); it is
 * required then and ignored otherwise. Pure: returns a new state and what changed for the user.
 */
export function nextSeason(input: GameState, jobClubId?: string): { state: GameState; report: RolloverReport } {
  const review = seasonReview(input);
  const fired = review.user?.verdict === "fired";
  if (fired && !jobClubId) throw new Error("a fired manager must pick one of the job offers");
  // Carreira-dinamica AC 21: a met goal may bring offers too; any pick must be one of them.
  if (jobClubId && !review.jobOffers.includes(jobClubId)) throw new Error("the club picked is not one of the job offers");
  const moved = !!jobClubId && !!input.userClubId;
  const state = JSON.parse(JSON.stringify(input)) as GameState;
  const season = input.season + 1;
  const rng = createRng(mix32(input.rngState, ROLLOVER_SALT + input.season));

  // AC 38: the season goes to the history before anything moves.
  const record: SeasonRecord = {
    season: input.season,
    userClubId: input.userClubId,
    userLeagueId: review.user ? (review.divisions[review.user.divisionIndex]?.leagueId ?? null) : null,
    userPosition: review.user?.position ?? null,
    verdict: review.user?.verdict ?? null,
    prize: review.user?.prize ?? 0,
    // Copa-nacional AC 48.
    cups: review.cups.flatMap((c) =>
      c.championId && c.runnerUpId ? [{ cupId: c.cupId, championId: c.championId, runnerUpId: c.runnerUpId, userReached: c.userReached }] : [],
    ),
    divisions: review.divisions.map((d) => ({
      leagueId: d.leagueId,
      championId: d.championId,
      promotedIds: d.promotedIds,
      relegatedIds: d.relegatedIds,
      topScorer: d.topScorer ? { name: d.topScorer.name, clubName: d.topScorer.clubName, goals: d.topScorer.goals } : null,
    })),
  };
  state.history = [...state.history, record];
  // Emprestimos door 3: every loan ends before anyone ages, retires or comes to the end of a contract.
  endLoans(state);

  // AC 10, door 4: 4 down from each division, 4 up from the one below, appended in table order.
  // Paises AC 11: the one below is the next tier of the same country; a country's only league stays.
  for (const [i, upper] of state.leagues.entries()) {
    const j = state.leagues.findIndex((l) => l.country === upper.country && l.tier === upper.tier + 1);
    const lower = state.leagues[j];
    if (!lower) continue;
    const down = review.divisions[i]!.relegatedIds;
    const up = review.divisions[j]!.promotedIds;
    const goingDown = down.map((id) => upper.clubs.find((c) => c.id === id)!);
    const goingUp = up.map((id) => lower.clubs.find((c) => c.id === id)!);
    upper.clubs = [...upper.clubs.filter((c) => !down.includes(c.id)), ...goingUp];
    lower.clubs = [...lower.clubs.filter((c) => !up.includes(c.id)), ...goingDown];
  }

  // AC 35: a fired manager takes the club they picked; the old one is the AI's now.
  // Carreira-dinamica AC 21, AC 22: so does one who took an offer, and the move is recorded.
  if (moved) {
    const old = allClubs(state).find((c) => c.id === input.userClubId);
    if (old) leaveClub(old);
    const rounds = state.leagues[review.user!.divisionIndex]!.rounds.length;
    state.career = [...(state.career ?? []), { season: input.season, round: rounds, fromId: input.userClubId!, toId: jobClubId!, reason: fired ? "fired" : "offer" }];
  }
  // Paises AC 30: after a sacking both clubs go through the turn as AI clubs (renewals and the
  // academy); the manager takes the new club only after it.
  const userId = moved ? jobClubId! : state.userClubId;
  const managed = moved ? null : userId;
  // Treino-evolucao AC 17: «Antes» is the rating at the start of the season, before its log.
  const seasonStart = (p: Player) => p.rating - (p.ratingLog ?? []).reduce((sum, step) => sum + step.delta, 0);
  const userBefore = new Map((allClubs(state).find((c) => c.id === userId)?.players ?? []).map((p) => [p.id, seasonStart(p)]));
  const retired: RolloverReport["retired"] = [];
  const expired: RolloverReport["expired"] = [];

  // AC 16-18, 27, 28, 37: every player at a club.
  for (const club of allClubs(state)) {
    const isUser = club.id === managed;
    const reported = club.id === userId;
    const stay: Player[] = [];
    for (const p of club.players) {
      const next = ageOneSeason(rng, p);
      if (!next) {
        if (reported) retired.push({ id: p.id, name: p.name });
        continue;
      }
      if (next.contractSeasons > 1) {
        stay.push({ ...next, contractSeasons: next.contractSeasons - 1 });
      } else if (!isUser && p.age <= AI_RENEW_MAX_AGE) {
        stay.push({ ...next, contractSeasons: randInt(rng, AI_RENEW_SEASONS.min, AI_RENEW_SEASONS.max), salary: salaryFor(next.rating) });
      } else {
        if (reported) expired.push({ id: p.id, name: p.name });
        state.market.freeAgents.push({ ...next, contractSeasons: 0 });
      }
    }
    club.players = stay;
    forgetDeparted(club);
  }
  // Free agents age too; the ones who just left their club already did.
  const leaving = new Set(allClubs(input).flatMap((c) => c.players.map((p) => p.id)));
  state.market.freeAgents = state.market.freeAgents.flatMap((p) => {
    if (leaving.has(p.id)) return [p];
    const next = ageOneSeason(rng, p);
    return next ? [next] : [];
  });

  // Correcoes-validacao AC 29: the list keeps the strongest 80, ties by id, in its own order.
  const kept = new Set(
    [...state.market.freeAgents]
      .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
      .slice(0, FREE_AGENTS_MAX)
      .map((p) => p.id),
  );
  state.market.freeAgents = state.market.freeAgents.filter((p) => kept.has(p.id));

  const taken = takenNames(state);
  for (const league of state.leagues) {
    for (const club of league.clubs) refillFromAcademy(rng, club, season, taken, league.country, club.id === managed ? SQUAD_MIN : AI_SQUAD_TARGET);
  }
  topUpFreeAgents(rng, state, season, taken);
  state.userClubId = userId;

  // AC 11, 13: new market window with 3 juniors, no offers; money, stadium and loans untouched.
  state.market.offers = [];
  // Gastos-da-ia AC 18: the transfer list only keeps the current season.
  state.market.transfers = [];
  state.market.juniors = generateJuniors(rng, takenNames(state), season, 1);
  for (const league of state.leagues) {
    league.rounds = generateSchedule(shuffle(rng, league.clubs.map((c) => c.id)));
    league.currentRound = 0;
  }

  const user = allClubs(state).find((c) => c.id === userId);
  if (user) user.lineup = autoLineup(user, (!moved && user.lineup?.formation) || AI_FORMATION);
  if (user && !moved && input.leagues.length) {
    const before = allClubs(input).find((c) => c.id === userId)?.lineup;
    // Penaltis AC 14: the chosen penalty taker stays with the club.
    if (before && user.lineup) user.lineup = { ...user.lineup, posture: before.posture, ...(before.penaltyTaker ? { penaltyTaker: before.penaltyTaker } : {}) };
  }

  // Copa-nacional AC 49: cup discipline starts clean for everyone.
  for (const p of [...allClubs(state).flatMap((c) => c.players), ...state.market.freeAgents, ...state.market.juniors]) {
    p.cupDiscipline = {};
    // Treino-evolucao AC 9: the season's rating log starts empty.
    delete p.ratingLog;
  }

  state.season = season;
  state.boardGoal = userBoardGoal(state);
  // Carreira-dinamica: the board starts the season patient.
  state.boardWarnings = 0;
  delete state.pendingJob;
  const advance = createRng(input.rngState);
  advance.next();
  state.rngState = advance.getState();
  // Copa-nacional AC 6, AC 11: the new cup, its preliminary drawn from the new season's state (door 3).
  // Paises AC 10: the national cup is only for the clubs of Brazil.
  const brazil = review.divisions.filter((_, i) => input.leagues[i]!.country === "BR");
  // Copa-continental AC 3-6: the continental cup from the final tables and the national cup's champion.
  const tables = new Map(review.divisions.map((d) => [d.leagueId, d.table.map((r) => r.clubId)]));
  const nationalChampion = review.cups.find((c) => c.cupId === NATIONAL_CUP_ID)?.championId ?? null;
  state.cups = [
    newCup(seedingFromTables({ divisions: brazil }), state.rngState),
    newContinentalCup(continentalFromTables(input.leagues, tables, nationalChampion), countryLookup(state.leagues), state.rngState),
  ];
  state.cupGoal = userCupGoal(state);

  const divisionIndex = userId ? state.leagues.findIndex((l) => l.clubs.some((c) => c.id === userId)) : -1;
  const changes = (user?.players ?? [])
    .filter((p) => userBefore.has(p.id))
    .map((p) => ({ playerId: p.id, name: p.name, position: p.position, before: userBefore.get(p.id)!, after: p.rating }));
  return { state, report: { season, retired, expired, changes, divisionIndex, boardGoal: state.boardGoal, cupGoal: state.cupGoal } };
}
