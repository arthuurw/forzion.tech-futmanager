import { create } from "zustand";
import { newGame as generateNewGame, randomSeed } from "./engine/generate";
import { AI_FORMATION, assignSlot, autoLineup } from "./engine/lineup";
import {
  HALFTIME,
  MATCH_MINUTES,
  changeFormation,
  changePosture,
  forcedVacancy,
  runToEnd,
  startRound,
  step,
  substitute,
  userStops,
  type LiveRound,
  type SubRefusal,
} from "./engine/live";
import * as finance from "./engine/finance";
import * as market from "./engine/market";
import { userBoardGoal, userCupGoal } from "./engine/board";
import { nextCompetition, nextDate } from "./engine/calendar";
import { takeJob } from "./engine/career";
import { finishCupDate, startCupDate } from "./engine/cup";
import { nextSeason as rollOver, type RolloverReport } from "./engine/rollover";
import { findClub, finishRound, isSeasonOver, userLeague, type RoundOutcome } from "./engine/season";
import type { Club, Difficulty, Finance, FormationName, GameState, MatchEvent, Posture, Training } from "./engine/types";
import { difficultyOf } from "./engine/difficulty";
import { decodeSaveFile } from "./engine/saveFile";
import { SLOT_COUNT, deleteGame, isStorageAvailable, listSaves, loadGame, saveGame, type LoadResult, type SlotEntry } from "./persistence/save";
import { formatMoney } from "./ui/money";

export type Phase =
  | "loading"
  | "home"
  | "chooseClub"
  | "squad"
  | "market"
  | "finance"
  | "live"
  | "round"
  | "end"
  | "newSeason"
  | "history"
  | "cup"
  | "about"
  | "job"
  | "saves";
export type SaveStatus = "ok" | "failed" | "unavailable";
/** Varios-saves: what «Jogos salvos» shows of one slot. */
export type SlotView =
  | { slot: number; kind: "empty" }
  | { slot: number; kind: "ok"; club: string; league: string; season: number; savedAt: number; difficulty: Difficulty }
  | { slot: number; kind: "incompatible"; version: unknown };

/** Varios-saves AC 19, AC 21. */
export const SAVES_TEXT = {
  fullNew: "Os 3 espaços estão ocupados. Apague um jogo para começar outro.",
  fullImport: "Os 3 espaços estão ocupados. Apague um jogo para importar outro.",
};

const emptySlots = (): SlotView[] => Array.from({ length: SLOT_COUNT }, (_, i) => ({ slot: i + 1, kind: "empty" }));

function okView(slot: number, game: GameState, savedAt: number): SlotView {
  const id = game.userClubId;
  const league = id ? game.leagues.find((l) => l.clubs.some((c) => c.id === id)) : undefined;
  const club = league?.clubs.find((c) => c.id === id);
  return { slot, kind: "ok", club: club?.name ?? "Sem clube", league: league?.name ?? "", season: game.season, savedAt, difficulty: game.difficulty ?? "normal" };
}

const slotView = (entry: SlotEntry): SlotView => (entry.kind === "ok" ? okView(entry.slot, entry.state, entry.savedAt) : entry);

/** Varios-saves AC 4, AC 5: the readable game saved last (a tie goes to the lowest), else the first empty slot. */
export function activeSlotOf(slots: SlotView[]): number {
  let best: { slot: number; savedAt: number } | null = null;
  for (const s of slots) if (s.kind === "ok" && (!best || s.savedAt > best.savedAt)) best = s;
  return best?.slot ?? slots.find((s) => s.kind === "empty")?.slot ?? 1;
}

/** Ajustes-saves C7: the title's notice only when no slot holds a readable game. */
const incompatibleOf = (slots: SlotView[]): unknown => {
  if (slots.some((s) => s.kind === "ok")) return null;
  const found = slots.find((s) => s.kind === "incompatible");
  return found?.kind === "incompatible" ? found.version : null;
};
export type LastRound = Omit<RoundOutcome, "state">;
export type Clock = "running" | "paused" | "halftime";
export type Speed = 1 | 2 | 4;

/** AC 2 / AC 7: one game minute every 300 ms at 1x, 150 ms at 2x, 75 ms at 4x. */
export const BASE_TICK_MS = 300;

export const REFUSAL_TEXT: Record<SubRefusal, string> = {
  limit: "Limite de 5 substituições",
  sent_off: "Jogador expulso não pode ser substituído",
  returning: "Jogador que saiu não pode voltar",
  not_on_bench: "Escolha um reserva disponível",
  not_vacant: "Escolha a vaga de quem sai ou a de um expulso",
  no_match: "Seu time não joga nesta rodada",
};

