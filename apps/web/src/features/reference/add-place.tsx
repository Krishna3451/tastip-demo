"use client";

import {
  applyTripCommand,
  availableVisitTimes,
  destinationForDay,
  type Place,
  type Trip,
  type TripOperation,
  validOwnPlace,
} from "@tastip/domain";
import { useState } from "react";
import { placeSourceLabel } from "../planner/lib/place-labels";
import type { Command } from "./itinerary";
import { Modal } from "./primitives";

export function AddPlace({
  trip,
  place,
  preferredDayId,
  onlyDayId,
  onCommand,
  onAdded,
  onClose,
  onRoute,
}: {
  trip: Trip;
  place: Place;
  preferredDayId: string;
  onlyDayId?: string;
  onCommand: Command;
  onAdded: (dayId: string, stopId: string) => void;
  onClose: () => void;
  onRoute: () => void;
}) {
  const city = place.destinationId ?? trip.brief.destinationId;
  const days = trip.days.filter(
    (day) => destinationForDay(trip, day.id) === city && (!onlyDayId || day.id === onlyDayId),
  );
  const initialDay = days.find((day) => day.id === preferredDayId) ?? days[0];
  const [dayId, setDayId] = useState(initialDay?.id ?? "");
  const [time, setTime] = useState(
    initialDay ? (availableVisitTimes(trip, initialDay.id)[0] ?? "") : "",
  );
  const [duration, setDuration] = useState("60");
  const [version, setVersion] = useState(trip.version);
  const [visitId] = useState(() => crypto.randomUUID());
  const [commandId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const stale = version !== trip.version;
  const minutes = Number(duration);
  const validDuration = Number.isInteger(minutes) && minutes >= 1 && minutes <= 720;
  const selectedDay = days.find((day) => day.id === dayId);
  const times = selectedDay && validDuration ? availableVisitTimes(trip, dayId, minutes) : [];
  return (
    <Modal
      title="Add place to trip"
      onClose={onClose}
      className="mt-tools-dialog mt-add-place-dialog"
    >
      <h2>{place.name}</h2>
      <p className="mt-muted">
        {placeSourceLabel(place)}. Choose when to visit; times and availability still need checking.
      </p>
      {!days.length ? (
        <>
          <p role="status">
            This place belongs to a city outside your trip. Add that city before scheduling it.
          </p>
          <button type="button" className="mt-primary" onClick={onRoute}>
            Edit trip cities
          </button>
        </>
      ) : (
        <form
          aria-label="Schedule this place"
          onSubmit={(event) => {
            event.preventDefault();
            if (stale || !selectedDay || !validDuration) return;
            const operations: TripOperation[] = [];
            if (!trip.places.some((item) => item.id === place.id)) {
              if (place.source === "qloo")
                operations.push({ type: "add-candidates", destinationId: city, places: [place] });
              else if (validOwnPlace(place)) operations.push({ type: "set-own-place", place });
              else {
                setError("Fictional samples can only be scheduled within their own sample trip.");
                return;
              }
            }
            operations.push({
              type: "add-stop",
              stop: {
                id: visitId,
                placeId: place.id,
                dayId,
                startTime: time,
                durationMinutes: minutes,
                pinned: false,
                timeLocked: false,
                ...(place.source === "qloo" && place.taste
                  ? { selection: { ...place.taste } }
                  : {}),
              },
            });
            const preview = applyTripCommand(trip, {
              id: commandId,
              baseVersion: version,
              operations,
            });
            if (!preview.ok) {
              setError(preview.error.message);
              return;
            }
            if (!onCommand(operations, version, trip.id, commandId)) {
              setError(
                "Your plan changed before this visit could be added. Your choices are still here; review the latest plan and try again.",
              );
              return;
            }
            onAdded(dayId, visitId);
          }}
        >
          <label>
            Day
            <select
              aria-label="Place visit day"
              value={dayId}
              onChange={(event) => {
                setDayId(event.target.value);
                setError("");
              }}
            >
              {!selectedDay && (
                <option value={dayId} disabled>
                  Choose an available day
                </option>
              )}
              {days.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.label}
                  {day.date ? ` · ${day.date}` : " · Dates open"}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-place-time-fields">
            <label>
              Start time
              <input
                type="time"
                aria-label="Place visit start time"
                required
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  setError("");
                }}
              />
            </label>
            <label>
              Duration (minutes)
              <input
                type="number"
                aria-label="Place visit duration"
                required
                min={1}
                max={720}
                value={duration}
                onChange={(event) => {
                  setDuration(event.target.value);
                  setError("");
                }}
              />
            </label>
          </div>
          {times.length > 0 && (
            <fieldset className="idea-schedule-times" aria-label="Available draft spaces">
              <legend>Spaces in your current draft</legend>
              {times.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  aria-pressed={time === slot}
                  onClick={() => {
                    setTime(slot);
                    setError("");
                  }}
                >
                  {slot}
                </button>
              ))}
            </fieldset>
          )}
          {stale && (
            <p role="status">Your plan changed. Review the latest plan before adding this visit.</p>
          )}
          {error && (
            <p className="mt-error" role="alert">
              {error}
            </p>
          )}
          <div className="mt-traveler-actions">
            <button
              type="submit"
              className="mt-primary"
              disabled={stale || !validDuration || !selectedDay}
            >
              Add visit
            </button>
            {stale && (
              <button
                type="button"
                className="mt-pill outlined"
                onClick={() => {
                  setVersion(trip.version);
                  setError("");
                }}
              >
                Review latest plan
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
