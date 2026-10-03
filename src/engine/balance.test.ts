import { userBoardGoal, userCupGoal } from "./board";
import { nextCompetition, nextDate } from "./calendar";
import { newGame } from "./generate";
import { AI_FORMATION, autoLineup, formationSlots, validateLineup } from "./lineup";
import { PENALTY_PER_CHANCE, PENALTY_SAVED_SHARE, penaltyChance } from "./live";
import { simulateMatch, type TeamSheet } from "./match";
import { acceptOffer, marketValue, signFreeAgent, signingFee, toggleForSale } from "./market";
import { createRng } from "./rng";
import { nextSeason } from "./rollover";
import { allClubs, playDate, playRound, seasonReview } from "./season";
import type { Country, FormationName, GameState, PlayerCore, Posture, TransferRecord } from "./types";

function flatSheet(clubId: string, rating: number, posture: Posture = "balanced", formation: FormationName = "4-4-2"): TeamSheet {
  const starters: PlayerCore[] = formationSlots(formation).map((position, i) => ({
    id: `${clubId}-${i}`,
    name: `${clubId} ${i}`,
    position,
    age: 25,
    rating,
  }));
  return { clubId, starters, posture };
}

/** Per-match means over seeds 1..n: shots and goals by side, cards and injuries. */
function tally(home: TeamSheet, away: TeamSheet, n = 2000) {
  const t = { homeShots: 0, awayShots: 0, homeConceded: 0, yellows: 0, reds: 0, injuries: 0 };
  for (let seed = 1; seed <= n; seed++) {
    const { result, events } = simulateMatch(home, away, createRng(seed));
    t.homeConceded += result.awayGoals;
    for (const e of events) {
      const shot = e.type === "goal" || e.type === "shot_saved" || e.type === "shot_missed";
      if (shot && e.clubId === home.clubId) t.homeShots++;
      if (shot && e.clubId === away.clubId) t.awayShots++;
      if (e.type === "yellow") t.yellows++;
      if (e.type === "red") t.reds++;
      if (e.type === "injury") t.injuries++;
    }
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v / n])) as typeof t;
}

function run(homeRating: number, awayRating: number, n = 2000) {
  let goals = 0;
  let homeWins = 0;
  let draws = 0;
  for (let seed = 1; seed <= n; seed++) {
    const { result } = simulateMatch(flatSheet("H", homeRating), flatSheet("A", awayRating), createRng(seed));
    goals += result.homeGoals + result.awayGoals;
    if (result.homeGoals > result.awayGoals) homeWins++;
    else if (result.homeGoals === result.awayGoals) draws++;
  }
  return { meanGoals: goals / n, homeWinRate: homeWins / n, drawRate: draws / n };
}

describe("balanceamento", () => {
  test("times iguais", () => {
    const r = run(70, 70);
    expect(r.meanGoals).toBeGreaterThanOrEqual(2.3);
    expect(r.meanGoals).toBeLessThanOrEqual(3.1);
    expect(r.homeWinRate).toBeGreaterThanOrEqual(0.4);
    expect(r.homeWinRate).toBeLessThanOrEqual(0.52);
  });

  test("forte contra fraco", () => {
    const r = run(85, 55);
    expect(r.homeWinRate).toBeGreaterThanOrEqual(0.75);
  });

  test("postura ofensiva cria e sofre mais finalizações", () => {
    const balanced = tally(flatSheet("H", 70), flatSheet("A", 70));
    const attacking = tally(flatSheet("H", 70, "attacking"), flatSheet("A", 70));
    expect(attacking.homeShots).toBeGreaterThanOrEqual(balanced.homeShots * 1.15);
    expect(attacking.awayShots).toBeGreaterThan(balanced.awayShots);
  });

  test("postura defensiva sofre menos gols", () => {
    const balanced = tally(flatSheet("H", 70), flatSheet("A", 70));
    const defensive = tally(flatSheet("H", 70, "defensive"), flatSheet("A", 70));
    expect(defensive.homeConceded).toBeLessThanOrEqual(balanced.homeConceded * 0.85);
  });

  test("taxa de cartões", () => {
    const t = tally(flatSheet("H", 70), flatSheet("A", 70));
    expect(t.yellows).toBeGreaterThanOrEqual(3.0);
    expect(t.yellows).toBeLessThanOrEqual(5.5);
    expect(t.reds).toBeGreaterThanOrEqual(0.08);
    expect(t.reds).toBeLessThanOrEqual(0.3);
  });

  test("taxa de lesões", () => {
    const t = tally(flatSheet("H", 70), flatSheet("A", 70));
    expect(t.injuries).toBeGreaterThanOrEqual(0.1);
    expect(t.injuries).toBeLessThanOrEqual(0.4);
  });
});

