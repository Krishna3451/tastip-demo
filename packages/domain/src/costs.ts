import type { CostCurrency, Trip, TripCost } from "./types";

export const COST_CURRENCIES: Record<CostCurrency, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  JPY: 0,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  DKK: 2,
  SGD: 2,
};
export function isCostCurrency(value: unknown): value is CostCurrency {
  return typeof value === "string" && Object.hasOwn(COST_CURRENCIES, value);
}
export function validActivityBudget(currency: unknown, amountMinor: unknown): boolean {
  return (
    isCostCurrency(currency) &&
    (amountMinor === null ||
      (typeof amountMinor === "number" &&
        Number.isSafeInteger(amountMinor) &&
        amountMinor >= 0 &&
        amountMinor <= 1_000_000_000))
  );
}
export function validTripCost(value: unknown): value is TripCost {
  if (!value || typeof value !== "object") return false;
  const cost = value as TripCost;
  return (
    typeof cost.id === "string" &&
    cost.id.trim().length > 0 &&
    cost.id.length <= 150 &&
    typeof cost.label === "string" &&
    cost.label.trim().length > 0 &&
    cost.label.length <= 150 &&
    ["activity", "lodging", "transport", "other"].includes(cost.category) &&
    isCostCurrency(cost.currency) &&
    Number.isSafeInteger(cost.unitAmountMinor) &&
    cost.unitAmountMinor >= 0 &&
    cost.unitAmountMinor <= 1_000_000_000 &&
    Number.isSafeInteger(cost.quantity) &&
    cost.quantity >= 1 &&
    cost.quantity <= 365 &&
    ["party", "each-traveler"].includes(cost.appliesTo) &&
    cost.source === "traveler"
  );
}

/** Parse a decimal amount directly into integer minor units; never add floating-point prices. */
export function parseCostAmount(value: string, currency: CostCurrency): number | null {
  const digits = COST_CURRENCIES[currency];
  const text = value.trim();
  if (!isCostCurrency(currency) || !/^\d+(?:\.\d+)?$/.test(text) || text.length > 20) return null;
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(minor) && minor <= 1_000_000_000 ? minor : null;
}
export function costAmountText(minor: number, currency: CostCurrency): string {
  const digits = COST_CURRENCIES[currency];
  const scale = 10 ** digits;
  return digits === 0
    ? String(minor)
    : `${Math.floor(minor / scale)}.${String(minor % scale).padStart(digits, "0")}`;
}
export function formatCost(minor: number, currency: CostCurrency): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(minor / 10 ** COST_CURRENCIES[currency]);
}
export function costLineTotal(cost: TripCost, partySize: number): number {
  return (
    cost.unitAmountMinor * cost.quantity * (cost.appliesTo === "each-traveler" ? partySize : 1)
  );
}
export function tripCostTotals(trip: Pick<Trip, "costs" | "brief">) {
  const totals = new Map<
    CostCurrency,
    { currency: CostCurrency; totalMinor: number; activityMinor: number }
  >();
  for (const cost of trip.costs ?? []) {
    const group = totals.get(cost.currency) ?? {
      currency: cost.currency,
      totalMinor: 0,
      activityMinor: 0,
    };
    const total = costLineTotal(cost, trip.brief.partySize);
    group.totalMinor += total;
    if (cost.category === "activity") group.activityMinor += total;
    totals.set(cost.currency, group);
  }
  return [...totals.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}
