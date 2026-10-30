"use client";

import {
  applyTripCommand,
  destinationForDay,
  type Trip,
  type TripOperation,
  type TripStop,
} from "@tastip/domain";
import { ArrowRight } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";

function scheduleFields(version: number, stop: TripStop) {
  return {
    version,
    placeId: stop.placeId,
    dayId: stop.dayId,
    time: stop.startTime,
    duration: String(stop.durationMinutes),
  };
}

export function VisitSchedule({
  trip,
  stop,
  timeInput,
  onCommand,
}: {
  trip: Trip;
  stop: TripStop;
  timeInput: RefObject<HTMLInputElement | null>;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
}) {
  const [baseline, setBaseline] = useState(() => scheduleFields(trip.version, stop));
  const [day, setDay] = useState(baseline.dayId);
  const [time, setTime] = useState(baseline.time);
  const [duration, setDuration] = useState(baseline.duration);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const dirty = day !== baseline.dayId || time !== baseline.time || duration !== baseline.duration;
  const stale = baseline.version !== trip.version;
  const accepted = scheduleFields(trip.version, stop);
  const unchanged =
    accepted.placeId === baseline.placeId &&
    accepted.dayId === baseline.dayId &&
    accepted.time === baseline.time &&
    accepted.duration === baseline.duration;

  useEffect(() => {
    if (baseline.version === trip.version) return;
    setError(null);
    setSaved(false);
    if (dirty) return;
    const latest = scheduleFields(trip.version, stop);
    setBaseline(latest);
    setDay(latest.dayId);
    setTime(latest.time);
    setDuration(latest.duration);
    setError(null);
    setSaved(false);
  }, [trip.version, stop, dirty, baseline.version]);

  function resetFeedback() {
    setError(null);
    setSaved(false);
  }
  function reload() {
    setBaseline(accepted);
    setDay(accepted.dayId);
    setTime(accepted.time);
    setDuration(accepted.duration);
    resetFeedback();
    timeInput.current?.focus();
  }
  function reject(message: string) {
    setError(message);
    setSaved(false);
    requestAnimationFrame(() => errorMessage.current?.focus());
  }

  return (
    <form
      className="visit-edit-form"
      aria-label="Visit schedule"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || stale) return;
        const operations: TripOperation[] = [
          { type: "move-stop", stopId: stop.id, dayId: day, startTime: time },
          { type: "set-duration", stopId: stop.id, durationMinutes: Number(duration) },
        ];
        // This pure preview exposes the same policy error inside the active editor.
        const preview = applyTripCommand(trip, {
          id: crypto.randomUUID(),
          baseVersion: baseline.version,
          operations,
        });
        if (!preview.ok) {
          reject(preview.error.message);
          return;
        }
        const nextStop = preview.trip.stops.find((item) => item.id === stop.id);
        if (!nextStop) {
          reject("This visit is no longer available. Reopen the latest plan before editing it.");
          return;
        }
        if (!onCommand(operations, baseline.version, trip.id)) {
          reject(
            "This visit could not be updated. Your draft is still here; reload the latest visit and try again.",
          );
          return;
        }
        const latest = scheduleFields(preview.trip.version, nextStop);
        setBaseline(latest);
        setDay(latest.dayId);
        setTime(latest.time);
        setDuration(latest.duration);
        setError(null);
        setSaved(true);
      }}
    >
      <h3>Plan this visit</h3>
      <div className="field-pair">
        <label>
          Day
          <select
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
              resetFeedback();
            }}
          >
            {trip.days
              .filter(
                (item) => destinationForDay(trip, item.id) === destinationForDay(trip, stop.dayId),
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Start time
          <input
            ref={timeInput}
            aria-label="Visit start time"
            type="time"
            value={time}
            onChange={(event) => {
              setTime(event.target.value);
              resetFeedback();
            }}
            required
          />
        </label>
      </div>
      <label>
        Visit duration (minutes)
        <input
          aria-label="Visit duration"
          type="number"
          min={1}
          max={720}
          value={duration}
          required
          onChange={(event) => {
            setDuration(event.target.value);
            resetFeedback();
          }}
        />
      </label>
      {stale && dirty && (
        <div className="visit-schedule-stale" role="status">
          <p>
            Your plan changed. Your visit draft is still here.{" "}
            {unchanged
              ? "Review it with the latest plan before updating."
              : "This visit’s place or schedule also changed. Reload the accepted visit before editing it."}
          </p>
          {unchanged && (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setBaseline(accepted);
                resetFeedback();
                timeInput.current?.focus();
              }}
            >
              Keep visit draft with latest plan
            </button>
          )}
          <button type="button" className="button button-quiet" onClick={reload}>
            Reload latest visit time
          </button>
        </div>
      )}
      {error && (
        <p ref={errorMessage} className="inline-error" role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      {saved && (
        <p className="visit-schedule-feedback" role="status">
          Visit updated.
        </p>
      )}
      <button className="button button-secondary" type="submit" disabled={!dirty || stale}>
        Update visit
        <ArrowRight size={16} />
      </button>
      {dirty && !stale && (
        <button type="button" className="button button-quiet" onClick={reload}>
          Reset visit draft
        </button>
      )}
    </form>
  );
}
