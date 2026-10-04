/**
 * Door 3 of partida-ao-vivo: the match engine as a one-minute step.
 * A LiveRound lives in memory only (door 4); every match has its own Rng (door 2).
 */
import { aiLineup, formationSlots, isAvailableFor } from "./lineup";
import { createRng, mix32, randInt, type Rng } from "./rng";
import { effectiveRating } from "./strength";
import { TRAINING_INJURY } from "./training";
import {
  LEAGUE,
  type Club,
  type Competition,
  type Condition,
  type FormationName,
  type GameState,
  type Goal,
  type League,
  type MatchEvent,
  type MatchResult,
  type PlayerCore,
  type Position,
  type Posture,
  type Training,
} from "./types";

export const MAX_SUBS = 5;
export const MATCH_MINUTES = 90;
export const HALFTIME = 45;

// Tunables. Calibrated by src/engine/balance.test.ts.
const HOME_MIDFIELD_BONUS = 1.2;
const HOME_ATTACK_BONUS = 1.08;
const BASE_CHANCE_PER_MINUTE = 0.14;
const ON_TARGET = 0.55;
const BASE_GOAL_ON_TARGET = 0.39;
const SCORER_WEIGHT: Record<Position, number> = { GK: 0.05, DF: 0.5, MF: 2, FW: 5 };
const CREATE: Record<Posture, number> = { defensive: 0.8, balanced: 1, attacking: 1.25 };
const CONCEDE: Record<Posture, number> = { defensive: 0.75, balanced: 1, attacking: 1.12 };
const YELLOW_PER_SIDE_MINUTE = 0.024;
const DIRECT_RED_PER_SIDE_MINUTE = 0.0004;
const BOOKED_CAUTION = 0.2;
const CARD_WEIGHT: Record<Position, number> = { GK: 0.2, DF: 3, MF: 2, FW: 1 };
const INJURY_PER_SIDE_MINUTE = 0.00125;
const DRAIN_PER_MINUTE = 0.15;
const DRAIN_PER_MINUTE_VETERAN = 0.2;
const VETERAN_AGE = 30;
const AI_TIRED_FITNESS = 60;
const AI_TIRED_FROM_MINUTE = 60;
/**
 * Correcoes-validacao AC 41: a sector's strength grows with its slots, as the square root of the
 * slots over the 4-4-2's (4 DF, 4 MF, 2 FW), so a 4-4-2 plays exactly as before.
 */
const SECTOR_REFERENCE: Record<Position, number> = { GK: 1, DF: 4, MF: 4, FW: 2 };
const SECTOR_EXPONENT = 0.5;
/** Penaltis AC 1, AC 4: the share of chances that become a penalty, and of missed kicks the keeper saves. */
export const PENALTY_PER_CHANCE = 0.025;
export const PENALTY_SAVED_SHARE = 0.6;

export type LivePlayer = PlayerCore & Partial<Condition>;

export type Vacancy = "injury" | "red";

export interface VacantSlot {
  why: Vacancy;
  /** Who left the slot. */
  playerId: string;
  /**
   * Posicao-na-substituicao C8: the sector the hole was moved to by a substitution. Absent = the
   * sector of who left (correcoes-validacao AC 43).
   */
  pos?: Position;
}

export interface LiveSide {
  clubId: string;
  isUser: boolean;
  /** Treino-evolucao AC 12: the club's training; absent = Normal. */
  training?: Training;
  /** Penaltis AC 15: the user's chosen taker; absent = the automatic order. */
  penaltyTaker?: string;
  formation: FormationName | null;
  /** Position each slot asks for. */
  slotPos: Position[];
  /** Player id per slot, or null when the slot is empty. */
  slots: (string | null)[];
  /** Why an empty slot is empty and who left it, by slot index. */
  vacancy: Record<number, VacantSlot>;
  posture: Posture;
  /** Players who can still come on. */
  bench: string[];
  subsUsed: number;
  subbedOff: string[];
  sentOff: string[];
  /** Injured in this match -> rounds out. */
  injured: Record<string, number>;
  /** Yellow cards in this match. */
  yellows: Record<string, number>;
  /** Live fitness of everyone who has been on the pitch. */
  fitness: Record<string, number>;
  /** Everyone who entered the pitch, in order. */
  played: string[];
}

export interface LiveMatch {
  matchId: string;
  /** The division the match belongs to; match ids repeat across divisions. */
  leagueId: string;
  home: LiveSide;
  away: LiveSide;
  homeGoals: number;
  awayGoals: number;
  goals: Goal[];
  events: MatchEvent[];
  rngState: number;
  /** Copa-nacional AC 12: a level score at 90' goes to penalties. */
  knockout?: boolean;
  /** The shoot-out score, when there was one. */
  penalties?: { home: number; away: number } | null;
}

