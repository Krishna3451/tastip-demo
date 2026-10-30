"use client";

import { destinationForDay, getTripDestination, type Trip } from "@tastip/domain";
import type { DrivingRoute } from "@tastip/providers";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProviderFetch } from "@/lib/provider-fetch";
import {
  betweenPlacesUrl,
  type DirectionsMode,
  drivingRouteConflicts,
  realDayVisits,
} from "../lib/day-directions";
import { placeSourceLabel } from "../lib/place-labels";

const LeafletMap = dynamic(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <p role="status">Opening the city map…</p>,
});
export function GeographicPlan({
  trip,
  dayId,
  onSelectStop,
  onOpenDay,
}: {
  trip: Trip;
  dayId: string;
  onSelectStop: (id: string) => void;
  onOpenDay: () => void;
}) {
  const providerFetch = useProviderFetch();
  const places = useMemo(() => realDayVisits(trip, dayId), [trip, dayId]);
  const [directionsMode, setDirectionsMode] = useState<DirectionsMode>("walking");
  const city = getTripDestination(trip, destinationForDay(trip, dayId));
  const day = trip.days.find((item) => item.id === dayId) ?? trip.days[0];
  const hasDemoVisits = trip.stops.some(
    (stop) =>
      stop.dayId === dayId &&
      trip.places.find((place) => place.id === stop.placeId)?.source === "demo",
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, []);
  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Any change to route inputs invalidates cached directions and pending requests.
  useEffect(() => {
    request.current?.abort();
    setRoute(null);
    setBusy(false);
    setError(null);
    return () => request.current?.abort();
  }, [places]);
  async function findRoute() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await providerFetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: places.map(({ place }) => [place.lng, place.lat]) }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Driving route could not connect.");
      if (!controller.signal.aborted) setRoute(body);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Driving route could not connect.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const conflicts = route ? drivingRouteConflicts(trip, dayId, route) : [];
  return (
    <section className="geographic-plan" aria-label="Geographic day plan">
      <header>
        <p className="eyebrow">THE CITY, CONNECTED</p>
        <h2 ref={heading} tabIndex={-1}>
          See where your day takes you.
        </h2>
        <p>
          Real geography for {city?.name ?? "your city"}. The illustrated day islands show
          chronology; this map shows locations.
        </p>
      </header>
      <section className="map-day-navigation" aria-label="Mapped day">
        <div>
          <strong>
            {day?.label} · {city?.name ?? "Your city"}
          </strong>
          <small>
            {day?.date ?? "Dates open"} · {city?.timeZone ?? "Local time"}
          </small>
        </div>
        <button type="button" className="button button-secondary" onClick={onOpenDay}>
          Open day timeline
        </button>
      </section>
      {(city || places.length > 0) && (
        <LeafletMap places={places} destination={city} route={route} onSelect={onSelectStop} />
      )}
      {!places.length && city && (
        <p className="map-city-caption">City view · no visit pins for this day.</p>
      )}
      {places.length ? (
        <>
          <div className="map-route-controls">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || places.length < 2 || places.length > 15}
              onClick={() => void findRoute()}
            >
              {busy ? "Checking road route…" : "Check driving route"}
            </button>
            <span>Driving only · no live traffic, parking or walking estimate</span>
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {route && (
            <div className="driving-result">
              <strong>
                {(route.distanceMetres / 1000).toFixed(1)} km · about{" "}
                {Math.ceil(route.durationSeconds / 60)} minutes driving
              </strong>
              <p>
                OSRM road-route estimate · retrieved {route.retrievedAt.slice(0, 10)}. Does not
                include visits, live traffic, parking or access restrictions. Walking preferences
                are not applied to this driving route.
              </p>
              {conflicts.length > 0 && (
                <ul>
                  {conflicts.map((conflict) => (
                    <li key={conflict}>{conflict}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {places.length > 1 && (
            <div className="external-directions">
              <label>
                Directions in Google Maps
                <select
                  aria-label="Google Maps travel mode"
                  value={directionsMode}
                  onChange={(event) => setDirectionsMode(event.target.value as DirectionsMode)}
                >
                  <option value="walking">Walking</option>
                  <option value="transit">Public transport</option>
                  <option value="driving">Driving</option>
                </select>
              </label>
              <p>
                Open directions between real places below. Choose your travel date and time in Maps;
                routes and estimates there do not update this itinerary. Sample places are omitted.
              </p>
            </div>
          )}
          <ol className="map-place-list">
            {places.map(({ stopId, place }, index) => (
              <li key={stopId}>
                <button type="button" data-stop-id={stopId} onClick={() => onSelectStop(stopId)}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span>
                    <strong>{place.name}</strong>
                    <small>
                      {placeSourceLabel(place)} · {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
                    </small>
                  </span>
                </button>
                {index > 0 && (
                  <a
                    className="map-leg-link"
                    href={betweenPlacesUrl(places[index - 1]!.place, place, directionsMode)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Directions from ${places[index - 1]!.place.name} to ${place.name} in Google Maps`}
                  >
                    {directionsMode === "transit"
                      ? "Public transport"
                      : directionsMode === "walking"
                        ? "Walking"
                        : "Driving"}{" "}
                    directions from {places[index - 1]!.place.name} ↗
                  </a>
                )}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="map-empty">
          <h3>
            {hasDemoVisits
              ? "A sample, with room for the real thing."
              : "Your map starts with a place."}
          </h3>
          <p>
            Add a place you know from Ideas, or find Qloo places for this city and add them to the
            day. Fictional sample venues are not shown as real map locations.
          </p>
        </div>
      )}
    </section>
  );
}
