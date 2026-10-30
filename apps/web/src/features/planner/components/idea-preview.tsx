"use client";

import type { Destination, Place, Trip } from "@tastip/domain";
import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { PlaceEvidence, PlaceFacts, PlacePhoto } from "./place-information";

export function IdeaPreview({
  place,
  day,
  city,
  profile,
  onClose,
}: {
  place?: Place;
  day: Trip["days"][number];
  city?: Destination;
  profile?: Trip["brief"]["tasteProfile"];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const opened = Boolean(place);
  useEffect(() => {
    if (opened) {
      dialog.current?.showModal();
      heading.current?.focus({ preventScroll: true });
    } else dialog.current?.close();
  }, [opened]);
  return (
    <dialog
      ref={dialog}
      className="day-editor-dialog idea-preview-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <header>
        <div>
          <p className="eyebrow">A POSSIBILITY FOR YOUR DAY</p>
          <h2 ref={heading} id={titleId} tabIndex={-1}>
            {place?.name ?? "Place preview"}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close place preview"
          onClick={() => dialog.current?.close()}
        >
          <X size={18} />
        </button>
      </header>
      {place && (
        <>
          <section className="detail-visit-context" aria-label="Preview day context">
            <strong>
              An idea for {day.label} · {city?.name ?? "Your city"}
            </strong>
            <span>
              {day.date ?? "Dates open"} · {city?.timeZone ?? "Local time"}
            </span>
          </section>
          <PlacePhoto key={place.id} place={place} />
          <span className="detail-category">{place.category}</span>
          <p className="detail-description">{place.description}</p>
          <PlaceEvidence place={place} evidence={place.taste} profile={profile} />
          <PlaceFacts place={place} date={day.date} />
          <p className="idea-preview-next">
            Choose a time and use Add to {day.label} in Ideas to schedule this place.
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => dialog.current?.close()}
          >
            Back to ideas
          </button>
        </>
      )}
    </dialog>
  );
}
