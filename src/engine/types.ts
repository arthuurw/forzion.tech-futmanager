export type Position = "GK" | "DF" | "MF" | "FW";
export const POSITIONS: readonly Position[] = ["GK", "DF", "MF", "FW"];

export const RATING_MIN = 40;
export const RATING_MAX = 95;
export const AGE_MIN = 17;
export const AGE_MAX = 36;

/** What a player is, independent of how they feel today. */
export interface PlayerCore {
  id: string;
  name: string;
  position: Position;
  age: number;
  rating: number;
}

/** Door 1 (save v2): how a player is doing. Integers. */
export interface Condition {
  /** 0..100 */
  fitness: number;
  /** -2..2 */
  morale: number;
  /** Rounds still out injured. */
  injuryRounds: number;
  /** Rounds still out suspended. */
  suspendedRounds: number;
  /** Yellow cards accumulated towards a suspension (0..2). */
  yellowCards: number;
  /** Consecutive rounds without playing (door 7). */
  idleRounds: number;
}

/** Door 1 (save v4): games and goals, this season and before it. */
export interface PlayerStats {
  seasonGames: number;
  seasonGoals: number;
  /** Seasons already closed; the current season is not in here yet. */
  careerGames: number;
  careerGoals: number;
}

export const ZERO_STATS: Readonly<PlayerStats> = { seasonGames: 0, seasonGoals: 0, careerGames: 0, careerGoals: 0 };

/** Door 6 (copa-nacional): cards and suspension that count only in one cup. */
export interface CupDiscipline {
  yellowCards: number;
  suspendedRounds: number;
}

export interface Player extends PlayerCore, Condition, PlayerStats {
  /** Reais per round, fixed when the player is generated or joins a club; never derived from rating (door 2). */
  salary: number;
  /** Seasons left, counting the current one. At least 1 while at a club; 0 for free agents and juniors (door 1). */
  contractSeasons: number;
  /**
   * Door 6 (copa-nacional): discipline per cup id, always present, `{}` when empty. The top-level
   * `yellowCards` and `suspendedRounds` are the league's.
   */
  cupDiscipline: Record<string, CupDiscipline>;
  /**
   * Door 3 (correcoes-validacao): the season the user signed, promoted or bought the player.
   * Absent = arrived before this rule, and may be sold.
   */
  arrivedSeason?: number;
  /**
   * Door 2 (treino-evolucao): the rating changes of this season, one per league round that moved
   * it, in order. Absent = none; emptied at the turn of the season.
   */
  ratingLog?: RatingStep[];
  /**
   * Door 1 (emprestimos): on loan from this club, which still owns the player; the player plays
   * for the club whose `players` hold them. Absent = not on loan. Every loan ends at the turn.
   */
  loanFrom?: string;
}

/** One rating change: the league round (1-based) and ±1. */
export interface RatingStep {
  round: number;
  delta: 1 | -1;
}

/** Door 1 (treino-evolucao): how hard a club trains. */
export type Training = "light" | "normal" | "hard";
export const TRAININGS: readonly Training[] = ["light", "normal", "hard"];

/** Door 6 (copa-nacional): which discipline a date reads and writes. */
export type Competition = { kind: "league" } | { kind: "cup"; cupId: string };
export const LEAGUE: Competition = { kind: "league" };

export const FRESH_CONDITION: Readonly<Condition> = {
  fitness: 100,
  morale: 0,
  injuryRounds: 0,
  suspendedRounds: 0,
  yellowCards: 0,
  idleRounds: 0,
};

export type FormationName = "4-4-2" | "4-3-3" | "3-5-2" | "4-5-1";
export const FORMATION_NAMES: readonly FormationName[] = ["4-4-2", "4-3-3", "3-5-2", "4-5-1"];

export type Posture = "defensive" | "balanced" | "attacking";
export const POSTURES: readonly Posture[] = ["defensive", "balanced", "attacking"];

/** Eleven slots in formation order (GK, then DF, MF, FW). `null` = empty slot. */
export interface Lineup {
  formation: FormationName;
  starters: (string | null)[];
  posture: Posture;
  /** Penaltis door 1: who takes the user's penalties; absent = Automático (the shoot-out's order). */
  penaltyTaker?: string;
}

/** What a club earned and spent when the last round closed. Reais. */
export interface Ledger {
  /** 0 when the club played away. */
  attendance: number;
  tickets: number;
  sponsorship: number;
  salaries: number;
  interest: number;
  /** Money received from sales since the previous close. */
  transfersIn: number;
  /** Money paid for purchases, sign-on fees and releases since the previous close. */
  transfersOut: number;
  /** End-of-season prize by table position; only on the ledger of the last round (AC 29). */
  prize?: number;
  /** Cup prize won on this date; only on the ledger of a cup date (copa-nacional AC 34). */
  cupPrize?: number;
}

