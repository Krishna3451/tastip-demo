"use client";

import type { Place, Trip } from "@tastip/domain";
import { MapPin, RefreshCw, Square } from "lucide-react";
import { useRef, useState } from "react";
import { AddPlace } from "../../reference/add-place";
import styles from "../styles/day-suggestions.module.css";
import { DAY_DISCOVERY_RADII, useDayDiscovery } from "../use-day-discovery";
import type { usePlanner } from "../use-planner";
import { PlacePhoto } from "./place-information";

type Binding = NonNullable<ReturnType<typeof useDayDiscovery>["binding"]>;

export function DaySuggestions({
  trip,
  dayId,
  scope,
  active,
  configured,
  available,
  unavailableReason,
  onCommand,
  onAdded,
}: {
  trip: Trip;
  dayId: string;
  scope: string;
  active: boolean;
  configured: boolean;
  available: boolean;
  unavailableReason?: string;
  onCommand: ReturnType<typeof usePlanner>["command"];
  onAdded: (dayId: string, stopId: string) => void;
}) {
  const discovery = useDayDiscovery({
    trip,
    dayId,
    scope,
    active,
    enabled: configured && available,
  });
  const day = trip.days.find((item) => item.id === dayId);
  const [review, setReview] = useState<{ place: Place; binding: Binding } | null>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const latest = useRef({ discovery, onCommand, onAdded });
  latest.current = { discovery, onCommand, onAdded };
  const currentReview =
    active && available && review && discovery.isCurrent(review.binding) ? review : null;
  function closeReview() {
    setReview(null);
    requestAnimationFrame(() => {
      if (lastTrigger.current?.isConnected) lastTrigger.current.focus({ preventScroll: true });
    });
  }
  const blockedReason = !available
    ? unavailableReason || "Recommendations are paused until saved preferences can be checked."
    : discovery.blockedReason;
  return (
    <section className={styles.tray} aria-label="Suggestions for this day">
      <header className={styles.heading}>
        <div>
          <h3>
            {day?.label ?? "Your day"} · {discovery.destination?.name ?? "Choose a city"}
          </h3>
          <p>Qloo suggestions, outside your schedule until you choose a visit.</p>
        </div>
      </header>
      <div className={styles.controls}>
        <label>
          Around this city
          <select
            aria-label="Day suggestion radius"
            value={discovery.radius}
            disabled={!active || !available}
            onChange={(event) => {
              setReview(null);
              discovery.setRadius(Number(event.target.value));
            }}
          >
            {DAY_DISCOVERY_RADII.map((radius) => (
              <option key={radius} value={radius}>
                {radius / 1000} km
              </option>
            ))}
          </select>
        </label>
        {discovery.status === "loading" ? (
          <button type="button" className="button button-secondary" onClick={discovery.stop}>
            <Square size={13} aria-hidden="true" /> Stop search
          </button>
        ) : (
          <button
            type="button"
            className="button button-secondary"
            disabled={!discovery.canFind}
            onClick={() => void discovery.find()}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {discovery.status === "ready" ? "Refresh suggestions" : "Find places for this day"}
          </button>
        )}
      </div>
      {!discovery.canFind && blockedReason && (
        <p className={styles.message} role="status">
          {blockedReason}
        </p>
      )}
      {discovery.status === "loading" && (
        <p className={styles.message} role="status">
          Finding places around {discovery.destination?.name}…
        </p>
      )}
      {discovery.status === "stopped" && (
        <div className={styles.recovery}>
          <p role="status">Search stopped. Your day is unchanged.</p>
          <button
            type="button"
            className="button button-secondary"
            disabled={!discovery.canFind}
            onClick={() => void discovery.retry()}
          >
            Retry suggestions
          </button>
        </div>
      )}
      {discovery.status === "error" && (
        <div className={styles.recovery}>
          <p role="alert">
            {discovery.error || "Suggestions could not load. Your day is unchanged."}
          </p>
          <button
            type="button"
            className="button button-secondary"
            disabled={!discovery.canFind}
            onClick={() => void discovery.retry()}
          >
            Retry suggestions
          </button>
        </div>
      )}
      {discovery.status === "ready" && !discovery.candidates.length && (
        <p className={styles.message} role="status">
          No matching places here. Try another radius or review the trip’s confirmed favorites.
        </p>
      )}
      {discovery.candidates.length > 0 && (
        <div className={styles.results}>
          <p className={styles.count} role="status">
            {discovery.candidates.length} Qloo suggestions · review before adding
          </p>
          {discovery.candidates.map((place) => {
            const alreadyPlanned = trip.stops.some(
              (stop) => stop.dayId === dayId && stop.placeId === place.id,
            );
            return (
              <article key={place.id} className={styles.card}>
                <div className={styles.cardHeading}>
                  <div className={styles.thumbnail}>
                    <MapPin size={22} aria-hidden="true" />
                    <PlacePhoto place={place} />
                  </div>
                  <div>
                    <h4>{place.name}</h4>
                    <p>Qloo · original rank {place.taste?.rank}</p>
                  </div>
                </div>
                {alreadyPlanned && <p className={styles.planned}>Already planned on this day</p>}
                <p className={styles.description}>{place.description}</p>
                <details className={styles.source}>
                  <summary>Recommendation source</summary>
                  <p>Rank within this Qloo response. Times and availability need checking.</p>
                  <code>{place.taste?.queryId}</code>
                </details>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label={`Review ${place.name} for ${day?.label ?? "this day"}`}
                  onClick={(event) => {
                    if (!discovery.binding || !discovery.isCurrent(discovery.binding)) return;
                    lastTrigger.current = event.currentTarget;
                    setReview({ place, binding: discovery.binding });
                  }}
                >
                  {alreadyPlanned ? "Add another visit" : `Add to ${day?.label ?? "this day"}`}
                </button>
              </article>
            );
          })}
        </div>
      )}
      {currentReview && (
        <div className="planner-conversation-planning">
          <AddPlace
            key={`${currentReview.binding.requestId}:${currentReview.place.id}`}
            trip={trip}
            place={currentReview.place}
            preferredDayId={currentReview.binding.dayId}
            onlyDayId={currentReview.binding.dayId}
            onCommand={(operations, version, tripId, commandId) => {
              if (!latest.current.discovery.isCurrent(currentReview.binding)) return false;
              if (
                version !== currentReview.binding.version ||
                tripId !== currentReview.binding.tripId ||
                operations.some(
                  (operation) =>
                    operation.type === "add-stop" &&
                    operation.stop.dayId !== currentReview.binding.dayId,
                )
              )
                return false;
              return latest.current.onCommand(operations, version, tripId, commandId);
            }}
            onClose={closeReview}
            onRoute={closeReview}
            onAdded={(addedDayId, stopId) => {
              setReview(null);
              latest.current.onAdded(addedDayId, stopId);
            }}
          />
        </div>
      )}
    </section>
  );
}
