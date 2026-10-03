import { createRng, type Rng } from "../engine/rng";
import type { MatchEvent, MatchEventType } from "../engine/types";
import { createAudio } from "./audio";
import { effectsFor } from "./sfx";
import type { EffectId } from "./backend";
import { effects, fakeBackend, type Call, type FakeBackend } from "./test-backend";

const constant = (v: number): Rng => ({ next: () => v, getState: () => 0 });

/** The audio after the first gesture, the user's club being "u" and the opponent "o". */
function started(rng: Rng = createRng(1)) {
  const backend = fakeBackend();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const audio = createAudio({ backend, rng, doc, storage: () => null });
  doc.dispatchEvent(new Event("pointerdown"));
  const send = (type: MatchEventType, clubId = "u") => audio.matchEvents([{ minute: 10, type, clubId } satisfies MatchEvent], "u");
  const effectCalls = () => backend.calls.filter((c): c is Extract<Call, { kind: "effect" }> => c.kind === "effect");
  return { audio, backend, send, effectCalls, doc };
}

const wait = (ms: number) => vi.advanceTimersByTime(ms);

/** Every effect the backend plays from now on, with the milliseconds since now (fake clock). */
function timeline(backend: FakeBackend): [EffectId, number][] {
  const t0 = Date.now();
  const heard: [EffectId, number][] = [];
  const play = backend.playEffect;
  backend.playEffect = (id, variant, pitch) => {
    heard.push([id, Date.now() - t0]);
    play(id, variant, pitch);
  };
  return heard;
}

const at90 = (type: MatchEventType, clubId: string): MatchEvent => ({ minute: 90, type, clubId });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("efeitos da partida (audio S2)", () => {
  test("efeito de cada tipo de evento", () => {
    // Audio C7: the 12 event types, both sides of a goal. Ajustes-audio C10: the shoot-out kicks
    // sound in the shoot-out's sequence (1.5 s after they arrive) and a user's kick has no jingle.
    const table: [MatchEventType, string, string[]][] = [
      ["kickoff", "u", ["whistle-short"]],
      ["halftime", "u", ["whistle-double"]],
      ["fulltime", "u", ["whistle-long"]],
      ["goal", "u", ["crowd-roar", "goal-jingle"]],
      ["goal", "o", ["crowd-groan"]],
      ["penalty_scored", "u", ["crowd-roar"]],
      ["penalty_scored", "o", ["crowd-groan"]],
      ["shot_saved", "u", ["crowd-ooh"]],
      ["shot_missed", "o", ["crowd-ooh"]],
      ["penalty_missed", "u", ["crowd-ooh"]],
      ["yellow", "o", ["whistle-short"]],
      ["red", "u", ["whistle-short", "crowd-boo"]],
      ["injury", "u", []],
      ["substitution", "u", []],
    ];
    const types = new Set(table.map(([t]) => t));
    expect(types.size).toBe(12);
    const { backend, send } = started();
    for (const [type, side, expected] of table) {
      const before = backend.calls.length;
      send(type, side);
      if (type === "penalty_scored" || type === "penalty_missed") {
        expect(effects(backend.calls.slice(before)), `${type} ${side} na chegada`).toEqual([]);
        wait(1500);
      }
      expect(effects(backend.calls.slice(before)), `${type} ${side}`).toEqual(expected);
      // Long enough for a shoot-out's closing jingle to play before the next row.
      wait(3000);
    }
  });

  test("disputa de pênaltis cobrança por cobrança", () => {
    // Ajustes-audio C7 (AC 7): the whistle and four kicks in one tick; user scores, opponent
    // scores, user misses, opponent misses.
    const { audio, backend } = started();
    const heard = timeline(backend);
    audio.matchEvents([at90("fulltime", "u"), at90("penalty_scored", "u"), at90("penalty_scored", "o"), at90("penalty_missed", "u"), at90("penalty_missed", "o")], "u");
    wait(20000);
    expect(heard).toEqual([
      ["whistle-long", 0],
      ["crowd-roar", 1500],
      ["crowd-groan", 2700],
      ["crowd-ooh", 3900],
      ["crowd-ooh", 5100],
    ]);
  });

  test("vinheta só na vitória da disputa", () => {
    // Ajustes-audio C8 (AC 8, AC 9): the user wins 2 x 1, then loses 0 x 1.
    const won = started();
    const wonHeard = timeline(won.backend);
    won.audio.matchEvents([at90("fulltime", "u"), at90("penalty_scored", "u"), at90("penalty_scored", "o"), at90("penalty_scored", "u"), at90("penalty_missed", "o")], "u");
    wait(20000);
    expect(wonHeard).toEqual([
      ["whistle-long", 0],
      ["crowd-roar", 1500],
      ["crowd-groan", 2700],
      ["crowd-roar", 3900],
      ["crowd-ooh", 5100],
      ["goal-jingle", 5100 + 1200],
    ]);

    const lost = started();
    const lostHeard = timeline(lost.backend);
    lost.audio.matchEvents([at90("fulltime", "u"), at90("penalty_missed", "u"), at90("penalty_scored", "o")], "u");
    wait(20000);
    expect(lostHeard).toEqual([
      ["whistle-long", 0],
      ["crowd-ooh", 1500],
      ["crowd-groan", 2700],
    ]);
  });

  test("efeitos desligados não tocam", () => {
    // C4 (effects).
    const { audio, backend, send } = started();
    audio.setPrefs({ music: true, sfx: false });
    send("goal");
    expect(effects(backend.calls)).toEqual([]);
    wait(1000);
    audio.setPrefs({ music: true, sfx: true });
    send("goal");
    expect(effects(backend.calls)).toContain("crowd-roar");
  });

  test("ambiente da torcida segue o relógio", () => {
    // C9: clock -> crowd-ambience gain.
    const { audio, backend } = started();
    const ramps = () => backend.calls.filter((c) => c.kind === "ambience-ramp");
    audio.crowd("running");
    expect(backend.calls.filter((c) => c.kind === "ambience-start")).toHaveLength(1);
    expect(ramps().at(-1)).toMatchObject({ gain: 1 });
    audio.crowd("halftime");
    expect(ramps().at(-1)).toMatchObject({ gain: 0.4 });
    audio.crowd("paused");
    expect(ramps().at(-1)).toMatchObject({ gain: 0 });
    audio.crowd("running");
    expect(ramps().at(-1)).toMatchObject({ gain: 1 });
    audio.crowd("over");
    expect(backend.calls.slice(-2)).toEqual([
      { kind: "ambience-ramp", gain: 0, seconds: 2 },
      { kind: "ambience-stop", afterSeconds: 2 },
    ]);
    expect(backend.calls.filter((c) => c.kind === "ambience-start")).toHaveLength(1);
  });

  test("variantes e afinação", () => {
    // C10.
    const { send, effectCalls } = started(createRng(1));
    for (let i = 0; i < 200; i++) {
      send("goal", "u");
      send("goal", "o");
      send("shot_saved");
      wait(1000);
    }
    for (const id of ["crowd-roar", "crowd-groan", "crowd-ooh"]) {
      const played = effectCalls().filter((c) => c.id === id);
      expect(played, id).toHaveLength(200);
      expect(new Set(played.map((c) => c.variant)).size, id).toBeGreaterThanOrEqual(2);
    }
    for (const c of effectCalls()) {
      expect(c.pitch).toBeGreaterThanOrEqual(0.94);
      expect(c.pitch).toBeLessThanOrEqual(1.06);
    }

    const low = started(constant(0));
    low.send("shot_saved");
    expect(low.effectCalls()[0]!.pitch).toBe(0.94);
    const high = started(constant(0.999999));
    high.send("shot_saved");
    expect(high.effectCalls()[0]!.pitch).toBeGreaterThan(1.0599);
    expect(high.effectCalls()[0]!.pitch).toBeLessThanOrEqual(1.06);
  });

  test("mesmo efeito em menos de 400 ms", () => {
    // C11.
    const a = started();
    a.send("shot_saved");
    wait(399);
    a.send("shot_missed");
    expect(effects(a.backend.calls)).toEqual(["crowd-ooh"]);

    const b = started();
    b.send("shot_saved");
    wait(400);
    b.send("shot_missed");
    expect(effects(b.backend.calls)).toEqual(["crowd-ooh", "crowd-ooh"]);

    const c = started();
    c.send("shot_saved");
    wait(100);
    c.send("kickoff");
    expect(effects(c.backend.calls)).toEqual(["crowd-ooh", "whistle-short"]);
  });
});

