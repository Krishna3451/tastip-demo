"use client";

import { hoursForDate, type Place, type Trip, type TripStop, WEEKDAYS } from "@tastip/domain";
import { Clock3 } from "lucide-react";
import { useState } from "react";
import { PlaceIcon } from "./journey";

export function PlacePhoto({ place }: { place: Place }) {
  const imageUrl = place.source === "qloo" ? place.facts?.imageUrl : undefined;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  return imageUrl && failedUrl !== imageUrl ? (
    <figure className="detail-photo">
      {/* biome-ignore lint/performance/noImgElement: The accepted Qloo-hosted image loads directly without a server-side proxy. */}
      <img
        key={imageUrl}
        src={imageUrl}
        alt={`${place.name} — supplied via Qloo`}
        decoding="async"
        onLoad={() => setLoadedUrl(imageUrl)}
        onError={() => setFailedUrl(imageUrl)}
        referrerPolicy="no-referrer"
      />
      {loadedUrl === imageUrl && <figcaption>Image via Qloo</figcaption>}
    </figure>
  ) : (
    <div className={`detail-art category-${place.category}`} aria-hidden="true">
      <PlaceIcon category={place.category} size={54} />
      <span className="detail-art-ring" />
      <span className="detail-art-dot" />
    </div>
  );
}

export function PlaceEvidence({
  place,
  evidence,
  profile,
}: {
  place: Place;
  evidence: TripStop["selection"];
  profile?: Trip["brief"]["tasteProfile"];
}) {
  return (
    <div className="detail-callout">
      <span className="tiny-star">✦</span>
      <div>
        <strong>
          {place.source === "traveler"
            ? "Added by you"
            : place.source === "demo"
              ? "A sample of the experience"
              : "Selected with Qloo"}
        </strong>
        <p>
          {place.source === "demo"
            ? "An original fictional venue for exploring the product. Live taste matching is not connected to this draft."
            : place.source === "traveler"
              ? "A place and pin you entered. Location, hours and costs still need checking."
              : `Recommendation rank ${evidence?.rank ?? "unavailable"}. Practical details still need checking.`}
        </p>
        {place.source === "qloo" && profile && (
          <p className="taste-evidence">
            Favorites saved with this trip: {profile.seeds.map((seed) => seed.name).join(", ")}.{" "}
            {profile.dayStyle && `Your choice: ${profile.dayStyle}.`}
            <br />
            <small>
              {evidence
                ? `Query ${evidence.queryId.slice(0, 8)} · Original Qloo rank ${evidence.rank}`
                : "Original visit selection was not recorded."}
            </small>
          </p>
        )}
      </div>
    </div>
  );
}

export function PlaceFacts({ place, date }: { place: Place; date: string | null }) {
  const listedHours = hoursForDate(place, date);
  return (
    <>
      {place.source !== "demo" && (
        <div className="detail-provider-links">
          <a
            className="button button-secondary"
            href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Open place on Google Maps
          </a>
          <p>Check current hours, menus and reviews with the venue. No booking has been made.</p>
        </div>
      )}
      {place.facts && (
        <section className="venue-facts" aria-label="Sourced venue details">
          {place.facts.specialtyDishes && (
            <p>
              <strong>Provider-listed specialties:</strong> {place.facts.specialtyDishes}. Confirm
              the current menu and ingredients with the venue.
            </p>
          )}
          {place.facts.cuisine && <p>{place.facts.cuisine}</p>}
          {place.facts.address && <p>{place.facts.address}</p>}
          <div className="venue-links">
            {place.facts.website && (
              <a href={place.facts.website} target="_blank" rel="noreferrer">
                Venue website ↗
              </a>
            )}
            {place.facts.menuUrl && (
              <a href={place.facts.menuUrl} target="_blank" rel="noreferrer">
                Venue menu ↗
              </a>
            )}
          </div>
          <details>
            <summary>Provider-listed weekly hours</summary>
            <dl>
              {WEEKDAYS.map((weekday) => {
                const periods = place.facts?.hours?.[weekday];
                return (
                  <div key={weekday}>
                    <dt>{weekday}</dt>
                    <dd>
                      {!periods?.length
                        ? "Not supplied"
                        : periods.every((period) => period.closed)
                          ? "Listed closed"
                          : periods
                              .filter((period) => !period.closed)
                              .map(
                                (period) =>
                                  `${period.opens ?? "Unknown"}–${period.closes ?? "Unknown"}`,
                              )
                              .join(", ")}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </details>
          {listedHours && (
            <p>
              Listed for this weekday:{" "}
              {listedHours.every((period) => period.closed)
                ? "listed closed — please confirm"
                : listedHours
                    .filter((period) => !period.closed)
                    .map((period) => `${period.opens ?? "Unknown"}–${period.closes ?? "Unknown"}`)
                    .join(", ")}
            </p>
          )}
          <small>
            Source: Qloo · retrieved {place.facts.retrievedAt.slice(0, 10)}. Hours can be incomplete
            or outdated; confirm with the venue. Holiday exceptions are not checked.
          </small>
        </section>
      )}
      <div className="detail-facts">
        <span>
          <Clock3 size={15} />
          Opening hours
        </span>
        <strong>{place.facts?.hours ? "Provider listing available" : "Not verified"}</strong>
        <span>Estimated spend</span>
        <strong>Unknown</strong>
      </div>
    </>
  );
}
