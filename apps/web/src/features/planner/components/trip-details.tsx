"use client";

import {
  COST_CURRENCIES,
  formatCost,
  isCostCurrency,
  parseCostAmount,
  type Trip,
  type TripBrief,
  type TripOperation,
  tripCostTotals,
} from "@tastip/domain";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function acceptedDetails(trip: Trip) {
  return {
    version: trip.version,
    partySize: trip.brief.partySize,
    pace: trip.brief.pace,
    budget: trip.brief.budget,
    currency: trip.brief.currency,
  };
}

export function TripDetails({
  trip,
  onCommand,
  showTravelers = true,
}: {
  trip: Trip;
  showTravelers?: boolean;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
}) {
  const [party, setParty] = useState(String(trip.brief.partySize));
  const [pace, setPace] = useState<TripBrief["pace"]>(trip.brief.pace);
  const [budget, setBudget] = useState(trip.brief.budget === null ? "" : String(trip.brief.budget));
  const [currency, setCurrency] = useState(trip.brief.currency);
  const [baseline, setBaseline] = useState(() => acceptedDetails(trip));
  const baseVersion = baseline.version;
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const partyInput = useRef<HTMLInputElement>(null);
  const count = Number(party);
  const validParty = Number.isInteger(count) && count >= 1 && count <= 20;
  const budgetUnchanged =
    currency === baseline.currency &&
    (budget.trim() === ""
      ? baseline.budget === null
      : Number.isFinite(Number(budget)) && Number(budget) === baseline.budget);
  const dirty = count !== baseline.partySize || pace !== baseline.pace || !budgetUnchanged;
  const stale = baseVersion !== trip.version;
  const totals = validParty
    ? tripCostTotals({ ...trip, brief: { ...trip.brief, partySize: count } })
    : [];
  useEffect(() => {
    if (dirty || trip.version === baseVersion) return;
    setParty(String(trip.brief.partySize));
    setPace(trip.brief.pace);
    setBudget(trip.brief.budget === null ? "" : String(trip.brief.budget));
    setCurrency(trip.brief.currency);
    setBaseline(acceptedDetails(trip));
    setSaved(false);
    setError(null);
  }, [trip, dirty, baseVersion]);
  function changed() {
    setSaved(false);
    setError(null);
  }
  function reset() {
    setParty(String(trip.brief.partySize));
    setPace(trip.brief.pace);
    setBudget(trip.brief.budget === null ? "" : String(trip.brief.budget));
    setCurrency(trip.brief.currency);
    setBaseline(acceptedDetails(trip));
    setError(null);
    setSaved(false);
    partyInput.current?.focus();
  }
  return (
    <section className="trip-details-panel" aria-label="Travelers, pace and activity budget">
      <header>
        <p className="eyebrow">MAKE IT YOUR KIND OF TRIP</p>
        <h2>A plan that moves with you.</h2>
        <p>
          Set travelers, pace and activity budget. Shared links include travelers and pace; your
          budget and cost notes stay private.
        </p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const operations: TripOperation[] = [];
          if (count !== baseline.partySize) {
            const travelers = trip.brief.details?.travelers;
            if (travelers) {
              const adults = count - travelers.children - travelers.infants;
              if (!Number.isInteger(adults) || adults < 1) {
                setError(
                  `Keep at least ${travelers.children + travelers.infants + 1} travelers to retain the children and infants already in this trip. Edit traveler categories first to change those counts.`,
                );
                return;
              }
              operations.push({ type: "set-travelers", travelers: { ...travelers, adults } });
            } else operations.push({ type: "set-party-size", partySize: count });
          }
          if (pace !== baseline.pace) operations.push({ type: "set-pace", pace });
          let acceptedBudget = baseline.budget;
          if (!budgetUnchanged) {
            if (!isCostCurrency(currency)) {
              setError("Choose a listed currency before setting a new activity budget.");
              return;
            }
            const amountMinor = budget.trim() ? parseCostAmount(budget, currency) : null;
            if (budget.trim() && amountMinor === null) {
              setError(
                `Enter a valid ${currency} planning amount${currency === "JPY" ? " in whole yen" : " with up to two decimal places"}, or leave it blank. The limit is ${formatCost(1_000_000_000, currency)}.`,
              );
              return;
            }
            operations.push({ type: "set-activity-budget", currency, amountMinor });
            acceptedBudget =
              amountMinor === null ? null : amountMinor / 10 ** COST_CURRENCIES[currency];
          }
          if (!operations.length) return;
          if (onCommand(operations, baseVersion, trip.id)) {
            setBaseline({
              version: baseVersion + 1,
              partySize: count,
              pace,
              budget: acceptedBudget,
              currency,
            });
            setBudget(acceptedBudget === null ? "" : String(acceptedBudget));
            setError(null);
            setSaved(true);
          } else
            setError(
              "These details could not be applied. Check the planner’s message, or reload the latest details below.",
            );
        }}
      >
        <div className="trip-details-fields">
          {showTravelers && (
            <label>
              Travelers
              <input
                ref={partyInput}
                aria-label="Trip travelers"
                type="number"
                min={1}
                max={20}
                step={1}
                required
                value={party}
                onChange={(event) => {
                  setParty(event.target.value);
                  changed();
                }}
              />
            </label>
          )}
          <label>
            Your pace
            <select
              aria-label="Trip pace"
              value={pace}
              onChange={(event) => {
                setPace(event.target.value as TripBrief["pace"]);
                changed();
              }}
            >
              <option value="slow">Unhurried</option>
              <option value="balanced">A little of both</option>
              <option value="full">See it all</option>
            </select>
          </label>
        </div>
        {showTravelers && trip.brief.details?.travelers && (
          <p className="trip-details-help">
            Changing the total adjusts adults. Children, infants and pets keep their existing
            counts.
          </p>
        )}
        <p className="trip-details-help">
          Pace guides future recommendations. Scheduled visits keep their current times.
        </p>
        <div className="trip-details-fields">
          <label>
            Whole-trip activity budget
            <input
              aria-label="Trip activity budget"
              type="text"
              inputMode="decimal"
              maxLength={20}
              placeholder="Not set"
              value={budget}
              onChange={(event) => {
                setBudget(event.target.value);
                changed();
              }}
              aria-describedby="trip-budget-help"
            />
          </label>
          <label>
            Budget currency
            <select
              aria-label="Trip budget currency"
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value);
                changed();
              }}
            >
              {!isCostCurrency(trip.brief.currency) && (
                <option value={trip.brief.currency}>{trip.brief.currency} · existing budget</option>
              )}
              {Object.keys(COST_CURRENCIES).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="trip-details-help" id="trip-budget-help">
          For the whole party and trip: activities and food, excluding travel and lodging. Leave
          blank if unknown; enter 0 for a zero budget.
        </p>
        <p className="trip-details-help">
          Compare activity costs in the same currency. No exchange rates are applied.
        </p>
        {totals.length > 0 && (
          <section
            className="trip-details-cost-preview"
            aria-label="Planned totals with these travelers"
          >
            <h3>
              With {validParty ? count : "your"} {count === 1 ? "traveler" : "travelers"}
            </h3>
            <p>Per-traveler costs recalculate with this party size.</p>
            <ul>
              {totals.map((group) => (
                <li key={group.currency}>
                  <span>{group.currency} · recorded subtotal</span>
                  <strong>{formatCost(group.totalMinor, group.currency)}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}
        {stale && (
          <p role="status" className="trip-details-help">
            Your plan changed. Your draft is still here; reload the latest details before applying
            changes.
          </p>
        )}
        {saved && !stale && (
          <p role="status" className="trip-details-saved">
            Trip details updated. Undo can restore the previous values.
          </p>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="trip-details-actions">
          <button type="submit" className="button button-primary" disabled={stale || !dirty}>
            <SlidersHorizontal size={16} />
            Apply trip details
          </button>
          <button type="button" className="button button-quiet" onClick={reset}>
            {stale ? "Reload latest trip details" : "Reset unsaved details"}
          </button>
        </div>
      </form>
    </section>
  );
}