type Refusal = market.MarketRefusal | finance.FinanceRefusal;
type ActionResult = { ok: true; state: GameState } | { ok: false; reason: Refusal; amount?: number; state?: GameState };

/** What the screens say when the engine refuses a market or finance action. */
export function refusalText(reason: Refusal, amount = 0): string {
  switch (reason) {
    case "price":
      return `Recusado: pedem ${formatMoney(amount)}`;
    case "cash":
      return "Caixa insuficiente";
    case "squad_full":
      return `Elenco cheio (${market.SQUAD_MAX})`;
    case "seller_min":
      return "O clube não vende: elenco no mínimo";
    case "user_min":
      return `Elenco no mínimo (${market.SQUAD_MIN})`;
    case "closed":
      return "Mercado fechado";
    case "not_found":
      return "Jogador não encontrado";
    case "works":
      return "Já há uma obra em andamento";
    case "max_capacity":
      return "Capacidade máxima: 80.000";
    case "loan_limit":
      return `Limite de empréstimo: ${formatMoney(amount)}`;
    case "over_debt":
      return "Valor maior que a dívida";
    case "invalid":
      return "Valor inválido";
    case "not_last_year":
      return "Só renova no último ano de contrato";
    case "arrived":
      return "Chegou nesta temporada: só pode ser vendido na próxima";
    case "buyer_gone":
      return "O comprador desistiu da proposta";
    // Emprestimos AC 5, AC 7, AC 12, AC 13, AC 17.
    case "starter":
      return "Titular: o clube não empresta";
    case "on_loan":
      return "Emprestado: não pode ser negociado";
    case "no_club":
      return "Nenhum clube quer esse jogador agora";
    case "last_year":
      return "Renove o contrato antes de emprestar";
  }
}