describe("equilíbrio financeiro", () => {
  test("caixa equilibrado em uma temporada", () => {
    // Gastos-da-ia C34 (Superseded checks): the running result of the 38 league rounds only -
    // tickets, sponsorship, salaries and interest; cup dates, prizes, transfers and works stay out.
    const ratios: number[] = [];
    for (let seed = 1; seed <= 5; seed++) {
      let state = newGame(seed);
      const serieA = state.leagues[0]!.clubs.map((c) => c.id);
      const running = new Map(state.leagues[0]!.clubs.map((c) => [c.id, c.finance.cash]));
      const initial = new Map(running);
      let leagueRounds = 0;
      while (nextDate(state).kind !== "over") {
        const date = nextDate(state);
        state = playDate(state).state;
        if (date.kind !== "league") continue;
        leagueRounds++;
        const clubs = state.leagues.flatMap((l) => l.clubs);
        for (const id of serieA) {
          const l = clubs.find((c) => c.id === id)!.finance.lastRound!;
          running.set(id, running.get(id)! + l.tickets + l.sponsorship - l.salaries - l.interest);
        }
      }
      expect(leagueRounds).toBe(38);
      for (const id of serieA) ratios.push(running.get(id)! / initial.get(id)!);
    }
    expect(ratios).toHaveLength(100);
    report("C34 uma temporada", ratios);
    for (const r of ratios) {
      expect(r).toBeGreaterThanOrEqual(0.5);
      expect(r).toBeLessThanOrEqual(2.5);
    }
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = (sorted[49]! + sorted[50]!) / 2;
    expect(median).toBeGreaterThanOrEqual(0.9);
    expect(median).toBeLessThanOrEqual(1.6);
  }, 90_000);
});

/** Min / median / max of a list, printed so a run shows the measured band. */
function report(label: string, values: number[]): void {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  console.log(`${label}: ${sorted[0]!.toFixed(2)} / ${median.toFixed(2)} / ${sorted[sorted.length - 1]!.toFixed(2)}`);
}

/** Five seasons of three seeds with no user, played once and shared by the checks below. */
const SEASONS = 5;
const MULTI_SEEDS = [1, 2, 3];
const best18 = (ratings: number[]) => [...ratings].sort((a, b) => b - a).slice(0, 18).reduce((a, b) => a + b, 0) / Math.min(18, ratings.length);

interface Run {
  /** Per season start, per league (in `leagues` order): mean over clubs of the best-18 mean. */
  strength: number[][];
  /** The country of each league, in `leagues` order, at the start. */
  countries: Country[];
  /** Final cash / initial cash, per club, with the country of the league it started in. */
  cash: { country: Country; ratio: number }[];
  /** Paises C33: after every round and every turn of the season, clubs in a league of another country than at the start. */
  countryMoves: string[];
  /** Per season: the transfer list just before the turn of the season. */
  transfers: TransferRecord[][];
  /** Per season: players at another club of Brazil after a round than before it, from the squads alone (paises C26). */
  moved: number[];
  /**
   * Per season: rounds whose squads afterwards differ from the squads before with the round's
   * transfer lines replayed in order (a buy moves `fromId` -> `toId`, a release takes the player
   * out, a free signing brings one in).
   */
  unexplained: number[];
}

/** Which club each player is at. */
const clubOf = (state: GameState) => new Map(state.leagues.flatMap((l) => l.clubs).flatMap((c) => c.players.map((p) => [p.id, c.id] as const)));