export interface LiveRound {
  /** Index into each league's rounds; both divisions play the same round. */
  roundIndex: number;
  roundNumber: number;
  /** Last minute simulated, 0 before kick-off. */
  minute: number;
  userClubId: string | null;
  matches: LiveMatch[];
  /** Snapshot of every player in the round. */
  players: Record<string, LivePlayer>;
  /** Set when the date is a cup phase instead of a league round (copa-nacional). */
  cup?: { cupIndex: number; phase: number };
}

// ---------- building sides ----------

export function makeSide(
  clubId: string,
  slotPos: Position[],
  slots: (string | null)[],
  bench: string[],
  players: Record<string, LivePlayer>,
  opts: { formation?: FormationName | null; posture?: Posture; isUser?: boolean; training?: Training; penaltyTaker?: string } = {},
): LiveSide {
  const fitness: Record<string, number> = {};
  const played: string[] = [];
  for (const id of slots) {
    if (!id) continue;
    fitness[id] = players[id]?.fitness ?? 100;
    played.push(id);
  }
  return {
    clubId,
    isUser: opts.isUser ?? false,
    ...(opts.training ? { training: opts.training } : {}),
    ...(opts.penaltyTaker ? { penaltyTaker: opts.penaltyTaker } : {}),
    formation: opts.formation ?? null,
    slotPos,
    slots: [...slots],
    vacancy: {},
    posture: opts.posture ?? "balanced",
    bench: [...bench],
    subsUsed: 0,
    subbedOff: [],
    sentOff: [],
    injured: {},
    yellows: {},
    fitness,
    played,
  };
}

export function makeMatch(matchId: string, home: LiveSide, away: LiveSide, rngState: number, leagueId = "l1"): LiveMatch {
  return { matchId, leagueId, home, away, homeGoals: 0, awayGoals: 0, goals: [], events: [], rngState };
}

function sideOf(m: LiveMatch, clubId: string): LiveSide | null {
  if (m.home.clubId === clubId) return m.home;
  if (m.away.clubId === clubId) return m.away;
  return null;
}

// ---------- strength ----------

export interface Strength {
  gk: number;
  def: number;
  mid: number;
  att: number;
}

/**
 * Correcoes-validacao AC 38: the keeper in the GK slot; with that slot empty, the best outfield
 * player on the pitch in goal, out of position (× 0,75).
 */
export function keeperStrength(side: LiveSide, players: Record<string, LivePlayer>): number {
  const inGoal = (id: string) => {
    const p = players[id];
    return p ? effectiveRating(p, "GK", side.fitness[id] ?? p.fitness ?? 100) : 0;
  };
  const keeper = onPitch(side).find((o) => o.pos === "GK");
  if (keeper) return inGoal(keeper.id);
  return Math.max(0, ...onPitch(side).map((o) => inGoal(o.id)));
}

/**
 * Sector strength = sum of effective ratings / slots the formation gives that sector, an empty slot
 * counting 0, × √(slots / the 4-4-2's slots) (correcoes-validacao AC 41). The keeper is
 * `keeperStrength`.
 */
export function sideStrength(side: LiveSide, players: Record<string, LivePlayer>): Strength {
  const sum: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const count: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  side.slotPos.forEach((pos, i) => {
    count[pos]++;
    const id = side.slots[i];
    const p = id ? players[id] : undefined;
    if (id && p) sum[pos] += effectiveRating(p, pos, side.fitness[id] ?? p.fitness ?? 100);
  });
  const sector = (pos: Position) => (count[pos] ? (sum[pos] / count[pos]) * (count[pos] / SECTOR_REFERENCE[pos]) ** SECTOR_EXPONENT : 0);
  const gk = keeperStrength(side, players);
  const def = sector("DF");
  const mid = sector("MF");
  const att = sector("FW");
  const floor = (n: number) => Math.max(n, 20);
  return {
    gk: floor(gk * 0.7 + def * 0.3),
    def: floor(def * 0.75 + mid * 0.25),
    mid: floor(mid),
    att: floor(att * 0.7 + mid * 0.3),
  };
}

function onPitch(side: LiveSide): { id: string; slot: number; pos: Position }[] {
  const out: { id: string; slot: number; pos: Position }[] = [];
  side.slots.forEach((id, slot) => {
    if (id) out.push({ id, slot, pos: side.slotPos[slot] as Position });
  });
  return out;
}

function weightedPick<T>(rng: Rng, items: T[], weight: (t: T) => number): T | null {
  const weights = items.map(weight);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] as number;
    if (r <= 0) return items[i] as T;
  }
  return items[items.length - 1] ?? null;
}

