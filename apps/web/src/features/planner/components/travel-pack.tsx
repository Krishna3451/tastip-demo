"use client";

import type { Trip } from "@tastip/domain";
import { CalendarArrowDown, Download, FileText, MapPin } from "lucide-react";
import { useState } from "react";
import {
  buildCalendar,
  buildPrintableTrip,
  placeDirectionsUrl,
  placeMapUrl,
  tripTitle,
} from "../lib/travel-pack";

function download(contents: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TravelPack({ trip }: { trip: Trip }) {
  const [error, setError] = useState<string | null>(null);
  const prefix = `tastip-${trip.brief.destinationId}`;
  const livePlaces = trip.places.filter(
    (place) => place.source !== "demo" && trip.stops.some((stop) => stop.placeId === place.id),
  );
  return (
    <section className="travel-pack" aria-label="Take your trip with you">
      <div className="travel-tool-heading">
        <div>
          <p className="eyebrow">READY WHEN YOU ARE</p>
          <h2>A little travel companion.</h2>
        </div>
        <Download size={23} aria-hidden="true" />
      </div>
      <p className="travel-tool-note">
        Keep a private copy of {tripTitle(trip)}. Downloads reflect this draft version; later
        changes won’t update them automatically.
      </p>
      <div className="travel-download-grid">
        <button
          type="button"
          className="travel-download-card"
          onClick={() => {
            setError(null);
            download(JSON.stringify(trip, null, 2), "application/json", `${prefix}-backup.json`);
          }}
        >
          <Download size={21} />
          <strong>Trip backup</strong>
          <span>Editable JSON · import it back into Tastip</span>
        </button>
        <button
          type="button"
          className="travel-download-card"
          onClick={() => {
            setError(null);
            try {
              download(buildCalendar(trip), "text/calendar;charset=utf-8", `${prefix}.ics`);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Calendar export failed.");
            }
          }}
        >
          <CalendarArrowDown size={21} />
          <strong>Calendar file</strong>
          <span>
            {trip.days.some((day) => !day.date)
              ? "Set trip dates first"
              : "Destination-local times · Apple / Google / Outlook"}
          </span>
        </button>
        <button
          type="button"
          className="travel-download-card"
          onClick={() => {
            setError(null);
            download(
              buildPrintableTrip(trip),
              "text/html;charset=utf-8",
              `${prefix}-itinerary.html`,
            );
          }}
        >
          <FileText size={21} />
          <strong>Printable itinerary</strong>
          <span>Open the HTML file, then print or save as PDF</span>
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {livePlaces.length > 0 && (
        <details className="travel-map-links">
          <summary>
            <MapPin size={15} />
            Open a planned place in Google Maps
          </summary>
          <ul>
            {livePlaces.map((place) => (
              <li key={place.id}>
                <a
                  href={placeMapUrl(place.lat, place.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {place.name}
                  <span>Open map ↗</span>
                </a>
                <a
                  href={placeDirectionsUrl(place.lat, place.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Directions to ${place.name} in Google Maps`}
                >
                  Directions ↗
                </a>
              </li>
            ))}
          </ul>
          <p>
            Google Maps opens separately with this place’s coordinates. These links do not verify
            routes, travel time, venue details or reservations.
          </p>
        </details>
      )}
      <p className="travel-tool-note">
        Itinerary files may contain your travel dates, preferences, costs and plans. Share them only
        with people you choose. Nothing is booked.
      </p>
    </section>
  );
}