let runs: Run[] | null = null;
function multiSeason(): Run[] {
  if (runs) return runs;
  runs = MULTI_SEEDS.map((seed) => {
    let state = newGame(seed);
    const initial = new Map(state.leagues.flatMap((l) => l.clubs).map((c) => [c.id, c.finance.cash]));
    const startCountry = new Map(state.leagues.flatMap((l) => l.clubs.map((c) => [c.id, l.country] as const)));
    const countries = state.leagues.map((l) => l.country);
    const countryMoves: string[] = [];
    const checkCountries = (label: string) => {
      for (const l of state.leagues) for (const c of l.clubs) if (startCountry.get(c.id) !== l.country) countryMoves.push(`${label} ${c.id} em ${l.id}`);
    };
    const strength: number[][] = [];
    const transfers: TransferRecord[][] = [];
    const moved: number[] = [];
    const unexplained: number[] = [];
    for (let season = 1; season <= SEASONS; season++) {
      strength.push(state.leagues.map((l) => l.clubs.reduce((sum, c) => sum + best18(c.players.map((p) => p.rating)), 0) / l.clubs.length));
      let movedNow = 0;
      let unexplainedNow = 0;
      for (let r = 0; r < 38; r++) {
        const before = clubOf(state);
        const seen = state.market.transfers.length;
        state = playRound(state).state;
        checkCountries(`seed ${seed} temporada ${season} rodada ${r + 1}`);
        const after = clubOf(state);
        for (const [id, clubId] of after) {
          const from = before.get(id);
          if (from !== undefined && from !== clubId && startCountry.get(clubId) === "BR") movedNow++;
        }
        const replay = new Map(before);
        let consistent = true;
        for (const t of state.market.transfers.slice(seen)) {
          if ((replay.get(t.playerId) ?? null) !== t.fromId) consistent = false;
          if (t.toId === null) replay.delete(t.playerId);
          else replay.set(t.playerId, t.toId);
        }
        const same = replay.size === after.size && [...after].every(([id, clubId]) => replay.get(id) === clubId);
        if (!consistent || !same) unexplainedNow++;
      }
      moved.push(movedNow);
      unexplained.push(unexplainedNow);
      transfers.push(state.market.transfers);
      if (season < SEASONS) {
        state = nextSeason(state).state;
        checkCountries(`seed ${seed} virada ${season}`);
      }
    }
    const cash = state.leagues.flatMap((l) => l.clubs).map((c) => ({ country: startCountry.get(c.id)!, ratio: c.finance.cash / initial.get(c.id)! }));
    return { strength, countries, cash, countryMoves, transfers, moved, unexplained };
  });
  return runs;
}

