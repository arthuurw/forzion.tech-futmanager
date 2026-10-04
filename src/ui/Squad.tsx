import { useState } from "react";
import { divisionAt, divisionOf, goalLabel } from "../engine/board";
import { CONTRACT_RENEWAL, isMarketOpen, releaseCost, renewalSalary } from "../engine/market";
import { nextCompetition } from "../engine/calendar";
import { formationSlots, isAvailableFor, validateLineup } from "../engine/lineup";
import { findAnyClub, userLeague } from "../engine/season";
import { FORMATION_NAMES, POSITIONS, POSTURES, TRAININGS, type FormationName, type Position, type Posture, type RatingStep, type Training } from "../engine/types";
import { useGame, userClub } from "../store";
import { BoardWarning, OfferPanel } from "./Career";
import { FitnessBar, MoraleArrow, StatusBadge } from "./Condition";
import { nextDateLabel } from "./Cup";
import { formatMoney } from "./money";
import { missingStartersText } from "./lineupText";
import { Flag } from "./Flag";
import { RatingBar } from "./RatingBar";
import { ScreenTabs, tabPanel } from "./ScreenTabs";
import { DivisionTable } from "./Table";

export const POSITION_LABEL: Record<Position, string> = { GK: "GOL", DF: "ZAG", MF: "MEI", FW: "ATA" };

/** Vertical position of each line on the pitch, attack at the top. */
const LINE_Y: Record<Position, number> = { FW: 17, MF: 44, DF: 70, GK: 89 };

/**
 * Pitch coordinates (percent) for each slot of a formation, spread evenly along its line.
 * `w` is the token width, narrowed on crowded lines so neighbours never overlap.
 */
function slotCoordinates(slots: Position[]): { x: number; y: number; w: number }[] {
  const perLine = new Map<Position, number[]>();
  slots.forEach((pos, i) => perLine.set(pos, [...(perLine.get(pos) ?? []), i]));
  const coords: { x: number; y: number; w: number }[] = [];
  for (const [pos, indexes] of perLine) {
    const n = indexes.length;
    const w = Math.min(26, 100 / (n + 1) - 1.5);
    indexes.forEach((slotIndex, k) => {
      coords[slotIndex] = { x: ((k + 1) / (n + 1)) * 100, y: LINE_Y[pos], w };
    });
  }
  return coords;
}

type SquadTab = "pitch" | "roster" | "table";

/** The wide layout (above 900 px), where the pitch is always visible and «Campo» is hidden. */
function isWide(): boolean {
  return typeof window.matchMedia === "function" && !window.matchMedia("(max-width: 900px)").matches;
}

const POSTURE_LABEL: Record<Posture, string> = { defensive: "Defensiva", balanced: "Equilibrada", attacking: "Ofensiva" };
/** Treino-evolucao AC 13, AC 14. */
const TRAINING_LABEL: Record<Training, string> = { light: "Leve", normal: "Normal", hard: "Forte" };
const TRAINING_LINE: Record<Training, string> = {
  light: "Recupera mais o físico e evolui menos.",
  normal: "Equilíbrio entre físico e evolução.",
  hard: "Evolui mais, recupera menos o físico e lesiona mais.",
};

/** Treino-evolucao AC 15, AC 16: the last rating change of the season, if any. */
function Trend({ log }: { log: RatingStep[] | undefined }) {
  const last = log?.at(-1);
  if (!last) return null;
  const label = `${last.delta > 0 ? "+1" : "−1"} na rodada ${last.round}`;
  return (
    <span className={`trend ${last.delta > 0 ? "up" : "down"}`} role="img" aria-label={label} title={label}>
      {last.delta > 0 ? "▲" : "▼"}
    </span>
  );
}