describe("aba escondida (correcoes-validacao)", () => {
  test("aba escondida não acumula efeitos", () => {
    // C56 (AC 52): hidden from minute 5 to 70; nothing is queued for the moment the tab returns.
    const { audio, backend, doc } = started();
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    const hiddenFrom = backend.calls.length;
    const whileHidden: MatchEvent[] = [
      { minute: 12, type: "goal", clubId: "u" },
      { minute: 20, type: "shot_saved", clubId: "o" },
      { minute: 31, type: "yellow", clubId: "o" },
      { minute: 45, type: "halftime", clubId: "u" },
      { minute: 52, type: "goal", clubId: "o" },
      { minute: 64, type: "red", clubId: "u" },
    ];
    for (const e of whileHidden) {
      audio.matchEvents([e], "u");
      wait(1000);
    }
    expect(effects(backend.calls.slice(hiddenFrom))).toEqual([]);

    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    wait(5000);
    expect(effects(backend.calls.slice(hiddenFrom))).toEqual([]);
    audio.matchEvents([{ minute: 71, type: "shot_missed", clubId: "o" }], "u");
    expect(effects(backend.calls.slice(hiddenFrom))).toEqual(["crowd-ooh"]);
  });

  test("disputa com a aba escondida não soa ao voltar", () => {
    // AC 52: the shoot-out's kicks are timed; the ones due while hidden do not sound.
    const { audio, backend, doc } = started();
    const before = backend.calls.length;
    audio.matchEvents([at90("penalty_scored", "u"), at90("penalty_missed", "o")], "u");
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    wait(10_000);
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    wait(10_000);
    expect(effects(backend.calls.slice(before))).toEqual([]);
  });
});

describe("pênalti no jogo (penaltis)", () => {
  test("som do pênalti no jogo", () => {
    // C6 (AC 8, L-005): the award whistles; each kick sounds as its own type.
    const table: [MatchEvent, EffectId[]][] = [
      [{ minute: 30, type: "penalty", clubId: "u" }, ["whistle-short"]],
      [{ minute: 30, type: "penalty", clubId: "o" }, ["whistle-short"]],
      [{ minute: 30, type: "goal", clubId: "u", penalty: true }, ["crowd-roar", "goal-jingle"]],
      [{ minute: 30, type: "goal", clubId: "o", penalty: true }, ["crowd-groan"]],
      [{ minute: 30, type: "shot_saved", clubId: "u", penalty: true }, ["crowd-ooh"]],
      [{ minute: 30, type: "shot_missed", clubId: "o", penalty: true }, ["crowd-ooh"]],
    ];
    for (const [event, expected] of table) expect(effectsFor(event, "u"), `${event.type} ${event.clubId}`).toEqual(expected);
  });
});