/** Door 1 (save v3): a club's money and stadium. Every amount is an integer in reais (AD-006). */
export interface Finance {
  cash: number;
  sponsorship: number;
  fans: number;
  capacity: number;
  ticketPrice: number;
  /** Rounds until the stadium expansion is ready; 0 = no works. */
  expansionRoundsLeft: number;
  /** Outstanding bank loan. */
  loan: number;
  loanLimit: number;
  pendingIn: number;
  pendingOut: number;
  lastRound: Ledger | null;
}

export interface Club {
  id: string;
  name: string;
  players: Player[];
  lineup: Lineup | null;
  finance: Finance;
  /** Ids of the players the user put up for sale. */
  forSale: string[];
  /** Door 1 (treino-evolucao): absent = "normal"; only the user's club ever changes it. */
  training?: Training;
}

export interface Goal {
  minute: number;
  clubId: string;
  playerId: string;
}

/** Door 7 of the core: only the score and the goals are persisted, never the full event log. */
export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  goals: Goal[];
}

export interface Match {
  id: string;
  homeId: string;
  awayId: string;
  result: MatchResult | null;
}

export interface Round {
  number: number;
  matches: Match[];
}

/** Door 1 (paises, save v7): the countries of the game. Screen names live here, not in the save. */
export type Country = "BR" | "AR" | "PT";
export const COUNTRIES: Readonly<Record<Country, string>> = { BR: "Brasil", AR: "Argentina", PT: "Portugal" };

export interface League {
  id: string;
  name: string;
  /** Door 1 (paises): a club only moves between leagues of the same country. */
  country: Country;
  /** Door 1 (paises): 0 = the country's first division. */
  tier: number;
  clubs: Club[];
  rounds: Round[];
  /** Index of the next round to play, 0..rounds.length. Equal to rounds.length = season over. */
  currentRound: number;
}

/** An AI club's bid for one of the user's players, valid until the next round closes. */
export interface Offer {
  id: string;
  buyerId: string;
  playerId: string;
  amount: number;
}

/**
 * Door 1 (gastos-da-ia, save v6): one move an AI club paid for or released, never rewritten.
 * `round` is the league round (1-based) that had just closed; `fromId` null = from the free
 * agents, `toId` null = released.
 */
export interface TransferRecord {
  round: number;
  kind: "buy" | "free" | "release";
  playerId: string;
  playerName: string;
  fromId: string | null;
  toId: string | null;
  amount: number;
}

/** Players with no club, kept outside the leagues so they can cross countries later (door 1). */
export interface Market {
  freeAgents: Player[];
  juniors: Player[];
  offers: Offer[];
  /** Door 1 (gastos-da-ia): this season's AI transfers, oldest first; emptied at the turn of the season. */
  transfers: TransferRecord[];
}

/** Door 1 (copa-nacional): a single match that always has a winner. */
export interface Tie {
  id: string;
  homeId: string;
  awayId: string;
  result: MatchResult | null;
  penalties: { home: number; away: number } | null;
  winnerId: string | null;
}

export interface CupPhase {
  name: string;
  /** Door 4: the phase is played right after this league round (1-based). */
  afterLeagueRound: number;
  /** Empty until the phase is drawn (door 3). */
  ties: Tie[];
}

export interface Cup {
  id: string;
  name: string;
  /** The 40 club ids, best first, frozen when the season starts. */
  seeding: string[];
  phases: CupPhase[];
  /** Index of the next phase to play; `phases.length` = cup over. */
  currentPhase: number;
}

/** A closed season's cup: `userReached` is the phase index reached, 6 = champion, null without a club. */
export interface CupRecord {
  cupId: string;
  championId: string;
  runnerUpId: string;
  userReached: number | null;
}

export const SCHEMA_VERSION = 8 as const;

export type Verdict = "met" | "missed" | "fired";

/** One division's season, kept by name where players may retire and vanish (door 1). */
export interface DivisionRecord {
  leagueId: string;
  championId: string;
  promotedIds: string[];
  relegatedIds: string[];
  topScorer: { name: string; clubName: string; goals: number } | null;
}

/** Door 1: one entry per closed season, never rewritten. */
export interface SeasonRecord {
  season: number;
  userClubId: string | null;
  userLeagueId: string | null;
  userPosition: number | null;
  verdict: Verdict | null;
  prize: number;
  divisions: DivisionRecord[];
  /** Door 1 (copa-nacional): `[]` for seasons closed before the cup existed. */
  cups: CupRecord[];
}

