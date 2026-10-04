import { readFileSync } from "node:fs";
import { newGame } from "./generate";
import { AI_FORMATION, aiLineup, autoLineup, formationSlots, validateLineup } from "./lineup";
import {
  MAX_SUBS,
  changeFormation,
  forcedVacancy,
  injuryChance,
  keeperStrength,
  makeMatch,
  makeSide,
  runToEnd,
  sideStrength,
  startRound,
  step,
  stepMatch,
  substitute,
  userMatch,
  userStops,
  penaltyTakers,
  type LivePlayer,
  type LiveRound,
  type LiveSide,
} from "./live";
import { simulateMatch, type TeamSheet } from "./match";
import { narrate, narrationContext } from "./narration";
import { createRng, mix32 } from "./rng";
import { finishRound, playRound } from "./season";
import { effectiveRating } from "./strength";
import { MATCH_EVENT_TYPES, type FormationName, type GameState, type MatchEventType, type Player, type Position } from "./types";

function game(seed = 1, clubIndex = 0): GameState {
  const state = newGame(seed);
  const club = state.leagues[0]!.clubs[clubIndex]!;
  state.userClubId = club.id;
  club.lineup = autoLineup(club, AI_FORMATION);
  return state;
}

function stepTo(live: LiveRound, minute: number): LiveRound {
  let l = live;
  while (l.minute < minute) l = step(l);
  return l;
}

function userSide(live: LiveRound): LiveSide {
  const m = userMatch(live)!;
  return m.home.clubId === live.userClubId ? m.home : m.away;
}

function ok(d: ReturnType<typeof substitute>): LiveRound {
  if (!d.ok) throw new Error(`refused: ${d.reason}`);
  return d.live;
}

/** Plays the round with the given decisions at minute 30 and returns every result. */
function playWith(state: GameState, decide: (live: LiveRound) => LiveRound) {
  const live = decide(stepTo(startRound(state), 30));
  return finishRound(state, live).results;
}

