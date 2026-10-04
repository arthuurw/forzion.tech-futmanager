import { nextDate } from "./calendar";
import { finishCupDate, startCupDate } from "./cup";
import { newGame } from "./generate";
import { AI_FORMATION, autoLineup, formationSlots, validateLineup } from "./lineup";
import { makeMatch, makeSide, penaltyChance, penaltyTakers, runToEnd, shootout, step, stepMatch, type LiveMatch, type LivePlayer } from "./live";
import { createRng, mix32, randInt } from "./rng";
import { playDate } from "./season";
import { computeTable } from "./table";
import { isWindowOpen } from "./market";
import { atCupDate } from "./test-fixtures";
import { LEAGUE, type Club, type Cup, type GameState, type Position } from "./types";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const all = (s: GameState): Club[] => s.leagues.flatMap((l) => l.clubs);
const clubOf = (s: GameState, id: string) => all(s).find((c) => c.id === id)!;
const CUP = { kind: "cup", cupId: "cup-nat" } as const;
/** AC 31, written out. */
const PRIZES = [150_000, 300_000, 500_000, 800_000, 1_200_000, 2_500_000];

interface CupDate {
  phase: number;
  before: GameState;
  after: GameState;
}

const seasons = new Map<number, { dates: CupDate[]; final: GameState }>();
/** A whole season of `seed` played date by date, keeping the state around each cup date. */
function season(seed: number): { dates: CupDate[]; final: GameState } {
  if (!seasons.has(seed)) {
    let s = newGame(seed);
    const dates: CupDate[] = [];
    while (nextDate(s).kind !== "over") {
      const d = nextDate(s);
      const before = s;
      s = playDate(s).state;
      // Copa-continental: these checks are about the national cup, `cups[0]`.
      if (d.kind === "cup" && d.cupIndex === 0) dates.push({ phase: d.phase, before, after: s });
    }
    seasons.set(seed, { dates, final: s });
  }
  const got = seasons.get(seed)!;
  return clone(got);
}

const clubsOf = (cup: Cup, k: number) => cup.phases[k]!.ties.flatMap((t) => [t.homeId, t.awayId]);
const winnersOf = (cup: Cup, k: number) => cup.phases[k]!.ties.map((t) => t.winnerId!);

/** Door 3, written out (L-004): Fisher-Yates with randInt, pairs in order, home = lower in the seeding. */
function referenceDraw(qualified: string[], seeding: string[], seed: number): [string, string][] {
  const rng = createRng(seed);
  const a = [...qualified];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  const out: [string, string][] = [];
  for (let i = 0; i < a.length; i += 2) {
    const [x, y] = [a[i]!, a[i + 1]!];
    out.push(seeding.indexOf(x) > seeding.indexOf(y) ? [x, y] : [y, x]);
  }
  return out;
}

const pairs = (cup: Cup, k: number) => cup.phases[k]!.ties.map((t) => [t.homeId, t.awayId]);
const best11 = (c: Club) => [...c.players].map((p) => p.rating).sort((a, b) => b - a).slice(0, 11).reduce((a, b) => a + b, 0) / 11;
const byStrength = (clubs: Club[]) => [...clubs].sort((a, b) => best11(b) - best11(a) || a.id.localeCompare(b.id)).map((c) => c.id);

/** AC 30, written out: never above capacity; demand (40 / price)^1,5 capped at 1,3; form 1. */
const gateOf = (f: { fans: number; capacity: number; ticketPrice: number }) =>
  Math.min(f.capacity, Math.floor(f.fans * Math.min(1.3, (40 / f.ticketPrice) ** 1.5) + 1e-6));

