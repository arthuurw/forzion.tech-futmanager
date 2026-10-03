import { computeTable } from "./table";
import type { Club, Finance, League, Ledger, Match, Player } from "./types";

export const DEFAULT_TICKET_PRICE = 40;
export const TICKET_PRICE_MIN = 10;
export const TICKET_PRICE_MAX = 200;
export const TICKET_PRICE_STEP = 5;
export const EXPANSION_COST = 4_000_000;
export const EXPANSION_SEATS = 5_000;
export const EXPANSION_ROUNDS = 6;
export const MAX_CAPACITY = 80_000;
export const LOAN_STEP = 500_000;
/** A club may owe up to this many times its starting cash. */
export const LOAN_LIMIT_CASH = 2;
const INTEREST_RATE = 0.015;
/** Sponsorship tops the expected home gate up to this share of the payroll (AC 13). */
const SPONSORSHIP_TARGET = 1.0;
/** Every club has some sponsor, however full its stadium. */
const SPONSORSHIP_FLOOR = 0.03;
const INITIAL_CASH_ROUNDS = 10;
const MAX_DEMAND = 1.3;
const DEMAND_ELASTICITY = 1.5;
const FANS_MIN = 15_000;
const FANS_MAX = 60_000;
const CAPACITY_SHARE = 0.8;
/** AC 7 (multiplas-temporadas): a Série B club gets this share of its sponsorship. */
export const SERIE_B_SPONSORSHIP_SHARE = 0.6;
/** Gastos-da-ia AC 1: an AI club keeps this many rounds of its payroll, new salary included, after any spend. */
export const AI_RESERVE_ROUNDS = 10;
/** Gastos-da-ia AC 12: an AI club expands only when this many rounds of payroll are left after the works. */
const AI_EXPANSION_RESERVE_ROUNDS = 20;
/** AC 29: prize per place above the 21st, by tier. */
const PRIZE_PER_PLACE = [250_000, 62_500] as const;

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** AC 2: reais per round. */
export function salaryFor(rating: number): number {
  return roundTo(2000 * 1.09 ** (rating - 40), 100);
}

export function payroll(players: readonly Player[]): number {
  return players.reduce((sum, p) => sum + p.salary, 0);
}

/**
 * Gastos-da-ia AC 1: what an AI club may spend on something that adds `newSalary` to its payroll -
 * its cash minus `AI_RESERVE_ROUNDS` rounds of the payroll it would have afterwards.
 */
export function aiBudget(club: Pick<Club, "players" | "finance">, newSalary: number): number {
  return club.finance.cash - AI_RESERVE_ROUNDS * (payroll(club.players) + newSalary);
}

/** AC 4: fans grow with the squad's mean rating, 15.000 at 58 up to 60.000 at 80. */
export function fansFor(meanRating: number): number {
  const raw = FANS_MIN + ((FANS_MAX - FANS_MIN) * (meanRating - 58)) / 22;
  return roundTo(Math.min(FANS_MAX, Math.max(FANS_MIN, raw)), 1000);
}

export function capacityFor(fans: number): number {
  return roundTo(fans * CAPACITY_SHARE, 1000);
}

/**
 * Fixed per round. Tops up what a half-season of home games at R$ 40 and a full stadium brings
 * to 100% of the payroll, so every club roughly breaks even (AC 13).
 */
export function sponsorshipFor(wages: number, capacity: number): number {
  const expectedGate = (capacity * DEFAULT_TICKET_PRICE) / 2;
  return Math.max(roundTo(wages * SPONSORSHIP_FLOOR, 10_000), roundTo(wages * SPONSORSHIP_TARGET - expectedGate, 10_000));
}

/** A new club's money, from its squad (AC 3, AC 4). Also used by the save migration. */
export function initialFinance(players: readonly Player[]): Finance {
  const wages = payroll(players);
  const mean = players.reduce((sum, p) => sum + p.rating, 0) / Math.max(1, players.length);
  const fans = fansFor(mean);
  const cash = roundTo(wages * INITIAL_CASH_ROUNDS, 100_000);
  return {
    cash,
    sponsorship: sponsorshipFor(wages, capacityFor(fans)),
    fans,
    capacity: capacityFor(fans),
    ticketPrice: DEFAULT_TICKET_PRICE,
    expansionRoundsLeft: 0,
    loan: 0,
    loanLimit: LOAN_LIMIT_CASH * cash,
    pendingIn: 0,
    pendingOut: 0,
    lastRound: null,
  };
}

/** AC 7: 1,2 for the leader down to 0,8 for the 20th; 1,0 before the first round (`position` null). */
export function formFactor(position: number | null, clubs: number): number {
  if (position === null) return 1;
  return 1.2 - (0.4 * (position - 1)) / (clubs - 1);
}

/** AC 7: never above capacity; cheaper tickets bring more people, up to 30% more than at R$ 40. */
export function attendanceFor(finance: Pick<Finance, "fans" | "capacity">, price: number, form: number): number {
  const demand = Math.min(MAX_DEMAND, (DEFAULT_TICKET_PRICE / price) ** DEMAND_ELASTICITY);
  // The epsilon keeps 30.000 × 0,8 at 24.000 instead of 23.999 from float error.
  return Math.min(finance.capacity, Math.floor(finance.fans * demand * form + 1e-6));
}

/** Table position of every club before the round at `league.currentRound`; null before the first round. */
export function positionsBeforeRound(league: League): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (league.currentRound === 0) {
    for (const c of league.clubs) out.set(c.id, null);
    return out;
  }
  computeTable(league).forEach((row, i) => out.set(row.clubId, i + 1));
  return out;
}