// ---------- one minute of one match ----------

function removeFromPitch(side: LiveSide, slot: number, why: Vacancy): void {
  const playerId = side.slots[slot];
  side.slots[slot] = null;
  if (playerId) side.vacancy[slot] = { why, playerId };
}

/** Brings `inId` on in `slot`. No validation: callers check the rules. */
function bringOn(m: LiveMatch, side: LiveSide, slot: number, inId: string, minute: number, players: Record<string, LivePlayer>): void {
  const outId = side.slots[slot];
  if (outId) side.subbedOff.push(outId);
  const leaving = outId ?? side.vacancy[slot]?.playerId;
  side.slots[slot] = inId;
  delete side.vacancy[slot];
  side.bench = side.bench.filter((id) => id !== inId);
  side.subsUsed++;
  side.fitness[inId] = players[inId]?.fitness ?? 100;
  if (!side.played.includes(inId)) side.played.push(inId);
  m.events.push({ minute, type: "substitution", clubId: side.clubId, playerId: leaving ?? undefined, playerInId: inId });
}

/**
 * The AI's substitutions. The user's side gets none, except the two vacancy rules (keeper sent
 * off, injury) when `fillUser` is set: nobody decides for it any more (AD-022).
 */
function aiSubstitutions(m: LiveMatch, side: LiveSide, minute: number, players: Record<string, LivePlayer>, fillUser = false): void {
  if (side.isUser && !fillUser) return;
  const bestFor = (pos: Position, samePositionOnly: boolean): string | null => {
    const candidates = side.bench
      .map((id) => players[id])
      .filter((p): p is LivePlayer => !!p && (!samePositionOnly || p.position === pos));
    candidates.sort((a, b) => effectiveRating(b, pos) - effectiveRating(a, pos) || a.id.localeCompare(b.id));
    return candidates[0]?.id ?? null;
  };
  // Correcoes-validacao AC 40: a keeper sent off is replaced by the bench keeper; the weakest
  // outfield player goes off, and his slot is the one left empty.
  side.slots.forEach((id, slot) => {
    if (id || side.slotPos[slot] !== "GK" || side.vacancy[slot]?.why !== "red" || side.subsUsed >= MAX_SUBS) return;
    const keeper = bestFor("GK", true);
    const off = onPitch(side)
      .filter((o) => o.pos !== "GK")
      .sort((a, b) => ownSlotRating(side, a, players) - ownSlotRating(side, b, players) || a.id.localeCompare(b.id))[0];
    if (!keeper || !off) return;
    // Ajustes-substituicao C4: the hole keeps the sector of the slot it moved to.
    side.vacancy[off.slot] = { ...side.vacancy[slot]!, pos: side.slotPos[off.slot] as Position };
    delete side.vacancy[slot];
    side.slots[off.slot] = null;
    side.slots[slot] = off.id;
    bringOn(m, side, slot, keeper, minute, players);
  });
  // Injured players are replaced at once.
  side.slots.forEach((id, slot) => {
    if (id || side.vacancy[slot]?.why !== "injury" || side.subsUsed >= MAX_SUBS) return;
    const pos = side.slotPos[slot] as Position;
    const inId = bestFor(pos, true) ?? bestFor(pos, false);
    if (inId) bringOn(m, side, slot, inId, minute, players);
  });
  if (side.isUser) return;
  // From the 60th minute, one tired player per minute is swapped for a fresh one of the same position.
  if (minute < AI_TIRED_FROM_MINUTE || side.subsUsed >= MAX_SUBS) return;
  const tired = onPitch(side)
    .filter((o) => (side.fitness[o.id] ?? 100) < AI_TIRED_FITNESS)
    .sort((a, b) => (side.fitness[a.id] ?? 100) - (side.fitness[b.id] ?? 100));
  for (const t of tired) {
    const inId = bestFor(t.pos, true);
    if (inId) {
      bringOn(m, side, t.slot, inId, minute, players);
      return;
    }
  }
}

function ownSlotRating(side: LiveSide, o: { id: string; pos: Position }, players: Record<string, LivePlayer>): number {
  const p = players[o.id];
  return p ? effectiveRating(p, o.pos, side.fitness[o.id] ?? p.fitness ?? 100) : 0;
}