describe("copa: forma e chaveamento", () => {
  test("seis fases com âncoras fixas", () => {
    const cup = newGame(61).cups[0]!;
    expect(cup.id).toBe("cup-nat");
    expect(cup.name).toBe("Copa Nacional");
    expect(cup.phases.map((p) => [p.name, p.afterLeagueRound])).toEqual([
      ["Preliminar", 4],
      ["16 avos", 10],
      ["Oitavas", 16],
      ["Quartas", 22],
      ["Semifinal", 28],
      ["Final", 34],
    ]);
  });

  test("chaveamento sem temporada anterior", () => {
    for (const seed of [62, 63]) {
      const s = newGame(seed);
      const seeding = s.cups[0]!.seeding;
      expect(seeding).toHaveLength(40);
      expect(new Set(seeding).size).toBe(40);
      expect(seeding).toEqual([...byStrength(s.leagues[0]!.clubs), ...byStrength(s.leagues[1]!.clubs)]);
    }
  });

  test("preliminar sorteada no começo", () => {
    const cup = newGame(64).cups[0]!;
    expect(cup.currentPhase).toBe(0);
    expect(cup.phases[0]!.ties).toHaveLength(8);
    for (const t of cup.phases[0]!.ties) expect([t.result, t.penalties, t.winnerId]).toEqual([null, null, null]);
    for (const phase of cup.phases.slice(1)) expect(phase.ties).toEqual([]);
  });

  test("quem joga a preliminar e quem entra direto", () => {
    const { dates } = season(65);
    const first = dates[0]!;
    const seeding = first.before.cups[0]!.seeding;
    expect(first.before.cups[0]!.phases[0]!.ties).toHaveLength(8);
    expect(new Set(clubsOf(first.before.cups[0]!, 0))).toEqual(new Set(seeding.slice(24)));
    const cup = first.after.cups[0]!;
    expect(cup.phases[1]!.ties).toHaveLength(16);
    const clubs = clubsOf(cup, 1);
    expect(clubs).toHaveLength(32);
    expect(new Set(clubs)).toEqual(new Set([...seeding.slice(0, 24), ...winnersOf(cup, 0)]));
  }, 60_000);

  test("cada sorteio usa todos os classificados", () => {
    const cup = season(65).final.cups[0]!;
    expect(cup.phases.map((p) => p.ties.length)).toEqual([8, 16, 8, 4, 2, 1]);
    for (let k = 1; k < 6; k++) {
      const clubs = clubsOf(cup, k);
      expect(new Set(clubs).size, `fase ${k}`).toBe(clubs.length);
      const expected = k === 1 ? [...cup.seeding.slice(0, 24), ...winnersOf(cup, 0)] : winnersOf(cup, k - 1);
      expect(new Set(clubs), `fase ${k}`).toEqual(new Set(expected));
    }
  }, 60_000);

  test("mando do pior chaveamento", () => {
    for (const seed of [65, 66]) {
      const cup = season(seed).final.cups[0]!;
      let n = 0;
      for (const phase of cup.phases) {
        for (const t of phase.ties) {
          expect(cup.seeding.indexOf(t.homeId), t.id).toBeGreaterThan(cup.seeding.indexOf(t.awayId));
          n++;
        }
      }
      expect(n).toBe(39);
    }
  }, 60_000);

  test("sorteio segue a semente da door 3", () => {
    // k = 0: the new game's state.
    const s = newGame(67);
    const cup0 = s.cups[0]!;
    const expected0 = referenceDraw(cup0.seeding.slice(24), cup0.seeding, mix32(mix32(s.rngState, 0xd0), 0));
    expect(pairs(cup0, 0)).toEqual(expected0);
    // The rejected alternative (mix32(rngState, 0xD0 + k)) draws something else.
    expect(expected0).not.toEqual(referenceDraw(cup0.seeding.slice(24), cup0.seeding, mix32(s.rngState, 0xd0)));

    // k = 1: the state of the date that closed the preliminary, before it advanced.
    const { before, after } = season(65).dates[0]!;
    const cup = after.cups[0]!;
    const qualified = [...cup.seeding.slice(0, 24), ...winnersOf(cup, 0)].sort((a, b) => cup.seeding.indexOf(a) - cup.seeding.indexOf(b));
    const expected1 = referenceDraw(qualified, cup.seeding, mix32(mix32(before.rngState, 0xd0), 1));
    expect(pairs(cup, 1)).toEqual(expected1);
    expect(after.rngState).not.toBe(before.rngState);
    expect(expected1).not.toEqual(referenceDraw(qualified, cup.seeding, mix32(mix32(after.rngState, 0xd0), 1)));
  }, 60_000);
});

