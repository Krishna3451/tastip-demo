"use client";

import {
  DESTINATIONS,
  destinationForDay,
  getTripDestination,
  type Place,
  type TasteProfile,
  type TasteSeed,
  type Trip,
  type TripBrief,
  type TripRoute,
} from "@tastip/domain";
import { Check, MapPin, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProviderFetch } from "@/lib/provider-fetch";
import { parseSavedPlaces } from "../planner/lib/saved-places";
import { buildTripPreview, type TripCandidateGroup } from "../planner/lib/trip-generation";
import { DiscoveryFavorites } from "./discovery-favorites";
import guidance from "./planning-guidance.module.css";
import { Modal } from "./primitives";

export function TripGenerationReview({
  brief,
  route,
  configured,
  currentTrip,
  previous,
  onAccept,
  onBack,
  onClose,
}: {
  brief: TripBrief;
  route: TripRoute;
  configured: boolean;
  currentTrip: Trip | null;
  previous: { tripId: string | null; version: number | null };
  onAccept: (trip: Trip) => boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  const providerFetch = useProviderFetch();
  const [seeds, setSeeds] = useState<TasteSeed[]>(brief.tasteProfile?.seeds ?? []);
  const [pace, setPace] = useState(brief.pace);
  const [categories, setCategories] = useState<Place["category"][]>(
    brief.tasteProfile?.categories ?? [],
  );
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<TripCandidateGroup[]>([]);
  const [preview, setPreview] = useState<Trip | null>(null);
  const [accepted, setAccepted] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const stale =
    (currentTrip?.id ?? null) !== previous.tripId ||
    (currentTrip?.version ?? null) !== previous.version;
  useEffect(() => {
    if (stale) {
      request.current?.abort();
      request.current = null;
      setBusy(false);
    }
  }, [stale]);
  const profile: TasteProfile = {
    ...(brief.tasteProfile ?? { dayStyle: "Personal trip", categories: [] }),
    seeds,
    categories,
  };
  const nextBrief = { ...brief, pace, tasteProfile: profile };
  const cityIds = [...new Set(route.stays.map((stay) => stay.destinationId))];
  const nextCityId = cityIds.find((id) => !groups.some((group) => group.destinationId === id));
  const currentStep = stale || preview ? "decision" : seeds.length ? "places" : "favorites";
  const steps = [
    { id: "details", title: "Trip details", detail: `${brief.days} days reviewed` },
    {
      id: "favorites",
      title: "Your favorites",
      detail: seeds.length ? `${seeds.length} confirmed` : "Choose cultural favorites",
    },
    {
      id: "places",
      title: "Qloo places",
      detail: !configured
        ? "Unavailable right now"
        : groups.length
          ? `${groups.length} of ${cityIds.length} city responses received`
          : busy
            ? "Requesting the first city"
            : "Not loaded yet",
    },
    {
      id: "decision",
      title: "Your decision",
      detail: stale
        ? "Current draft changed"
        : preview
          ? "Preview ready · not saved"
          : "Review before creating",
    },
  ];
  function cityName(id: string) {
    return (
      route.stays.find((stay) => stay.destinationId === id)?.destination?.name ??
      DESTINATIONS.find((destination) => destination.id === id)?.name ??
      id
    );
  }
  function clearPreview() {
    request.current?.abort();
    setBusy(false);
    setProgress("");
    setGroups([]);
    setPreview(null);
    setError("");
  }
  async function generate() {
    if (!seeds.length) {
      setFavoritesOpen(true);
      return;
    }
    if (!configured || stale || busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setPreview(null);
    setError("");
    const completed = [...groups];
    try {
      const empty = buildTripPreview(nextBrief, route, []);
      for (const [index, cityId] of cityIds.entries()) {
        if (completed.some((group) => group.destinationId === cityId)) continue;
        const city = getTripDestination(empty, cityId);
        if (!city) throw new Error("A trip city could not be resolved. Review the trip details.");
        setProgress(`Finding your kind of ${city.name} · ${index + 1} of ${cityIds.length}`);
        const response = await providerFetch("/api/taste", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityIds: seeds.map((seed) => seed.id),
            destinationId: cityId,
            destination: city,
            categories,
            take: 20,
          }),
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message ?? `Places in ${city.name} could not load. Try again.`,
          );
        const records = parseSavedPlaces(
          JSON.stringify(
            Array.isArray(body.selected)
              ? body.selected.map((place: unknown) => ({ place, destination: city }))
              : null,
          ),
        );
        if (
          !records ||
          records.length > 20 ||
          records.some(({ place }) => place.source !== "qloo" || !place.taste)
        )
          throw new Error(`The recommendations for ${city.name} could not be checked. Try again.`);
        if (controller.signal.aborted || request.current !== controller) return;
        completed.push({ destinationId: cityId, places: records.map(({ place }) => place) });
        setGroups([...completed]);
      }
      const prepared = buildTripPreview(nextBrief, route, completed);
      if (!controller.signal.aborted && request.current === controller) {
        setPreview(prepared);
        setProgress("");
      }
    } catch (cause) {
      if (!controller.signal.aborted && request.current === controller)
        setError(
          cause instanceof Error ? cause.message : "Your trip could not be prepared. Try again.",
        );
    } finally {
      if (!controller.signal.aborted && request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <Modal
      title="Review your personal trip"
      onClose={onClose}
      className="mt-tools-dialog mt-generation-dialog"
    >
      <header className="mt-generation-heading">
        <span className="mt-muted">Your next trip</span>
        <h1>
          {route.stays.map((stay) => stay.destination?.name ?? stay.destinationId).join(" → ")}
        </h1>
        <p>
          {brief.days} days · {brief.partySize} traveler{brief.partySize === 1 ? "" : "s"} ·{" "}
          {route.startDate ?? "Flexible dates"}
        </p>
      </header>
      <p className="mt-muted">
        Review a personal itinerary before creating it. Your current trip stays as it is.
      </p>
      <section className={guidance.guide} aria-label="Planning steps">
        <h2>Before this becomes your trip</h2>
        <ol className={guidance.steps}>
          {steps.map((step) => (
            <li key={step.id} aria-current={step.id === currentStep ? "step" : undefined}>
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
        {(busy || groups.length > 0 || error || progress) && (
          <ul className={guidance.cityResponses} aria-label="City recommendation progress">
            {cityIds.map((id) => {
              const result = groups.find((group) => group.destinationId === id);
              return (
                <li key={id}>
                  <strong>{cityName(id)}</strong>
                  <span>
                    {result
                      ? `${result.places.length} Qloo candidates received`
                      : busy && id === nextCityId
                        ? "Requesting recommendations…"
                        : "Not loaded yet"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {!preview && (
        <section className="mt-generation-preferences" aria-label="Trip recommendation preferences">
          <div>
            <strong>Your favorites</strong>
            <p>
              {seeds.length
                ? seeds.map((seed) => seed.name).join(" · ")
                : "Choose an artist, book, film or another favorite."}
            </p>
            <button
              type="button"
              className="mt-pill outlined"
              disabled={busy}
              onClick={() => setFavoritesOpen(true)}
            >
              {seeds.length ? "Edit favorites" : "Choose favorites"}
            </button>
          </div>
          <label>
            Pace
            <select
              aria-label="Trip pace"
              disabled={busy}
              value={pace}
              onChange={(event) => {
                clearPreview();
                setPace(event.target.value as TripBrief["pace"]);
              }}
            >
              <option value="slow">Slow · room to linger</option>
              <option value="balanced">Balanced · a little of everything</option>
              <option value="full">Full · more to explore</option>
            </select>
          </label>
          <fieldset disabled={busy}>
            <legend>Make room for</legend>
            <div className="mt-setup-chips">
              {(
                [
                  ["cafe", "Cafés"],
                  ["food", "Food"],
                  ["culture", "Culture"],
                  ["outdoors", "Outdoors"],
                  ["shop", "Shops"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={categories.includes(value)}
                  onClick={() => {
                    clearPreview();
                    setCategories(
                      categories.includes(value)
                        ? categories.filter((item) => item !== value)
                        : [...categories, value],
                    );
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <small>No selection includes all kinds of places.</small>
          </fieldset>
        </section>
      )}
      {stale && (
        <p role="alert">
          Your current draft changed. Close this preview and review the latest plan before creating
          another trip.
        </p>
      )}
      {busy && (
        <section className="mt-generation-progress" role="status">
          <span className="mt-generation-orb" />
          <strong>{progress || "Preparing your itinerary…"}</strong>
          <p>Requesting Qloo recommendations. Each city’s results appear after they are checked.</p>
          <button
            type="button"
            className="mt-pill outlined"
            onClick={() => {
              request.current?.abort();
              request.current = null;
              setBusy(false);
              setProgress("Planning stopped. Completed city results are kept for retry.");
            }}
          >
            Stop planning
          </button>
        </section>
      )}
      {!busy && progress && <p role="status">{progress}</p>}
      {error && (
        <p className="mt-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <section className="mt-generation-itinerary" aria-label="Proposed itinerary">
          <div className="mt-generation-summary">
            <Check size={18} />
            <strong>
              {preview.stops.length} proposed visits · {preview.places.length} places
            </strong>
          </div>
          <p className="mt-muted">
            Places are ranked by Qloo within each city. Visit times are a draft; confirm hours and
            travel before going. Choose Create this trip to save this draft and edit its days.
          </p>
          {preview.days.map((day) => {
            const city = getTripDestination(preview, destinationForDay(preview, day.id));
            const stops = preview.stops.filter((stop) => stop.dayId === day.id);
            return (
              <article key={day.id} className="mt-generation-day">
                <header>
                  <h2>
                    {day.label} · {city?.name}
                  </h2>
                  <span>{day.date ?? "Dates open"}</span>
                </header>
                {stops.length ? (
                  <ol>
                    {stops.map((stop) => {
                      const place = preview.places.find((place) => place.id === stop.placeId);
                      return (
                        <li key={stop.id}>
                          <time>{stop.startTime}</time>
                          <div>
                            <strong>{place?.name}</strong>
                            <small>
                              {place?.category} · {stop.durationMinutes} min · Qloo #
                              {stop.selection?.rank}
                            </small>
                          </div>
                          <MapPin size={16} />
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p>No matching places found here. This day will stay open for your own ideas.</p>
                )}
              </article>
            );
          })}
          {preview.places.length > preview.stops.length && (
            <p className="mt-muted">
              {preview.places.length - new Set(preview.stops.map((stop) => stop.placeId)).size} more
              places will stay in Ideas.
            </p>
          )}
          {!preview.stops.length && (
            <p role="status">
              No visit suggestions were available. You can create this as an empty draft or go back
              and choose other favorites.
            </p>
          )}
        </section>
      )}
      {!configured && (
        <p role="status">
          Qloo recommendations are unavailable right now. Create a blank draft or return to the trip
          details.
        </p>
      )}
      <footer className="mt-generation-footer">
        {!preview && (
          <button
            type="button"
            className="mt-pill outlined"
            disabled={busy || stale || accepted}
            onClick={() => {
              try {
                if (onAccept(buildTripPreview(nextBrief, route, []))) setAccepted(true);
                else setError("This draft was not accepted. Your previous trip has been kept.");
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "This draft could not be prepared.",
                );
              }
            }}
          >
            Create blank draft
          </button>
        )}
        <button
          type="button"
          className="mt-pill outlined"
          disabled={busy || accepted}
          onClick={preview ? clearPreview : onBack}
        >
          {preview ? "Refine this plan" : "Back to trip details"}
        </button>
        {preview ? (
          <button
            type="button"
            className="mt-primary"
            disabled={stale || accepted}
            onClick={() => {
              if (onAccept(preview)) setAccepted(true);
              else
                setError(
                  "This trip was not accepted. Your previous draft has been kept; check the notice and try again.",
                );
            }}
          >
            Create this trip
          </button>
        ) : (
          <button
            type="button"
            className="mt-primary"
            disabled={busy || stale || !configured}
            onClick={() => void generate()}
          >
            <RefreshCw size={16} />
            {error || progress ? "Retry planning" : "Find my places"}
          </button>
        )}
      </footer>
      {favoritesOpen && (
        <DiscoveryFavorites
          initial={seeds}
          configured={configured}
          onClose={() => setFavoritesOpen(false)}
          onConfirm={(values) => {
            clearPreview();
            setSeeds(values);
            setFavoritesOpen(false);
          }}
        />
      )}
    </Modal>
  );
}
