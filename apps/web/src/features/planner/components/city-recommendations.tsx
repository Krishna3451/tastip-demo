"use client";

import {
  cityRecommendationOperations,
  destinationForDay,
  feedbackTasteSignals,
  getTripDestination,
  type Place,
  type Trip,
  type TripOperation,
} from "@tastip/domain";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useProviderFetch } from "@/lib/provider-fetch";

export function CityRecommendations({
  trip,
  dayId,
  configured,
  onCommand,
  onTaste,
  actionRef,
}: {
  trip: Trip;
  dayId: string;
  configured: boolean;
  onCommand: (ops: TripOperation[], version?: number, tripId?: string) => boolean | undefined;
  onTaste: () => void;
  actionRef?: Ref<{ find: () => void }>;
}) {
  const providerFetch = useProviderFetch();
  const cityId = destinationForDay(trip, dayId);
  const city = getTripDestination(trip, cityId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{
    places: Place[];
    version: number;
    tripId: string;
    operations: TripOperation[];
  } | null>(null);
  const section = useRef<HTMLElement>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: city switches cancel old-location recommendations.
  useEffect(() => {
    pending.current?.abort();
    setBusy(false);
    setProposal(null);
    setError(null);
  }, [cityId, trip.id]);
  async function find() {
    if (busy) return;
    section.current?.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    if (!trip.brief.tasteProfile?.seeds.length) {
      onTaste();
      return;
    }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    setProposal(null);
    try {
      const response = await providerFetch("/api/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityIds: trip.brief.tasteProfile.seeds.map((seed) => seed.id),
          destinationId: cityId,
          ...(cityId.startsWith("geonames-") ? { destination: city } : {}),
          categories: trip.brief.tasteProfile.categories,
          excludedIds: feedbackTasteSignals(trip).excludedIds,
        }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Recommendations could not connect.");
      if (!body.selected?.length)
        throw new Error("No matching candidates here yet. Try a broader day style.");
      const operations = cityRecommendationOperations(trip, cityId, body.selected);
      if (!controller.signal.aborted)
        setProposal({ places: body.selected, version: trip.version, tripId: trip.id, operations });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Recommendations could not connect.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useImperativeHandle(actionRef, () => ({ find: () => void find() }));
  const count = proposal?.operations.filter((op) => op.type === "add-stop").length ?? 0;
  return (
    <section ref={section} className="city-recommendations" aria-label="City recommendations">
      <div>
        <strong>Your kind of {city?.name ?? "places"}</strong>
        <p>Ranked around your confirmed favorites. Existing visits and pins stay in place.</p>
      </div>
      <button
        type="button"
        className="button button-secondary"
        disabled={busy || (!configured && Boolean(trip.brief.tasteProfile?.seeds.length))}
        onClick={() => void find()}
      >
        {busy ? "Finding places…" : `Find places in ${city?.name ?? "this city"}`}
      </button>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {proposal && (
        <div className="city-candidate-review">
          <p>
            {proposal.places.length} real candidates · {count} new draft visits. Travel and opening
            hours still need checking.
          </p>
          <div>
            {proposal.places.slice(0, 5).map((place) => (
              <span key={place.id}>
                {place.name}
                <small>Qloo #{place.taste?.rank}</small>
              </span>
            ))}
          </div>
          <button
            type="button"
            className="button button-primary"
            disabled={trip.version !== proposal.version || trip.id !== proposal.tripId}
            onClick={() => {
              if (onCommand(proposal.operations, proposal.version, proposal.tripId))
                setProposal(null);
            }}
          >
            Add {count} visits & keep ideas
          </button>
          {(trip.version !== proposal.version || trip.id !== proposal.tripId) && (
            <p role="status">The trip changed. Find places again to prepare a fresh suggestion.</p>
          )}
        </div>
      )}
    </section>
  );
}
