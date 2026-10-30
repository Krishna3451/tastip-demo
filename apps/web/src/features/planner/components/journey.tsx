"use client";

import type { Place, Trip, TripStop } from "@tastip/domain";
import dynamic from "next/dynamic";

const JourneyScene = dynamic(() => import("@tastip/scene").then((module) => module.JourneyScene), {
  ssr: false,
  loading: () => (
    <p className="scene-note" role="status">
      Building your little world…
    </p>
  ),
});

import { ArrowUpRight, Coffee, Landmark, Leaf, ShoppingBag, Utensils } from "lucide-react";

export function PlaceIcon({ category, size = 18 }: { category: Place["category"]; size?: number }) {
  const Icon = {
    cafe: Coffee,
    culture: Landmark,
    food: Utensils,
    outdoors: Leaf,
    shop: ShoppingBag,
  }[category];
  return <Icon size={size} aria-hidden="true" />;
}

export function Journey({
  trip,
  dayId,
  selectedStopId,
  onSelect,
}: {
  trip: Trip;
  dayId: string;
  selectedStopId: string | null;
  onSelect: (id: string) => void;
}) {
  const stops = trip.stops
    .filter((stop) => stop.dayId === dayId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  return (
    <section className="journey-scene" aria-label="Illustrated day journey">
      <div className="journey-heading">
        <span className="eyebrow">A little adventure, at your pace</span>
        <p>Your day, one good place at a time.</p>
      </div>
      <div className="journey-cloud cloud-one" aria-hidden="true" />
      <div className="journey-cloud cloud-two" aria-hidden="true" />
      {stops.length === 0 ? (
        <div className="empty-day">
          <Leaf size={28} />
          <h3>A little breathing room.</h3>
          <p>This day has no stops. Move a visit here from another day.</p>
        </div>
      ) : (
        <>
          <div className="journey-canvas-wrap">
            <JourneyScene
              trip={trip}
              dayId={dayId}
              selectedStopId={selectedStopId}
              onSelect={onSelect}
            />
          </div>
          <div className="journey-visit-controls">
            {stops.map((stop, index) => {
              const place = trip.places.find((p) => p.id === stop.placeId);
              return place ? (
                <button
                  type="button"
                  key={stop.id}
                  data-stop-id={stop.id}
                  onClick={() => onSelect(stop.id)}
                  aria-pressed={selectedStopId === stop.id}
                >
                  <PlaceIcon category={place.category} />
                  <span>
                    <small>
                      {stop.startTime} · STOP {index + 1}
                    </small>
                    <strong>{place.name}</strong>
                  </span>
                  <ArrowUpRight size={13} />
                </button>
              ) : null;
            })}
          </div>
        </>
      )}
      <p className="scene-note">
        An illustrated timeline · Distances and travel times are not represented.
      </p>
    </section>
  );
}

export function ItineraryList({
  trip,
  dayId,
  selectedStopId,
  onSelect,
}: {
  trip: Trip;
  dayId: string;
  selectedStopId: string | null;
  onSelect: (id: string) => void;
}) {
  const stops = trip.stops
    .filter((stop) => stop.dayId === dayId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  return (
    <section className="itinerary-list" aria-label="Day itinerary">
      <div className="list-intro">
        <h2>A day with a little room to wander.</h2>
        <p>Times are a draft. Confirm opening hours and travel before you go.</p>
      </div>
      {stops.length === 0 ? (
        <p className="empty-day">No visits scheduled for this day.</p>
      ) : (
        stops.map((stop: TripStop, index) => {
          const place = trip.places.find((p) => p.id === stop.placeId);
          if (!place) return null;
          return (
            <button
              type="button"
              className={`itinerary-row ${selectedStopId === stop.id ? "selected" : ""}`}
              key={stop.id}
              data-stop-id={stop.id}
              onClick={() => onSelect(stop.id)}
              aria-pressed={selectedStopId === stop.id}
            >
              <span className="visit-time">{stop.startTime}</span>
              <span className={`place-tile category-${place.category}`}>
                <PlaceIcon category={place.category} size={24} />
              </span>
              <span className="visit-copy">
                <small>
                  STOP {index + 1} · {stop.durationMinutes} MIN
                </small>
                <strong>{place.name}</strong>
                <span>{place.description}</span>
                {stop.note && (
                  <span className="visit-note-preview">
                    <b>Your note</b> {stop.note}
                  </span>
                )}
              </span>
              <ArrowUpRight size={18} />
            </button>
          );
        })
      )}
    </section>
  );
}