/** Door 1: the whole save document. */
export interface GameState {
  schemaVersion: typeof SCHEMA_VERSION;
  seed: number;
  rngState: number;
  season: number;
  userClubId: string | null;
  /**
   * Door 4: `leagues[0]` is the Série A and `leagues[1]` the Série B; door 1 (paises): then the
   * Liga Argentina and the Liga Portuguesa.
   */
  leagues: League[];
  market: Market;
  history: SeasonRecord[];
  /** Worst acceptable final position for the user this season; 0 before a club is chosen (AC 30). */
  boardGoal: number;
  /**
   * Door 1 (copa-nacional): `cups[0]` is the national cup, id `"cup-nat"`; door 1
   * (copa-continental, save v8): `cups[1]` is the continental cup, id `"cup-cont"`.
   */
  cups: Cup[];
  /** Index of the cup phase the user must reach; -1 = no cup goal (no club). */
  cupGoal: number;
  /**
   * Door 1 (correcoes-validacao): written with the state from before a date the user plays live,
   * and gone once it closes. Present when the game opens = the date is played to its end first.
   */
  pendingLive?: true;
  /**
   * Door 1 (carreira-dinamica): consecutive league rounds in the board's firing zone, counted from
   * round 10 to the fourth-last; absent = 0.
   */
  boardWarnings?: number;
  /** Door 1 (carreira-dinamica): job offers waiting for an answer; `fired` must be answered. */
  pendingJob?: PendingJob;
  /** Door 1 (carreira-dinamica): the manager's club changes, oldest first, never rewritten; absent = none. */
  career?: CareerMove[];
  /** Door 1 (noticias): what the closed dates did to the user's club, oldest first, at most 60; absent = none. */
  news?: NewsItem[];
  /** Door 1 (dificuldade): the level chosen with the club, for the whole game; absent = "normal". */
  difficulty?: Difficulty;
}

/** Door 1 (dificuldade): Fácil, Normal, Difícil. */
export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/** Door 1 (noticias): the date a news item belongs to: a league round (1-based) or a cup phase. */
export type NewsDate = { kind: "league"; round: number } | { kind: "cup"; cupId: string; phase: number };

/**
 * Door 1 (noticias): one fact of a date about the user's club. Data only: the screen writes the
 * sentence (AD-004). Players by name, since they may retire; clubs by id, since they never go.
 */
export type NewsItem = { season: number; date: NewsDate } & (
  | { kind: "injury"; playerName: string; rounds: number }
  | { kind: "suspension"; playerName: string; rounds: number; cupId?: string }
  | { kind: "rating"; playerName: string; rating: number; delta: 1 | -1 }
  | { kind: "offer"; playerName: string; clubId: string; amount: number }
  | { kind: "transfer"; playerName: string; fromId: string; toId: string; amount: number }
  | { kind: "board"; warnings: number }
  | { kind: "job"; clubIds: string[] }
  | { kind: "cup"; cupId: string; phase: number; result: "advanced" | "champion" | "out"; opponentId: string }
);

/** Door 1 (carreira-dinamica): offers the user must (`fired`) or may (`offer`) take. Never the user's club. */
export interface PendingJob {
  reason: "fired" | "offer";
  clubIds: string[];
}

/** Door 1 (carreira-dinamica): `round` is the league round that had just closed; at the turn, the league's number of rounds. */
export interface CareerMove {
  season: number;
  round: number;
  fromId: string;
  toId: string;
  reason: "fired" | "offer";
}

export type MatchEventType =
  | "kickoff"
  | "shot_saved"
  | "shot_missed"
  | "goal"
  | "halftime"
  | "fulltime"
  | "yellow"
  | "red"
  | "injury"
  | "substitution"
  | "penalty"
  | "penalty_scored"
  | "penalty_missed";

/** The events of 90 minutes of play. */
export const MATCH_EVENT_TYPES: readonly MatchEventType[] = [
  "kickoff",
  "shot_saved",
  "shot_missed",
  "goal",
  "halftime",
  "fulltime",
  "yellow",
  "red",
  "injury",
  "substitution",
  "penalty",
];

/** Copa-nacional AC 15: only a knockout tie level at 90' has these, after the full-time whistle. */
export const PENALTY_EVENT_TYPES: readonly MatchEventType[] = ["penalty_scored", "penalty_missed"];

export interface MatchEvent {
  minute: number;
  type: MatchEventType;
  clubId: string;
  /** The player the event is about; for a substitution, the one leaving. */
  playerId?: string;
  /** Substitution only: the one coming on. */
  playerInId?: string;
  /** Penaltis door 2: a `goal`, `shot_saved` or `shot_missed` that is the kick of an in-play penalty. */
  penalty?: true;
}
