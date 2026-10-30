"use client";

import { type Trip, type TripDetails, validTravelers } from "@tastip/domain";
import { useEffect, useState } from "react";
import type { Command } from "./itinerary";

type Counts = TripDetails["travelers"];
const fields = ["adults", "children", "infants", "pets"] as const;
const names = { adults: "Adults", children: "Children", infants: "Infants", pets: "Pets" };
function accepted(trip: Trip): Counts {
  return (
    trip.brief.details?.travelers ?? {
      adults: trip.brief.partySize,
      children: 0,
      infants: 0,
      pets: 0,
    }
  );
}
function draft(counts: Counts) {
  return {
    adults: String(counts.adults),
    children: String(counts.children),
    infants: String(counts.infants),
    pets: String(counts.pets),
  };
}

export function TripTravelers({ trip, onCommand }: { trip: Trip; onCommand: Command }) {
  const [baseline, setBaseline] = useState(() => ({
    version: trip.version,
    counts: accepted(trip),
  }));
  const [counts, setCounts] = useState(() => draft(baseline.counts));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const values = Object.fromEntries(
    fields.map((field) => [field, counts[field].trim() ? Number(counts[field]) : Number.NaN]),
  ) as Counts;
  const dirty = fields.some((field) => values[field] !== baseline.counts[field]);
  const stale = baseline.version !== trip.version;
  const valid = validTravelers(values);
  useEffect(() => {
    if (dirty || !stale) return;
    const next = accepted(trip);
    setBaseline({ version: trip.version, counts: next });
    setCounts(draft(next));
    setSaved(false);
  }, [trip, dirty, stale]);
  function reload() {
    const next = accepted(trip);
    setBaseline({ version: trip.version, counts: next });
    setCounts(draft(next));
    setError("");
    setSaved(false);
  }
  return (
    <form
      className="mt-travelers-editor"
      aria-label="Trip traveler categories"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !dirty || stale) return;
        if (!onCommand([{ type: "set-travelers", travelers: values }], baseline.version, trip.id)) {
          setError("These travelers could not be updated. Reload the latest values and try again.");
          return;
        }
        setBaseline({ version: baseline.version + 1, counts: values });
        setSaved(true);
        setError("");
      }}
    >
      <h2>Who’s coming?</h2>
      <p>Keep the traveler categories with your trip. Pets are counted separately.</p>
      <div className="mt-traveler-fields">
        {fields.map((field) => (
          <label key={field}>
            {names[field]}
            <input
              type="number"
              aria-label={`Trip ${field}`}
              min={field === "adults" ? 1 : 0}
              max={20}
              step={1}
              required
              value={counts[field]}
              onChange={(event) => {
                setCounts((current) => ({ ...current, [field]: event.target.value }));
                setSaved(false);
                setError("");
              }}
            />
          </label>
        ))}
      </div>
      {!valid && (
        <p role="status">
          Choose at least one adult and no more than 20 travelers in total, plus up to 20 pets.
        </p>
      )}
      {stale && (
        <p role="status">
          Your plan changed. Your traveler draft is still here; reload the latest values before
          saving.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && !stale && (
        <p role="status">Travelers updated. Your visits and files stay in place.</p>
      )}
      <div className="mt-traveler-actions">
        <button type="submit" className="mt-primary" disabled={!valid || !dirty || stale}>
          Update travelers
        </button>
        <button type="button" className="mt-pill outlined" onClick={reload}>
          {stale ? "Reload latest travelers" : "Reset traveler draft"}
        </button>
      </div>
    </form>
  );
}
