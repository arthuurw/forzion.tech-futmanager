import type { Rng } from "../engine/rng";
import type { MatchEvent } from "../engine/types";
import type { AudioBackend, EffectId } from "./backend";

/** AC 10: the crowd reactions have variants; the backend shapes each one. */
export const EFFECT_VARIANTS: Record<EffectId, number> = {
  "whistle-short": 1,
  "whistle-double": 1,
  "whistle-long": 1,
  "crowd-roar": 2,
  "goal-jingle": 1,
  "crowd-groan": 2,
  "crowd-ooh": 3,
  "crowd-boo": 1,
};

/** AC 10: every effect is tuned by a factor in [0.94, 1.06]. */
export const PITCH_MIN = 0.94;
export const PITCH_SPAN = 0.12;
/** AC 11. */
export const REPEAT_GAP_MS = 400;

/** The match clock as the crowd hears it; `over` is the final whistle. */
export type Crowd = "running" | "halftime" | "paused" | "over";

/** AC 9. */
export const CROWD_GAIN: Record<Exclude<Crowd, "over">, number> = { running: 1, halftime: 0.4, paused: 0 };
const CROWD_RAMP_S = 0.3;
const CROWD_END_S = 2;

/** AC 7: what the user hears for each event of their match. */
export function effectsFor(e: MatchEvent, userClubId: string): EffectId[] {
  switch (e.type) {
    case "kickoff":
    case "yellow":
    case "penalty":
      return ["whistle-short"];
    case "halftime":
      return ["whistle-double"];
    case "fulltime":
      return ["whistle-long"];
    case "goal":
      return e.clubId === userClubId ? ["crowd-roar", "goal-jingle"] : ["crowd-groan"];
    // Ajustes-audio AC 9: a shoot-out kick has no jingle; the shoot-out's win has one (AC 8).
    case "penalty_scored":
      return e.clubId === userClubId ? ["crowd-roar"] : ["crowd-groan"];
    case "shot_saved":
    case "shot_missed":
    case "penalty_missed":
      return ["crowd-ooh"];
    case "red":
      return ["whistle-short", "crowd-boo"];
    case "injury":
    case "substitution":
      return [];
  }
}

export interface Sfx {
  play(id: EffectId): void;
  crowd(state: Crowd): void;
  setEnabled(on: boolean): void;
}

export function createSfx(backend: AudioBackend, rng: Rng, now: () => number): Sfx {
  let enabled = true;
  const lastAt = new Map<EffectId, number>();
  /** The clock the ambience follows, while a match is on. */
  let crowd: Exclude<Crowd, "over"> | null = null;

  const ambienceGain = () => (enabled && crowd ? CROWD_GAIN[crowd] : 0);

  return {
    play(id) {
      if (!enabled) return;
      const t = now();
      const before = lastAt.get(id);
      if (before !== undefined && t - before < REPEAT_GAP_MS) return;
      lastAt.set(id, t);
      const variant = Math.floor(rng.next() * EFFECT_VARIANTS[id]);
      backend.playEffect(id, variant, PITCH_MIN + rng.next() * PITCH_SPAN);
    },
    crowd(state) {
      if (state === "over") {
        if (crowd === null) return;
        crowd = null;
        backend.rampAmbience(0, CROWD_END_S);
        backend.stopAmbience(CROWD_END_S);
        return;
      }
      if (state === crowd) return;
      if (crowd === null) backend.startAmbience();
      crowd = state;
      backend.rampAmbience(ambienceGain(), CROWD_RAMP_S);
    },
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (crowd) backend.rampAmbience(ambienceGain(), CROWD_RAMP_S);
    },
  };
}