describe("equilíbrio em várias temporadas", () => {
  test("força estável em 5 temporadas", () => {
    // Gastos-da-ia C21 (Superseded checks): the limit is 5 points, was 4.
    // Paises C26 (Superseded checks): measured over the leagues of Brazil only.
    let drift = 0;
    for (const [k, run] of multiSeason().entries()) {
      for (const [season, divisions] of run.strength.entries()) {
        divisions.forEach((mean, d) => {
          if (run.countries[d] !== "BR") return;
          drift = Math.max(drift, Math.abs(mean - run.strength[0]![d]!));
          expect(Math.abs(mean - run.strength[0]![d]!), `seed ${MULTI_SEEDS[k]} temporada ${season + 1} divisão ${d}`).toBeLessThanOrEqual(5);
        });
      }
    }
    console.log(`C21 deriva máxima: ${drift.toFixed(2)}`);
  }, 120_000);

  test("caixa em 5 temporadas", () => {
    // Gastos-da-ia C19 (Superseded checks): −2× to 15×, median 2× to 4×; was −2× to 30×, median 3× to 10×.
    // Correcoes-validacao C34: median 2× to 6,5×, was 4× (user's decision; the rest unchanged).
    // Treino-evolucao (Superseded checks): at most 18×, was 15× (user's decision; the evolution per
    // round moves the one club at the top between 15,2× and 17,3×).
    // Paises C26 (Superseded checks): the clubs that started in the leagues of Brazil only.
    const ratios = multiSeason().flatMap((r) => r.cash.filter((c) => c.country === "BR").map((c) => c.ratio));
    expect(ratios).toHaveLength(120);
    report("C19 caixa em 5 temporadas", ratios);
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = (sorted[59]! + sorted[60]!) / 2;
    for (const r of ratios) {
      expect(r).toBeGreaterThanOrEqual(-2);
      expect(r).toBeLessThanOrEqual(18);
    }
    expect(median).toBeGreaterThanOrEqual(2);
    expect(median).toBeLessThanOrEqual(6.5);
  }, 120_000);

  test("compras da IA em 5 temporadas", () => {
    for (const [k, run] of multiSeason().entries()) {
      // Paises C26 (Superseded checks): the buys of the clubs of Brazil, c1-c40 by door 1.
      const brazil = (id: string | null) => id !== null && Number(id.slice(1)) <= 40;
      const buys = run.transfers.map((list) => list.filter((t) => t.kind === "buy" && brazil(t.toId)).length);
      console.log(`C20 seed ${MULTI_SEEDS[k]}: compras por temporada ${buys.join(", ")}; movimentos ${run.transfers.map((l) => l.length).join(", ")}`);
      console.log(`C20 seed ${MULTI_SEEDS[k]}: jogadores que mudaram de clube por temporada ${run.moved.join(", ")}`);
      // L-015: the lines are checked against the squads. Replaying each round's lines over the
      // squads before it gives the squads after it, so every buy line is one player leaving
      // one club for another. A player bought twice in the same round counts once in the
      // squads, so the squads alone give a lower bound on the buys.
      expect(run.unexplained, `seed ${MULTI_SEEDS[k]}`).toEqual([0, 0, 0, 0, 0]);
      for (const [season, n] of buys.entries()) {
        expect(run.moved[season]!, `seed ${MULTI_SEEDS[k]} temporada ${season + 1}`).toBeGreaterThan(0);
        expect(n, `seed ${MULTI_SEEDS[k]} temporada ${season + 1}`).toBeGreaterThanOrEqual(run.moved[season]!);
      }
      for (const [season, n] of buys.entries()) expect(n, `seed ${MULTI_SEEDS[k]} temporada ${season + 1}`).toBeGreaterThan(0);
      const total = buys.reduce((a, b) => a + b, 0);
      expect(total, `seed ${MULTI_SEEDS[k]}`).toBeGreaterThanOrEqual(50);
      expect(total, `seed ${MULTI_SEEDS[k]}`).toBeLessThanOrEqual(600);
    }
  }, 120_000);

  test("uma compra por jogador por temporada", () => {
    // Ajustes-4a AC 8: the list is read just before each turn of the season.
    let most = 0;
    for (const [k, run] of multiSeason().entries()) {
      expect(run.transfers).toHaveLength(SEASONS);
      for (const [season, list] of run.transfers.entries()) {
        const buys = new Map<string, number>();
        for (const t of list) if (t.kind === "buy") buys.set(t.playerId, (buys.get(t.playerId) ?? 0) + 1);
        expect(buys.size, `seed ${MULTI_SEEDS[k]} temporada ${season + 1}`).toBeGreaterThan(0);
        const max = Math.max(...buys.values());
        most = Math.max(most, max);
        expect(max, `seed ${MULTI_SEEDS[k]} temporada ${season + 1}`).toBeLessThanOrEqual(1);
      }
    }
    console.log(`AC 8 maior número de compras de um jogador numa temporada: ${most}`);
  }, 120_000);

  test("boletim só com os três tipos", () => {
    for (const [k, run] of multiSeason().entries()) {
      expect(run.transfers).toHaveLength(SEASONS);
      for (const [season, list] of run.transfers.entries()) {
        expect(list.length, `seed ${MULTI_SEEDS[k]} temporada ${season + 1}`).toBeGreaterThan(0);
        const kinds = new Set(list.map((t) => t.kind));
        for (const kind of kinds) expect(["buy", "free", "release"], `seed ${MULTI_SEEDS[k]} temporada ${season + 1}`).toContain(kind);
      }
    }
  }, 120_000);
  test("caixa em 5 temporadas dos países novos", () => {
    // Paises C24 (AC 23): every club of the Liga Argentina and the Liga Portuguesa between −2× and
    // 15× its initial cash, the median of each league between 1,2× and 4× (floor renegotiated from 2×).
    // Correcoes-validacao C34: the median's ceiling is 6,5×, was 4× (user's decision; the rest unchanged).
    const all = multiSeason().flatMap((r) => r.cash);
    for (const country of ["AR", "PT"] as const) {
      const ratios = all.filter((c) => c.country === country).map((c) => c.ratio);
      expect(ratios, country).toHaveLength(60);
      report(`C24 caixa em 5 temporadas ${country}`, ratios);
      for (const r of ratios) {
        expect(r, country).toBeGreaterThanOrEqual(-2);
        expect(r, country).toBeLessThanOrEqual(15);
      }
      const sorted = [...ratios].sort((a, b) => a - b);
      const median = (sorted[29]! + sorted[30]!) / 2;
      expect(median, country).toBeGreaterThanOrEqual(1.2);
      expect(median, country).toBeLessThanOrEqual(6.5);
    }
  }, 120_000);

  test("força estável dos países novos", () => {
    // Paises C25 (AC 24): the mean best 18 of the Liga Argentina and the Liga Portuguesa stays
    // within 5 points of season 1, every season.
    for (const [k, run] of multiSeason().entries()) {
      expect(run.countries, `seed ${MULTI_SEEDS[k]}`).toEqual(["BR", "BR", "AR", "PT"]);
      for (const d of [2, 3]) {
        const drift = run.strength.map((divisions) => Math.abs(divisions[d]! - run.strength[0]![d]!));
        console.log(`C25 seed ${MULTI_SEEDS[k]} ${run.countries[d]}: deriva ${drift.map((x) => x.toFixed(2)).join(", ")}`);
        expect(run.strength, `seed ${MULTI_SEEDS[k]}`).toHaveLength(SEASONS);
        for (const [season, x] of drift.entries()) {
          expect(x, `seed ${MULTI_SEEDS[k]} temporada ${season + 1} ${run.countries[d]}`).toBeLessThanOrEqual(5);
        }
      }
    }
  }, 120_000);

  test("clube nunca muda de país", () => {
    // Paises C33 (door 1): after every round and every turn of the season of 5 seasons of seeds 1-3.
    for (const run of multiSeason()) expect(run.countryMoves).toEqual([]);
  }, 120_000);
});

