"use client";

import {
  destinationForDay,
  formatTime,
  getTripDestination,
  listedHoursWarning,
  type Trip,
  type TripOperation,
  type TripStop,
  timeMinutes,
  validOwnPlace,
} from "@tastip/domain";
import { ArrowRight, LockKeyhole, Pin, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OwnPlaceDialog } from "./own-place-dialog";
import { PlaceEvidence, PlaceFacts, PlacePhoto } from "./place-information";
import { RepeatVisit } from "./repeat-visit";
import { VisitNote } from "./visit-note";
import { VisitSchedule } from "./visit-schedule";

export function StopDetail({
  trip,
  stop,
  onClose,
  onCommand,
  onSelectVisit,
}: {
  trip: Trip;
  stop: TripStop;
  onClose: () => void;
  onCommand: (ops: TripOperation[], version?: number, tripId?: string) => boolean | undefined;
  onSelectVisit: (id: string) => void;
}) {
  const place = trip.places.find((p) => p.id === stop.placeId);
  const evidence = stop.selection;
  const dayDate = trip.days.find((day) => day.id === stop.dayId)?.date ?? null;
  const visitDay = trip.days.find((day) => day.id === stop.dayId);
  const visitCity = getTripDestination(trip, destinationForDay(trip, stop.dayId));
  const [replacement, setReplacement] = useState(stop.placeId);
  const panel = useRef<HTMLElement>(null);
  const timeInput = useRef<HTMLInputElement>(null);
  const hoursWarning = place
    ? listedHoursWarning(place, dayDate, stop.startTime, stop.durationMinutes)
    : null;
  useEffect(() => {
    setReplacement(stop.placeId);
    panel.current?.focus({ preventScroll: window.innerWidth > 620 });
  }, [stop.placeId]);
  if (!place) return null;
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className="stop-detail"
      aria-label={`${place.name} visit details`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="detail-toolbar">
        <span className="eyebrow">A CLOSER LOOK</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Close visit details"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <PlacePhoto key={place.id} place={place} />
      <span className="detail-category">
        {place.category} · {stop.durationMinutes} minute visit
      </span>
      <section className="detail-visit-context" aria-label="This visit’s day and time">
        <strong>
          {visitDay?.label}
          {dayDate ? ` · ${dayDate}` : " · Dates open"}
        </strong>
        <span>
          {stop.startTime}–{formatTime(timeMinutes(stop.startTime) + stop.durationMinutes)} ·{" "}
          {visitCity?.name}
        </span>
        <small>{visitCity?.timeZone ?? "Local time"}</small>
      </section>
      <h2>{place.name}</h2>
      {hoursWarning && (
        <section className="visit-hours-review" aria-label="Listed hours review">
          <p role="status">{hoursWarning.message}</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              timeInput.current?.focus();
              timeInput.current?.scrollIntoView({ block: "center" });
            }}
          >
            Review visit time
          </button>
        </section>
      )}
      <p className="detail-description">{place.description}</p>
      <PlaceEvidence place={place} evidence={evidence} profile={trip.brief.tasteProfile} />
      {validOwnPlace(place) && (
        <OwnPlaceDialog trip={trip} dayId={stop.dayId} place={place} onCommand={onCommand} />
      )}
      {place.source !== "traveler" && (
        <section className="taste-feedback" aria-label="Recommendation feedback">
          <strong>Does this feel like you?</strong>
          <div>
            <button
              type="button"
              aria-pressed={stop.feedback === "more"}
              onClick={() =>
                onCommand([
                  {
                    type: "rate-stop",
                    stopId: stop.id,
                    feedback: stop.feedback === "more" ? null : "more",
                  },
                ])
              }
            >
              <ThumbsUp size={15} />
              More like this
            </button>
            <button
              type="button"
              aria-pressed={stop.feedback === "less"}
              onClick={() =>
                onCommand([
                  {
                    type: "rate-stop",
                    stopId: stop.id,
                    feedback: stop.feedback === "less" ? null : "less",
                  },
                ])
              }
            >
              <ThumbsDown size={15} />
              Less like this
            </button>
          </div>
          <p>
            {stop.feedback
              ? place.source === "qloo"
                ? "Saved to this draft. Use Rebuild with taste to apply feedback to a fresh Qloo search."
                : "Saved to this sample draft. Live refinement is available on Qloo trips."
              : "Your feedback stays editable. We won’t change your plan until you choose to refine it."}
          </p>
        </section>
      )}
      <PlaceFacts place={place} date={dayDate} />
      <VisitSchedule trip={trip} stop={stop} timeInput={timeInput} onCommand={onCommand} />
      <RepeatVisit
        key={`${stop.id}:${place.id}`}
        trip={trip}
        stop={stop}
        onCommand={onCommand}
        onSelectVisit={onSelectVisit}
      />
      <VisitNote
        key={stop.id}
        tripId={trip.id}
        version={trip.version}
        stopId={stop.id}
        placeId={stop.placeId}
        note={stop.note}
        onCommand={onCommand}
      />
      <form
        className="replace-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCommand([{ type: "replace-stop", stopId: stop.id, placeId: replacement }]);
        }}
      >
        <label>
          Try another place
          <select
            aria-label="Replacement place"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          >
            {trip.places
              .filter(
                (candidate) =>
                  (candidate.destinationId ?? trip.brief.destinationId) ===
                  destinationForDay(trip, stop.dayId),
              )
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
        </label>
        <button
          type="submit"
          className="button button-secondary"
          disabled={replacement === stop.placeId}
        >
          Replace place
          <ArrowRight size={15} />
        </button>
        {stop.note && replacement !== stop.placeId && (
          <p className="replacement-note-hint">
            Replacing this place clears its private visit note. Undo brings it back.
          </p>
        )}
      </form>
      <div className="detail-actions">
        <button
          type="button"
          aria-pressed={stop.pinned}
          className={`detail-action ${stop.pinned ? "is-set" : ""}`}
          onClick={() => onCommand([{ type: "pin-stop", stopId: stop.id, pinned: !stop.pinned }])}
        >
          <Pin size={17} />
          {stop.pinned ? "Place pinned" : "Keep this place"}
        </button>
        <button
          type="button"
          aria-pressed={stop.timeLocked}
          className={`detail-action ${stop.timeLocked ? "is-set" : ""}`}
          onClick={() =>
            onCommand([{ type: "lock-time", stopId: stop.id, timeLocked: !stop.timeLocked }])
          }
        >
          <LockKeyhole size={17} />
          {stop.timeLocked ? "Time fixed" : "Fix the time"}
        </button>
        <button
          type="button"
          className="detail-action remove-action"
          onClick={() => onCommand([{ type: "remove-stop", stopId: stop.id }])}
        >
          <Trash2 size={17} />
          Remove from day
        </button>
      </div>
      <p className="detail-footnote">
        Draft visit · No reservation made
        <br />
        Dates, travel times, and availability are unverified.
      </p>
    </aside>
  );
}
