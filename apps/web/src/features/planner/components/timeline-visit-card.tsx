"use client";

import { listedHoursWarning, type Place, type TripStop } from "@tastip/domain";
import { ArrowUpRight, Check, Clock3 } from "lucide-react";
import { useId, useState } from "react";
import { PlaceIcon } from "./journey";

export function TimelineVisitCard({
  place,
  stop,
  date,
  selected,
  onSelect,
}: {
  place: Place;
  stop: TripStop;
  date: string | null;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const evidence = stop.selection ?? place.taste;
  const imageUrl = place.source === "qloo" ? place.facts?.imageUrl : undefined;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const image = imageUrl && failedUrl !== imageUrl ? imageUrl : null;
  const sourceId = useId();
  const hoursId = `${sourceId}-hours`;
  const warning = listedHoursWarning(place, date, stop.startTime, stop.durationMinutes);
  return (
    <button
      type="button"
      className={`day-timeline-card ${selected ? "is-selected" : ""}`}
      data-stop-id={stop.id}
      aria-label={`Open ${place.name}, ${stop.startTime}`}
      aria-describedby={warning ? `${sourceId} ${hoursId}` : sourceId}
      aria-pressed={selected}
      onClick={() => onSelect(stop.id)}
    >
      <span
        className={`day-timeline-place-art place-art-${place.category} ${imageUrl ? "has-image-source" : ""}`}
        aria-hidden="true"
      >
        <PlaceIcon category={place.category} size={30} />
        <span className="place-art-orbit" />
        <span className="place-art-ground" />
        <span className="place-art-dot" />
        {image && (
          /* biome-ignore lint/performance/noImgElement: The accepted Qloo-hosted thumbnail loads directly without a server-side proxy. */
          <img
            key={image}
            className="day-timeline-photo"
            src={image}
            alt=""
            width={89}
            height={106}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoadedUrl(image)}
            onError={() => setFailedUrl(image)}
          />
        )}
      </span>
      <span className="day-timeline-card-copy">
        <span className="day-timeline-category">
          {place.category === "food"
            ? "FOOD & GOOD COMPANY"
            : place.category === "culture"
              ? "A LITTLE CULTURE"
              : place.category === "cafe"
                ? "A SLOW MOMENT"
                : place.category === "outdoors"
                  ? "ROOM TO BREATHE"
                  : "A GOOD LITTLE FIND"}
        </span>
        <strong>{place.name}</strong>
        <span className="day-timeline-description">{place.description}</span>
        {stop.note && (
          <span className="visit-note-preview">
            <b>Your note</b> {stop.note}
          </span>
        )}
        <span className="day-timeline-card-meta">
          <span>{stop.durationMinutes} min</span>
          <span
            title={
              evidence
                ? `Qloo query ${evidence.queryId}; original rank ${evidence.rank}`
                : undefined
            }
          >
            <span id={sourceId}>
              {place.source === "qloo"
                ? evidence
                  ? "Selected around your taste"
                  : "From your Qloo recommendations"
                : place.source === "traveler"
                  ? "Added by you · pin unverified"
                  : "Fictional sample place"}
              {image && loadedUrl === image && <> · Image via Qloo</>}
            </span>
          </span>
          {stop.pinned && (
            <span>
              <Check size={11} /> Kept
            </span>
          )}
        </span>
        {warning && (
          <span className="visit-hours-badge" id={hoursId} title={warning.message}>
            <Clock3 size={14} aria-hidden="true" />
            {warning.kind === "closed" ? "Listed closed for this weekday" : "Check listed hours"}
          </span>
        )}
      </span>
      <ArrowUpRight size={18} className="day-timeline-card-arrow" />
    </button>
  );
}