describe("copa: data de copa", () => {
  test("fechar data avança fase e rng uma vez", () => {
    for (const { phase, before, after } of season(68).dates) {
      expect(before.cups[0]!.currentPhase).toBe(phase);
      expect(after.cups[0]!.currentPhase).toBe(phase + 1);
      const rng = createRng(before.rngState);
      rng.next();
      expect(after.rngState, `fase ${phase}`).toBe(rng.getState());
    }
  }, 60_000);

  test("sementes das partidas de copa", () => {
    for (const { phase, before } of season(69).dates.filter((d) => d.phase === 0 || d.phase === 2)) {
      const live = startCupDate(before);
      expect(live.matches).toHaveLength(before.cups[0]!.phases[phase]!.ties.length);
      live.matches.forEach((m, i) => {
        expect(m.rngState, `fase ${phase} confronto ${i}`).toBe(mix32(mix32(before.rngState, 0xc0), phase * 32 + i));
        // The rejected alternative, the league's matchSeed(rngState, k, i), is another seed.
        expect(m.rngState).not.toBe(mix32(before.rngState, phase * 16 + i));
      });
    }
    // The shoot-out continues the match's own stream after minute 90.
    let checked = 0;
    for (const { before } of season(69).dates) {
      const at89 = (() => {
        let l = startCupDate(before);
        while (l.minute < 89) l = step(l);
        return l;
      })();
      const done = runToEnd(at89);
      done.matches.forEach((m, i) => {
        if (!m.penalties) return;
        const replay = clone(at89.matches[i]!);
        const rng = createRng(replay.rngState);
        stepMatch(replay, 90, at89.players, rng);
        expect(replay.penalties).toEqual(m.penalties);
        expect(replay.events).toEqual(m.events);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);

  test("empate vai aos pênaltis", () => {
    const seen = { level: 0, decided: 0 };
    for (const seed of [70, 71]) {
      for (const phase of season(seed).final.cups[0]!.phases) {
        for (const t of phase.ties) {
          const r = t.result!;
          if (r.homeGoals === r.awayGoals) {
            seen.level++;
            expect(t.penalties, t.id).not.toBeNull();
            expect(t.penalties!.home).not.toBe(t.penalties!.away);
            expect(t.winnerId).toBe(t.penalties!.home > t.penalties!.away ? t.homeId : t.awayId);
          } else {
            seen.decided++;
            expect(t.penalties, t.id).toBeNull();
            expect(t.winnerId).toBe(r.homeGoals > r.awayGoals ? t.homeId : t.awayId);
          }
        }
      }
    }
    expect(seen.level).toBeGreaterThan(0);
    expect(seen.decided).toBeGreaterThan(0);
  }, 60_000);

  test("perdedor sai da copa", () => {
    for (const seed of [70, 71]) {
      const cup = season(seed).final.cups[0]!;
      cup.phases.forEach((phase, k) => {
        for (const t of phase.ties) {
          const loser = t.winnerId === t.homeId ? t.awayId : t.homeId;
          for (const later of cup.phases.slice(k + 1)) expect(later.ties.flatMap((x) => [x.homeId, x.awayId]), `${t.id} ${loser}`).not.toContain(loser);
        }
      });
    }
  }, 60_000);

  test("copa não conta na liga nem nas estatísticas", () => {
    const withGoals = season(72).dates.find((d) => d.after.cups[0]!.phases[d.phase]!.ties.some((t) => t.result!.goals.length > 0))!;
    const before = withGoals.before;
    const after = finishCupDate(before, startCupDate(before)).state;
    const scorers = after.cups[0]!.phases[withGoals.phase]!.ties.flatMap((t) => t.result!.goals.map((g) => g.playerId));
    expect(scorers.length).toBeGreaterThan(0);
    expect(after.leagues.map((l) => computeTable(l))).toEqual(before.leagues.map((l) => computeTable(l)));
    const stats = (s: GameState) => all(s).flatMap((c) => c.players.map((p) => [p.id, p.seasonGames, p.seasonGoals]));
    expect(stats(after)).toEqual(stats(before));
  }, 60_000);

  test("suspenso na copa fica fora da data de copa", () => {
    const seed = 73;
    const preliminary = newGame(seed).cups[0]!.phases[0]!.ties;
    const userId = preliminary[0]!.homeId;
    const aiId = preliminary[1]!.homeId;
    const s = atCupDate(seed, 0, userId);
    const ai = clubOf(s, aiId);
    const fws = ai.players.filter((p) => p.position === "FW").sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
    const [first, second] = [fws[0]!, fws[1]!];
    for (const p of [first, second]) Object.assign(p, { injuryRounds: 0, fitness: 100 });
    first.cupDiscipline = { "cup-nat": { yellowCards: 0, suspendedRounds: 1 } };
    second.suspendedRounds = 1;

    const me = clubOf(s, userId);
    for (const p of me.players) Object.assign(p, { injuryRounds: 0, suspendedRounds: 0 });
    me.lineup = autoLineup(me, AI_FORMATION);
    const starterId = me.lineup.starters[5]!;
    const benchPlayer = me.players.find((p) => !me.lineup!.starters.includes(p.id))!;
    const starter = me.players.find((p) => p.id === starterId)!;
    for (const p of [starter, benchPlayer]) p.cupDiscipline = { "cup-nat": { yellowCards: 0, suspendedRounds: 1 } };
    // Only suspended in the league: still on the bench for the cup (L-007).
    const leagueOnly = me.players.find((p) => p !== benchPlayer && !me.lineup!.starters.includes(p.id))!;
    leagueOnly.suspendedRounds = 1;

    expect(validateLineup(me, me.lineup, CUP).ok).toBe(false);
    expect(validateLineup(me, me.lineup, LEAGUE).ok).toBe(true);

    const live = startCupDate(s);
    const sideOf = (id: string) => {
      const m = live.matches.find((x) => x.home.clubId === id || x.away.clubId === id)!;
      return m.home.clubId === id ? m.home : m.away;
    };
    const aiSide = sideOf(aiId);
    expect(aiSide.slots).toContain(second.id);
    expect(aiSide.slots).not.toContain(first.id);
    expect(aiSide.bench).not.toContain(first.id);
    const mine = sideOf(userId);
    expect(mine.bench).not.toContain(benchPlayer.id);
    expect(mine.bench).toContain(leagueOnly.id);
    expect(mine.slots[5]).toBeNull();
  });

  test("data de copa não fecha o mercado", () => {
    const s = atCupDate(74, 1);
    const seller = s.leagues[0]!.clubs[0]!;
    s.market.offers = [{ id: "of-1", buyerId: s.leagues[0]!.clubs[1]!.id, playerId: seller.players[0]!.id, amount: 1_000_000 }];
    const market = clone(s.market);
    expect(market.freeAgents.length + market.juniors.length).toBeGreaterThan(0);
    const after = finishCupDate(s, startCupDate(s)).state;
    expect(after.market).toEqual(market);
  });
});

describe("copa: dinheiro", () => {
  test("bilheteria do mandante na copa", () => {
    const s = atCupDate(75, 0);
    const tie = s.cups[0]!.phases[0]!.ties[0]!;
    Object.assign(clubOf(s, tie.homeId).finance, { fans: 30_000, capacity: 24_000, ticketPrice: 40 });
    const after = finishCupDate(s, startCupDate(s)).state;
    expect(clubOf(after, tie.homeId).finance.lastRound).toMatchObject({ attendance: 24_000, tickets: 960_000 });
    expect(clubOf(after, tie.awayId).finance.lastRound).toMatchObject({ attendance: 0, tickets: 0 });
  });

  test("prêmio por fase", () => {
    const { dates } = season(76);
    expect(dates.map((d) => d.phase)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const { phase, after } of dates) {
      for (const t of after.cups[0]!.phases[phase]!.ties) {
        const loser = t.winnerId === t.homeId ? t.awayId : t.homeId;
        expect(clubOf(after, t.winnerId!).finance.lastRound!.cupPrize, `${t.id} vencedor`).toBe(PRIZES[phase]);
        expect(clubOf(after, loser).finance.lastRound!.cupPrize, `${t.id} perdedor`).toBe(0);
      }
    }
    expect(PRIZES).toEqual([150_000, 300_000, 500_000, 800_000, 1_200_000, 2_500_000]);
  }, 60_000);

  test("data de copa não cobra folha nem juros", () => {
    const s = atCupDate(77, 0);
    const played = finishCupDate(s, startCupDate(s)).state;
    const tie = played.cups[0]!.phases[0]!.ties.find((t) => t.winnerId === t.homeId)!;
    const f = clubOf(s, tie.homeId).finance;
    Object.assign(f, { fans: 30_000, capacity: 24_000, ticketPrice: 40, loan: 1_000_000, expansionRoundsLeft: 3 });
    expect(clubOf(s, tie.homeId).players.reduce((sum, p) => sum + p.salary, 0)).toBeGreaterThan(0);
    const cash = f.cash;
    const after = finishCupDate(s, startCupDate(s)).state;
    const g = clubOf(after, tie.homeId).finance;
    expect(g.cash - cash).toBe(960_000 + 150_000);
    expect([g.loan, g.expansionRoundsLeft, g.capacity]).toEqual([1_000_000, 3, 24_000]);
  });

  test("registro da data de copa", () => {
    const s = atCupDate(78, 0);
    const tie = s.cups[0]!.phases[0]!.ties[2]!;
    Object.assign(clubOf(s, tie.homeId).finance, { pendingIn: 250_000, pendingOut: 90_000, ticketPrice: 45 });
    Object.assign(clubOf(s, tie.awayId).finance, { pendingIn: 40_000, pendingOut: 70_000 });
    const idle = all(s).find((c) => !s.cups[0]!.phases[0]!.ties.some((t) => t.homeId === c.id || t.awayId === c.id))!;
    const idleLedger = clone(idle.finance.lastRound);
    const after = finishCupDate(s, startCupDate(s)).state;
    const t = after.cups[0]!.phases[0]!.ties[2]!;
    const home = clubOf(after, tie.homeId).finance.lastRound!;
    const gate = gateOf(clubOf(s, tie.homeId).finance);
    expect(gate).toBeGreaterThan(0);
    expect(home).toEqual({
      attendance: gate,
      tickets: gate * 45,
      sponsorship: 0,
      salaries: 0,
      interest: 0,
      transfersIn: 250_000,
      transfersOut: 90_000,
      cupPrize: t.winnerId === tie.homeId ? 150_000 : 0,
    });
    expect(clubOf(after, tie.awayId).finance.lastRound).toEqual({
      attendance: 0,
      tickets: 0,
      sponsorship: 0,
      salaries: 0,
      interest: 0,
      transfersIn: 40_000,
      transfersOut: 70_000,
      cupPrize: t.winnerId === tie.awayId ? 150_000 : 0,
    });
    // A club without a tie keeps its last league ledger.
    expect(clubOf(after, idle.id).finance.lastRound).toEqual(idleLedger);
  });
});

describe("copa: pênaltis", () => {
  test("regras da disputa de pênaltis", () => {
    const cases: { home: (n: number) => boolean; away: (n: number) => boolean; expected: { home: number; away: number; kicks: number } }[] = [
      { home: () => true, away: () => false, expected: { home: 3, away: 0, kicks: 6 } },
      { home: () => true, away: (n) => n < 4, expected: { home: 5, away: 4, kicks: 10 } },
      { home: () => true, away: (n) => n < 5, expected: { home: 6, away: 5, kicks: 12 } },
      { home: (n) => n !== 4 && n !== 6, away: (n) => n !== 4, expected: { home: 5, away: 6, kicks: 14 } },
    ];
    for (const c of cases) {
      const order: string[] = [];
      const r = shootout((side, n) => {
        order.push(side);
        return side === "home" ? c.home(n) : c.away(n);
      });
      expect(r).toEqual(c.expected);
      // Alternating, home first.
      expect(order).toEqual(Array.from({ length: c.expected.kicks }, (_, i) => (i % 2 === 0 ? "home" : "away")));
    }
  });

  test("chance do pênalti", () => {
    const table: [number, number, number][] = [
      [80, 80, 0.75],
      [70, 80, 0.7],
      [90, 70, 0.85],
      [95, 40, 0.92],
      [40, 95, 0.55],
    ];
    for (const [taker, keeper, chance] of table) expect(penaltyChance(taker, keeper), `${taker} x ${keeper}`).toBeCloseTo(chance, 10);
  });

  test("ordem dos batedores", () => {
    const ratings: [string, Position, number][] = [
      ["gk", "GK", 50],
      ["df72", "DF", 72],
      ["df68", "DF", 68],
      ["df60", "DF", 60],
      ["df55", "DF", 55],
      ["mf78", "MF", 78],
      ["mf70", "MF", 70],
      ["mf65", "MF", 65],
      ["fw80", "FW", 80],
      ["fw75", "FW", 75],
      ["fw90", "FW", 90],
      ["fw85", "FW", 85],
    ];
    const players: Record<string, LivePlayer> = {};
    for (const prefix of ["H-", "A-"]) {
      for (const [id, position, rating] of ratings) players[prefix + id] = { id: prefix + id, name: prefix + id, position, age: 25, rating };
    }
    // 4-3-3 at 90': the FW 90 was sent off (empty slot) and the FW 85 was replaced by the FW 75.
    const side = (p: string) => {
      const ids = ["gk", "df72", "df68", "df60", "df55", "mf78", "mf70", "mf65", "fw80", "fw75", null].map((id) => (id ? p + id : null));
      const s = makeSide(p === "H-" ? "H" : "A", formationSlots("4-3-3"), ids, [], players);
      s.sentOff = [p + "fw90"];
      s.vacancy = { 10: { why: "red", playerId: p + "fw90" } };
      s.subbedOff = [p + "fw85"];
      s.played = [...s.played, p + "fw85", p + "fw90"];
      return s;
    };
    const expected = ["fw80", "fw75", "mf78", "mf70", "mf65", "df72", "df68", "df60", "df55", "gk"].map((id) => "H-" + id);
    expect(penaltyTakers(side("H-"), players)).toEqual(expected);

    // Through a real shoot-out long enough for an 11th home kick.
    let found: LiveMatch | null = null;
    for (let seed = 1; seed <= 5000 && !found; seed++) {
      const m = makeMatch("t", side("H-"), side("A-"), 0, "cup-nat");
      m.knockout = true;
      const slots = [...m.home.slots];
      stepMatch(m, 90, players, createRng(seed));
      const homeKicks = m.events.filter((e) => e.clubId === "H" && e.type.startsWith("penalty_"));
      if (m.penalties && homeKicks.length >= 11 && m.home.slots.every((id, i) => id === slots[i])) found = m;
    }
    expect(found).not.toBeNull();
    const takers = found!.events.filter((e) => e.clubId === "H" && e.type.startsWith("penalty_")).map((e) => e.playerId);
    expect(takers.slice(0, 10)).toEqual(expected);
    expect(takers[10]).toBe("H-fw80");
    expect(takers).not.toContain("H-fw90");
    expect(takers).not.toContain("H-fw85");
  });

  test("eventos de pênalti", () => {
    let checked = 0;
    for (const { before } of season(79).dates) {
      for (const m of runToEnd(startCupDate(before)).matches) {
        if (!m.penalties) {
          expect(m.events.some((e) => e.type.startsWith("penalty_"))).toBe(false);
          continue;
        }
        checked++;
        const end = m.events.findIndex((e) => e.type === "fulltime");
        const kicks = m.events.slice(end + 1);
        expect(kicks.every((e) => e.type === "penalty_scored" || e.type === "penalty_missed")).toBe(true);
        const homeKicks = kicks.filter((e) => e.clubId === m.home.clubId);
        const awayKicks = kicks.filter((e) => e.clubId === m.away.clubId);
        expect(homeKicks.length + awayKicks.length).toBe(kicks.length);
        expect(homeKicks.filter((e) => e.type === "penalty_scored")).toHaveLength(m.penalties.home);
        expect(awayKicks.filter((e) => e.type === "penalty_scored")).toHaveLength(m.penalties.away);
        for (const e of homeKicks) expect(m.home.slots).toContain(e.playerId);
        for (const e of awayKicks) expect(m.away.slots).toContain(e.playerId);
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 60_000);
});

describe("copa: mercado da IA (gastos-da-ia)", () => {
  test("data de copa não mexe no mercado da IA", () => {
    // The preliminary comes after league round 4: the next league round, 5, has the window open.
    const s = atCupDate(78, 0);
    expect(nextDate(s)).toEqual({ kind: "cup", cupIndex: 0, phase: 0 });
    expect(s.leagues[0]!.currentRound).toBe(4);
    expect(isWindowOpen(5)).toBe(true);
    // Every club rich with a full stadium; one Série A club in the red with 22 players.
    for (const c of all(s)) Object.assign(c.finance, { cash: 500_000_000, fans: 60_000, capacity: 20_000, ticketPrice: 40, expansionRoundsLeft: 0 });
    const red = s.leagues[0]!.clubs[3]!;
    red.finance.cash = -1_000_000;
    expect(red.players.length).toBeGreaterThan(18);
    const squads = (x: GameState) => all(x).map((c) => [c.id, c.players.map((p) => p.id)]);
    const before = clone(s);
    const after = playDate(s).state;
    expect(squads(after)).toEqual(squads(before));
    expect(after.market.transfers).toEqual(before.market.transfers);
    expect(after.market.freeAgents.map((p) => p.id)).toEqual(before.market.freeAgents.map((p) => p.id));
    const inTies = new Set(clubsOf(after.cups[0]!, 0));
    expect(inTies.size).toBe(16);
    for (const c of all(after)) {
      const was = clubOf(before, c.id).finance;
      const gate = inTies.has(c.id) ? c.finance.lastRound!.tickets + c.finance.lastRound!.cupPrize! : 0;
      expect(c.finance.cash - was.cash, c.id).toBe(gate);
      expect([c.finance.expansionRoundsLeft, c.finance.capacity], c.id).toEqual([0, 20_000]);
    }
    // Some home side did fill its stadium.
    expect(all(after).some((c) => inTies.has(c.id) && c.finance.lastRound!.attendance === 20_000)).toBe(true);
  });
});

describe("copa e países (paises)", () => {
  test("copa nacional só com o Brasil", () => {
    // C10 (AC 10): the 40 clubs of Brazil, and no club c41-c80 in any tie of the season.
    let s = newGame(63);
    const brazil = new Set(s.leagues.filter((l) => l.country === "BR").flatMap((l) => l.clubs.map((c) => c.id)));
    expect(brazil.size).toBe(40);
    const seeding = s.cups[0]!.seeding;
    expect(seeding).toHaveLength(40);
    expect(new Set(seeding)).toEqual(brazil);
    const abroad = (id: string) => Number(id.slice(1)) >= 41 && Number(id.slice(1)) <= 80;
    while (nextDate(s).kind !== "over") s = playDate(s).state;
    const ties = s.cups[0]!.phases.flatMap((p) => p.ties);
    expect(ties).toHaveLength(8 + 16 + 8 + 4 + 2 + 1);
    for (const t of ties) {
      expect(abroad(t.homeId), t.id).toBe(false);
      expect(abroad(t.awayId), t.id).toBe(false);
    }
  }, 60_000);
});

describe("cobrador escolhido (penaltis)", () => {
  const RATINGS: [string, Position, number][] = [
    ["gk", "GK", 50],
    ["df72", "DF", 72],
    ["df68", "DF", 68],
    ["df60", "DF", 60],
    ["df55", "DF", 55],
    ["mf78", "MF", 78],
    ["mf70", "MF", 70],
    ["mf65", "MF", 65],
    ["fw80", "FW", 80],
    ["fw75", "FW", 75],
    ["fw90", "FW", 90],
    ["fw85", "FW", 85],
  ];
  const players: Record<string, LivePlayer> = {};
  for (const p of ["H-", "A-"]) for (const [id, position, rating] of RATINGS) players[p + id] = { id: p + id, name: p + id, position, age: 25, rating };
  const ELEVEN = ["gk", "df72", "df68", "df60", "df55", "mf78", "mf70", "mf65", "fw80", "fw75", "fw90"];
  const MF70 = ELEVEN.indexOf("mf70");
  /** 4-3-3 with the FW 85 on the bench; `taker` is the chosen one, or none. */
  const side = (p: string, taker?: string) =>
    makeSide(p === "H-" ? "H" : "A", formationSlots("4-3-3"), ELEVEN.map((id) => p + id), [p + "fw85"], players, taker ? { penaltyTaker: taker } : {});
  const h = (ids: string[]) => ids.map((id) => "H-" + id);
  const AUTO = h(["fw90", "fw80", "fw75", "mf78", "mf70", "mf65", "df72", "df68", "df60", "df55", "gk"]);

  test("cobrador escolhido na ordem", () => {
    // C12 (AC 15, AC 16, AC 18, L-006, L-007): the chosen midfielder first while on the pitch; off it,
    // for any reason, exactly the automatic order.
    expect(penaltyTakers(side("H-", "H-mf70"), players)).toEqual(h(["mf70", "fw90", "fw80", "fw75", "mf78", "mf65", "df72", "df68", "df60", "df55", "gk"]));
    const subbed = side("H-", "H-mf70");
    subbed.slots[MF70] = "H-fw85";
    subbed.subbedOff = ["H-mf70"];
    const sentOff = side("H-", "H-mf70");
    sentOff.slots[MF70] = null;
    sentOff.sentOff = ["H-mf70"];
    sentOff.vacancy = { [MF70]: { why: "red", playerId: "H-mf70" } };
    const injured = side("H-", "H-mf70");
    injured.slots[MF70] = null;
    injured.injured = { "H-mf70": 2 };
    injured.vacancy = { [MF70]: { why: "injury", playerId: "H-mf70" } };
    const without = AUTO.filter((id) => id !== "H-mf70");
    const cases: [string, ReturnType<typeof side>, string[]][] = [
      ["no banco", side("H-", "H-fw85"), AUTO],
      ["substituído", subbed, h(["fw90", "fw85", "fw80", "fw75", "mf78", "mf65", "df72", "df68", "df60", "df55", "gk"])],
      ["expulso", sentOff, without],
      ["lesionado", injured, without],
      ["id desconhecido", side("H-", "nobody"), AUTO],
      ["sem escolha", side("H-"), AUTO],
    ];
    for (const [name, s, expected] of cases) expect(penaltyTakers(s, players), name).toEqual(expected);
    // AC 18: a side built without the option, as every AI side is, has no chosen taker.
    expect("penaltyTaker" in side("A-")).toBe(false);
  });

  test("cobrador escolhido abre a disputa", () => {
    // C14 (AC 17): the chosen midfielder takes the home side's first kick; the next nine follow the
    // automatic order without him.
    let found: LiveMatch | null = null;
    for (let seed = 1; seed <= 5000 && !found; seed++) {
      const m = makeMatch("t", side("H-", "H-mf70"), side("A-"), 0, "cup-nat");
      m.knockout = true;
      const slots = [...m.home.slots];
      stepMatch(m, 90, players, createRng(seed));
      const homeKicks = m.events.filter((e) => e.clubId === "H" && e.type.startsWith("penalty_"));
      if (m.penalties && homeKicks.length >= 10 && m.home.slots.every((id, i) => id === slots[i])) found = m;
    }
    expect(found).not.toBeNull();
    const takers = found!.events.filter((e) => e.clubId === "H" && e.type.startsWith("penalty_")).map((e) => e.playerId);
    expect(takers.slice(0, 10)).toEqual(h(["mf70", "fw90", "fw80", "fw75", "mf78", "mf65", "df72", "df68", "df60", "df55"]));
  });
});