export interface GameStore {
  phase: Phase;
  game: GameState | null;
  /** Varios-saves: the active slot holds a readable game. */
  hasSave: boolean;
  /** Varios-saves: the 3 slots as last read or written. */
  slots: SlotView[];
  /** Varios-saves: the slot the game in memory is written to. */
  activeSlot: number;
  /** Varios-saves AC 19, AC 21: why «Jogos salvos» opened instead of a new or imported game. */
  savesNotice: string | null;
  /** Correcoes-validacao AC 1: the last read of the save failed, which is not «no save». */
  loadFailed: boolean;
  /** Correcoes-validacao AC 6: «Continuar» found a save that does not open. */
  openFailed: boolean;
  /** Door 2 (correcoes-validacao): another tab holds the game; this one does not write. */
  otherTab: boolean;
  /** `init` is running, so a second call (StrictMode) does nothing. */
  booting: boolean;
  /** The game a market or finance action is saving; lineup changes made meanwhile go into it too. */
  pendingCommit: GameState | null;
  /** The last write asked for: writes go one after the other, so the slot ends with the last game. */
  writeQueue: Promise<unknown>;
  /** Set when a slot holds a document with an unsupported schemaVersion. */
  incompatibleVersion: unknown;
  saveStatus: SaveStatus;
  lastRound: LastRound | null;
  /**
   * The round being played live, in memory only. The save only gets the mark of door 1
   * (correcoes-validacao, AD-019), which replaces partida-ao-vivo's door 4.
   */
  live: LiveRound | null;
  clock: Clock;
  speed: Speed;
  /** Why the last decision was refused, if it was. */
  liveMessage: string | null;
  /** Parada-obrigatoria: the user's injuries and sendings-off that stopped the clock, until it goes on. */
  liveStop: MatchEvent[] | null;
  /** The round reached 90' and is being saved. */
  finishing: boolean;
  /** The live round was run to its end by «Pular para o fim» (ajustes-audio AC 5). */
  skipped: boolean;
  /** Why the last market or finance action was refused, if it was. */
  marketMessage: string | null;
  /** A market or finance action is being saved; further actions wait. */
  saving: boolean;
  /** What the last «Próxima temporada» changed (AC 14). In memory only. */
  rolloverReport: RolloverReport | null;
  /** Why the last «Importar jogo» was refused, if it was (lancamento AC 10-13). */
  importMessage: string | null;
  /** A valid imported game waiting for «Sim, substituir» (lancamento AC 7). */
  pendingImport: GameState | null;
  /** `navigator.storage.persist()` was already asked this session (lancamento AC 20). */
  persistRequested: boolean;
  /** Correcoes-validacao AC 47: an error escaped an action or the clock; the error screen shows. */
  crashed: boolean;
  /** Correcoes-validacao AC 47: reports an error outside the render and shows the error screen. */
  crash(error: unknown): void;
  init(): Promise<void>;
  /** Correcoes-validacao AC 1, AC 3: reads the save again after a failed read. */
  retryLoad(): Promise<void>;
  /** Door 2: takes the game from the other tab, then reads the save again and opens it. */
  useThisTab(): Promise<void>;
  newGame(seed?: number): void;
  /** Dificuldade AC 2, AC 3: the level is kept in the game and sets the club's starting cash. */
  chooseClub(clubId: string, difficulty?: Difficulty): Promise<void>;
  /** Correcoes-validacao AC 11: lineup changes are saved; each resolves once its write is done. */
  setFormation(formation: FormationName): Promise<void>;
  setPosture(posture: Posture): Promise<void>;
  /** Treino-evolucao AC 13: the user's club's training, saved like the lineup. */
  setTraining(training: Training): Promise<void>;
  assignStarter(slotIndex: number, playerId: string): Promise<void>;
  /**
   * Plays the next date: a league round or a cup phase the user plays opens the live screen; a cup
   * phase without the user closes at once and shows its results (copa-nacional AC 44).
   */
  playRound(): Promise<void>;
  tick(): void;
  pause(): void;
  resume(): void;
  setSpeed(speed: Speed): void;
  skipToEnd(): Promise<void>;
  /** Posicao-na-substituicao: `target` is where the player coming on plays; the slot of who leaves by default. */
  substitute(slot: number, inId: string, target?: number): void;
  changeLiveFormation(formation: FormationName): void;
  changeLivePosture(posture: Posture): void;
  goToMarket(): void;
  goToFinance(): void;
  /** Market and finance actions (AC 15): each saves before the screen shows the new state. Resolve to accepted or not. */
  buyPlayer(playerId: string, offer: number): Promise<boolean>;
  acceptOffer(offerId: string): Promise<boolean>;
  rejectOffer(offerId: string): Promise<boolean>;
  toggleForSale(playerId: string): Promise<boolean>;
  releasePlayer(playerId: string): Promise<boolean>;
  signFreeAgent(playerId: string): Promise<boolean>;
  promoteJunior(playerId: string): Promise<boolean>;
  setTicketPrice(price: number): Promise<boolean>;
  expandStadium(): Promise<boolean>;
  takeLoan(amount: number): Promise<boolean>;
  repayLoan(amount: number): Promise<boolean>;
  /** AC 26. */
  renewContract(playerId: string): Promise<boolean>;
  /** Emprestimos AC 3: lends the user's player to the door-2 club. */
  loanOut(playerId: string): Promise<boolean>;
  /** Emprestimos AC 11: takes an AI club's reserve on loan. */
  loanIn(playerId: string): Promise<boolean>;
  /** Emprestimos AC 2, AC 5-7: the club a loan would go to, or null with the refusal in `marketMessage`. */
  checkLoanOut(playerId: string): string | null;
  /** Carreira-dinamica AC 10, AC 15: takes one of the pending offers, saves, then opens the new club's squad. */
  takeJob(clubId: string): Promise<boolean>;
  /** Carreira-dinamica AC 19: turns the pending offer down and saves. */
  declineJob(): Promise<void>;
  /** «Próxima temporada» (AC 10-15, 35): saves the new season, then shows «Nova temporada». */
  nextSeason(jobClubId?: string): Promise<void>;
  goToHistory(): void;
  goToCup(): void;
  continueGame(): void;
  goToSquad(): void;
  goHome(): void;
  goToAbout(): void;
  /** Varios-saves AC 9: the «Jogos salvos» screen. */
  goToSaves(): void;
  /** Varios-saves AC 13: makes `slot` active and opens its game. */
  openSlot(slot: number): Promise<void>;
  /** Varios-saves AC 15, AC 16: removes the game of `slot`. */
  deleteSlot(slot: number): Promise<void>;
  /**
   * Reads an exported file's text; a valid game goes to the first empty slot (varios-saves AC 20),
   * or waits for `confirmImport` after a failed read (AC 22).
   */
  importFile(text: string): Promise<void>;
  confirmImport(): Promise<void>;
  cancelImport(): void;
}

type Set = (partial: Partial<GameStore>) => void;
type Get = () => GameStore;

export const IMPORT_TEXT = {
  invalid: "Arquivo inválido: não é um jogo salvo",
  malformed: "Arquivo corrompido: não foi possível ler o jogo",
  version: (v: unknown) => `Versão do jogo salvo não suportada (${String(v)})`,
};