describe("partida coerente (correcoes-validacao)", () => {
  test("conversão sem goleiro", () => {
    // C43 (AC 39): 2000 matches against a 4-4-2 with no keeper (ten outfield players).
    const home = flatSheet("H", 70);
    const away = flatSheet("A", 70);
    away.starters = away.starters.filter((p) => p.position !== "GK");
    expect(away.starters).toHaveLength(10);
    let goals = 0;
    let onTarget = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      for (const e of simulateMatch(home, away, createRng(seed)).events) {
        if (e.clubId !== "H") continue;
        if (e.type === "goal") goals++;
        if (e.type === "goal" || e.type === "shot_saved") onTarget++;
      }
    }
    console.log(`C43 conversão contra time sem goleiro: ${(goals / onTarget).toFixed(3)} (${goals}/${onTarget})`);
    expect(onTarget).toBeGreaterThan(0);
    expect(goals / onTarget).toBeLessThan(0.8);
  });

  test("formação muda o placar", () => {
    // C46 (AC 42): the same clubs, 70 against 70; the home side in 4-3-3 and then in 4-5-1, against a 4-4-2.
    const homeGoals = (formation: FormationName) => {
      let goals = 0;
      for (let seed = 1; seed <= 2000; seed++) goals += simulateMatch(flatSheet("H", 70, "balanced", formation), flatSheet("A", 70), createRng(seed)).result.homeGoals;
      return goals / 2000;
    };
    const attacking = homeGoals("4-3-3");
    const holding = homeGoals("4-5-1");
    console.log(`C46 gols do mandante: 4-3-3 ${attacking.toFixed(3)}, 4-5-1 ${holding.toFixed(3)}`);
    expect(attacking).toBeGreaterThanOrEqual(1.05 * holding);
  });
});

describe("nenhum save sem saída (correcoes-validacao)", () => {
  test("carreira sem renovação não trava", () => {
    // C19 (AC 15, AC 16): seed 11, club 10 of the Série A, no renewals, an automatic eleven for
    // every date, a job offer taken when fired; through season 3, round 24, to the end of season 4.
    let s = newGame(11);
    s.userClubId = s.leagues[0]!.clubs[10]!.id;
    s.boardGoal = userBoardGoal(s);
    s.cupGoal = userCupGoal(s);
    const stuck: string[] = [];
    const smallest: number[] = [];
    let passed = false;
    for (;;) {
      let fewest = Infinity;
      while (nextDate(s).kind !== "over") {
        const me = allClubs(s).find((c) => c.id === s.userClubId)!;
        const competition = nextCompetition(s);
        me.lineup = autoLineup(me, me.lineup?.formation ?? AI_FORMATION, me.lineup?.posture ?? "balanced", 0, competition);
        fewest = Math.min(fewest, me.players.length);
        if (!validateLineup(me, me.lineup, competition).ok) {
          stuck.push(`temporada ${s.season} rodada ${s.leagues[0]!.currentRound}`);
          break;
        }
        if (s.season === 3 && s.leagues[0]!.currentRound >= 24) passed = true;
        s = playDate(s).state;
      }
      smallest.push(fewest);
      if (stuck.length || s.season === 4) break;
      const review = seasonReview(s);
      s = nextSeason(s, review.user?.verdict === "fired" ? review.jobOffers[0] : undefined).state;
    }
    console.log(`C19 menor elenco por temporada: ${smallest.join(", ")}`);
    expect(stuck).toEqual([]);
    // The academy keeps the squad at 18 or more (AC 15): nobody leaves it during a season here.
    expect(smallest).toHaveLength(4);
    for (const n of smallest) expect(n).toBeGreaterThanOrEqual(18);
    expect(passed).toBe(true);
    expect(s.season).toBe(4);
    expect(nextDate(s).kind).toBe("over");
  }, 180_000);
});

