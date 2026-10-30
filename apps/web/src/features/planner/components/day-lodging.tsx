"use client";

import { getTripDestination, lodgingWebsite, routeStayDates, type Trip } from "@tastip/domain";
import { BedDouble, Moon } from "lucide-react";

export function DayLodging({
  trip,
  dayId,
  onOpenStays,
}: {
  trip: Trip;
  dayId: string;
  onOpenStays: () => void;
}) {
  const index = trip.days.findIndex((day) => day.id === dayId);
  const overnight = trip.route
    ? routeStayDates(trip.route).find(
        (stay) => index >= stay.firstDay && index < stay.firstDay + stay.nights,
      )
    : undefined;
  if (!overnight)
    return trip.stops.some((stop) => stop.dayId === dayId) ? (
      <div className="day-timeline-night">
        <Moon size={16} />
        <div>
          <strong>Leave a little room for the unexpected.</strong>
          <p>Your evening is yours to shape. No accommodation is booked.</p>
        </div>
      </div>
    ) : null;
  const city = getTripDestination(trip, overnight.destinationId)?.name ?? "this city";
  const candidate = trip.lodgings?.find((choice) => choice.stayId === overnight.id)?.candidate;
  const website = candidate ? lodgingWebsite(candidate) : undefined;
  return (
    <section className="day-lodging" aria-label="Lodging for this night">
      <BedDouble size={21} aria-hidden="true" />
      <div className="day-lodging-copy">
        <p className="eyebrow">
          NIGHT OF {trip.days[index]?.date} · {city}
        </p>
        <h4>{candidate?.name ?? `A place to land in ${city}.`}</h4>
        <p>
          {candidate
            ? `${candidate.source === "traveler" ? "Entered by you · details unverified" : "Qloo lodging suggestion"}. Idea only; not reserved.`
            : "No lodging idea saved for this city stay. Choose one when you’re ready."}
        </p>
        <div className="day-lodging-actions">
          <button
            type="button"
            className="button button-secondary"
            aria-label={`${candidate ? "Review" : "Choose"} lodging in ${city}`}
            onClick={onOpenStays}
          >
            {candidate ? "Review lodging idea" : "Choose a lodging idea"}
          </button>
          {website && (
            <a
              className="button button-quiet"
              href={website}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open property link ↗
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
