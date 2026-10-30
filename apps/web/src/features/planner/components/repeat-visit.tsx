"use client";

import {
  applyTripCommand,
  availableVisitTimes,
  destinationForDay,
  type Trip,
  type TripOperation,
  type TripStop,
} from "@tastip/domain";
import { CalendarPlus } from "lucide-react";
import { useRef, useState } from "react";

export function RepeatVisit({
  trip,
  stop,
  onCommand,
  onSelectVisit,
}: {
  trip: Trip;
  stop: TripStop;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
  onSelectVisit: (id: string) => void;
}) {
  const place = trip.places.find((item) => item.id === stop.placeId)!;
  const days = trip.days.filter(
    (day) => destinationForDay(trip, day.id) === (place.destinationId ?? trip.brief.destinationId),
  );
  const [editing, setEditing] = useState(false);
  const [dayId, setDayId] = useState(stop.dayId);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [baseVersion, setBaseVersion] = useState(trip.version);
  const [visitId, setVisitId] = useState("");
  const [addedId, setAddedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const daySelect = useRef<HTMLSelectElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const added = trip.stops.find((item) => item.id === addedId);
  const times = availableVisitTimes(trip, dayId, duration);
  const stale = baseVersion !== trip.version;
  const dayAvailable = days.some((day) => day.id === dayId);
  function finish() {
    setEditing(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }
  function prepareVisit() {
    const nextDuration = Math.min(stop.durationMinutes, 720);
    const currentIndex = trip.days.findIndex((day) => day.id === stop.dayId);
    const nextDay =
      days.find(
        (day) =>
          trip.days.indexOf(day) > currentIndex &&
          availableVisitTimes(trip, day.id, nextDuration).length,
      ) ??
      days.find((day) => availableVisitTimes(trip, day.id, nextDuration).length) ??
      days[0]!;
    setDayId(nextDay.id);
    setTime(availableVisitTimes(trip, nextDay.id, nextDuration)[0] ?? "");
    setDuration(nextDuration);
    setBaseVersion(trip.version);
    setVisitId(crypto.randomUUID());
    setError(null);
    setAddedId(null);
    setEditing(true);
    requestAnimationFrame(() => daySelect.current?.focus());
  }
  function reject(message: string) {
    setError(message);
    requestAnimationFrame(() => errorMessage.current?.focus());
  }
  return (
    <section className="repeat-visit" aria-label="Plan another visit">
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (stale) return;
            const evidence = place.source === "qloo" ? (stop.selection ?? place.taste) : undefined;
            const operations: TripOperation[] = [
              {
                type: "add-stop",
                stop: {
                  id: visitId,
                  placeId: place.id,
                  dayId,
                  startTime: time,
                  durationMinutes: duration,
                  pinned: false,
                  timeLocked: false,
                  ...(evidence ? { selection: structuredClone(evidence) } : {}),
                },
              },
            ];
            const preview = applyTripCommand(trip, {
              id: crypto.randomUUID(),
              baseVersion,
              operations,
            });
            if (!preview.ok) {
              reject(preview.error.message);
              return;
            }
            if (onCommand(operations, baseVersion, trip.id)) {
              setAddedId(visitId);
              setError(null);
              finish();
            } else
              reject(
                "This visit could not be added. Your choices are still here; review the latest plan before trying again.",
              );
          }}
        >
          <h3>A reason to return.</h3>
          <p>
            Schedule {place.name} again. Your original visit stays in place; this visit starts with
            its own note and settings.
          </p>
          <div className="field-pair">
            <label>
              Day
              <select
                ref={daySelect}
                aria-label="Another visit day"
                required
                value={dayId}
                onChange={(event) => {
                  setDayId(event.target.value);
                  setTime(availableVisitTimes(trip, event.target.value, duration)[0] ?? "");
                  setError(null);
                }}
              >
                {!dayAvailable && (
                  <option value={dayId} disabled>
                    Day no longer available
                  </option>
                )}
                {days.map((day) => (
                  <option key={day.id} value={day.id}>
                    {day.label}
                    {day.date ? ` · ${day.date}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start time
              <input
                aria-label="Another visit start time"
                type="time"
                required
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  setError(null);
                }}
              />
            </label>
          </div>
          <label>
            Duration (minutes)
            <input
              aria-label="Another visit duration"
              type="number"
              min={1}
              max={720}
              required
              value={duration}
              onChange={(event) => {
                setDuration(Number(event.target.value));
                setError(null);
              }}
            />
          </label>
          {times.length > 0 && (
            <fieldset className="repeat-visit-times" aria-label="Draft spaces in this day">
              {times.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  aria-pressed={slot === time}
                  onClick={() => {
                    setTime(slot);
                    setError(null);
                  }}
                >
                  {slot}
                </button>
              ))}
            </fieldset>
          )}
          <p>
            Draft spaces respect your current visits and entered travel times. Opening hours and
            travel between places still need checking.
          </p>
          {stale && (
            <div className="repeat-visit-stale" role="status">
              <p>
                Your plan changed. Your new visit choices are still here. Review them with the
                latest plan before adding the visit.
              </p>
              {!dayAvailable && (
                <p>This day is no longer available in this city. Reload a suggested visit.</p>
              )}
              <button
                type="button"
                className="button button-quiet"
                disabled={!dayAvailable}
                onClick={() => {
                  setBaseVersion(trip.version);
                  setError(null);
                  daySelect.current?.focus();
                }}
              >
                Keep these visit choices
              </button>
              <button type="button" className="button button-quiet" onClick={prepareVisit}>
                Reload suggested visit
              </button>
            </div>
          )}
          {error && !stale && (
            <p ref={errorMessage} className="inline-error" role="alert" tabIndex={-1}>
              {error}
            </p>
          )}
          <div className="repeat-visit-actions">
            <button type="submit" className="button button-secondary" disabled={stale}>
              Add another visit
            </button>
            <button type="button" className="button button-quiet" onClick={finish}>
              Cancel another visit
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            ref={trigger}
            type="button"
            className="button button-secondary"
            onClick={prepareVisit}
          >
            <CalendarPlus size={15} />
            Plan another visit
          </button>
          {added && (
            <div className="repeat-visit-result">
              <p role="status">
                Another visit is on {trip.days.find((day) => day.id === added.dayId)?.label} at{" "}
                {added.startTime}.
              </p>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => onSelectVisit(added.id)}
              >
                Open the new visit
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
