import { BOARD_PATIENCE } from "./career";
import { migrateSave } from "./migrate";
import { NEWS_LIMIT } from "./news";
import { DIFFICULTIES, type Difficulty, type GameState } from "./types";

/** Door 1 of lancamento: the exported file is this envelope, forever. */
export const SAVE_FILE_FORMAT = "forzion-futmanager-save";

export interface SaveFile {
  format: typeof SAVE_FILE_FORMAT;
  exportedAt: string;
  save: GameState;
}

export type DecodeResult =
  | { kind: "ok"; state: GameState }
  | { kind: "invalid_json" }
  | { kind: "not_a_save" }
  | { kind: "unsupported_version"; version: unknown }
  | { kind: "malformed" };

/** The file's text: the envelope as JSON with 2-space indentation. `exportedAt` comes from the caller (AD-002). */
export function encodeSaveFile(state: GameState, exportedAt: string): string {
  const file: SaveFile = { format: SAVE_FILE_FORMAT, exportedAt, save: state };
  return JSON.stringify(file, null, 2);
}

/** `forzion-futmanager-t<season>-<club name without accents, spaces as hyphens>.json`. */
export function saveFileName(season: number, clubName: string): string {
  const slug = clubName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `forzion-futmanager-t${season}-${slug}.json`;
}

/** The user's club name, or null before a club is chosen. */
export function userClubName(state: GameState): string | null {
  if (!state.userClubId) return null;
  for (const league of state.leagues) {
    const club = league.clubs.find((c) => c.id === state.userClubId);
    if (club) return club.name;
  }
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Just enough shape for the screens to open the game: the lists they walk and the numbers they
 * read. Correcoes-validacao AC 4: each league's rounds and current round, each club's players,
 * money and sale list, and the user's lineup.
 */
function hasGameShape(state: unknown): state is GameState {
  if (!isObject(state)) return false;
  if (!Number.isInteger(state.seed) || !Number.isInteger(state.rngState) || !Number.isInteger(state.season)) return false;
  if (!isObject(state.market) || !Array.isArray(state.history) || !Array.isArray(state.cups)) return false;
  const leagues = state.leagues;
  if (!Array.isArray(leagues) || leagues.length === 0) return false;
  const isClub = (c: unknown) => isObject(c) && typeof c.id === "string" && Array.isArray(c.players) && isObject(c.finance) && Array.isArray(c.forSale);
  const isLeague = (l: unknown) => isObject(l) && Array.isArray(l.rounds) && Number.isInteger(l.currentRound) && Array.isArray(l.clubs) && l.clubs.every(isClub);
  if (!leagues.every(isLeague)) return false;
  const userClubId = state.userClubId;
  if (typeof userClubId !== "string") return false;
  const clubs = (leagues as { clubs: Record<string, unknown>[] }[]).flatMap((l) => l.clubs);
  const user = clubs.find((c) => c.id === userClubId);
  const clubIds = new Set(clubs.map((c) => c.id as string));
  return (
    user !== undefined &&
    isObject(user.lineup) &&
    hasJobShape(state.pendingJob, clubIds, userClubId) &&
    (state.boardWarnings === undefined || isIntIn(state.boardWarnings, 0, BOARD_PATIENCE - 1)) &&
    (state.difficulty === undefined || DIFFICULTIES.includes(state.difficulty as Difficulty)) &&
    optionalList(state.career, Infinity, (m) => isCareerMove(m, clubIds)) &&
    optionalList(state.news, NEWS_LIMIT, (n) => isNewsItem(n, clubIds))
  );
}

/** Ajustes-importacao: an integer from `min` to `max`, the range the engine writes. */
function isIntIn(v: unknown, min: number, max = Infinity): boolean {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
}

/** Validacao-importacao: an optional list is absent, or at most `max` items that each pass. */
function optionalList(list: unknown, max: number, isItem: (item: Record<string, unknown>) => boolean): boolean {
  return list === undefined || (Array.isArray(list) && list.length <= max && list.every((item) => isObject(item) && isItem(item)));
}

/** Validacao-importacao C2: a club change between two clubs of the game. */
function isCareerMove(m: Record<string, unknown>, clubIds: ReadonlySet<string>): boolean {
  const isClubId = (id: unknown) => typeof id === "string" && clubIds.has(id);
  return isIntIn(m.season, 1) && isIntIn(m.round, 0) && isClubId(m.fromId) && isClubId(m.toId) && (m.reason === "fired" || m.reason === "offer");
}

/** Validacao-importacao C3: the fields of the news kind the screens read; clubs must be of the game. */
function isNewsItem(n: Record<string, unknown>, clubIds: ReadonlySet<string>): boolean {
  const isClubId = (id: unknown) => typeof id === "string" && clubIds.has(id);
  const isName = typeof n.playerName === "string" && n.playerName.trim() !== "";
  const isAmount = typeof n.amount === "number" && Number.isFinite(n.amount) && n.amount >= 0;
  const d = n.date;
  const date = isObject(d) && (d.kind === "league" ? isIntIn(d.round, 1) : d.kind === "cup" && typeof d.cupId === "string" && isIntIn(d.phase, 0));
  if (!isIntIn(n.season, 1) || !date) return false;
  switch (n.kind) {
    case "injury":
      return isName && isIntIn(n.rounds, 1);
    case "suspension":
      return isName && isIntIn(n.rounds, 1) && (n.cupId === undefined || typeof n.cupId === "string");
    case "rating":
      return isName && Number.isInteger(n.rating) && (n.delta === 1 || n.delta === -1);
    case "offer":
      return isName && isClubId(n.clubId) && isAmount;
    case "transfer":
      return isName && isClubId(n.fromId) && isClubId(n.toId) && isAmount;
    case "board":
      return isIntIn(n.warnings, 1, BOARD_PATIENCE - 1);
    case "job":
      return Array.isArray(n.clubIds) && n.clubIds.length > 0 && n.clubIds.every(isClubId);
    case "cup":
      return typeof n.cupId === "string" && isIntIn(n.phase, 0) && ["advanced", "champion", "out"].includes(n.result as string) && isClubId(n.opponentId);
    default:
      return false;
  }
}

/** Carreira-dinamica AC 26: a pending offer names other clubs of the game, or is absent. Ajustes-importacao C2: at least one. */
function hasJobShape(job: unknown, clubIds: ReadonlySet<string>, userClubId: string): boolean {
  if (job === undefined) return true;
  if (!isObject(job) || (job.reason !== "fired" && job.reason !== "offer") || !Array.isArray(job.clubIds)) return false;
  return job.clubIds.length > 0 && job.clubIds.every((id) => typeof id === "string" && id !== userClubId && clubIds.has(id));
}

/** Reads an exported file: the envelope, then `migrateSave`, then the shape of the game. */
export function decodeSaveFile(text: string): DecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "invalid_json" };
  }
  if (!isObject(parsed) || parsed.format !== SAVE_FILE_FORMAT || !("save" in parsed)) return { kind: "not_a_save" };
  if (!isObject(parsed.save)) return { kind: "malformed" };
  let migrated;
  try {
    migrated = migrateSave(parsed.save);
  } catch {
    return { kind: "malformed" };
  }
  if (migrated.kind === "incompatible") return { kind: "unsupported_version", version: migrated.version };
  if (!hasGameShape(migrated.state)) return { kind: "malformed" };
  return { kind: "ok", state: migrated.state };
}