function discipline(m: LiveMatch, side: LiveSide, minute: number, rng: Rng, players: Record<string, LivePlayer>): void {
  const roll = rng.next();
  if (roll < DIRECT_RED_PER_SIDE_MINUTE) {
    const who = weightedPick(rng, onPitch(side), (o) => CARD_WEIGHT[o.pos]);
    if (who) sendOff(m, side, who.slot, who.id, minute);
    return;
  }
  if (roll < DIRECT_RED_PER_SIDE_MINUTE + YELLOW_PER_SIDE_MINUTE) {
    const who = weightedPick(rng, onPitch(side), (o) => CARD_WEIGHT[o.pos] * ((side.yellows[o.id] ?? 0) > 0 ? BOOKED_CAUTION : 1));
    if (!who) return;
    const count = (side.yellows[who.id] ?? 0) + 1;
    side.yellows[who.id] = count;
    if (count >= 2) sendOff(m, side, who.slot, who.id, minute);
    else m.events.push({ minute, type: "yellow", clubId: side.clubId, playerId: who.id });
  }
  void players;
}

function sendOff(m: LiveMatch, side: LiveSide, slot: number, id: string, minute: number): void {
  side.sentOff.push(id);
  removeFromPitch(side, slot, "red");
  m.events.push({ minute, type: "red", clubId: side.clubId, playerId: id });
}

/** Treino-evolucao AC 12: the chance of an injury per side and minute, by the side's training. */
export function injuryChance(training: Training | undefined): number {
  return INJURY_PER_SIDE_MINUTE * TRAINING_INJURY[training ?? "normal"];
}

function injuries(m: LiveMatch, side: LiveSide, minute: number, rng: Rng): void {
  if (rng.next() >= injuryChance(side.training)) return;
  const who = weightedPick(rng, onPitch(side), (o) => 1 + (100 - (side.fitness[o.id] ?? 100)) / 50);
  if (!who) return;
  side.injured[who.id] = randInt(rng, 1, 4);
  removeFromPitch(side, who.slot, "injury");
  m.events.push({ minute, type: "injury", clubId: side.clubId, playerId: who.id });
}

function drain(side: LiveSide, players: Record<string, LivePlayer>): void {
  for (const { id } of onPitch(side)) {
    const age = players[id]?.age ?? 25;
    const perMinute = age > VETERAN_AGE ? DRAIN_PER_MINUTE_VETERAN : DRAIN_PER_MINUTE;
    side.fitness[id] = Math.max(0, (side.fitness[id] ?? 100) - perMinute);
  }
}

function pickShooter(rng: Rng, side: LiveSide, players: Record<string, LivePlayer>): { id: string; pos: Position } | null {
  const who = weightedPick(rng, onPitch(side), (o) => SCORER_WEIGHT[o.pos] * (players[o.id]?.rating ?? 50));
  return who ? { id: who.id, pos: who.pos } : null;
}

/** Plays `minute` of match `m` in place. `fillUser`: the user's holes are filled by the AI's rule (AD-022). */
export function stepMatch(m: LiveMatch, minute: number, players: Record<string, LivePlayer>, rng: Rng, fillUser = false): void {
  if (minute === 1) m.events.push({ minute: 1, type: "kickoff", clubId: m.home.clubId });

  const h = sideStrength(m.home, players);
  const a = sideStrength(m.away, players);
  const homeMid = h.mid * HOME_MIDFIELD_BONUS;
  const homeHasBall = rng.next() < homeMid / (homeMid + a.mid);
  const attacker = homeHasBall ? m.home : m.away;
  const defender = homeHasBall ? m.away : m.home;
  const attStrength = homeHasBall ? h.att * HOME_ATTACK_BONUS : a.att;
  const defStrength = homeHasBall ? a : h;

  const chance =
    BASE_CHANCE_PER_MINUTE * Math.pow(attStrength / defStrength.def, 1.5) * CREATE[attacker.posture] * CONCEDE[defender.posture];
  if (rng.next() < chance) {
    // Penaltis AC 1: a share of the chances is a penalty instead of a shot from open play.
    const shooter = rng.next() < PENALTY_PER_CHANCE ? "penalty" : pickShooter(rng, attacker, players);
    if (shooter === "penalty") {
      // AC 3: the kick is against the keeper alone, not the blend of keeper and defence.
      inPlayPenalty(m, attacker, homeHasBall, keeperStrength(defender, players), minute, players, rng);
    } else if (shooter) {
      if (rng.next() < ON_TARGET) {
        const p = players[shooter.id];
        const shooterRating = p ? effectiveRating(p, shooter.pos, attacker.fitness[shooter.id]) : 50;
        const goalProb = BASE_GOAL_ON_TARGET * Math.pow(shooterRating / defStrength.gk, 1.2);
        if (rng.next() < goalProb) {
          m.events.push({ minute, type: "goal", clubId: attacker.clubId, playerId: shooter.id });
          m.goals.push({ minute, clubId: attacker.clubId, playerId: shooter.id });
          if (homeHasBall) m.homeGoals++;
          else m.awayGoals++;
        } else {
          m.events.push({ minute, type: "shot_saved", clubId: attacker.clubId, playerId: shooter.id });
        }
      } else {
        m.events.push({ minute, type: "shot_missed", clubId: attacker.clubId, playerId: shooter.id });
      }
    }
  }

  for (const side of [m.home, m.away]) {
    discipline(m, side, minute, rng, players);
    injuries(m, side, minute, rng);
    drain(side, players);
  }
  for (const side of [m.home, m.away]) aiSubstitutions(m, side, minute, players, fillUser);

  if (minute === HALFTIME) m.events.push({ minute: HALFTIME, type: "halftime", clubId: m.home.clubId });
  if (minute === MATCH_MINUTES) {
    m.events.push({ minute: MATCH_MINUTES, type: "fulltime", clubId: m.home.clubId });
    // Door 2 (copa-nacional): the shoot-out continues the match's own stream.
    if (m.knockout && m.homeGoals === m.awayGoals) penaltyShootout(m, players, rng);
  }
}

