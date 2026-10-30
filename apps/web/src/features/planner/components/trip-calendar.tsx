"use client";

import { destinationForDay, getDayStops, getTripDestination, type Trip } from "@tastip/domain";
import { ArrowUpRight, CalendarDays, Clock3, MapPin } from "lucide-react";
import { placeSourceLabel } from "../lib/place-labels";
import { visitEnd } from "../lib/travel-pack";
import { TransferBlocks } from "./transfer-plans";

export function TravelCalendar({
  trip,
  dayId,
  onDayChange,
  onSelectStop,
  onOpenDay,
}: {
  trip: Trip;
  dayId: string;
  onDayChange: (dayId: string) => void;
  onSelectStop: (stopId: string) => void;
  onOpenDay: (dayId: string) => void;
}) {
  return (
    <section className="travel-calendar" aria-label="Trip calendar">
      <div className="travel-tool-heading">
        <div>
          <p className="eyebrow">ONE JOURNEY, DAY BY DAY</p>
          <h2>Your time, thoughtfully spent.</h2>
        </div>
        <CalendarDays size={24} aria-hidden="true" />
      </div>
      <p className="travel-tool-note">
        Every event uses the same saved itinerary. Times are local to each city; travel and opening
        hours still need checking.
      </p>
      <div className="calendar-day-grid">
        {trip.days.map((day) => {
          const city = getTripDestination(trip, destinationForDay(trip, day.id));
          const stops = getDayStops(trip, day.id);
          return (
            <article
              key={day.id}
              className={`calendar-day-card ${day.id === dayId ? "is-active" : ""}`}
            >
              <button
                type="button"
                className="calendar-day-title"
                aria-pressed={day.id === dayId}
                onClick={() => onDayChange(day.id)}
              >
                <span>{day.label}</span>
                <strong>
                  {day.date
                    ? new Intl.DateTimeFormat("en", {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      }).format(new Date(`${day.date}T12:00:00Z`))
                    : "Dates open"}
                </strong>
                <small>
                  <MapPin size={12} />
                  {city?.name ?? "Your destination"}
                </small>
              </button>
              <TransferBlocks trip={trip} dayId={day.id} />
              <ol>
                {stops.map((stop) => {
                  const place = trip.places.find((item) => item.id === stop.placeId);
                  return place ? (
                    <li key={stop.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onDayChange(day.id);
                          onSelectStop(stop.id);
                        }}
                      >
                        <span>
                          <Clock3 size={12} />
                          {stop.startTime}–{visitEnd(stop.startTime, stop.durationMinutes)}
                        </span>
                        <strong>{place.name}</strong>
                        <small>
                          {place.category} · {stop.durationMinutes} min
                        </small>
                        <small>{placeSourceLabel(place)}</small>
                      </button>
                    </li>
                  ) : null;
                })}
              </ol>
              {!stops.length && (
                <p className="calendar-open-day">
                  A little breathing room.
                  <br />
                  No visits scheduled yet.
                </p>
              )}
              <button
                type="button"
                className="button button-secondary calendar-open-timeline"
                aria-label={`Open ${day.label} timeline`}
                onClick={() => onOpenDay(day.id)}
              >
                Open day timeline
                <ArrowUpRight size={14} />
              </button>
              <p className="calendar-zone">{city?.timeZone} local time</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