describe("economia sem dinheiro do nada (correcoes-validacao)", () => {
  test("revenda de livres não dá lucro", () => {
    // C33 (AC 22-25): the old exploit - sign the free agents worth the most per real of fee up to
    // 30 players, put them up for sale, accept every bid for them until round 5 - against just playing.
    for (const seed of [5, 21]) {
      const start = (): GameState => {
        const s = newGame(seed);
        const club = s.leagues[0]!.clubs[0]!;
        s.userClubId = club.id;
        s.boardGoal = userBoardGoal(s);
        s.cupGoal = userCupGoal(s);
        club.lineup = autoLineup(club, AI_FORMATION);
        return s;
      };
      const me = (s: GameState) => allClubs(s).find((c) => c.id === s.userClubId)!;

      let played = start();
      while (played.leagues[0]!.currentRound < 5) played = playRound(played).state;

      let s = start();
      const signed: string[] = [];
      const byRatio = [...s.market.freeAgents].sort((a, b) => marketValue(b) / signingFee(b) - marketValue(a) / signingFee(a) || a.id.localeCompare(b.id));
      for (const p of byRatio) {
        if (me(s).players.length >= 30) break;
        const r = signFreeAgent(s, p.id);
        if (r.ok) {
          s = r.state;
          signed.push(p.id);
        }
      }
      for (const id of signed) {
        const r = toggleForSale(s, id);
        if (r.ok) s = r.state;
      }
      let sold = 0;
      while (s.leagues[0]!.currentRound < 5) {
        for (const o of s.market.offers.filter((x) => signed.includes(x.playerId))) {
          const r = acceptOffer(s, o.id);
          if (r.ok) sold++;
          if (r.ok || r.state) s = r.state!;
        }
        s = playRound(s).state;
      }
      console.log(`C33 seed ${seed}: ${signed.length} contratados, ${sold} vendidos, caixa ${me(s).finance.cash} contra ${me(played).finance.cash}`);
      expect(signed.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(me(s).finance.cash, `seed ${seed}`).toBeLessThanOrEqual(me(played).finance.cash);
    }
  }, 120_000);
});

describe("carreira longa sem usuário (correcoes-validacao)", () => {
  /** Seed 5, no user, 20 seasons, played once: the Série A strength at each start, the cash at each end. */
  let long: { strength: number[]; red: number[]; medians: number[]; initialMedian: number } | null = null;
  const median80 = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    expect(sorted).toHaveLength(80);
    return (sorted[39]! + sorted[40]!) / 2;
  };
  function longCareer() {
    if (long) return long;
    let s = newGame(5);
    const cash = () => s.leagues.flatMap((l) => l.clubs).map((c) => c.finance.cash);
    const initialMedian = median80(cash());
    const strength: number[] = [];
    const red: number[] = [];
    const medians: number[] = [];
    for (let season = 1; season <= 20; season++) {
      strength.push(s.leagues[0]!.clubs.reduce((sum, c) => sum + best18(c.players.map((p) => p.rating)), 0) / 20);
      while (nextDate(s).kind !== "over") s = playDate(s).state;
      red.push(cash().filter((c) => c < 0).length);
      medians.push(median80(cash()));
      if (season < 20) s = nextSeason(s).state;
    }
    long = { strength, red, medians, initialMedian };
    return long;
  }

  test("força estável em 20 temporadas", () => {
    // C31 (AC 30): the mean of each Série A club's best 18, within 5 points of season 1.
    const { strength } = longCareer();
    expect(strength).toHaveLength(20);
    const drift = strength.map((x) => Math.abs(x - strength[0]!));
    console.log(`C31 deriva: ${drift.map((x) => x.toFixed(2)).join(", ")}`);
    for (const [k, d] of drift.entries()) expect(d, `temporada ${k + 1}`).toBeLessThanOrEqual(5);
  }, 300_000);

  test("caixa em 20 temporadas", () => {
    // C32 (AC 31): at most 10 of the 80 clubs in the red at the end of each season.
    const { red } = longCareer();
    expect(red).toHaveLength(20);
    console.log(`C32 clubes no vermelho: ${red.join(", ")}`);
    for (const [k, n] of red.entries()) expect(n, `temporada ${k + 1}`).toBeLessThanOrEqual(10);
  }, 300_000);

  test("caixa da IA limitado em 20 temporadas", () => {
    // C73 (AC 68): the median cash of the 80 clubs at most 20 × the initial median, every season.
    const { medians, initialMedian } = longCareer();
    expect(medians).toHaveLength(20);
    console.log(`C73 mediana / inicial: ${medians.map((m) => (m / initialMedian).toFixed(2)).join(", ")}`);
    for (const [k, m] of medians.entries()) expect(m, `temporada ${k + 1}`).toBeLessThanOrEqual(20 * initialMedian);
  }, 300_000);
});