// ---------- penalties (copa-nacional S3) ----------

const PENALTY_BASE = 0.75;
const PENALTY_MIN = 0.55;
const PENALTY_MAX = 0.92;
const PENALTY_ROUNDS = 5;
const TAKER_ORDER: Position[] = ["FW", "MF", "DF", "GK"];

/** AC 13: 0,75 + (taker - keeper) / 200, within [0,55; 0,92]. Both are effective ratings. */
export function penaltyChance(taker: number, keeper: number): number {
  return Math.min(PENALTY_MAX, Math.max(PENALTY_MIN, PENALTY_BASE + (taker - keeper) / 200));
}

function ownEffective(side: LiveSide, id: string, players: Record<string, LivePlayer>): number {
  const p = players[id];
  return p ? effectiveRating(p, p.position, side.fitness[id] ?? p.fitness ?? 100) : 0;
}

/**
 * AC 14: whoever is on the pitch, FW, MF, DF, GK, strongest first within the position. Penaltis
 * AC 15-17: the user's chosen taker goes first while on the pitch.
 */
export function penaltyTakers(side: LiveSide, players: Record<string, LivePlayer>): string[] {
  const rank = (id: string) => TAKER_ORDER.indexOf(players[id]?.position ?? "GK");
  const chosen = (id: string) => (id === side.penaltyTaker ? 0 : 1);
  return onPitch(side)
    .map((o) => o.id)
    .sort((a, b) => chosen(a) - chosen(b) || rank(a) - rank(b) || ownEffective(side, b, players) - ownEffective(side, a, players) || a.localeCompare(b));
}

export type ShootoutSide = "home" | "away";

/**
 * AC 12: five kicks each, home first, alternating, stopping once one side cannot catch up; then
 * pairs until exactly one of a pair scores. `kick(side, n)` takes that side's kick `n` (0-based).
 */
export function shootout(kick: (side: ShootoutSide, n: number) => boolean): { home: number; away: number; kicks: number } {
  const score = { home: 0, away: 0 };
  const taken = { home: 0, away: 0 };
  const take = (side: ShootoutSide) => {
    if (kick(side, taken[side])) score[side]++;
    taken[side]++;
  };
  const decided = () =>
    score.home + (PENALTY_ROUNDS - taken.home) < score.away || score.away + (PENALTY_ROUNDS - taken.away) < score.home;
  for (let i = 0; i < PENALTY_ROUNDS && !decided(); i++) {
    take("home");
    if (decided()) break;
    take("away");
  }
  while (score.home === score.away) {
    take("home");
    take("away");
  }
  return { home: score.home, away: score.away, kicks: taken.home + taken.away };
}

function keeperRating(side: LiveSide, players: Record<string, LivePlayer>): number {
  const gk = onPitch(side).find((o) => o.pos === "GK");
  const p = gk ? players[gk.id] : undefined;
  return gk && p ? effectiveRating(p, "GK", side.fitness[gk.id] ?? p.fitness ?? 100) : 0;
}

function penaltyShootout(m: LiveMatch, players: Record<string, LivePlayer>, rng: Rng): void {
  const sides = { home: m.home, away: m.away };
  const takers = { home: penaltyTakers(m.home, players), away: penaltyTakers(m.away, players) };
  const keepers = { home: keeperRating(m.home, players), away: keeperRating(m.away, players) };
  const result = shootout((which, n) => {
    const side = sides[which];
    const list = takers[which];
    const id = list.length ? list[n % list.length] : undefined;
    const chance = id ? penaltyChance(ownEffective(side, id, players), keepers[which === "home" ? "away" : "home"]) : 0;
    const scored = rng.next() < chance;
    m.events.push({ minute: MATCH_MINUTES, type: scored ? "penalty_scored" : "penalty_missed", clubId: side.clubId, playerId: id });
    return scored;
  });
  m.penalties = { home: result.home, away: result.away };
}