/** Lancamento AC 20-21: after the session's first good save, ask the browser not to evict the save. */
function requestPersistence(set: Set, get: Get): void {
  if (get().persistRequested) return;
  set({ persistRequested: true });
  try {
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (typeof storage?.persist === "function") void storage.persist().catch(() => undefined);
  } catch {
    // The browser said no; the game goes on.
  }
}

async function persist(game: GameState, set: Set, get: Get): Promise<void> {
  if (!isStorageAvailable()) {
    set({ saveStatus: "unavailable" });
    return;
  }
  // Door 2: a tab without the lock never writes.
  if (get().otherTab) return;
  // Varios-saves AC 2: the slot active when the write was asked for.
  const slot = get().activeSlot;
  const write = get().writeQueue.then(() => saveGame(game, slot));
  set({ writeQueue: write.catch(() => undefined) });
  try {
    await write;
    const slots = get().slots.map((s) => (s.slot === slot ? okView(slot, game, Date.now()) : s));
    set({ saveStatus: "ok", hasSave: true, slots, incompatibleVersion: incompatibleOf(slots), loadFailed: false });
  } catch {
    set({ saveStatus: "failed" });
    return;
  }
  requestPersistence(set, get);
}

/** Door 2 (correcoes-validacao): the Web Locks name that one tab at a time holds. */
export const TAB_LOCK = "forzion-futmanager-save";

function tabLocks(): LockManager | undefined {
  try {
    return typeof navigator === "undefined" ? undefined : navigator.locks;
  } catch {
    return undefined;
  }
}

/** The screen «Continuar» opens for this game; carreira-dinamica AC 8: a fired user picks a club first. */
function openingPhase(game: GameState): Phase {
  if (game.pendingJob?.reason === "fired") return "job";
  return isSeasonOver(userLeague(game)) ? "end" : "squad";
}

/** The screen after a date closes: the sacking (carreira-dinamica AC 7), the season's end, or the results. */
function afterDatePhase(game: GameState): Phase {
  if (game.pendingJob?.reason === "fired") return "job";
  return isSeasonOver(userLeague(game)) ? "end" : "round";
}

/** Returns a new state with the user's club replaced by `edit(club)`. */
function editUserClub(game: GameState, edit: (club: Club) => Club): GameState {
  if (!game.userClubId) return game;
  const league = userLeague(game);
  const clubs = league.clubs.map((c) => (c.id === game.userClubId ? edit(c) : c));
  return { ...game, leagues: game.leagues.map((l) => (l === league ? { ...league, clubs } : l)) };
}

export function userClub(game: GameState): Club | null {
  return game.userClubId ? findClub(userLeague(game), game.userClubId) : null;
}

/** Applies a finance action to the user's club. */
function withUserFinance(game: GameState, apply: (f: Finance) => finance.FinanceResult): ActionResult {
  const club = userClub(game);
  if (!club) return { ok: false, reason: "not_found" };
  const r = apply(club.finance);
  if (!r.ok) return r;
  return { ok: true, state: editUserClub(game, (c) => ({ ...c, finance: r.finance })) };
}

