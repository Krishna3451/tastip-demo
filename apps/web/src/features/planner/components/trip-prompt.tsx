"use client";

import {
  DESTINATIONS,
  type Destination,
  dateAt,
  isLocalDate,
  MAX_CITY_STAYS,
  MAX_TRIP_DAYS,
  parseRoutePrompt,
  type TripBrief,
  type TripRoute,
} from "@tastip/domain";
import { ArrowUpRight, Globe2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function TripPrompt({
  brief,
  onReview,
}: {
  brief: TripBrief;
  onReview: (patch: Partial<TripBrief>, route?: TripRoute) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [review, setReview] = useState<{
    origin: string;
    originChoices: Destination[];
    originIndex: number;
    choices: Destination[][];
    selected: number[];
    ids: string[];
    days: number;
    partySize: number;
  } | null>(null);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function resolveOrigin(query: string, signal: AbortSignal): Promise<Destination[]> {
    try {
      const response = await fetch("/api/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal,
      });
      const body = await response.json();
      return response.ok && Array.isArray(body.results) ? body.results : [];
    } catch {
      return [];
    }
  }
  async function resolve() {
    const parsed = parseRoutePrompt(prompt);
    if (!parsed.cityQueries.length || parsed.cityQueries.some((query) => query.length > 100)) {
      setError(
        "Try a simple route, like ‘From Delhi to Lisbon and Porto for 5 days’. Review each city before continuing.",
      );
      return;
    }
    const days = parsed.days ?? brief.days;
    if (
      days < parsed.cityQueries.length ||
      days > MAX_TRIP_DAYS ||
      days < 1 ||
      parsed.cityQueries.length > MAX_CITY_STAYS
    ) {
      setError(
        `Choose 1–${MAX_TRIP_DAYS} days, up to ${MAX_CITY_STAYS} city stays and at least one day per city.`,
      );
      return;
    }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    setReview(null);
    try {
      const choices = await Promise.all(
        parsed.cityQueries.map(async (query) => {
          const preset = DESTINATIONS.find(
            (city) => city.name.toLowerCase() === query.toLowerCase(),
          );
          if (preset) return [preset];
          const response = await fetch("/api/destinations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
            signal: controller.signal,
          });
          const body = await response.json();
          if (!response.ok)
            throw new Error(body.error?.message ?? "City search could not connect.");
          if (!body.results?.length)
            throw new Error(`We couldn’t resolve ‘${query}’. Use a city name, or choose it below.`);
          return body.results as Destination[];
        }),
      );
      const originChoices = parsed.origin
        ? await resolveOrigin(parsed.origin, controller.signal)
        : [];
      if (!controller.signal.aborted)
        setReview({
          origin: parsed.origin,
          originChoices,
          originIndex: 0,
          choices,
          selected: choices.map(() => 0),
          ids: choices.map(() => crypto.randomUUID()),
          days,
          partySize: parsed.partySize ?? brief.partySize,
        });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "City search could not connect.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="trip-prompt">
      <form
        className="trip-prompt-input"
        onSubmit={(event) => {
          event.preventDefault();
          void resolve();
        }}
      >
        <label htmlFor="trip-prompt">Where is your mind wandering?</label>
        <textarea
          id="trip-prompt"
          aria-label="Describe your trip"
          value={prompt}
          maxLength={500}
          onChange={(event) => {
            pending.current?.abort();
            setBusy(false);
            setReview(null);
            setPrompt(event.target.value);
          }}
          placeholder="From Delhi to Lisbon and Porto for 5 days…"
        />
        <button
          type="submit"
          className="button button-primary"
          disabled={busy || prompt.trim().length < 2}
        >
          <Globe2 size={16} />
          {busy ? "Finding your route…" : "Sketch my route"}
          <ArrowUpRight size={16} />
        </button>
      </form>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {review && (
        <form
          className="prompt-review"
          aria-label="Review interpreted trip"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isLocalDate(date)) {
              setError("Choose your first travel date to create this dated route.");
              return;
            }
            const cities = review.choices.map(
              (choices, index) => choices[review.selected[index] ?? 0]!,
            );
            const baseDays = Math.floor(review.days / cities.length);
            const remainder = review.days % cities.length;
            const stays = cities.map((city, index) => ({
              id: `stay-${index + 1}`,
              destinationId: city.id,
              destination: city,
              days: baseDays + (index < remainder ? 1 : 0),
            }));
            const first = cities[0]!;
            onReview(
              {
                destinationId: first.id,
                destination: first,
                days: review.days,
                origin: review.originChoices[review.originIndex]?.name ?? review.origin,
                originDestination: review.originChoices[review.originIndex],
                partySize: review.partySize,
              },
              {
                startDate: date,
                stays,
                transfers: stays.slice(1).map((stay, index) => ({
                  id: `transfer-${index + 1}`,
                  fromStayId: stays[index]!.id,
                  toStayId: stay.id,
                  mode: "undecided",
                })),
              },
            );
            setError(null);
          }}
        >
          <p className="eyebrow">CHECK THE DETAILS</p>
          <h3>A starting point, for you to confirm.</h3>
          <p>
            We read city names and duration from your text. Check the places below; we haven’t
            inferred flights, hotels or your taste.
          </p>
          <label>
            Traveling from
            <input
              aria-label="Prompt origin"
              value={review.origin}
              onChange={(event) =>
                setReview({ ...review, origin: event.target.value, originChoices: [] })
              }
            />
          </label>
          {review.originChoices.length > 0 && (
            <label>
              Confirm origin city
              <select
                aria-label="Prompt origin city"
                value={review.originIndex}
                onChange={(event) =>
                  setReview({ ...review, originIndex: Number(event.target.value) })
                }
              >
                {review.originChoices.map((city, index) => (
                  <option key={city.id} value={index}>
                    {city.name}, {city.country}
                  </option>
                ))}
              </select>
            </label>
          )}
          {review.choices.map((choices, index) => (
            <label key={review.ids[index]}>
              City {index + 1}
              <select
                aria-label={`Prompt city ${index + 1}`}
                value={review.selected[index] ?? 0}
                onChange={(event) =>
                  setReview({
                    ...review,
                    selected: review.selected.map((value, i) =>
                      i === index ? Number(event.target.value) : value,
                    ),
                  })
                }
              >
                {choices.map((city, i) => (
                  <option key={city.id} value={i}>
                    {city.name}, {city.country}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="field-pair">
            <label>
              First travel date
              <input
                type="date"
                aria-label="Prompt start date"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label>
              Days
              <input
                type="number"
                aria-label="Prompt days"
                min={review.choices.length}
                max={MAX_TRIP_DAYS}
                value={review.days}
                required
                onChange={(event) => setReview({ ...review, days: Number(event.target.value) })}
              />
            </label>
          </div>
          <p>
            {review.days} days / {Math.max(0, review.days - 1)} nights
            {isLocalDate(date) ? ` · ${date}–${dateAt(date, review.days - 1)}` : ""}. Days are
            spread across your cities; you can adjust the route in the planner.
          </p>
          <button type="submit" className="button button-secondary">
            Use this route
          </button>
        </form>
      )}
    </div>
  );
}