/** AC 7, paises AC 9: what a club is paid per round in a league of tier `tier` (0 = a country's first division). */
export function sponsorshipPaid(f: Pick<Finance, "sponsorship">, tier: number): number {
  return tier === 0 ? f.sponsorship : Math.round(f.sponsorship * SERIE_B_SPONSORSHIP_SHARE);
}

/** AC 29, paises AC 9: (21 − position) × R$ 250.000 in a first division, × R$ 62.500 in the Série B. */
export function prizeFor(tier: number, position: number): number {
  return (21 - position) * (PRIZE_PER_PLACE[tier] ?? PRIZE_PER_PLACE[1]);
}

export function interestFor(loan: number): number {
  return roundTo(loan * INTEREST_RATE, 100);
}

/**
 * AC 5, 6, 43, 48: closes one round for every club - wages, sponsorship, home gate, interest and
 * stadium works - and writes the round's ledger. Transfers were paid when they happened; the
 * ledger only reports them. Then every club but `userClubId` that filled its stadium at home
 * expands it when 20 rounds of payroll are left after the cost (gastos-da-ia AC 12, 13). Mutates
 * `clubs`.
 */
export function closeRoundFinances(
  clubs: Club[],
  matches: readonly Match[],
  positions: Map<string, number | null>,
  tier = 0,
  prizes: Map<string, number> | null = null,
  userClubId: string | null = null,
): void {
  const homeOf = new Set(matches.map((m) => m.homeId));
  for (const club of clubs) {
    const f = club.finance;
    const home = homeOf.has(club.id);
    const attendance = home ? attendanceFor(f, f.ticketPrice, formFactor(positions.get(club.id) ?? null, clubs.length)) : 0;
    const ledger: Ledger = {
      attendance,
      tickets: attendance * f.ticketPrice,
      sponsorship: sponsorshipPaid(f, tier),
      salaries: payroll(club.players),
      interest: interestFor(f.loan),
      transfersIn: f.pendingIn,
      transfersOut: f.pendingOut,
    };
    const prize = prizes?.get(club.id);
    if (prize !== undefined) ledger.prize = prize;
    f.cash += ledger.tickets + ledger.sponsorship - ledger.salaries - ledger.interest + (prize ?? 0);
    f.pendingIn = 0;
    f.pendingOut = 0;
    f.lastRound = ledger;
    if (f.expansionRoundsLeft > 0) {
      f.expansionRoundsLeft--;
      if (f.expansionRoundsLeft === 0) f.capacity += EXPANSION_SEATS;
    }
    const spare = f.cash - EXPANSION_COST - AI_EXPANSION_RESERVE_ROUNDS * payroll(club.players);
    if (club.id !== userClubId && home && attendance === f.capacity && spare >= 0) {
      const works = expandStadium(f);
      if (works.ok) club.finance = works.finance;
    }
  }
}

/** AC 9: the round's result as the Finanças screen shows it; a cup date adds its prize (copa-nacional AC 34). */
export function ledgerBalance(l: Ledger): number {
  return l.tickets + l.sponsorship + l.transfersIn - l.salaries - l.interest - l.transfersOut + (l.prize ?? 0) + (l.cupPrize ?? 0);
}

export type FinanceRefusal = "cash" | "invalid" | "works" | "max_capacity" | "loan_limit" | "over_debt";
export type FinanceResult = { ok: true; finance: Finance } | { ok: false; reason: FinanceRefusal; amount?: number };

/** AC 41. */
export function isValidTicketPrice(price: number): boolean {
  return Number.isInteger(price) && price >= TICKET_PRICE_MIN && price <= TICKET_PRICE_MAX && price % TICKET_PRICE_STEP === 0;
}

export function setTicketPrice(f: Finance, price: number): FinanceResult {
  if (!isValidTicketPrice(price)) return { ok: false, reason: "invalid" };
  return { ok: true, finance: { ...f, ticketPrice: price } };
}

/** AC 43, 44, 45, 23. */
export function expandStadium(f: Finance): FinanceResult {
  if (f.expansionRoundsLeft > 0) return { ok: false, reason: "works" };
  if (f.capacity + EXPANSION_SEATS > MAX_CAPACITY) return { ok: false, reason: "max_capacity" };
  if (EXPANSION_COST > f.cash) return { ok: false, reason: "cash" };
  return { ok: true, finance: { ...f, cash: f.cash - EXPANSION_COST, expansionRoundsLeft: EXPANSION_ROUNDS } };
}

/** AC 46, 47: multiples of R$ 500.000; `amount` on refusal is what can still be borrowed. */
export function takeLoan(f: Finance, amount: number): FinanceResult {
  if (!Number.isInteger(amount) || amount <= 0 || amount % LOAN_STEP !== 0) return { ok: false, reason: "invalid" };
  if (f.loan + amount > f.loanLimit) return { ok: false, reason: "loan_limit", amount: f.loanLimit - f.loan };
  return { ok: true, finance: { ...f, cash: f.cash + amount, loan: f.loan + amount } };
}

/** AC 49, 23: a multiple of R$ 500.000 or the whole debt, never more than the debt or the cash. */
export function repayLoan(f: Finance, amount: number): FinanceResult {
  if (!Number.isInteger(amount) || amount <= 0 || (amount % LOAN_STEP !== 0 && amount !== f.loan)) return { ok: false, reason: "invalid" };
  if (amount > f.loan) return { ok: false, reason: "over_debt" };
  if (amount > f.cash) return { ok: false, reason: "cash" };
  return { ok: true, finance: { ...f, cash: f.cash - amount, loan: f.loan - amount } };
}
