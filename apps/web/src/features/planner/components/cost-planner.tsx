"use client";

import {
  COST_CURRENCIES,
  costAmountText,
  costLineTotal,
  formatCost,
  isCostCurrency,
  parseCostAmount,
  type Trip,
  type TripCost,
  type TripOperation,
  tripCostTotals,
} from "@tastip/domain";
import { Pencil, Plus, ReceiptText, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const CATEGORY_LABELS = {
  activity: "Activities & food",
  lodging: "Lodging",
  transport: "Transport",
  other: "Other",
};

function costFields(trip: Trip, cost?: TripCost) {
  return {
    editing: cost?.id ?? null,
    label: cost?.label ?? "",
    category: cost?.category ?? "activity",
    currency: cost?.currency ?? (isCostCurrency(trip.brief.currency) ? trip.brief.currency : "EUR"),
    amount: cost ? costAmountText(cost.unitAmountMinor, cost.currency) : "",
    quantity: String(cost?.quantity ?? 1),
    appliesTo: cost?.appliesTo ?? "party",
  };
}

type CostFields = ReturnType<typeof costFields>;

function sameFields(left: CostFields, right: CostFields) {
  return Object.keys(left).every(
    (key) => left[key as keyof CostFields] === right[key as keyof CostFields],
  );
}

export function CostPlanner({
  trip,
  onCommand,
}: {
  trip: Trip;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
}) {
  const [draft, setDraft] = useState(() => costFields(trip));
  const [baseline, setBaseline] = useState(() => ({
    version: trip.version,
    fields: costFields(trip),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const { editing, label, category, currency, amount, quantity, appliesTo } = draft;
  const dirty = !sameFields(draft, baseline.fields);
  const stale = baseline.version !== trip.version;
  const currentCost = trip.costs?.find((cost) => cost.id === editing);
  const targetUnchanged =
    !editing || (currentCost && sameFields(costFields(trip, currentCost), baseline.fields));

  useEffect(() => {
    if (dirty || baseline.version === trip.version) return;
    const fields = costFields(
      trip,
      trip.costs?.find((cost) => cost.id === baseline.fields.editing),
    );
    setDraft(fields);
    setBaseline({ version: trip.version, fields });
    setError(null);
    setSaved(null);
  }, [trip, dirty, baseline]);

  function change(fields: Partial<CostFields>) {
    setDraft((current) => ({ ...current, ...fields }));
    setError(null);
    setSaved(null);
  }

  function load(cost?: TripCost) {
    const fields = costFields(trip, cost);
    setDraft(fields);
    setBaseline({ version: trip.version, fields });
    setError(null);
    setSaved(null);
    nameInput.current?.focus();
  }

  function keepDraft(asNew: boolean) {
    const fields = costFields(trip, asNew ? undefined : currentCost);
    setBaseline({ version: trip.version, fields });
    setDraft((current) => ({ ...current, editing: asNew ? null : current.editing }));
    setError(null);
    nameInput.current?.focus();
  }
  const totals = tripCostTotals(trip);
  const budgetCurrency = isCostCurrency(trip.brief.currency) ? trip.brief.currency : null;
  const budgetMinor =
    budgetCurrency && trip.brief.budget !== null
      ? parseCostAmount(String(trip.brief.budget), budgetCurrency)
      : null;
  const activityMinor =
    totals.find((group) => group.currency === budgetCurrency)?.activityMinor ?? 0;

  return (
    <section className="cost-planner" aria-labelledby="costs-title">
      <header className="cost-heading">
        <span className="cost-symbol">
          <ReceiptText size={24} />
        </span>
        <div>
          <p className="eyebrow">ROOM FOR THE LITTLE EXTRAS</p>
          <h2 id="costs-title">Plan what you’ll spend.</h2>
        </div>
      </header>
      <p className="cost-introduction">
        Add amounts from your own research. These are planning notes, not verified prices,
        reservations or payments. Costs stay private on shared trip links.
      </p>
      {totals.length > 0 && (
        <section className="cost-totals" aria-label="Recorded cost subtotals">
          {totals.map((group) => (
            <article key={group.currency}>
              <small>{group.currency} · recorded subtotal</small>
              <strong>{formatCost(group.totalMinor, group.currency)}</strong>
              <span>
                For {trip.brief.partySize} {trip.brief.partySize === 1 ? "traveler" : "travelers"}
              </span>
            </article>
          ))}
        </section>
      )}
      <p className="cost-scope">
        Each currency has its own subtotal. No exchange rates are applied; missing costs are not
        included.
      </p>
      {budgetCurrency && budgetMinor !== null && (
        <section className="cost-budget" aria-label="Activity budget comparison">
          <strong>Activity budget · {formatCost(budgetMinor, budgetCurrency)}</strong>
          <span>
            {formatCost(activityMinor, budgetCurrency)} recorded for activities & food in{" "}
            {budgetCurrency}.{" "}
            {activityMinor > budgetMinor
              ? `${formatCost(activityMinor - budgetMinor, budgetCurrency)} above your activity budget.`
              : `${formatCost(budgetMinor - activityMinor, budgetCurrency)} not yet allocated.`}{" "}
            Lodging, transport and other currencies are excluded.
          </span>
        </section>
      )}
      <div className="cost-workspace">
        <form
          className="cost-form"
          aria-label={editing ? "Edit planned cost" : "Add planned cost"}
          onSubmit={(event) => {
            event.preventDefault();
            if (stale || !dirty) return;
            const unitAmountMinor = parseCostAmount(amount, currency);
            const count = Number(quantity);
            if (
              !label.trim() ||
              unitAmountMinor === null ||
              !Number.isSafeInteger(count) ||
              count < 1 ||
              count > 365
            ) {
              setError(
                `Enter a name, a valid ${currency} amount${currency === "JPY" ? " in whole yen" : " with up to two decimal places"}, and a quantity from 1 to 365.`,
              );
              return;
            }
            if (
              onCommand(
                [
                  {
                    type: "set-cost",
                    cost: {
                      id: editing ?? crypto.randomUUID(),
                      label: label.trim(),
                      category,
                      currency,
                      unitAmountMinor,
                      quantity: count,
                      appliesTo,
                      source: "traveler",
                    },
                  },
                ],
                baseline.version,
                trip.id,
              )
            ) {
              const fields = costFields(trip);
              setDraft(fields);
              setBaseline({ version: baseline.version + 1, fields });
              setError(null);
              setSaved(editing ? "Cost updated." : "Cost added.");
              nameInput.current?.focus();
            } else {
              setError(
                "This cost could not be saved. Your entry is still here; check the planner’s message and try again.",
              );
            }
          }}
        >
          <h3>{editing ? "Edit this amount" : "Add a planned cost"}</h3>
          <label>
            Cost name
            <input
              ref={nameInput}
              required
              maxLength={150}
              value={label}
              onChange={(event) => change({ label: event.target.value })}
              placeholder="e.g. Museum tickets"
            />
          </label>
          <label>
            Category
            <select
              value={category}
              onChange={(event) => change({ category: event.target.value as TripCost["category"] })}
            >
              {Object.entries(CATEGORY_LABELS).map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <div className="cost-form-pair">
            <label>
              Unit amount
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(event) => change({ amount: event.target.value })}
                placeholder={currency === "JPY" ? "0" : "0.00"}
                maxLength={20}
              />
            </label>
            <label>
              Currency
              <select
                value={currency}
                onChange={(event) => {
                  if (isCostCurrency(event.target.value)) change({ currency: event.target.value });
                }}
              >
                {Object.keys(COST_CURRENCIES).map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="cost-form-pair">
            <label>
              Quantity
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                required
                value={quantity}
                onChange={(event) => change({ quantity: event.target.value })}
              />
            </label>
            <label>
              Applies to
              <select
                aria-label="Applies to"
                value={appliesTo}
                onChange={(event) =>
                  change({ appliesTo: event.target.value as TripCost["appliesTo"] })
                }
              >
                <option value="party">Whole party</option>
                <option value="each-traveler">Each traveler ({trip.brief.partySize})</option>
              </select>
            </label>
          </div>
          {stale && dirty && (
            <div className="cost-draft-notice" role="status">
              <p>
                The plan changed. Your cost draft is still here.{" "}
                {targetUnchanged
                  ? "Review it with the latest plan before saving."
                  : currentCost
                    ? "The recorded cost also changed. Reload it, or keep your draft as a separate cost."
                    : "The recorded cost was removed. You can keep your draft as a new cost."}
              </p>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => keepDraft(!targetUnchanged)}
              >
                {targetUnchanged ? "Keep draft with latest plan" : "Continue as new cost"}
              </button>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => load(currentCost)}
              >
                {currentCost ? "Reload latest cost" : "Discard draft"}
              </button>
            </div>
          )}
          {saved && (
            <p role="status" className="cost-save-feedback">
              {saved}
            </p>
          )}
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="cost-form-actions">
            <button type="submit" className="button button-primary" disabled={stale || !dirty}>
              <Plus size={15} />
              {editing ? "Save cost" : "Add cost"}
            </button>
            {(editing || dirty) && (
              <button type="button" className="button button-quiet" onClick={() => load()}>
                {editing ? "Cancel edit" : "Reset entry"}
              </button>
            )}
          </div>
        </form>
        <div className="cost-records">
          <h3>
            Your recorded amounts <span>{trip.costs?.length ?? 0}</span>
          </h3>
          {!trip.costs?.length && (
            <p className="cost-empty">
              Start with a ticket, a night’s stay or a train fare. Add only the amounts you know.
            </p>
          )}
          <ul>
            {trip.costs?.map((cost) => (
              <li key={cost.id} aria-label={cost.label}>
                <div className="cost-record-heading">
                  <h4>{cost.label}</h4>
                  <strong>
                    {formatCost(costLineTotal(cost, trip.brief.partySize), cost.currency)}
                  </strong>
                </div>
                <p>
                  {CATEGORY_LABELS[cost.category]} ·{" "}
                  {formatCost(cost.unitAmountMinor, cost.currency)} × {cost.quantity}
                  {cost.appliesTo === "each-traveler"
                    ? ` × ${trip.brief.partySize} ${trip.brief.partySize === 1 ? "traveler" : "travelers"}`
                    : " · whole party"}
                </p>
                <div className="cost-record-actions">
                  <small>Entered by you</small>
                  <button
                    type="button"
                    onClick={() => load(cost)}
                    aria-label={`Edit cost: ${cost.label}`}
                  >
                    <Pencil size={14} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !onCommand(
                          [{ type: "remove-cost", costId: cost.id }],
                          trip.version,
                          trip.id,
                        )
                      )
                        setError(
                          "This cost could not be removed. Check the planner’s message and try again.",
                        );
                    }}
                    aria-label={`Remove cost: ${cost.label}`}
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