export const useGame = create<GameStore>()((set, get) => {
  /**
   * AC 15: the save is written first; only then does the game state (and the screen) change.
   * Correcoes-validacao AC 12: a lineup change made while it saves goes into the saved game too.
   */
  async function commit(action: (game: GameState) => ActionResult): Promise<boolean> {
    const { game, saving } = get();
    if (!game || saving) return false;
    const r = action(game);
    if (!r.ok) {
      // Correcoes-validacao AC 27: a refusal that still changed the game (an offer withdrawn) is
      // kept, saved first and shown with its message.
      if (r.state) {
        set({ saving: true });
        await persist(r.state, set, get);
        set({ game: r.state, saving: false, marketMessage: refusalText(r.reason, r.amount) });
      } else {
        set({ marketMessage: refusalText(r.reason, r.amount) });
      }
      return false;
    }
    set({ saving: true, pendingCommit: r.state });
    await persist(r.state, set, get);
    const final = get().pendingCommit ?? r.state;
    set({ pendingCommit: null });
    if (final !== r.state) await persist(final, set, get);
    set({ game: final, marketMessage: null, saving: false });
    return true;
  }

  /** Correcoes-validacao AC 11, AC 12: a lineup change shows at once and is saved. */
  function editLineup(edit: (game: GameState) => GameState): Promise<void> {
    const game = get().game;
    if (!game) return Promise.resolve();
    const next = edit(game);
    set({ game: next });
    const pending = get().pendingCommit;
    if (pending) {
      set({ pendingCommit: edit(pending) });
      return Promise.resolve();
    }
    return persist(next, set, get);
  }

  /**
   * Lancamento AC 6 and AC 14: the imported game is written to the slot and opens even if the
   * write fails. Correcoes-validacao AC 5: it opens first; one that does not open is not written.
   */
  /** Varios-saves AC 20: the imported game goes to `slot`, which becomes the active one. */
  async function openImported(game: GameState, slot = get().activeSlot): Promise<void> {
    let phase: Phase;
    try {
      phase = openingPhase(game);
    } catch {
      set({ importMessage: IMPORT_TEXT.malformed, pendingImport: null });
      return;
    }
    set({ activeSlot: slot, game, pendingImport: null, importMessage: null, lastRound: null, live: null, rolloverReport: null });
    await persist(game, set, get);
    set({ phase });
  }

  /**
   * Door 2 (correcoes-validacao): resolves true once this tab holds the lock, false when another
   * tab has it, and true without Web Locks. The lock is kept for the life of the page; losing it
   * to another tab turns this one into «O jogo está aberto em outra aba».
   */
  function holdTabLock(steal: boolean): Promise<boolean> {
    const locks = tabLocks();
    if (!locks) return Promise.resolve(true);
    return new Promise((resolve) => {
      let granted = false;
      const options: LockOptions = steal ? { steal: true } : { ifAvailable: true };
      try {
        locks
          .request(TAB_LOCK, options, (lock) => {
            if (!lock) {
              resolve(false);
              return;
            }
            granted = true;
            set({ otherTab: false });
            resolve(true);
            return new Promise<void>(() => undefined);
          })
          .catch(() => {
            if (granted) set({ otherTab: true });
            else resolve(true);
          });
      } catch {
        resolve(true);
      }
    });
  }

  /**
   * Door 1 (correcoes-validacao): the save was left in the middle of a live date. The date is
   * played to its end with no decisions, from the saved state and lineup, and saved without the mark.
   */
  async function closePendingLive(saved: GameState): Promise<void> {
    const { pendingLive, ...game } = saved;
    void pendingLive;
    const date = nextDate(game);
    if (date.kind === "over") {
      set({ phase: "home", game, hasSave: true });
      return;
    }
    // AD-022: nobody decides for the user any more, so the user's holes are filled by the AI's rule.
    const live = runToEnd(date.kind === "league" ? startRound(game) : startCupDate(game), { fillUserVacancies: true });
    const { state, ...lastRound } = live.cup ? finishCupDate(game, live) : finishRound(game, live);
    set({ game: state, lastRound, hasSave: true, live: null });
    await persist(state, set, get);
    set({ phase: afterDatePhase(state) });
  }

  /**
   * Reads the slots and opens the active one (varios-saves AC 4-6). A read that fails is
   * `loadFailed`, not «no save» (correcoes-validacao AC 1); then slot 1 is the one written.
   */
  async function readSlots(): Promise<void> {
    let entries: SlotEntry[];
    try {
      entries = await listSaves();
    } catch {
      set({ phase: "home", game: null, hasSave: false, saveStatus: "failed", loadFailed: true, slots: emptySlots(), activeSlot: 1 });
      return;
    }
    const slots = entries.map(slotView);
    const activeSlot = activeSlotOf(slots);
    set({ loadFailed: false, slots, activeSlot, incompatibleVersion: incompatibleOf(slots) });
    const entry = entries[activeSlot - 1];
    if (entry?.kind === "ok" && entry.state.pendingLive) await closePendingLive(entry.state);
    else if (entry?.kind === "ok") set({ phase: "home", game: entry.state, hasSave: true });
    else set({ phase: "home", game: null, hasSave: false });
  }

  /** Closes the live round at 90': results, condition, save, then the results screen. */
  async function finishLive(): Promise<void> {
    const { game, live, finishing } = get();
    if (!game || !live || finishing) return;
    set({ finishing: true });
    const { state, ...lastRound } = live.cup ? finishCupDate(game, live) : finishRound(game, live);
    set({ game: state, lastRound });
    await persist(state, set, get);
    set({ phase: afterDatePhase(state), live: null, finishing: false });
  }

  /** Applies a decision to the user's side, only while the clock is stopped. */
  function decide(apply: (live: LiveRound, clubId: string) => LiveRound | { refused: SubRefusal }): void {
    const { live, clock, game, finishing } = get();
    if (!live || !game?.userClubId || clock === "running" || finishing) return;
    const out = apply(live, game.userClubId);
    if ("refused" in out) set({ liveMessage: REFUSAL_TEXT[out.refused] });
    else set({ live: out, liveMessage: null });
  }

  return {
    phase: "loading",
    game: null,
    hasSave: false,
    slots: emptySlots(),
    activeSlot: 1,
    savesNotice: null,
    loadFailed: false,
    openFailed: false,
    otherTab: false,
    booting: false,
    pendingCommit: null,
    writeQueue: Promise.resolve(),
    incompatibleVersion: null,
    saveStatus: "ok",
    lastRound: null,
    live: null,
    clock: "paused",
    speed: 1,
    liveMessage: null,
    liveStop: null,
    finishing: false,
    skipped: false,
    marketMessage: null,
    saving: false,
    rolloverReport: null,
    importMessage: null,
    pendingImport: null,
    persistRequested: false,
    crashed: false,

    crash(error) {
      console.error(error);
      set({ crashed: true });
    },

    async init() {
      // Only the first mount reads storage; StrictMode's second effect run is a no-op.
      if (get().phase !== "loading" || get().booting) return;
      set({ booting: true });
      if (!isStorageAvailable()) {
        set({ phase: "home", saveStatus: "unavailable", hasSave: false, game: null, booting: false });
        return;
      }
      // Door 2: another tab has the game, so this one neither reads nor writes.
      if (!(await holdTabLock(false))) {
        set({ phase: "home", otherTab: true, booting: false });
        return;
      }
      await readSlots();
      set({ booting: false });
    },

    async retryLoad() {
      set({ phase: "loading", loadFailed: false });
      await readSlots();
    },

    async useThisTab() {
      if (!(await holdTabLock(true))) return;
      set({ phase: "loading", otherTab: false, game: null, live: null, lastRound: null, finishing: false, saving: false, pendingCommit: null, pendingImport: null });
      await readSlots();
      if (get().phase === "home" && get().hasSave) get().continueGame();
    },

    newGame(seed = randomSeed()) {
      // Varios-saves AC 18, AC 19: the first empty slot; after a failed read, slot 1 (AC 22).
      let activeSlot = get().activeSlot;
      if (!get().loadFailed) {
        const free = get().slots.find((s) => s.kind === "empty");
        if (!free) return set({ phase: "saves", savesNotice: SAVES_TEXT.fullNew });
        activeSlot = free.slot;
      }
      set({ activeSlot, hasSave: false, game: generateNewGame(seed), phase: "chooseClub", lastRound: null, live: null });
    },

    async chooseClub(clubId, difficulty = "normal") {
      const game = get().game;
      if (!game) return;
      const cash = (c: Club) => Math.round((c.finance.cash * difficultyOf({ difficulty }).cash) / 100_000) * 100_000;
      const chosen = editUserClub({ ...game, userClubId: clubId, difficulty }, (club) => ({
        ...club,
        lineup: autoLineup(club, AI_FORMATION),
        // Ajustes-importacao C1: the loan limit follows the cash the level gave.
        finance: { ...club.finance, cash: cash(club), loanLimit: finance.LOAN_LIMIT_CASH * cash(club) },
      }));
      // AC 30: the board sets the goal when the manager arrives.
      const next = { ...chosen, boardGoal: userBoardGoal(chosen), cupGoal: userCupGoal(chosen) };
      set({ game: next });
      await persist(next, set, get);
      set({ phase: "squad" });
    },

    setFormation(formation) {
      // Correcoes-validacao AC 21: filled for the next match's competition, keeping the posture.
      return editLineup((game) =>
        editUserClub(game, (club) => ({ ...club, lineup: autoLineup(club, formation, club.lineup?.posture ?? "balanced", 0, nextCompetition(game)) })),
      );
    },

    setPosture(posture) {
      return editLineup((game) => editUserClub(game, (club) => (club.lineup ? { ...club, lineup: { ...club.lineup, posture } } : club)));
    },

    setTraining(training) {
      return editLineup((game) => editUserClub(game, (club) => ({ ...club, training })));
    },

    assignStarter(slotIndex, playerId) {
      return editLineup((game) =>
        editUserClub(game, (club) => {
          // Correcoes-validacao AC 19, AC 20: the discipline of the next match's competition.
          const lineup = club.lineup ? assignSlot(club, club.lineup, slotIndex, playerId, nextCompetition(game)) : null;
          return lineup ? { ...club, lineup } : club;
        }),
      );
    },

    async playRound() {
      const { game, finishing } = get();
      // Carreira-dinamica AC 8: a fired user plays nothing until a club is picked.
      if (!game || finishing || game.pendingJob?.reason === "fired") return;
      const date = nextDate(game);
      if (date.kind === "over") return;
      // Door 1 (correcoes-validacao): the state from before the date is saved with the mark, queued
      // ahead of the write that closes the date.
      const goLive = async (live: LiveRound) => {
        set({ live, phase: "live", clock: "running", speed: 1, liveMessage: null, liveStop: null, finishing: false, skipped: false, lastRound: null });
        await persist({ ...game, pendingLive: true }, set, get);
      };
      if (date.kind === "league") return goLive(startRound(game));
      const live = startCupDate(game);
      const plays = game.cups[date.cupIndex]!.phases[date.phase]!.ties.some((t) => t.homeId === game.userClubId || t.awayId === game.userClubId);
      if (plays) return goLive(live);
      // AC 44: the user is out of this cup date, so it closes without the live screen.
      set({ finishing: true, lastRound: null });
      const { state, ...lastRound } = finishCupDate(game, live);
      set({ game: state, lastRound });
      await persist(state, set, get);
      set({ phase: "round", live: null, finishing: false });
    },

    tick() {
      const { live, clock, finishing } = get();
      if (!live || clock !== "running" || finishing) return;
      const next = step(live);
      set({ live: next });
      if (next.minute === HALFTIME) set({ clock: "halftime" });
      // Parada-obrigatoria C5: an injury or a red card of the user's stops the clock before 90'.
      const stops = userStops(next);
      if (stops.length > 0 && next.minute < MATCH_MINUTES) set({ clock: next.minute === HALFTIME ? "halftime" : "paused", liveStop: stops });
      // Correcoes-validacao AC 47: a date that fails to close shows the error screen.
      if (next.minute >= MATCH_MINUTES) void finishLive().catch((e: unknown) => get().crash(e));
    },

    pause() {
      if (get().clock === "running") set({ clock: "paused" });
    },

    resume() {
      const { live, finishing } = get();
      // Parada-obrigatoria C6: an empty slot the user must fill keeps the clock stopped.
      if (!live || finishing || forcedVacancy(live)) return;
      set({ clock: "running", liveMessage: null, liveStop: null });
    },

    setSpeed(speed) {
      set({ speed });
    },

    async skipToEnd() {
      const live = get().live;
      if (!live || get().finishing) return;
      set({ live: runToEnd(live, { fillUserVacancies: true }), clock: "paused", skipped: true, liveStop: null });
      await finishLive().catch((e: unknown) => get().crash(e));
    },

    substitute(slot, inId, target) {
      decide((live, clubId) => {
        const r = substitute(live, clubId, slot, inId, target);
        return r.ok ? r.live : { refused: r.reason };
      });
    },

    changeLiveFormation(formation) {
      decide((live, clubId) => changeFormation(live, clubId, formation));
    },

    changeLivePosture(posture) {
      decide((live, clubId) => changePosture(live, clubId, posture));
    },

    goToMarket() {
      set({ phase: "market", marketMessage: null });
    },

    goToFinance() {
      set({ phase: "finance", marketMessage: null });
    },

    buyPlayer: (playerId, offer) => commit((g) => market.buyPlayer(g, playerId, offer)),
    acceptOffer: (offerId) => commit((g) => market.acceptOffer(g, offerId)),
    rejectOffer: (offerId) => commit((g) => market.rejectOffer(g, offerId)),
    toggleForSale: (playerId) => commit((g) => market.toggleForSale(g, playerId)),
    releasePlayer: (playerId) => commit((g) => market.releasePlayer(g, playerId)),
    signFreeAgent: (playerId) => commit((g) => market.signFreeAgent(g, playerId)),
    promoteJunior: (playerId) => commit((g) => market.promoteJunior(g, playerId)),
    setTicketPrice: (price) => commit((g) => withUserFinance(g, (f) => finance.setTicketPrice(f, price))),
    expandStadium: () => commit((g) => withUserFinance(g, (f) => finance.expandStadium(f))),
    takeLoan: (amount) => commit((g) => withUserFinance(g, (f) => finance.takeLoan(f, amount))),
    repayLoan: (amount) => commit((g) => withUserFinance(g, (f) => finance.repayLoan(f, amount))),
    renewContract: (playerId) => commit((g) => market.renewContract(g, playerId)),
    loanOut: (playerId) => commit((g) => market.loanOut(g, playerId)),
    loanIn: (playerId) => commit((g) => market.loanIn(g, playerId)),

    checkLoanOut(playerId) {
      const { game } = get();
      if (!game) return null;
      const r = market.loanOutCheck(game, playerId);
      if (r.ok) {
        set({ marketMessage: null });
        return r.clubId;
      }
      set({ marketMessage: refusalText(r.reason) });
      return null;
    },

    async takeJob(clubId) {
      const { game, saving } = get();
      if (!game || saving) return false;
      const r = takeJob(game, clubId);
      if (!r.ok) return false;
      set({ saving: true });
      await persist(r.state, set, get);
      set({ game: r.state, saving: false, phase: "squad", lastRound: null, marketMessage: null });
      return true;
    },

    async declineJob() {
      const { game, saving } = get();
      if (!game || saving || game.pendingJob?.reason !== "offer") return;
      const { pendingJob, ...next } = game;
      void pendingJob;
      set({ saving: true });
      await persist(next, set, get);
      set({ game: next, saving: false });
    },

    async nextSeason(jobClubId) {
      const { game, saving } = get();
      if (!game || saving || !isSeasonOver(userLeague(game))) return;
      set({ saving: true });
      const { state, report } = rollOver(game, jobClubId);
      await persist(state, set, get);
      set({ game: state, rolloverReport: report, phase: "newSeason", saving: false, lastRound: null, marketMessage: null });
    },

    goToHistory() {
      set({ phase: "history", marketMessage: null });
    },

    goToCup() {
      set({ phase: "cup", marketMessage: null });
    },

    continueGame() {
      const game = get().game;
      if (!game) return;
      // Varios-saves AC 13: a slot opened with a pending live date plays it first (AD-019).
      if (game.pendingLive) {
        void closePendingLive(game).then(() => {
          if (get().phase === "home" && get().game && !get().game!.pendingLive) get().continueGame();
        });
        return;
      }
      // Correcoes-validacao AC 6: a save that does not open says so instead of ignoring the tap.
      let phase: Phase;
      try {
        phase = openingPhase(game);
      } catch {
        set({ openFailed: true });
        return;
      }
      set({ phase, lastRound: null, live: null, openFailed: false });
    },

    goToSquad() {
      set({ phase: "squad", marketMessage: null });
    },

    goHome() {
      set({ phase: "home", savesNotice: null });
    },

    goToAbout() {
      set({ phase: "about" });
    },

    goToSaves() {
      set({ phase: "saves", savesNotice: null });
    },

    async openSlot(slot) {
      let r: LoadResult;
      try {
        r = await loadGame(slot);
      } catch {
        set({ openFailed: true });
        return;
      }
      if (r.kind !== "ok") return;
      set({ activeSlot: slot, game: r.state, hasSave: true, lastRound: null, live: null, rolloverReport: null, openFailed: false });
      get().continueGame();
    },

    async deleteSlot(slot) {
      // After any write still queued, so a pending write cannot bring the game back.
      const removal = get().writeQueue.then(() => deleteGame(slot));
      set({ writeQueue: removal.catch(() => undefined) });
      try {
        await removal;
      } catch {
        set({ saveStatus: "failed" });
        return;
      }
      let entries: SlotEntry[] | null = null;
      try {
        entries = await listSaves();
      } catch {
        // The slot is gone either way.
      }
      const slots = entries ? entries.map(slotView) : get().slots.map((s): SlotView => (s.slot === slot ? { slot, kind: "empty" } : s));
      set({ slots, incompatibleVersion: incompatibleOf(slots) });
      if (slot !== get().activeSlot) return;
      // AC 16: the slot AC 4 would pick among the rest.
      const activeSlot = activeSlotOf(slots);
      const entry = entries?.[activeSlot - 1];
      set({ activeSlot, game: entry?.kind === "ok" ? entry.state : null, hasSave: entry?.kind === "ok", lastRound: null, live: null });
    },

    async importFile(text) {
      const r = decodeSaveFile(text);
      if (r.kind === "invalid_json" || r.kind === "not_a_save") return set({ importMessage: IMPORT_TEXT.invalid, pendingImport: null });
      if (r.kind === "malformed") return set({ importMessage: IMPORT_TEXT.malformed, pendingImport: null });
      if (r.kind === "unsupported_version") return set({ importMessage: IMPORT_TEXT.version(r.version), pendingImport: null });
      // Correcoes-validacao AC 2: a failed read may hide a save, so it asks (varios-saves AC 22).
      if (get().loadFailed) return set({ pendingImport: r.state, importMessage: null });
      // Varios-saves AC 20, AC 21: the first empty slot, never over a game.
      const free = get().slots.find((s) => s.kind === "empty");
      if (!free) return set({ phase: "saves", savesNotice: SAVES_TEXT.fullImport, importMessage: null });
      await openImported(r.state, free.slot);
    },

    async confirmImport() {
      const game = get().pendingImport;
      if (game) await openImported(game);
    },

    cancelImport() {
      set({ pendingImport: null });
    },
  };
});