export function Squad() {
  const game = useGame((s) => s.game);
  const setFormation = useGame((s) => s.setFormation);
  const setPosture = useGame((s) => s.setPosture);
  const setTraining = useGame((s) => s.setTraining);
  const setPenaltyTaker = useGame((s) => s.setPenaltyTaker);
  const assignStarter = useGame((s) => s.assignStarter);
  const playRound = useGame((s) => s.playRound);
  const toggleForSale = useGame((s) => s.toggleForSale);
  const releasePlayer = useGame((s) => s.releasePlayer);
  const goToMarket = useGame((s) => s.goToMarket);
  const goToFinance = useGame((s) => s.goToFinance);
  const goToHistory = useGame((s) => s.goToHistory);
  const goToCup = useGame((s) => s.goToCup);
  const goHome = useGame((s) => s.goHome);
  const renewContract = useGame((s) => s.renewContract);
  const checkLoanOut = useGame((s) => s.checkLoanOut);
  const loanOut = useGame((s) => s.loanOut);
  const message = useGame((s) => s.marketMessage);
  // Correcoes-validacao AC 48: wide screens hide «Campo» (the pitch is always there), so they start on «Elenco».
  const [tab, setTab] = useState<SquadTab>(() => (isWide() ? "roster" : "pitch"));
  const [releasing, setReleasing] = useState<string | null>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  // Emprestimos AC 2: the player to lend and the club door 2 picked for him.
  const [lending, setLending] = useState<{ playerId: string; clubId: string } | null>(null);
  if (!game) return null;
  const club = userClub(game);
  if (!club) return null;
  const league = userLeague(game);
  const lineup = club.lineup;
  const training: Training = club.training ?? "normal";
  // Penaltis AC 10, AC 11: the eleven in slot order; a taker who is not one of them reads as Automático.
  const starters = (lineup?.starters ?? []).flatMap((id) => club.players.filter((p) => p.id === id));
  const taker = starters.some((p) => p.id === lineup?.penaltyTaker) ? lineup!.penaltyTaker! : "";
  // Copa-nacional AC 23, 29, ajustes-4a AC 1-3: availability is for the user's next match's competition.
  const competition = nextCompetition(game);
  const isAvailable = (p: (typeof club.players)[number]) => isAvailableFor(p, competition);
  const validation = validateLineup(club, lineup, competition);
  const slots = lineup ? formationSlots(lineup.formation) : [];
  const coords = slotCoordinates(slots);
  const starterIds = new Set(lineup?.starters.filter((id): id is string => !!id));
  const marketOpen = isMarketOpen(game);
  const toRelease = club.players.find((p) => p.id === releasing) ?? null;
  const toRenew = club.players.find((p) => p.id === renewing) ?? null;
  const toLend = lending ? club.players.find((p) => p.id === lending.playerId) : undefined;
  const askLoan = (playerId: string) => {
    const clubId = checkLoanOut(playerId);
    setLending(clubId ? { playerId, clubId } : null);
  };

  // AC 9: by position, then rating descending.
  const roster = [...club.players].sort(
    (a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || b.rating - a.rating || a.name.localeCompare(b.name),
  );

  // Narrow screens show one panel (the active tab). Wide screens always show the pitch,
  // plus the squad list or the table in the right column.
  const panelClass = (id: SquadTab) =>
    ["panel", tab === id ? "m-active" : "", id === "roster" && tab === "table" ? "d-hidden" : "", id === "table" && tab !== "table" ? "d-hidden" : ""]
      .filter(Boolean)
      .join(" ");

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="club-title">
          <Flag clubId={club.id} name={club.name} size={26} />
          {club.name}
        </h1>
        <ScreenTabs
          idBase="squad"
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "pitch", label: "Campo", mobileOnly: true },
            { id: "roster", label: "Elenco" },
            { id: "table", label: "Classificação" },
          ]}
        />
      </div>

      <div className="screen-body squad-body tabbed">
        <section {...tabPanel("squad", "pitch")} className={`${panelClass("pitch")} pitch-panel`} style={{ "--i": 0 } as React.CSSProperties}>
          <div className="panel-head">
            <h2 className="title-bar">Escalação</h2>
            <div className="formation-controls">
              <label className="formation-row">
                Formação
                <select aria-label="Formação" value={lineup?.formation ?? ""} onChange={(e) => setFormation(e.target.value as FormationName)}>
                  {FORMATION_NAMES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="formation-row">
                Postura
                <select aria-label="Postura" value={lineup?.posture ?? "balanced"} onChange={(e) => setPosture(e.target.value as Posture)}>
                  {POSTURES.map((p) => (
                    <option key={p} value={p}>
                      {POSTURE_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="formation-row">
                Treino
                <select aria-label="Treino" value={training} onChange={(e) => void setTraining(e.target.value as Training)}>
                  {TRAININGS.map((t) => (
                    <option key={t} value={t}>
                      {TRAINING_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="formation-row">
                Pênaltis
                <select aria-label="Pênaltis" value={taker} onChange={(e) => void setPenaltyTaker(e.target.value || null)}>
                  <option value="">Automático</option>
                  {starters.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="training-line">{TRAINING_LINE[training]}</p>
          </div>

          <div className="pitch-wrap">
            <div className="pitch">
              <div className="line halfway" />
              <div className="line circle" />
              <div className="line box" />
              <div className="line small-box" />
              {slots.map((position, i) => {
                const current = lineup?.starters[i] ?? "";
                const currentPlayer = club.players.find((p) => p.id === current);
                // Same position first, then everyone else available (out of position, AC 23).
                const options = club.players
                  .filter((p) => isAvailable(p) || p.id === current)
                  .sort((a, b) => Number(b.position === position) - Number(a.position === position) || POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || b.rating - a.rating);
                const oop = !!currentPlayer && currentPlayer.position !== position;
                const unavailable = !!currentPlayer && !isAvailable(currentPlayer);
                const at = coords[i] ?? { x: 50, y: 50, w: 26 };
                return (
                  <div
                    key={i}
                    className={`token pos-${position}${current ? "" : " empty"}${oop ? " oop" : ""}${unavailable ? " unavailable" : ""}`}
                    style={{ left: `${at.x}%`, top: `${at.y}%`, width: `${at.w}%` }}
                  >
                    <span className="num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <select aria-label={`Titular ${i + 1} (${POSITION_LABEL[position]})`} value={current} onChange={(e) => assignStarter(i, e.target.value)}>
                      {current === "" && <option value="">—</option>}
                      {options.map((p) => (
                        <option key={p.id} value={p.id} disabled={!isAvailable(p)}>
                          {p.position === position ? "" : `${POSITION_LABEL[p.position]} · `}
                          {p.name} ({p.rating})
                        </option>
                      ))}
                    </select>
                    {oop && <span className="sr-only">fora de posição</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section {...tabPanel("squad", "roster")} className={panelClass("roster")} style={{ "--i": 1 } as React.CSSProperties}>
          <h2 className="title-bar">Elenco</h2>
          <div className="fill">
            <table aria-label="Elenco" className="compact">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Pos</th>
                  <th className="num">Idade</th>
                  <th className="num">Força</th>
                  <th className="num">Salário</th>
                  <th className="num">Contr.</th>
                  <th className="num">Cond</th>
                  <th>Moral</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {roster.map((p) => (
                  <tr key={p.id} className={[starterIds.has(p.id) ? "starter" : "", isAvailable(p) ? "" : "out"].filter(Boolean).join(" ") || undefined}>
                    <td>{p.name}</td>
                    <td>
                      <span className={`pos pos-${p.position}`}>{POSITION_LABEL[p.position]}</span>
                    </td>
                    <td className="num">{p.age}</td>
                    <td className="num rating-cell">
                      <RatingBar rating={p.rating} />
                      {p.rating}
                      <Trend log={p.ratingLog} />
                    </td>
                    <td className="num">{formatMoney(p.salary)}</td>
                    <td className="num contract">
                      {p.contractSeasons === 1 && !p.loanFrom ? (
                        // The last year's number is the renewal button (AC 26).
                        <button className="link contract-n last" aria-label={`Renovar ${p.name}`} title="Renovar contrato" onClick={() => setRenewing(p.id)}>
                          {p.contractSeasons}
                        </button>
                      ) : (
                        <span className="contract-n">{p.contractSeasons}</span>
                      )}
                      {p.contractSeasons === 1 && !p.loanFrom && <span className="last-year">Último ano</span>}
                    </td>
                    <td className="num">
                      <FitnessBar value={p.fitness} />
                    </td>
                    <td>
                      <MoraleArrow value={p.morale} />
                    </td>
                    <td className="row-actions">
                      <StatusBadge player={p} competition={competition} />
                      {/* Emprestimos AC 17: a player on loan to the user is not the user's to sell, release or lend. */}
                      {p.loanFrom && <span className="badge emp">Emprestado</span>}
                      {marketOpen && !p.loanFrom && (
                        <>
                          <label className="for-sale" title="À venda">
                            <input
                              type="checkbox"
                              aria-label={`À venda: ${p.name}`}
                              checked={club.forSale.includes(p.id)}
                              onChange={() => void toggleForSale(p.id)}
                            />
                            <span aria-hidden="true">$</span>
                          </label>
                          <button className="mini" aria-label={`Emprestar ${p.name}`} title="Emprestar" onClick={() => askLoan(p.id)}>
                            ⇄
                          </button>
                          <button className="mini" aria-label={`Dispensar ${p.name}`} title="Dispensar" onClick={() => setReleasing(p.id)}>
                            ✕
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section {...tabPanel("squad", "table")} className={panelClass("table")} style={{ "--i": 1 } as React.CSSProperties}>
          <h2 className="title-bar">Classificação</h2>
          <div className="fill">
            <DivisionTable game={game} highlightClubId={club.id} />
          </div>
        </section>
      </div>

      {toRenew && (
        <div role="alertdialog" aria-label="Confirmar renovação" className="panel confirm inline">
          <p>
            Renovar {toRenew.name} por {CONTRACT_RENEWAL} temporadas com salário {formatMoney(renewalSalary(toRenew))} por rodada. Confirmar?
          </p>
          <button
            className="primary"
            autoFocus
            onClick={() => {
              setRenewing(null);
              void renewContract(toRenew.id);
            }}
          >
            Confirmar
          </button>
          <button onClick={() => setRenewing(null)}>Cancelar</button>
        </div>
      )}

      {toRelease && (
        <div role="alertdialog" aria-label="Confirmar dispensa" className="panel confirm inline">
          <p>
            Dispensar {toRelease.name} custa {formatMoney(releaseCost(toRelease))}. Confirmar?
          </p>
          <button
            className="primary"
            autoFocus
            onClick={() => {
              setReleasing(null);
              void releasePlayer(toRelease.id);
            }}
          >
            Confirmar
          </button>
          <button onClick={() => setReleasing(null)}>Cancelar</button>
        </div>
      )}

      {toLend && lending && (
        <div role="alertdialog" aria-label="Confirmar empréstimo" className="panel confirm inline">
          <p>
            Emprestar {toLend.name} para {findAnyClub(game, lending.clubId).name} até o fim da temporada? O salário fica com o clube que o
            recebe.
          </p>
          <button
            className="primary"
            autoFocus
            onClick={() => {
              setLending(null);
              void loanOut(toLend.id);
            }}
          >
            Confirmar
          </button>
          <button onClick={() => setLending(null)}>Cancelar</button>
        </div>
      )}

      <OfferPanel />

      <div className="action-bar">
        <span className="matchday">{nextDateLabel(game, league.rounds.length, league.currentRound)}</span>
        <span className="goal">Meta: {goalLabel(divisionAt(game.leagues, divisionOf(game, club.id)), game.boardGoal)}</span>
        <span className="cash">{formatMoney(club.finance.cash)}</span>
        <button onClick={goToMarket}>Mercado</button>
        <button onClick={goToFinance}>Finanças</button>
        <button onClick={goToHistory}>Histórico</button>
        <button onClick={goToCup}>Copa</button>
        {/* Menu-no-elenco C1: back to the title menu, where «Continuar» opens this game again. */}
        <button onClick={goHome}>Menu principal</button>
        <BoardWarning />
        {message && (
          <p role="status" className="missing">
            {message}
          </p>
        )}
        {!validation.ok && (
          <p role="status" className="missing">
            {missingStartersText(validation.missing)}
          </p>
        )}
        <button className="primary" disabled={!validation.ok} onClick={() => void playRound()}>
          Jogar rodada
        </button>
      </div>
    </div>
  );
}