/**
 * Penaltis AC 1-4: the award, then one kick by the first of `penaltyTakers` at the defending
 * keeper (`keeperStrength`), scored with `penaltyChance`; a miss is saved or goes wide.
 */
function inPlayPenalty(m: LiveMatch, attacker: LiveSide, home: boolean, keeper: number, minute: number, players: Record<string, LivePlayer>, rng: Rng): void {
  const taker = penaltyTakers(attacker, players)[0];
  if (!taker) return;
  m.events.push({ minute, type: "penalty", clubId: attacker.clubId });
  const kick = { minute, clubId: attacker.clubId, playerId: taker, penalty: true as const };
  if (rng.next() < penaltyChance(ownEffective(attacker, taker, players), keeper)) {
    m.events.push({ ...kick, type: "goal" });
    m.goals.push({ minute, clubId: attacker.clubId, playerId: taker });
    if (home) m.homeGoals++;
    else m.awayGoals++;
  } else {
    m.events.push({ ...kick, type: rng.next() < PENALTY_SAVED_SHARE ? "shot_saved" : "shot_missed" });
  }
}

export function resultOf(m: LiveMatch): MatchResult {
  return { homeGoals: m.homeGoals, awayGoals: m.awayGoals, goals: m.goals.map((g) => ({ ...g })) };
}

// ---------- the round ----------

