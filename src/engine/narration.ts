import type { Club, GameState, MatchEvent, Player } from "./types";

export interface NarrationContext {
  clubs: Map<string, Club>;
  players: Map<string, Player>;
}

export function narrationContext(clubs: readonly Club[]): NarrationContext {
  const c = new Map<string, Club>();
  const p = new Map<string, Player>();
  for (const club of clubs) {
    c.set(club.id, club);
    for (const player of club.players) p.set(player.id, player);
  }
  return { clubs: c, players: p };
}

/**
 * Correcoes-validacao AC 46: every club of every division and the free agents, so a player who
 * changed club or division when the round closed is still named, never shown by id.
 */
export function gameNarrationContext(game: Pick<GameState, "leagues" | "market">): NarrationContext {
  const ctx = narrationContext(game.leagues.flatMap((l) => l.clubs));
  for (const p of game.market.freeAgents) if (!ctx.players.has(p.id)) ctx.players.set(p.id, p);
  return ctx;
}

/** One PT-BR line per event type (C46 of partida-ao-vivo). */
export function narrate(event: MatchEvent, ctx: NarrationContext): string {
  const club = ctx.clubs.get(event.clubId)?.name ?? event.clubId;
  const nameOf = (id: string | undefined) => (id ? (ctx.players.get(id)?.name ?? id) : "");
  const player = nameOf(event.playerId);
  switch (event.type) {
    case "kickoff":
      return "Começa o jogo!";
    case "halftime":
      return "Fim do primeiro tempo.";
    case "fulltime":
      return "Fim de jogo!";
    case "goal":
      return event.penalty ? `GOL do ${club}! ${player} cobra o pênalti e marca.` : `GOL do ${club}! ${player} marca.`;
    case "shot_saved":
      return event.penalty ? `${player} (${club}) cobra o pênalti e o goleiro defende!` : `${player} (${club}) finaliza, mas o goleiro defende.`;
    case "shot_missed":
      return event.penalty ? `${player} (${club}) cobra o pênalti pra fora!` : `${player} (${club}) chuta pra fora.`;
    case "penalty":
      return `Pênalti para o ${club}!`;
    case "yellow":
      return `Cartão amarelo para ${player} (${club}).`;
    case "red":
      return `Cartão vermelho! ${player} (${club}) está expulso.`;
    case "injury":
      return `${player} (${club}) se machuca e deixa o campo.`;
    case "substitution":
      return `Substituição no ${club}: sai ${player || "—"}, entra ${nameOf(event.playerInId)}.`;
    case "penalty_scored":
      return `Pênalti convertido por ${player}.`;
    case "penalty_missed":
      return `${player} perde o pênalti.`;
  }
}
