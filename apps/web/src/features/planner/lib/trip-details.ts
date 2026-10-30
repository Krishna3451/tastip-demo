import { formatCost, isCostCurrency, parseCostAmount, type TripBrief } from "@tastip/domain";

export const PACE_LABELS = {
  slow: "Unhurried",
  balanced: "A little of both",
  full: "See it all",
} as const;

/** Preserve older budget codes/precision instead of silently converting or rounding them. */
export function activityBudgetAmount(brief: TripBrief): string | null {
  if (brief.budget === null) return null;
  if (isCostCurrency(brief.currency)) {
    const minor = parseCostAmount(String(brief.budget), brief.currency);
    if (minor !== null) return formatCost(minor, brief.currency);
  }
  return `${brief.currency} ${String(brief.budget)}`;
}
