"use client";

import {
  getTripDestination,
  type LodgingCandidate,
  lodgingAddress,
  lodgingWebsite,
  routeStayDates,
  stayForDay,
  type Trip,
  type TripOperation,
  validLodgingCandidate,
} from "@tastip/domain";
import { BedDouble, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProviderFetch } from "@/lib/provider-fetch";
import { TravelerLodgingForm } from "./traveler-lodging-form";

export function LodgingPanel({
  trip,
  dayId,
  configured,
  onCommand,
  onTaste,
}: {
  trip: Trip;
  dayId: string;
  configured: boolean;
  onCommand: (ops: TripOperation[], version?: number, tripId?: string) => boolean | undefined;
  onTaste: () => void;
}) {
  const providerFetch = useProviderFetch();
  const stays = trip.route ? routeStayDates(trip.route).filter((stay) => stay.nights > 0) : [];
  const dayStay = trip.route
    ? stayForDay(
        trip.route,
        trip.days.findIndex((day) => day.id === dayId),
      )
    : undefined;
  const preferredStayId = stays.find((item) => item.id === dayStay?.id)?.id ?? stays[0]?.id ?? "";
  const [stayId, setStayId] = useState(preferredStayId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Choosing another day resets a manually selected city even within the same stay.
  useEffect(() => setStayId(preferredStayId), [preferredStayId, dayId]);
  const stay = stays.find((item) => item.id === stayId) ?? stays[0];
  const city = stay ? getTripDestination(trip, stay.destinationId) : undefined;
  const selectedLodging = trip.lodgings?.find((choice) => choice.stayId === stay?.id)?.candidate;
  const [proposal, setProposal] = useState<{
    candidates: LodgingCandidate[];
    tripId: string;
    version: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changes to the trip or selected city invalidate this proposal.
  useEffect(() => {
    request.current?.abort();
    setBusy(false);
    setProposal(null);
    setError(null);
  }, [trip.id, stay?.id]);
  async function find() {
    if (!city || !stay) return;
    if (!trip.brief.tasteProfile?.seeds.length) {
      onTaste();
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    setProposal(null);
    try {
      const response = await providerFetch("/api/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityIds: trip.brief.tasteProfile.seeds.map((seed) => seed.id),
          destinationId: city.id,
          ...(city.id.startsWith("geonames-") ? { destination: city } : {}),
          includeLodging: true,
        }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Lodging suggestions could not connect.");
      if (!Array.isArray(body.lodgings) || !body.lodgings.every(validLodgingCandidate))
        throw new Error("The lodging data could not be validated.");
      if (!body.lodgings.length)
        throw new Error(
          "Qloo returned no lodging candidates among this city’s ranked places. Try another favorite, or look for a property on the map.",
        );
      if (!controller.signal.aborted)
        setProposal({ candidates: body.lodgings, version: trip.version, tripId: trip.id });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Lodging suggestions could not connect.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="lodging-panel" aria-label="Planned stays">
      <header>
        <p className="eyebrow">A PLACE TO LAND</p>
        <h2 ref={heading} tabIndex={-1}>
          A good night, in your kind of place.
        </h2>
        <p>
          Keep a lodging idea with each city stay. Check dates, rates and availability directly with
          the property.
        </p>
      </header>
      {!stays.length ? (
        <div className="lodging-empty">
          <BedDouble size={30} />
          <h3>Start with your dates.</h3>
          <p>
            Use “Edit dates & cities” above to set your first travel date. A one-day trip has no
            overnight stay.
          </p>
        </div>
      ) : (
        <>
          <div className="lodging-controls">
            <label>
              City stay
              <select
                aria-label="Lodging city stay"
                value={stay?.id}
                onChange={(event) => setStayId(event.target.value)}
              >
                {stays.map((item) => (
                  <option key={item.id} value={item.id}>
                    {getTripDestination(trip, item.destinationId)?.name ?? item.destinationId} ·{" "}
                    {item.nights} {item.nights === 1 ? "night" : "nights"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || (!configured && Boolean(trip.brief.tasteProfile?.seeds.length))}
              onClick={() => void find()}
            >
              {busy ? "Finding lodging ideas…" : `Find stays in ${city?.name ?? "this city"}`}
            </button>
          </div>
          {stay && (
            <p>
              {stay.arrival ?? "Dates open"} → {stay.departure ?? "Dates open"} · {stay.nights}{" "}
              {stay.nights === 1 ? "night" : "nights"}.{" "}
              {trip.brief.tasteProfile?.lodging
                ? `Preferred style: ${trip.brief.tasteProfile.lodging}. Style matching is not verified.`
                : ""}
            </p>
          )}
          {trip.lodgings?.length ? (
            <div className="planned-lodgings">
              {trip.lodgings.map((choice) => {
                const dates = trip.route
                  ? routeStayDates(trip.route).find((item) => item.id === choice.stayId)
                  : undefined;
                return (
                  <article key={choice.stayId}>
                    <span>
                      <Check size={15} /> LODGING IDEA SAVED
                    </span>
                    <h3>{choice.candidate.name}</h3>
                    <p>
                      {dates?.arrival ?? "Dates open"} → {dates?.departure ?? "Dates open"} ·{" "}
                      {dates?.nights} {dates?.nights === 1 ? "night" : "nights"} · not reserved
                    </p>
                    <small className="lodging-source">
                      {choice.candidate.source === "traveler"
                        ? "Entered by you · details unverified"
                        : "Qloo lodging suggestion"}
                    </small>
                    {lodgingAddress(choice.candidate) && <p>{lodgingAddress(choice.candidate)}</p>}
                    {lodgingWebsite(choice.candidate) && (
                      <a
                        className="button button-secondary"
                        href={lodgingWebsite(choice.candidate)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {choice.candidate.source === "traveler"
                          ? "Open your lodging link ↗"
                          : "Check with the property ↗"}
                      </a>
                    )}
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => onCommand([{ type: "remove-lodging", stayId: choice.stayId }])}
                    >
                      Remove lodging idea
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}
          {stay && (
            <TravelerLodgingForm
              key={`${trip.id}:${stay.id}:${stay.destinationId}`}
              tripId={trip.id}
              version={trip.version}
              stayId={stay.id}
              destinationId={stay.destinationId}
              selected={selectedLodging}
              onCommand={onCommand}
            />
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {proposal && (
            <div className="lodging-candidates">
              {proposal.candidates.map((candidate) => (
                <article key={candidate.id}>
                  {candidate.facts?.imageUrl && (
                    <figure>
                      {/* biome-ignore lint/performance/noImgElement: Provider-hosted image without server proxy. */}
                      <img
                        src={candidate.facts.imageUrl}
                        alt={`${candidate.name} — via Qloo`}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                      <figcaption>Image via Qloo</figcaption>
                    </figure>
                  )}
                  <div>
                    <span className="eyebrow">QLOO LODGING SUGGESTION</span>
                    <h3>{candidate.name}</h3>
                    <p>{candidate.description}</p>
                    <small>
                      {candidate.facts?.address} · Original recommendation rank{" "}
                      {candidate.taste.rank}
                    </small>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={proposal.version !== trip.version || proposal.tripId !== trip.id}
                      onClick={() => {
                        if (
                          stay &&
                          onCommand(
                            [{ type: "select-lodging", stayId: stay.id, candidate }],
                            proposal.version,
                            proposal.tripId,
                          )
                        )
                          setProposal(null);
                      }}
                    >
                      Keep this lodging idea
                    </button>
                  </div>
                </article>
              ))}
              {proposal.version !== trip.version && (
                <p role="status">Your plan changed. Find stays again for a fresh suggestion.</p>
              )}
            </div>
          )}
          {city && (
            <a
              className="lodging-map-link"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`hotels in ${city.name} ${city.country}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              Explore properties on Google Maps ↗
            </a>
          )}
          <p className="lodging-note">
            No live room inventory, price quote, reservation, check-in guarantee or dietary
            suitability is implied. Hotel suggestions remain separate from timed day visits.
          </p>
        </>
      )}
    </section>
  );
}