describe("pênaltis no jogo (penaltis)", () => {
  /** Per side over seeds 1..n: chances (shots + awards), awards, goals, saves and misses from the spot. */
  function penalties(home: TeamSheet, away: TeamSheet, n: number) {
    const side = () => ({ chances: 0, awarded: 0, scored: 0, saved: 0, missed: 0 });
    const t: Record<string, ReturnType<typeof side>> = { [home.clubId]: side(), [away.clubId]: side() };
    for (let seed = 1; seed <= n; seed++) {
      for (const e of simulateMatch(home, away, createRng(seed)).events) {
        const s = t[e.clubId]!;
        if (e.type === "penalty") s.awarded++;
        const shot = e.type === "goal" || e.type === "shot_saved" || e.type === "shot_missed";
        if (shot && !e.penalty) s.chances++;
        if (e.type === "penalty") s.chances++;
        if (!e.penalty) continue;
        if (e.type === "goal") s.scored++;
        if (e.type === "shot_saved") s.saved++;
        if (e.type === "shot_missed") s.missed++;
      }
    }
    return t;
  }

  test("pênaltis por partida", () => {
    // C2 (AC 1, AC 4, AC 5): equal sides of 70.
    const n = 2000;
    const t = penalties(flatSheet("H", 70), flatSheet("A", 70), n);
    const sum = (k: "chances" | "awarded" | "scored" | "saved" | "missed") => t.H![k] + t.A![k];
    const perMatch = sum("awarded") / n;
    const perChance = sum("awarded") / sum("chances");
    const conversion = sum("scored") / sum("awarded");
    const savedShare = sum("saved") / (sum("saved") + sum("missed"));
    console.log(`C2 pênaltis/partida ${perMatch.toFixed(3)} por chance ${perChance.toFixed(4)} conversão ${conversion.toFixed(3)} defesas ${savedShare.toFixed(3)}`);
    expect(perMatch).toBeGreaterThanOrEqual(0.2);
    expect(perMatch).toBeLessThanOrEqual(0.4);
    expect(Math.abs(perChance - PENALTY_PER_CHANCE)).toBeLessThanOrEqual(0.01);
    expect(conversion).toBeGreaterThanOrEqual(0.65);
    expect(conversion).toBeLessThanOrEqual(0.85);
    expect(Math.abs(savedShare - PENALTY_SAVED_SHARE)).toBeLessThanOrEqual(0.1);
  });

  test("conversão do pênalti pelo cobrador e pelo goleiro", () => {
    // C3 (AC 3): a side of 90 against a side of 60, each converting near penaltyChance.
    const t = penalties(flatSheet("H", 90), flatSheet("A", 60), 4000);
    const strong = t.H!.scored / t.H!.awarded;
    const weak = t.A!.scored / t.A!.awarded;
    console.log(`C3 conversão 90x60 ${strong.toFixed(3)} (${t.H!.awarded}) 60x90 ${weak.toFixed(3)} (${t.A!.awarded})`);
    expect(Math.abs(strong - penaltyChance(90, 60))).toBeLessThanOrEqual(0.06);
    expect(Math.abs(weak - penaltyChance(60, 90))).toBeLessThanOrEqual(0.06);
  });
});