describe("rodada ao vivo (engine)", () => {
  test("mesmas decisões mesmos resultados", () => {
    const state = game(4);
    const decide = (l: LiveRound) => ok(substitute(l, state.userClubId!, 10, userSide(l).bench[0]!));
    const a = playWith(state, decide);
    const b = playWith(state, decide);
    expect(a).toHaveLength(10);
    expect(b).toEqual(a);
  });

  test("substituição não muda os outros 9 jogos", () => {
    const state = game(4);
    const withSub = playWith(state, (l) => ok(substitute(l, state.userClubId!, 10, userSide(l).bench[0]!)));
    const without = playWith(state, (l) => l);
    const isUser = (r: (typeof withSub)[number]) => r.homeId === state.userClubId || r.awayId === state.userClubId;
    expect(withSub.filter((r) => !isUser(r))).toEqual(without.filter((r) => !isUser(r)));
    expect(withSub.filter((r) => !isUser(r))).toHaveLength(9);
  });

  test("playRound equivale a rodada ao vivo sem decisões", () => {
    const state = game(9);
    const direct = playRound(state);
    const viaLive = finishRound(state, runToEnd(startRound(state)));
    let stepped = startRound(state);
    while (stepped.minute < 90) stepped = step(stepped);
    const viaSteps = finishRound(state, stepped);
    expect(viaLive).toEqual(direct);
    expect(viaSteps).toEqual(direct);
  });

  test("substituição entra no slot e narra", () => {
    const state = game(2);
    let live = stepTo(startRound(state), 20);
    const before = userSide(live);
    const outId = before.slots[10]!;
    const inId = before.bench[0]!;
    live = ok(substitute(live, state.userClubId!, 10, inId));
    const after = userSide(live);
    expect(after.slots[10]).toBe(inId);
    expect(after.subsUsed).toBe(1);
    expect(after.bench).not.toContain(inId);
    expect(userMatch(live)!.events.at(-1)).toEqual({
      minute: 20,
      type: "substitution",
      clubId: state.userClubId,
      playerId: outId,
      playerInId: inId,
    });
    // From the next minute the new player is on the pitch and tiring; the old one is not.
    live = step(live);
    const next = userSide(live);
    expect(next.fitness[inId]).toBeLessThan(100);
    expect(next.slots).not.toContain(outId);
  });

  test("sexta substituição recusada", () => {
    const state = game(2);
    let live = stepTo(startRound(state), 10);
    for (let i = 0; i < MAX_SUBS; i++) live = ok(substitute(live, state.userClubId!, 10 - i, userSide(live).bench[0]!));
    expect(MAX_SUBS).toBe(5);
    expect(userSide(live).subsUsed).toBe(5);
    const sixth = substitute(live, state.userClubId!, 1, userSide(live).bench[0]!);
    expect(sixth).toEqual({ ok: false, reason: "limit" });
  });

  test("quem saiu não volta", () => {
    const state = game(2);
    let live = stepTo(startRound(state), 10);
    const outId = userSide(live).slots[10]!;
    live = ok(substitute(live, state.userClubId!, 10, userSide(live).bench[0]!));
    expect(substitute(live, state.userClubId!, 9, outId)).toEqual({ ok: false, reason: "returning" });
  });

  test("expulso não pode ser substituído", () => {
    const state = game(2);
    const live = stepTo(startRound(state), 10);
    const side = userSide(live);
    const expelled = side.slots[4]!;
    side.slots[4] = null;
    side.vacancy[4] = { why: "red", playerId: expelled };
    side.sentOff.push(expelled);
    expect(substitute(live, state.userClubId!, 4, side.bench[0]!)).toEqual({ ok: false, reason: "sent_off" });
  });

  test("mudar formação redistribui sem tirar ninguém", () => {
    const state = game(3);
    const live = stepTo(startRound(state), 30);
    const before = userSide(live);
    const onBefore = before.slots.filter(Boolean).sort();
    const after = userSide(changeFormation(live, state.userClubId!, "3-5-2"));
    expect(after.formation).toBe("3-5-2");
    expect(after.slotPos).toEqual(formationSlots("3-5-2"));
    expect(after.slots.filter(Boolean).sort()).toEqual(onBefore);
    // 4-4-2 -> 3-5-2: one defender now sits in a midfield slot.
    const players = live.players;
    const outOfPosition = after.slots.filter((id, i) => id && players[id]!.position !== after.slotPos[i]);
    expect(outOfPosition).toHaveLength(1);
    expect(players[outOfPosition[0]!]!.position).toBe("DF");
  });

  test("IA substitui lesionado e cansado", () => {
    const state = game(5);
    let live = stepTo(startRound(state), 10);
    const m = live.matches.find((x) => x !== userMatch(live))!;
    const ai = m.home;
    // Injured defender in slot 2: replaced at once by a bench defender.
    const hurt = ai.slots[2]!;
    ai.slots[2] = null;
    ai.vacancy[2] = { why: "injury", playerId: hurt };
    ai.injured[hurt] = 2;
    live = step(live);
    const afterInjury = live.matches.find((x) => x.matchId === m.matchId)!.home;
    const replacement = afterInjury.slots[2]!;
    expect(replacement).toBeTruthy();
    expect(replacement).not.toBe(hurt);
    expect(live.players[replacement]!.position).toBe("DF");
    expect(afterInjury.subsUsed).toBeGreaterThanOrEqual(1);

    // From the 60th minute, a midfielder under 60 fitness is swapped for a bench midfielder.
    live.minute = 60;
    const side = live.matches.find((x) => x.matchId === m.matchId)!.home;
    side.subsUsed = 1;
    const tiredSlot = side.slotPos.indexOf("MF");
    const tired = side.slots[tiredSlot]!;
    side.fitness[tired] = 50;
    live = step(live);
    const afterTired = live.matches.find((x) => x.matchId === m.matchId)!.home;
    expect(afterTired.slots[tiredSlot]).not.toBe(tired);
    expect(live.players[afterTired.slots[tiredSlot]!]!.position).toBe("MF");

    // With 5 substitutions used, nobody else comes on.
    const capped = live.matches.find((x) => x.matchId === m.matchId)!.home;
    capped.subsUsed = MAX_SUBS;
    const other = capped.slots[capped.slotPos.lastIndexOf("MF")]!;
    capped.fitness[other] = 40;
    live = step(live);
    const afterCap = live.matches.find((x) => x.matchId === m.matchId)!.home;
    expect(afterCap.slots).toContain(other);
    expect(afterCap.subsUsed).toBe(MAX_SUBS);
  });

  test("segundo amarelo vira vermelho e sai", () => {
    let found = 0;
    for (let seed = 1; seed <= 40 && found < 3; seed++) {
      const state = game(1);
      state.rngState = seed * 7919;
      const live = runToEnd(startRound(state));
      for (const m of live.matches) {
        for (const side of [m.home, m.away]) {
          for (const id of side.sentOff) {
            if (side.yellows[id] !== 2) continue;
            found++;
            const mine = m.events.filter((e) => e.playerId === id && (e.type === "yellow" || e.type === "red"));
            expect(mine.map((e) => e.type)).toEqual(["yellow", "red"]);
            expect(side.slots).not.toContain(id);
            const redAt = mine[1]!.minute;
            expect(m.events.some((e) => e.minute > redAt && e.playerId === id && e.type !== "substitution")).toBe(false);
          }
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test("expulsão deixa time com 10 e setor mais fraco", () => {
    const state = game(6);
    const live = stepTo(startRound(state), 20);
    const side = userSide(live);
    const before = sideStrength(side, live.players);
    const df = side.slotPos.indexOf("DF");
    const id = side.slots[df]!;
    side.slots[df] = null;
    side.vacancy[df] = { why: "red", playerId: id };
    side.sentOff.push(id);
    const after = sideStrength(side, live.players);
    expect(side.slots.filter(Boolean)).toHaveLength(10);
    expect(after.def).toBeLessThan(before.def);
    const later = userSide(stepTo(live, 90));
    expect(later.slots[df]).toBeNull();
  });

  test("condição cai por minuto e mais rápido acima de 30", () => {
    // Find a user side with a starter aged 30 or less and one above 30 who stay on for 10 minutes.
    for (let seed = 1; seed < 50; seed++) {
      const state = game(seed);
      const start = startRound(state);
      const side = userSide(start);
      const young = side.slots.find((id) => id && start.players[id]!.age <= 30);
      const old = side.slots.find((id) => id && start.players[id]!.age > 30);
      if (!young || !old) continue;
      const end = userSide(stepTo(start, 10));
      if (!end.slots.includes(young) || !end.slots.includes(old)) continue;
      expect(100 - end.fitness[young]!).toBeCloseTo(1.5, 5);
      expect(100 - end.fitness[old]!).toBeCloseTo(2.0, 5);
      return;
    }
    throw new Error("no suitable squad found");
  });

  test("IA poupa quem está abaixo de 60 de condição", () => {
    const state = game(3);
    const league = state.leagues[0]!;
    const aiClub = league.clubs.find((c) => c.id !== state.userClubId)!;
    const firstXI = autoLineup(aiClub, AI_FORMATION).starters;
    const byId = (id: string) => aiClub.players.find((p) => p.id === id)!;
    // Tire a starting forward just below the line and put a starting midfielder exactly on it.
    const tiredFw = byId(firstXI.find((id) => byId(id!).position === "FW")!);
    const edgeMf = byId(firstXI.find((id) => byId(id!).position === "MF")!);
    tiredFw.fitness = 59;
    edgeMf.fitness = 60;
    const rested = aiClub.players.filter((p) => p.position === "FW" && p.id !== tiredFw.id && p.fitness >= 60);
    expect(rested.length).toBeGreaterThanOrEqual(2);

    const live = startRound(state);
    const match = live.matches.find((m) => m.home.clubId === aiClub.id || m.away.clubId === aiClub.id)!;
    const side = match.home.clubId === aiClub.id ? match.home : match.away;
    expect(side.slots).not.toContain(tiredFw.id);
    expect(side.bench).toContain(tiredFw.id);
    expect(side.slots).toContain(edgeMf.id);
    const fwSlots = side.slots.filter((_, i) => side.slotPos[i] === "FW");
    for (const id of fwSlots) expect(live.players[id!]!.position).toBe("FW");
  });

  test("lesionado sai na hora", () => {
    for (let seed = 1; seed < 200; seed++) {
      const state = game(1);
      state.rngState = seed * 104729;
      let live = startRound(state);
      while (live.minute < 90) {
        live = step(live);
        for (const m of live.matches) {
          const injury = m.events.find((e) => e.type === "injury" && e.minute === live.minute);
          if (!injury) continue;
          const side = m.home.clubId === injury.clubId ? m.home : m.away;
          expect(side.slots).not.toContain(injury.playerId);
          expect(side.injured[injury.playerId!]).toBeGreaterThanOrEqual(1);
          expect(side.injured[injury.playerId!]).toBeLessThanOrEqual(4);
          return;
        }
      }
    }
    throw new Error("no injury found");
  });

  test("condição 50 rende 85%", () => {
    const p: Player = { id: "x", name: "x", position: "MF", age: 25, rating: 80, fitness: 100, morale: 0, injuryRounds: 0, suspendedRounds: 0, yellowCards: 0, idleRounds: 0, salary: 0, contractSeasons: 1, seasonGames: 0, seasonGoals: 0, careerGames: 0, careerGoals: 0, cupDiscipline: {} };
    expect(effectiveRating({ ...p, fitness: 50 }, "MF") / effectiveRating(p, "MF")).toBeCloseTo(0.85, 10);
  });

  test("moral +2 rende 6% a mais", () => {
    const p: Player = { id: "x", name: "x", position: "FW", age: 25, rating: 70, fitness: 100, morale: 0, injuryRounds: 0, suspendedRounds: 0, yellowCards: 0, idleRounds: 0, salary: 0, contractSeasons: 1, seasonGames: 0, seasonGoals: 0, careerGames: 0, careerGoals: 0, cupDiscipline: {} };
    expect(effectiveRating({ ...p, morale: 2 }, "FW") / effectiveRating(p, "FW")).toBeCloseTo(1.06, 10);
  });

  test("todos os 11 tipos de evento ocorrem e têm narração", () => {
    const seen = new Map<MatchEventType, string>();
    const base = game(1);
    // Every league plays in the round: the context has every club (correcoes-validacao C61).
    const ctx = narrationContext(base.leagues.flatMap((l) => l.clubs));
    for (let seed = 1; seed <= 200 && seen.size < MATCH_EVENT_TYPES.length; seed++) {
      const state = game(1);
      state.rngState = seed * 2654435761;
      for (const m of runToEnd(startRound(state)).matches) {
        for (const e of m.events) {
          const text = narrate(e, ctx);
          expect(text.length).toBeGreaterThan(0);
          expect(text, e.type).not.toContain(e.clubId);
          for (const id of [e.playerId, e.playerInId]) if (id) expect(text, e.type).not.toContain(id);
          if (!seen.has(e.type)) seen.set(e.type, text);
        }
      }
    }
    // Penaltis C8: the in-play penalty is the 11th type.
    expect(MATCH_EVENT_TYPES).toHaveLength(11);
    expect(MATCH_EVENT_TYPES).toContain("penalty");
    expect([...seen.keys()].sort()).toEqual([...MATCH_EVENT_TYPES].sort());
    expect(new Set(seen.values()).size).toBe(11);
  });
});

describe("duas divisões na rodada", () => {
  test("sementes das partidas das duas divisões", () => {
    let state = game(12);
    state = playRound(state).state;
    const live = startRound(state);
    // Paises (Superseded checks): 4 leagues of 10 matches.
    expect(live.matches).toHaveLength(40);
    const [a, b] = state.leagues;
    const n = 2;
    a!.rounds[1]!.matches.forEach((m, i) => {
      const lm = live.matches[i]!;
      expect([lm.leagueId, lm.matchId, lm.home.clubId, lm.away.clubId]).toEqual(["l1", m.id, m.homeId, m.awayId]);
      expect(lm.rngState).toBe(mix32(state.rngState, n * 16 + i));
    });
    b!.rounds[1]!.matches.forEach((m, i) => {
      const lm = live.matches[10 + i]!;
      expect([lm.leagueId, lm.matchId, lm.home.clubId, lm.away.clubId]).toEqual(["l2", m.id, m.homeId, m.awayId]);
      expect(lm.rngState).toBe(mix32(mix32(state.rngState, 0xb), n * 16 + i));
    });
  });

  test("temporada inteira nas duas divisões", () => {
    const state0 = newGame(13);
    const club = state0.leagues[1]!.clubs[4]!;
    state0.userClubId = club.id;
    club.lineup = autoLineup(club, AI_FORMATION);
    let state = state0;
    for (let r = 1; r <= 38; r++) {
      const out = playRound(state);
      state = out.state;
      // The results shown are the user's division only.
      expect(out.results.map((x) => x.matchId)).toEqual(state.leagues[1]!.rounds[r - 1]!.matches.map((m) => m.id));
      for (const league of state.leagues) expect(league.currentRound, `${league.id} rodada ${r}`).toBe(r);
    }
    for (const league of state.leagues) {
      const played = league.rounds.flatMap((r) => r.matches).filter((m) => m.result !== null);
      expect(played, league.id).toHaveLength(380);
    }
  }, 60_000);
});

describe("disponibilidade na rodada da liga (copa-nacional)", () => {
  test("suspenso na copa joga a liga", () => {
    const state = game(87);
    const me = state.leagues[0]!.clubs[0]!;
    const ai = state.leagues[0]!.clubs[1]!;
    const fws = ai.players.filter((p) => p.position === "FW").sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
    const cupOnly = fws[0]!;
    const leagueOnly = fws[1]!;
    cupOnly.cupDiscipline = { "cup-nat": { yellowCards: 0, suspendedRounds: 1 } };
    leagueOnly.suspendedRounds = 1;
    const benchCup = me.players.find((p) => !me.lineup!.starters.includes(p.id))!;
    benchCup.cupDiscipline = { "cup-nat": { yellowCards: 0, suspendedRounds: 1 } };
    const benchLeague = me.players.find((p) => p !== benchCup && !me.lineup!.starters.includes(p.id))!;
    benchLeague.suspendedRounds = 1;
    const live = startRound(state);
    const sideOf = (id: string) => {
      const m = live.matches.find((x) => x.home.clubId === id || x.away.clubId === id)!;
      return m.home.clubId === id ? m.home : m.away;
    };
    expect(sideOf(ai.id).slots).toContain(cupOnly.id);
    expect([...sideOf(ai.id).slots, ...sideOf(ai.id).bench]).not.toContain(leagueOnly.id);
    expect(sideOf(me.id).bench).toContain(benchCup.id);
    expect(sideOf(me.id).bench).not.toContain(benchLeague.id);
  });
});

describe("sementes dos países (paises)", () => {
  test("semente das ligas novas", () => {
    // C8 (AC 8, door 2): the leagues abroad replayed here on the live engine with the seed
    // written out; the Série A and the Série B against the v6 snapshot.
    const s = newGame(1);
    const after = playRound(s).state;
    const players: Record<string, LivePlayer> = {};
    for (const l of s.leagues) for (const c of l.clubs) for (const p of c.players) players[p.id] = { ...p };
    for (const k of [2, 3]) {
      const league = s.leagues[k]!;
      const clubs = new Map(league.clubs.map((c) => [c.id, c]));
      const side = (id: string) => {
        const club = clubs.get(id)!;
        const lineup = aiLineup(club);
        const bench = club.players.filter((p) => !lineup.starters.includes(p.id)).map((p) => p.id);
        return makeSide(id, formationSlots(lineup.formation), lineup.starters, bench, players, { formation: lineup.formation, posture: "balanced" });
      };
      const replay = (seedOf: (i: number) => number) =>
        runToEnd({
          roundIndex: 0,
          roundNumber: 1,
          minute: 0,
          userClubId: null,
          players,
          matches: league.rounds[0]!.matches.map((m, i) => makeMatch(m.id, side(m.homeId), side(m.awayId), seedOf(i), league.id)),
        }).matches.map((m) => [m.homeGoals, m.awayGoals]);
      const stored = after.leagues[k]!.rounds[0]!.matches.map((m) => [m.result!.homeGoals, m.result!.awayGoals]);
      expect(stored, league.id).toEqual(replay((i) => mix32(mix32(mix32(s.rngState, 0xe0), k), 1 * 16 + i)));
      // The rejected seed (door 2) gives other scores.
      expect(stored, league.id).not.toEqual(replay((i) => mix32(mix32(s.rngState, 0xa + k), 1 * 16 + i)));
    }
    const snapshot = JSON.parse(readFileSync(new URL("./__fixtures__/snapshot-v6.json", import.meta.url), "utf8")) as Record<string, { results: unknown }>;
    for (const seed of [1, 2, 3]) {
      // Treino-evolucao (Superseded checks): round 1's evolution is undone before round 2, so round 2
      // plays the ratings the snapshot was taken with.
      const one = playRound(newGame(seed)).state;
      for (const p of one.leagues.flatMap((l) => l.clubs.flatMap((c) => c.players))) {
        p.rating -= (p.ratingLog ?? []).reduce((sum, step) => sum + step.delta, 0);
        delete p.ratingLog;
      }
      const two = playRound(one).state;
      const results = [0, 1].map((k) => [0, 1].map((r) => two.leagues[k]!.rounds[r]!.matches.map((m) => m.result)));
      expect(results, `seed ${seed}`).toEqual(snapshot[seed]!.results);
    }
  });
});

describe("partida coerente (correcoes-validacao)", () => {
  /** A fresh player (fitness 100, morale 0) of `position` and `rating`. */
  const fresh = (id: string, position: Position, rating: number): LivePlayer => ({ id, name: id, position, age: 25, rating, fitness: 100, morale: 0 });
  /** One side with a player of the slot's own position in every slot, all rated `rating`. */
  function flatSide(slotPos: Position[], rating = 70) {
    const players: Record<string, LivePlayer> = {};
    const ids = slotPos.map((pos, i) => {
      players[`p${i}`] = fresh(`p${i}`, pos, rating);
      return `p${i}`;
    });
    return { side: makeSide("c", slotPos, ids, [], players), players };
  }
  const shape = (df: number, mf: number, fw: number): Position[] => [
    "GK",
    ...Array<Position>(df).fill("DF"),
    ...Array<Position>(mf).fill("MF"),
    ...Array<Position>(fw).fill("FW"),
  ];

  test("time do usuário com vaga joga", () => {
    // C18 (AC 16, AC 17): 10 available, all of them in the eleven, one slot empty.
    const state = game(8);
    const me = state.leagues[0]!.clubs[0]!;
    me.players.forEach((p, i) => Object.assign(p, { injuryRounds: i < 10 ? 0 : 5, suspendedRounds: 0 }));
    me.lineup = autoLineup(me, AI_FORMATION);
    expect(me.lineup.starters.filter((id) => id === null)).toHaveLength(1);
    expect(validateLineup(me, me.lineup)).toEqual({ ok: true, missing: 0 });
    const live = startRound(state);
    const side = userSide(live);
    expect(side.slots.filter((id) => id === null)).toHaveLength(1);
    const out = finishRound(state, live);
    const mine = out.results.find((r) => r.homeId === me.id || r.awayId === me.id)!;
    expect(Number.isInteger(mine.result.homeGoals)).toBe(true);
    expect(Number.isInteger(mine.result.awayGoals)).toBe(true);
    expect(out.state.leagues[0]!.currentRound).toBe(1);
  });

  test("goleiro efetivo sem goleiro", () => {
    // C42 (AC 38): the best outfield player on the pitch, 80, in goal at 80 × 0,75.
    const { side, players } = flatSide(formationSlots("4-4-2"));
    players.p3 = fresh("p3", "DF", 80);
    players.p9 = fresh("p9", "FW", 76);
    side.slots[0] = null;
    side.vacancy[0] = { why: "red", playerId: "p0" };
    expect(keeperStrength(side, players)).toBe(80 * 0.75);
    expect(keeperStrength(side, players)).toBe(60);
    // With the keeper in his slot, it is his own rating.
    const withKeeper = flatSide(formationSlots("4-4-2"));
    expect(keeperStrength(withKeeper.side, withKeeper.players)).toBe(70);
    // The side's keeper term reads it: 0,7 × keeper + 0,3 × the defenders' mean (as in the core).
    expect(sideStrength(side, players).gk).toBeCloseTo(0.7 * 60 + 0.3 * ((70 + 70 + 80 + 70) / 4), 10);
  });

  test("IA repõe goleiro expulso", () => {
    // C44 (AC 40, L-007): a keeper on the bench and a sub left; no sub left; no keeper on the bench.
    function sentOffKeeper(opts: { subsUsed: number; benchKeeper: boolean }) {
      const slotPos = formationSlots("4-4-2");
      const players: Record<string, LivePlayer> = {};
      const ids = slotPos.map((pos, i) => {
        players[`a${i}`] = fresh(`a${i}`, pos, 70 + i);
        return `a${i}`;
      });
      players.benchGk = fresh("benchGk", "GK", 65);
      players.benchDf = fresh("benchDf", "DF", 90);
      const bench = opts.benchKeeper ? ["benchDf", "benchGk"] : ["benchDf"];
      const ai = makeSide("ai", slotPos, ids, bench, players);
      ai.slots[0] = null;
      ai.vacancy[0] = { why: "red", playerId: "a0" };
      ai.sentOff.push("a0");
      ai.subsUsed = opts.subsUsed;
      const other = flatSide(formationSlots("4-4-2"));
      Object.assign(players, other.players);
      const m = makeMatch("m", ai, other.side, 12345);
      const before = [...ai.slots];
      stepMatch(m, 20, players, createRng(12345));
      return { m, before, players };
    }
    const replaced = sentOffKeeper({ subsUsed: 0, benchKeeper: true });
    const side = replaced.m.home;
    expect(side.slots[0]).toBe("benchGk");
    // One outfield player went off for him: the weakest on the pitch, a1 (71).
    expect(side.subbedOff).toEqual(["a1"]);
    expect(side.slots).not.toContain("a1");
    expect(side.slots.filter(Boolean)).toHaveLength(10);
    expect(side.subsUsed).toBe(1);
    // Ajustes-substituicao C4: the hole also keeps the sector of the slot it moved to.
    expect(side.vacancy[1]).toEqual({ why: "red", playerId: "a0", pos: "DF" });
    expect(replaced.m.events.filter((e) => e.type === "substitution")).toEqual([
      { minute: 20, type: "substitution", clubId: "ai", playerId: "a1", playerInId: "benchGk" },
    ]);

    for (const [label, opts] of [
      ["sem substituição", { subsUsed: MAX_SUBS, benchKeeper: true }],
      ["sem goleiro reserva", { subsUsed: 0, benchKeeper: false }],
    ] as const) {
      const { m, before } = sentOffKeeper(opts);
      expect(m.home.slots, label).toEqual(before);
      expect(m.home.slots[0], label).toBeNull();
      expect(m.home.subsUsed, label).toBe(opts.subsUsed);
      expect(m.events.filter((e) => e.type === "substitution"), label).toEqual([]);
    }
  });

  test("setor cresce com a contagem", () => {
    // C45 (AC 41): the 11 rated 70, each in his own position.
    const of = (slotPos: Position[]) => {
      const { side, players } = flatSide(slotPos);
      return sideStrength(side, players);
    };
    const s433 = of(formationSlots("4-3-3"));
    const s451 = of(formationSlots("4-5-1"));
    expect(s433.att).toBeGreaterThanOrEqual(1.2 * s451.att);
    expect(of(shape(5, 3, 2)).def).toBeGreaterThan(of(shape(3, 5, 2)).def);
    // The 4-4-2 of the core is unchanged: every sector is its players' mean.
    const s442 = of(formationSlots("4-4-2"));
    expect([s442.gk, s442.def, s442.mid, s442.att]).toEqual([70, 70, 70, 70].map((x) => expect.closeTo(x, 10)));
  });

  test("vaga fica no setor perdido", () => {
    // C47 (AC 43, L-005): 10 men, a DF sent off (4-5-1 -> 4-4-2) and the FW sent off (4-4-2 -> 4-5-1).
    const cases: [FormationName, Position, FormationName][] = [
      ["4-5-1", "DF", "4-4-2"],
      ["4-4-2", "FW", "4-5-1"],
    ];
    for (const [from, lost, to] of cases) {
      const state = game(7);
      const me = state.leagues[0]!.clubs[0]!;
      for (const p of me.players) Object.assign(p, { injuryRounds: 0, suspendedRounds: 0 });
      me.lineup = autoLineup(me, from);
      const live = startRound(state);
      const side = userSide(live);
      const slot = side.slotPos.lastIndexOf(lost);
      const id = side.slots[slot]!;
      expect(live.players[id]!.position, `${from} ${lost}`).toBe(lost);
      side.slots[slot] = null;
      side.vacancy[slot] = { why: "red", playerId: id };
      side.sentOff.push(id);
      const after = userSide(changeFormation(live, state.userClubId!, to));
      const empty = after.slots.flatMap((s, i) => (s ? [] : [i]));
      expect(empty, `${from} -> ${to}`).toHaveLength(1);
      expect(after.slotPos[empty[0]!], `${from} -> ${to}`).toBe(lost);
      expect(after.vacancy[empty[0]!], `${from} -> ${to}`).toEqual({ why: "red", playerId: id });
    }
  });
});

describe("parada obrigatória (parada-obrigatoria)", () => {
  /** The user's side at minute 10 of round 1, everyone available. */
  function at10(seed = 2): { state: GameState; live: LiveRound; side: LiveSide } {
    const state = game(seed);
    for (const p of state.leagues[0]!.clubs[0]!.players) Object.assign(p, { injuryRounds: 0, suspendedRounds: 0 });
    const live = stepTo(startRound(state), 10);
    return { state, live, side: userSide(live) };
  }

  function vacate(side: LiveSide, slot: number, why: "injury" | "red"): string {
    const id = side.slots[slot]!;
    side.slots[slot] = null;
    side.vacancy[slot] = { why, playerId: id };
    if (why === "red") side.sentOff.push(id);
    return id;
  }

  const gkSlot = (side: LiveSide) => side.slotPos.indexOf("GK");
  const benchKeepers = (live: LiveRound, side: LiveSide) => side.bench.filter((id) => live.players[id]!.position === "GK");

  test("parada só do usuário no minuto", () => {
    // C1.
    const { state, live } = at10();
    const m = userMatch(live)!;
    const me = state.userClubId!;
    const rival = m.home.clubId === me ? m.away.clubId : m.home.clubId;
    const other = live.matches.find((x) => x !== m)!;
    m.events.push(
      { minute: 9, type: "injury", clubId: me, playerId: "old" },
      { minute: 10, type: "yellow", clubId: me, playerId: "y" },
      { minute: 10, type: "injury", clubId: me, playerId: "a" },
      { minute: 10, type: "injury", clubId: rival, playerId: "b" },
      { minute: 10, type: "red", clubId: me, playerId: "c" },
    );
    other.events.push({ minute: 10, type: "red", clubId: other.home.clubId, playerId: "d" });
    expect(userStops(live)).toEqual([
      { minute: 10, type: "injury", clubId: me, playerId: "a" },
      { minute: 10, type: "red", clubId: me, playerId: "c" },
    ]);
    expect(userStops({ ...live, userClubId: null })).toEqual([]);
  });

  test("troca obrigatória: tabela", () => {
    // C2 (L-005, L-007): the 8 cases.
    const cases: [string, (live: LiveRound, side: LiveSide) => void, (side: LiveSide) => ReturnType<typeof forcedVacancy>][] = [
      ["lesão com troca", (_l, s) => void vacate(s, 10, "injury"), () => ({ slot: 10, why: "injury" })],
      ["lesão sem substituição", (_l, s) => (vacate(s, 10, "injury"), (s.subsUsed = MAX_SUBS)), () => null],
      ["lesão com banco vazio", (_l, s) => (vacate(s, 10, "injury"), (s.bench = [])), () => null],
      ["goleiro expulso com reserva", (_l, s) => void vacate(s, gkSlot(s), "red"), (s) => ({ slot: gkSlot(s), why: "red" })],
      [
        "goleiro expulso sem goleiro no banco",
        (l, s) => (vacate(s, gkSlot(s), "red"), (s.bench = s.bench.filter((id) => l.players[id]!.position !== "GK"))),
        () => null,
      ],
      ["goleiro expulso sem substituição", (_l, s) => (vacate(s, gkSlot(s), "red"), (s.subsUsed = MAX_SUBS)), () => null],
      ["jogador de linha expulso", (_l, s) => void vacate(s, 4, "red"), () => null],
      ["sem vaga", () => undefined, () => null],
    ];
    expect(cases).toHaveLength(8);
    for (const [name, arrange, expected] of cases) {
      const { live, side } = at10();
      expect(benchKeepers(live, side).length, name).toBeGreaterThan(0);
      expect(side.slotPos[4], name).not.toBe("GK");
      arrange(live, side);
      expect(forcedVacancy(live), name).toEqual(expected(side));
    }
  });

  test("goleiro expulso: reserva entra no gol", () => {
    // C3: a keeper for an outfield player goes in goal; any other reserve is a plain substitution.
    const { state, live, side } = at10();
    const gk = gkSlot(side);
    const expelled = vacate(side, gk, "red");
    const keeper = benchKeepers(live, side)[0]!;
    const outSlot = side.slotPos.indexOf("DF");
    const outId = side.slots[outSlot]!;
    const after = ok(substitute(live, state.userClubId!, outSlot, keeper));
    const s = userSide(after);
    expect(s.slots[gk]).toBe(keeper);
    expect(s.slots[outSlot]).toBeNull();
    // Ajustes-substituicao C3: the hole also keeps the sector of the slot it moved to.
    expect(s.vacancy[outSlot]).toEqual({ why: "red", playerId: expelled, pos: "DF" });
    expect(s.vacancy[gk]).toBeUndefined();
    expect(s.subbedOff).toContain(outId);
    expect(s.subsUsed).toBe(1);
    expect(userMatch(after)!.events.at(-1)).toEqual({ minute: 10, type: "substitution", clubId: state.userClubId, playerId: outId, playerInId: keeper });

    const other = side.bench.find((id) => live.players[id]!.position !== "GK")!;
    const plain = userSide(ok(substitute(live, state.userClubId!, outSlot, other)));
    expect(plain.slots[outSlot]).toBe(other);
    expect(plain.slots[gk]).toBeNull();
    expect(plain.vacancy[gk]).toEqual({ why: "red", playerId: expelled });
  });

  test("pular preenche as vagas do usuário", () => {
    // C4: the AI's rule for the user's holes when nobody decides any more. Everyone at full fitness
    // and neutral morale, so the best reserve is the highest rating (ties by id) and the weakest
    // outfield player the lowest.
    const fresh = (seed = 2) => {
      const f = at10(seed);
      for (const p of Object.values(f.live.players)) Object.assign(p, { fitness: 100, morale: 0 });
      for (const id of Object.keys(f.side.fitness)) f.side.fitness[id] = 100;
      return f;
    };
    const best = (live: LiveRound, ids: string[]) =>
      [...ids].sort((a, b) => live.players[b]!.rating - live.players[a]!.rating || a.localeCompare(b))[0];
    const firstSub = (live: LiveRound) => userMatch(live)!.events.find((e) => e.type === "substitution" && e.clubId === live.userClubId)!;

    // Injury, with a reserve of the same position: the best of them comes on at 11'.
    const { live, side } = fresh();
    const pos = side.slotPos[10]!;
    const sameBench = side.bench.filter((id) => live.players[id]!.position === pos);
    expect(sameBench.length).toBeGreaterThan(1);
    const injured = vacate(side, 10, "injury");
    const filled = runToEnd(live, { fillUserVacancies: true });
    const sub = firstSub(filled);
    expect(sub.minute).toBe(11);
    expect(sub.playerId).toBe(injured);
    expect(sub.playerInId).toBe(best(live, sameBench));
    const end = userSide(filled);
    for (const v of Object.values(end.vacancy)) if (v.why === "injury") expect(end.subsUsed === MAX_SUBS || end.bench.length === 0).toBe(true);

    // Without the option the hole stays, as with step() until 90.
    const left = userSide(runToEnd(live));
    expect(left.slots[10]).toBeNull();
    expect(left.vacancy[10]?.why).toBe("injury");

    // Injury, no reserve of that position (L-007): the best of any position comes on.
    const n = fresh();
    const nPos = n.side.slotPos[10]!;
    n.side.bench = n.side.bench.filter((id) => n.live.players[id]!.position !== nPos);
    const others = [...n.side.bench];
    vacate(n.side, 10, "injury");
    const anySub = firstSub(runToEnd(n.live, { fillUserVacancies: true }));
    expect(anySub.minute).toBe(11);
    expect(n.live.players[anySub.playerInId!]!.position).not.toBe(nPos);
    expect(anySub.playerInId).toBe(best(n.live, others));

    // Keeper sent off: the bench keeper goes in goal and the lowest-rated outfield player goes off.
    const k = fresh();
    const gk = gkSlot(k.side);
    vacate(k.side, gk, "red");
    const keepers = benchKeepers(k.live, k.side);
    const outfield = k.side.slots.filter((id, i): id is string => !!id && k.side.slotPos[i] !== "GK");
    for (const [i, id] of k.side.slots.entries()) if (id) expect(k.live.players[id]!.position).toBe(k.side.slotPos[i]);
    const lowest = Math.min(...outfield.map((id) => k.live.players[id]!.rating));
    const done = runToEnd(k.live, { fillUserVacancies: true });
    const keeperSub = firstSub(done);
    expect(keeperSub.minute).toBe(11);
    expect(keepers).toContain(keeperSub.playerInId);
    expect(outfield).toContain(keeperSub.playerId);
    expect(k.live.players[keeperSub.playerId!]!.rating).toBe(lowest);
    expect(userSide(done).subbedOff).toContain(keeperSub.playerId);
    expect(keepers).toContain(userSide(done).slots[gk]);
  });
});

describe("treino na partida (treino-evolucao)", () => {
  test("chance de lesão pelo treino", () => {
    // C10: 0,00125 per side and minute, × 0,8 / 1 / 1,3; absent is Normal.
    expect(injuryChance("light")).toBeCloseTo(0.00125 * 0.8, 15);
    expect(injuryChance("normal")).toBeCloseTo(0.00125, 15);
    expect(injuryChance("hard")).toBeCloseTo(0.00125 * 1.3, 15);
    expect(injuryChance(undefined)).toBeCloseTo(0.00125, 15);
  });

  test("treino na partida", () => {
    // C11: sideFor carries the club's training; the draws per minute stay the same.
    const state = game(5);
    const me = state.leagues[0]!.clubs[0]!;
    me.training = "hard";
    const full = startRound(state);
    expect(userSide(full).training).toBe("hard");
    const m0 = userMatch(full)!;
    const rival = m0.home.clubId === state.userClubId ? m0.away : m0.home;
    expect(injuryChance(rival.training)).toBeCloseTo(0.00125, 15);

    const only = (training: "light" | "normal" | "hard", rngState: number) => {
      const live: LiveRound = { ...full, matches: [{ ...structuredClone(m0), rngState }] };
      userSide(live).training = training;
      return runToEnd(live).matches[0]!;
    };
    const injuriesOf = (m: ReturnType<typeof only>) => m.events.filter((e) => e.type === "injury");
    let quiet = 0;
    for (let s = 1; s < 200 && !quiet; s++) {
      const runs = (["light", "normal", "hard"] as const).map((t) => only(t, s));
      if (runs.every((m) => injuriesOf(m).length === 0)) quiet = s;
    }
    expect(quiet).toBeGreaterThan(0);
    const [light, normal, hard] = (["light", "normal", "hard"] as const).map((t) => only(t, quiet));
    expect(light!.events).toEqual(normal!.events);
    expect(hard!.events).toEqual(normal!.events);
    expect(light!.rngState).toBe(normal!.rngState);
    expect(hard!.rngState).toBe(normal!.rngState);

    // A stream where the hard side gets an injury the normal side does not: up to that minute both
    // matches are the same, so the draw fell between 0,00125 and 0,001625.
    let found = false;
    for (let s = 1; s < 3000 && !found; s++) {
      const n = only("normal", s);
      const h = only("hard", s);
      const k = h.events.findIndex((e, i) => JSON.stringify(e) !== JSON.stringify(n.events[i]));
      if (k < 0) continue;
      const first = h.events[k]!;
      if (first.type === "injury" && first.clubId === state.userClubId) {
        expect(n.events.slice(0, k)).toEqual(h.events.slice(0, k));
        expect(n.events.some((e) => e.minute === first.minute && e.type === "injury" && e.clubId === state.userClubId)).toBe(false);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});

describe("posição na substituição (posicao-na-substituicao)", () => {
  /** Minute 10 of a 4-4-2 with the defender of slot 2 sent off; 10 on the pitch. */
  function redAt2() {
    const state = game(2);
    const live = stepTo(startRound(state), 10);
    const side = userSide(live);
    expect(side.formation).toBe("4-4-2");
    expect(side.slots.filter(Boolean)).toHaveLength(11);
    expect(side.slotPos[2]).toBe("DF");
    expect(side.slotPos[9]).toBe("FW");
    const expelled = side.slots[2]!;
    side.slots[2] = null;
    side.vacancy[2] = { why: "red", playerId: expelled };
    side.sentOff.push(expelled);
    const defender = side.bench.find((id) => live.players[id]!.position === "DF")!;
    expect(defender).toBeDefined();
    return { state, live, expelled, defender, striker: side.slots[9]! };
  }

  test("entra na vaga do expulso", () => {
    // C1: the defender coming on takes the red card's slot; the hole moves to the striker's slot.
    const { state, live, expelled, defender, striker } = redAt2();
    const after = userSide(ok(substitute(live, state.userClubId!, 9, defender, 2)));
    expect(after.slots[2]).toBe(defender);
    expect(after.slots[9]).toBeNull();
    // Amended after verification: the hole also keeps the sector it was moved to.
    expect(after.vacancy[9]).toEqual({ why: "red", playerId: expelled, pos: "FW" });
    expect(after.vacancy[2]).toBeUndefined();
    expect(after.subsUsed).toBe(userSide(live).subsUsed + 1);
    expect(after.subbedOff).toContain(striker);
    expect(after.bench).not.toContain(defender);
    expect(userMatch(ok(substitute(live, state.userClubId!, 9, defender, 2)))!.events.at(-1)).toMatchObject({
      type: "substitution",
      playerId: striker,
      playerInId: defender,
    });
    expect(after.slots.filter(Boolean)).toHaveLength(10);
  });

  test("posição padrão é a de quem sai", () => {
    // C2: without a target, or with the slot of who leaves, nothing changes from before.
    const { state, live, expelled, defender } = redAt2();
    const plain = ok(substitute(live, state.userClubId!, 9, defender));
    const same = ok(substitute(live, state.userClubId!, 9, defender, 9));
    expect(same).toEqual(plain);
    const side = userSide(plain);
    expect(side.slots[9]).toBe(defender);
    expect(side.slots[2]).toBeNull();
    expect(side.vacancy[2]).toEqual({ why: "red", playerId: expelled });
  });

  test("posição na substituição: recusas", () => {
    // C3 (L-005, L-007): every refusal returns the reason and leaves the round as it was.
    const { state, live, defender } = redAt2();
    const me = state.userClubId!;
    const injured = structuredClone(live);
    const injuredSide = userSide(injured);
    const hurt = injuredSide.slots[6]!;
    injuredSide.slots[6] = null;
    injuredSide.vacancy[6] = { why: "injury", playerId: hurt };
    const full = structuredClone(live);
    const fullSide = userSide(full);
    fullSide.subsUsed = MAX_SUBS;
    const back = structuredClone(live);
    userSide(back).subbedOff.push(defender);
    const rows: [string, LiveRound, number, string, number, string][] = [
      ["vaga ocupada", live, 9, defender, 5, "not_vacant"],
      ["vaga de lesão", injured, 9, defender, 6, "not_vacant"],
      ["fora do time (-1)", live, 9, defender, -1, "not_vacant"],
      ["fora do time (11)", live, 9, defender, 11, "not_vacant"],
      ["sai o expulso", live, 2, defender, 2, "sent_off"],
      ["limite", full, 9, defender, 2, "limit"],
      ["quem já saiu", back, 9, defender, 2, "returning"],
    ];
    for (const [name, round, slot, inId, target, reason] of rows) {
      const before = structuredClone(round);
      expect(substitute(round, me, slot, inId, target), name).toEqual({ ok: false, reason });
      expect(round, name).toEqual(before);
    }
  });

  test("formação depois da troca mantém a posição", () => {
    // C8 (L-005): every formation keeps the hole in the attack and the defenders at the back.
    const { state, live, expelled, defender } = redAt2();
    const me = state.userClubId!;
    const subbed = ok(substitute(live, me, 9, defender, 2));
    const rows: [FormationName, number][] = [
      ["4-4-2", 4],
      ["4-5-1", 4],
      ["4-3-3", 4],
      ["3-5-2", 3],
    ];
    for (const [formation, backs] of rows) {
      const side = userSide(changeFormation(subbed, me, formation));
      const lastFw = side.slotPos.lastIndexOf("FW");
      expect(side.slots[lastFw], formation).toBeNull();
      expect(side.vacancy[lastFw], formation).toMatchObject({ why: "red", playerId: expelled });
      const inDefence = side.slots.filter((id, i) => id && side.slotPos[i] === "DF" && subbed.players[id]!.position === "DF");
      expect(inDefence, formation).toHaveLength(backs);
      expect(side.slots.filter(Boolean), formation).toHaveLength(10);
    }
    const fiveOne = userSide(changeFormation(subbed, me, "4-5-1"));
    const striker = fiveOne.slots.find((id) => id && subbed.players[id]!.position === "FW")!;
    expect(fiveOne.slotPos[fiveOne.slots.indexOf(striker)]).toBe("MF");
  });
});

describe("ajustes da substituição (ajustes-substituicao)", () => {
  /** Minute 10 of round 1 with the user's keeper sent off; everyone else available. */
  function keeperOff() {
    const state = game(2);
    for (const p of state.leagues[0]!.clubs[0]!.players) Object.assign(p, { injuryRounds: 0, suspendedRounds: 0 });
    const live = stepTo(startRound(state), 10);
    const side = userSide(live);
    expect(side.formation).toBe("4-4-2");
    const goal = side.slotPos.indexOf("GK");
    const keeper = side.slots[goal]!;
    side.slots[goal] = null;
    side.vacancy[goal] = { why: "red", playerId: keeper };
    side.sentOff.push(keeper);
    const reserve = side.bench.find((id) => live.players[id]!.position === "GK")!;
    expect(reserve).toBeDefined();
    return { state, live, keeper, reserve };
  }

  test("regra do goleiro grava o setor", () => {
    // C3 (L-005, L-018, L-028): the hole keeps the sector of the slot left, not the keeper's.
    const { state, live, keeper, reserve } = keeperOff();
    const me = state.userClubId!;
    expect(userSide(live).slotPos[2]).toBe("DF");
    const subbed = ok(substitute(live, me, 2, reserve));
    expect(userSide(subbed).vacancy[2]).toEqual({ why: "red", playerId: keeper, pos: "DF" });
    for (const formation of ["4-4-2", "4-5-1", "4-3-3", "3-5-2"] as FormationName[]) {
      const side = userSide(changeFormation(subbed, me, formation));
      expect(side.slots[side.slotPos.indexOf("GK")], formation).toBe(reserve);
      const holes = side.slots.flatMap((id, i) => (id ? [] : [i]));
      expect(holes, formation).toHaveLength(1);
      expect(side.slotPos[holes[0]!], formation).toBe("DF");
      expect(side.vacancy[holes[0]!], formation).toMatchObject({ why: "red", playerId: keeper });
      expect(side.slots.filter(Boolean), formation).toHaveLength(10);
    }
  });

  test("preenchimento do gol grava o setor", () => {
    // C4 (L-018): the automatic keeper rule records the sector of the outfield slot that was left.
    const { live, keeper } = keeperOff();
    const side = userSide(runToEnd(live, { fillUserVacancies: true }));
    const inGoal = side.slots[side.slotPos.indexOf("GK")]!;
    expect(live.players[inGoal]!.position).toBe("GK");
    expect(userSide(live).bench).toContain(inGoal);
    const left = Object.entries(side.vacancy).filter(([, v]) => v.playerId === keeper);
    expect(left).toHaveLength(1);
    const [slot, v] = left[0]!;
    expect(side.slotPos[Number(slot)]).not.toBe("GK");
    expect(v).toEqual({ why: "red", playerId: keeper, pos: side.slotPos[Number(slot)] });
  });
});

describe("pênalti no jogo (penaltis)", () => {
  const flat = (clubId: string, rating: number): TeamSheet => ({
    clubId,
    starters: formationSlots("4-4-2").map((position, i) => ({ id: `${clubId}-${i}`, name: `${clubId} ${i}`, position, age: 25, rating })),
  });
  const KICKS: readonly MatchEventType[] = ["goal", "shot_saved", "shot_missed"];

  test("pênalti marcado e cobrado", () => {
    // C1 (AC 1, AC 2, door 2): every award is followed by exactly one kick of the same side and minute.
    const kinds = new Set<MatchEventType>();
    let awarded = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const { result, events } = simulateMatch(flat("H", 70), flat("A", 70), createRng(seed));
      events.forEach((e, i) => {
        if (e.penalty) expect(events[i - 1]?.type, `seed ${seed} min ${e.minute}`).toBe("penalty");
        if (e.type !== "penalty") return;
        awarded++;
        const kick = events[i + 1]!;
        expect(kick, `seed ${seed}`).toMatchObject({ minute: e.minute, clubId: e.clubId, penalty: true });
        expect(KICKS).toContain(kick.type);
        expect(kick.playerId?.startsWith(`${e.clubId}-`), `seed ${seed}`).toBe(true);
        kinds.add(kick.type);
        const shots = events.filter((x) => x.minute === e.minute && x.clubId === e.clubId && KICKS.includes(x.type));
        expect(shots, `seed ${seed}`).toEqual([kick]);
        if (kick.type === "goal") expect(result.goals).toContainEqual({ minute: kick.minute, clubId: kick.clubId, playerId: kick.playerId });
      });
    }
    expect(awarded).toBeGreaterThan(0);
    expect([...kinds].sort()).toEqual(["goal", "shot_missed", "shot_saved"]);
  });

  test("sem ninguém em campo não tem pênalti", () => {
    // C7 (AC 9): a side with every slot empty is never awarded a penalty.
    const away = flat("A", 70).starters;
    const players: Record<string, LivePlayer> = Object.fromEntries(away.map((p) => [p.id, p]));
    for (let seed = 1; seed <= 200; seed++) {
      const home = makeSide("H", formationSlots("4-4-2"), Array<string | null>(11).fill(null), [], players);
      const m = makeMatch("t", home, makeSide("A", formationSlots("4-4-2"), away.map((p) => p.id), [], players), 0);
      const rng = createRng(seed);
      for (let minute = 1; minute <= 90; minute++) stepMatch(m, minute, players, rng);
      expect(m.events.filter((e) => e.type === "penalty" && e.clubId === "H"), `seed ${seed}`).toEqual([]);
    }
  });

  test("cobrador escolhido bate no jogo", () => {
    // C13 (AC 15, L-003, L-006): through startRound and sideFor, the chosen midfielder takes the
    // user's in-play penalty while on the pitch; the automatic order would pick a forward.
    let checked = 0;
    for (let seed = 1; seed <= 400 && checked === 0; seed++) {
      const state = game(1);
      const club = state.leagues[0]!.clubs[0]!;
      const starters = club.lineup!.starters.filter((id): id is string => !!id);
      const mf = starters.find((id) => club.players.find((p) => p.id === id)!.position === "MF")!;
      club.lineup = { ...club.lineup!, penaltyTaker: mf };
      state.rngState = seed * 2654435761;
      const live = startRound(state);
      for (const m of live.matches) {
        for (const side of [m.home, m.away]) expect(side.penaltyTaker).toBe(side.clubId === club.id ? mf : undefined);
      }
      const auto = penaltyTakers({ ...userMatchSide(live, club.id), penaltyTaker: undefined }, live.players)[0];
      expect(auto).not.toBe(mf);
      const m = userMatch(runToEnd(live))!;
      const left = m.events.find((e) => e.playerId === mf && (e.type === "substitution" || e.type === "red" || e.type === "injury"));
      m.events.forEach((e, i) => {
        if (e.type !== "penalty" || e.clubId !== club.id || (left && left.minute <= e.minute)) return;
        expect(m.events[i + 1]!.playerId, `seed ${seed}`).toBe(mf);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("pênalti contra o goleiro (penaltis round 2)", () => {
  test("pênalti contra o goleiro, não contra a defesa", () => {
    // C17 (AC 3): a keeper of 50 behind a defence of 80; a taker of 70 scores with
    // penaltyChance(70, 50) = 0,85, not with the side's blended keeper strength (59 -> 0,805).
    // Scripted draws: home ball, a chance, a penalty, then the kick's roll; every later draw 0,99.
    const sheet = (clubId: string, keeper: number, others: number): LivePlayer[] =>
      formationSlots("4-4-2").map((position, i) => ({ id: `${clubId}-${i}`, name: `${clubId} ${i}`, position, age: 25, rating: position === "GK" ? keeper : others, fitness: 100, morale: 0 }));
    const [home, away] = [sheet("H", 70, 70), sheet("A", 50, 80)];
    const players: Record<string, LivePlayer> = Object.fromEntries([...home, ...away].map((p) => [p.id, p]));
    const side = (id: string, list: LivePlayer[]) => makeSide(id, formationSlots("4-4-2"), list.map((p) => p.id), [], players);
    expect(keeperStrength(side("A", away), players)).toBe(50);
    const cases: [number, MatchEventType][] = [
      [0.83, "goal"],
      [0.849, "goal"],
      [0.851, "shot_missed"],
    ];
    for (const [roll, type] of cases) {
      const draws = [0, 0, 0, roll];
      const rng = { next: () => draws.shift() ?? 0.99, getState: () => 0 };
      const m = makeMatch("t", side("H", home), side("A", away), 0);
      stepMatch(m, 1, players, rng);
      expect(m.events.map((e) => e.type), String(roll)).toEqual(["kickoff", "penalty", type]);
      expect(m.events[2], String(roll)).toMatchObject({ clubId: "H", penalty: true });
    }
  });
});

function userMatchSide(live: LiveRound, clubId: string): LiveSide {
  const m = userMatch(live)!;
  return m.home.clubId === clubId ? m.home : m.away;
}