function clone<T>(value: T): T {
  // Plain JSON everywhere, so this is a faithful deep copy without DOM globals (door 3 of the core).
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Salt of the Série B match streams (door 2 of multiplas-temporadas). */
const SERIE_B_MATCH_SALT = 0xb;
/** Salt of the match streams of the leagues from index 2 on (door 2 of paises). */
const ABROAD_MATCH_SALT = 0xe0;

/**
 * Door 2: the seed of each match depends only on the save's state, the round, the match's index
 * and its league's index in `leagues`. The Série A keeps the core's formula; the Série B mixes in
 * its own salt first; league `k >= 2` uses `mix32(mix32(rngState, 0xE0), k)` (paises door 2).
 */
export function matchSeed(rngState: number, roundNumber: number, matchIndex: number, divisionIndex = 0): number {
  const base =
    divisionIndex === 0
      ? rngState
      : divisionIndex === 1
        ? mix32(rngState, SERIE_B_MATCH_SALT)
        : mix32(mix32(rngState, ABROAD_MATCH_SALT), divisionIndex);
  return mix32(base, roundNumber * 16 + matchIndex);
}

/**
 * One club's side for a date: the user's lineup or the AI's, with anyone unavailable for
 * `competition` left out of the eleven (an empty slot) and off the bench (door 6 of copa-nacional).
 */
export function sideFor(
  club: Club,
  userClubId: string | null,
  players: Record<string, LivePlayer>,
  competition: Competition = LEAGUE,
): LiveSide {
  const isUser = club.id === userClubId;
  const lineup = isUser && club.lineup ? club.lineup : aiLineup(club, competition);
  const slotPos = formationSlots(lineup.formation);
  const starters = lineup.starters.map((id) => {
    const p = id ? club.players.find((x) => x.id === id) : undefined;
    return p && isAvailableFor(p, competition) ? p.id : null;
  });
  const onField = new Set(starters.filter((id): id is string => !!id));
  const bench = club.players.filter((p) => isAvailableFor(p, competition) && !onField.has(p.id)).map((p) => p.id);
  return makeSide(club.id, slotPos, starters, bench, players, {
    formation: lineup.formation,
    posture: lineup.posture ?? "balanced",
    isUser,
    training: club.training,
    penaltyTaker: isUser ? lineup.penaltyTaker : undefined,
  });
}

/** Every club of every division by id, and a snapshot of every player. */
export function roundSnapshot(state: Pick<GameState, "leagues">): { clubs: Map<string, Club>; players: Record<string, LivePlayer> } {
  const players: Record<string, LivePlayer> = {};
  const clubs = new Map(state.leagues.flatMap((l: League) => l.clubs).map((c) => [c.id, c]));
  for (const c of clubs.values()) for (const p of c.players) players[p.id] = { ...p };
  return { clubs, players };
}

export function startRound(state: GameState): LiveRound {
  const first = state.leagues[0];
  if (!first) throw new Error("save has no league");
  const roundIndex = first.currentRound;
  if (!first.rounds[roundIndex]) throw new Error("season is over");
  const { clubs, players } = roundSnapshot(state);
  const side = (clubId: string): LiveSide => {
    const club = clubs.get(clubId);
    if (!club) throw new Error(`unknown club ${clubId}`);
    return sideFor(club, state.userClubId, players);
  };

  // AC 3, paises AC 7: the 10 matches of every league, in `leagues` order.
  const matches = state.leagues.flatMap((league, division) => {
    const round = league.rounds[roundIndex];
    if (!round) throw new Error("divisions out of step");
    return round.matches.map((match, i) =>
      makeMatch(match.id, side(match.homeId), side(match.awayId), matchSeed(state.rngState, round.number, i, division), league.id),
    );
  });
  const roundNumber = first.rounds[roundIndex]!.number;
  return { roundIndex, roundNumber, minute: 0, userClubId: state.userClubId, matches, players };
}

function stepInPlace(live: LiveRound, fillUser = false): void {
  live.minute++;
  for (const m of live.matches) {
    const rng = createRng(m.rngState);
    stepMatch(m, live.minute, live.players, rng, fillUser);
    m.rngState = rng.getState();
  }
}

/**
 * A copy for one more minute: matches are copied, the players' snapshot is shared, since nothing
 * writes to it during a round (40 squads make copying it the main cost of a tick).
 */
function forNextMinutes(input: LiveRound): LiveRound {
  return { ...input, matches: clone(input.matches) };
}

/** Advances every match by one minute. Pure: returns a new LiveRound. */
export function step(input: LiveRound): LiveRound {
  if (input.minute >= MATCH_MINUTES) return input;
  const live = forNextMinutes(input);
  stepInPlace(live);
  return live;
}

/**
 * Plays every minute left. Same result as calling step() until 90, with one copy instead of ninety.
 * `fillUserVacancies` (AD-022): nobody decides for the user any more, so the user's injured and a
 * keeper sent off are replaced by the AI's rule.
 */
export function runToEnd(input: LiveRound, opts: { fillUserVacancies?: boolean } = {}): LiveRound {
  if (input.minute >= MATCH_MINUTES) return input;
  const live = forNextMinutes(input);
  while (live.minute < MATCH_MINUTES) stepInPlace(live, opts.fillUserVacancies ?? false);
  return live;
}

export function userMatch(live: LiveRound): LiveMatch | null {
  if (!live.userClubId) return null;
  return live.matches.find((m) => m.home.clubId === live.userClubId || m.away.clubId === live.userClubId) ?? null;
}

/** The user's injuries and sendings-off of the last minute played: they stop the clock (parada-obrigatoria). */
export function userStops(live: LiveRound): MatchEvent[] {
  const m = userMatch(live);
  if (!m) return [];
  return m.events.filter((e) => e.minute === live.minute && e.clubId === live.userClubId && (e.type === "injury" || e.type === "red"));
}

/**
 * The user's empty slot that must be filled before the clock goes on: a keeper sent off with a
 * keeper on the bench, or an injury with anyone on the bench, while a substitution is left.
 */
export function forcedVacancy(live: LiveRound): { slot: number; why: Vacancy } | null {
  const m = userMatch(live);
  const side = m && live.userClubId ? sideOf(m, live.userClubId) : null;
  if (!side || side.subsUsed >= MAX_SUBS || side.bench.length === 0) return null;
  const empty = side.slots.flatMap((id, slot) => (id ? [] : [slot]));
  const keeperSlot = empty.find((slot) => side.slotPos[slot] === "GK" && side.vacancy[slot]?.why === "red");
  if (keeperSlot !== undefined && side.bench.some((id) => live.players[id]?.position === "GK")) return { slot: keeperSlot, why: "red" };
  const injured = empty.find((slot) => side.vacancy[slot]?.why === "injury");
  return injured === undefined ? null : { slot: injured, why: "injury" };
}

// ---------- the user's decisions ----------

export type SubRefusal = "limit" | "sent_off" | "returning" | "not_on_bench" | "no_match" | "not_vacant";
export type Decision<T> = { ok: true; live: T } | { ok: false; reason: SubRefusal };

/**
 * Takes the player of `slot` off and brings `inId` on, in `target`: the same slot by default, or
 * the empty slot of a player sent off (posicao-na-substituicao), which then moves to `slot`.
 * Applies from the next minute.
 */
export function substitute(input: LiveRound, clubId: string, slot: number, inId: string, target = slot): Decision<LiveRound> {
  const live = clone(input);
  const m = live.matches.find((x) => sideOf(x, clubId));
  const side = m ? sideOf(m, clubId) : null;
  if (!m || !side || slot < 0 || slot >= side.slots.length) return { ok: false, reason: "no_match" };
  if (side.subsUsed >= MAX_SUBS) return { ok: false, reason: "limit" };
  if (side.vacancy[slot]?.why === "red") return { ok: false, reason: "sent_off" };
  if (side.subbedOff.includes(inId)) return { ok: false, reason: "returning" };
  if (!side.bench.includes(inId)) return { ok: false, reason: "not_on_bench" };
  if (target !== slot) {
    // Posicao-na-substituicao C1, C3: only a red card's empty slot takes the player coming on.
    const outId = side.slots[slot];
    if (!outId || side.slots[target] !== null || side.vacancy[target]?.why !== "red") return { ok: false, reason: "not_vacant" };
    side.vacancy[slot] = { ...side.vacancy[target]!, pos: side.slotPos[slot] as Position };
    delete side.vacancy[target];
    side.slots[slot] = null;
    side.slots[target] = outId;
    bringOn(m, side, target, inId, live.minute, live.players);
    return { ok: true, live };
  }
  // Parada-obrigatoria C3: with the goal empty after a red card, a keeper brought on for an
  // outfield player goes in goal, and the outfield slot is the one left empty.
  const goal = side.slots.findIndex((id, i) => !id && side.slotPos[i] === "GK" && side.vacancy[i]?.why === "red");
  const outId = side.slots[slot];
  if (goal >= 0 && outId && side.slotPos[slot] !== "GK" && live.players[inId]?.position === "GK") {
    // Ajustes-substituicao C3: the hole keeps the sector of the slot it moved to.
    side.vacancy[slot] = { ...side.vacancy[goal]!, pos: side.slotPos[slot] as Position };
    delete side.vacancy[goal];
    side.slots[slot] = null;
    side.slots[goal] = outId;
    bringOn(m, side, goal, inId, live.minute, live.players);
    return { ok: true, live };
  }
  bringOn(m, side, slot, inId, live.minute, live.players);
  return { ok: true, live };
}

/**
 * Re-seats the players on the pitch in the slots of `formation`: same-position players first,
 * then the rest wherever a slot is left (out of position). Nobody leaves; empty slots stay empty.
 * Correcoes-validacao AC 43: each empty slot is kept first in the sector of the player who left
 * it, the last slot of that sector, when the new formation has one free.
 */
export function changeFormation(input: LiveRound, clubId: string, formation: FormationName): LiveRound {
  const live = clone(input);
  const m = live.matches.find((x) => sideOf(x, clubId));
  const side = m ? sideOf(m, clubId) : null;
  if (!side) return input;
  const newPos = formationSlots(formation);
  const ids = side.slots.filter((id): id is string => !!id);
  const vacancies = side.slots.map((id, i) => (id ? null : side.vacancy[i] ?? null)).filter((v): v is VacantSlot => !!v);
  const seats: (string | null)[] = newPos.map(() => null);
  const vacancy: Record<number, VacantSlot> = {};
  const unplaced: VacantSlot[] = [];
  for (const v of vacancies) {
    const lost = v.pos ?? live.players[v.playerId]?.position;
    let slot = -1;
    newPos.forEach((pos, i) => {
      if (pos === lost && !vacancy[i]) slot = i;
    });
    if (slot >= 0) vacancy[slot] = v;
    else unplaced.push(v);
  }
  const free = (i: number) => !seats[i] && !vacancy[i];
  const left = [...ids];
  newPos.forEach((pos, i) => {
    if (!free(i)) return;
    const k = left.findIndex((id) => live.players[id]?.position === pos);
    if (k >= 0) seats[i] = left.splice(k, 1)[0] as string;
  });
  // The rest sit wherever a slot is left, from the front; any vacancy not placed yet takes what remains.
  const emptyIdx = newPos.map((_, i) => i).filter(free);
  emptyIdx.slice(0, left.length).forEach((slotIdx, k) => (seats[slotIdx] = left[k] as string));
  emptyIdx.slice(left.length).forEach((slotIdx, k) => {
    const v = unplaced[k];
    if (v) vacancy[slotIdx] = v;
  });
  side.formation = formation;
  side.slotPos = newPos;
  side.slots = seats;
  side.vacancy = vacancy;
  return live;
}

export function changePosture(input: LiveRound, clubId: string, posture: Posture): LiveRound {
  const live = clone(input);
  const m = live.matches.find((x) => sideOf(x, clubId));
  const side = m ? sideOf(m, clubId) : null;
  if (!side) return input;
  side.posture = posture;
  return live;
}
