"use client";

import {
  availableVisitTimes,
  destinationForDay,
  getTripDestination,
  type Place,
  type Trip,
  type TripOperation,
  type TripStop,
  validOwnPlace,
} from "@tastip/domain";
import { useEffect, useRef, useState } from "react";
import { DayNotesForm } from "./day-notes-form";
import { IdeaPreview } from "./idea-preview";
import { PlaceIcon } from "./journey";
import { OwnPlaceDialog } from "./own-place-dialog";

export function IdeasPanel({
  trip,
  dayId,
  onCommand,
  onSelectVisit,
  onOpenDay,
  initialSchedule,
}: {
  trip: Trip;
  dayId: string;
  onCommand: (ops: TripOperation[], version?: number, tripId?: string) => boolean | undefined;
  onSelectVisit: (id: string) => void;
  onOpenDay: () => void;
  initialSchedule?: Pick<TripStop, "startTime" | "durationMinutes">;
}) {
  const day = trip.days.find((item) => item.id === dayId)!;
  const city = getTripDestination(trip, destinationForDay(trip, dayId));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, []);
  const scheduled = new Set(trip.stops.map((stop) => stop.placeId));
  const ideas = trip.places.filter(
    (place) =>
      !scheduled.has(place.id) &&
      (place.destinationId ?? trip.brief.destinationId) === destinationForDay(trip, dayId),
  );
  const [time, setTime] = useState(
    initialSchedule?.startTime ?? availableVisitTimes(trip, dayId)[0] ?? "",
  );
  const [manualTime, setManualTime] = useState(Boolean(initialSchedule));
  const [duration, setDuration] = useState(String(initialSchedule?.durationMinutes ?? 60));
  const minutes = Number(duration);
  const validDuration = Number.isInteger(minutes) && minutes >= 1 && minutes <= 720;
  const times = validDuration ? availableVisitTimes(trip, dayId, minutes) : [];
  const [addedId, setAddedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const added = trip.stops.find((stop) => stop.id === addedId);
  const addedPlace = trip.places.find((place) => place.id === added?.placeId);
  const addedButton = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Place["source"] | "all">("all");
  const [category, setCategory] = useState<Place["category"] | "all">("all");
  const search = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const normalize = (text: string) =>
    text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
  const normalizedQuery = normalize(query.trim());
  const visibleIdeas = ideas.filter(
    (place) =>
      (source === "all" || place.source === source) &&
      (category === "all" || place.category === category) &&
      normalize(`${place.name} ${place.category} ${place.description}`).includes(normalizedQuery),
  );
  const filtered = Boolean(query.trim()) || source !== "all" || category !== "all";
  function resetFilters() {
    setQuery("");
    setSource("all");
    setCategory("all");
  }
  useEffect(() => {
    if (!manualTime && validDuration) setTime(availableVisitTimes(trip, dayId, minutes)[0] ?? "");
  }, [trip, dayId, manualTime, validDuration, minutes]);

  function addIdea(placeId: string) {
    if (!time || !validDuration) return;
    const id = crypto.randomUUID();
    if (
      onCommand(
        [
          {
            type: "add-stop",
            stop: {
              id,
              placeId,
              dayId,
              startTime: time,
              durationMinutes: minutes,
              pinned: false,
              timeLocked: false,
            },
          },
        ],
        trip.version,
        trip.id,
      )
    ) {
      setAddedId(id);
      setManualTime(false);
      setError(null);
      requestAnimationFrame(() => addedButton.current?.focus());
    } else {
      setError(
        "This idea could not be scheduled. Your time and duration are still here; check the plan message and try another space.",
      );
    }
  }
  return (
    <section className="ideas-panel" aria-label="Ideas and day notes">
      <header>
        <p className="eyebrow">ROOM FOR A DETOUR</p>
        <h2 ref={heading} tabIndex={-1}>
          Keep an idea. Make it a moment.
        </h2>
        <p>
          Ideas stay outside your schedule until you add them. Notes never turn into venue visits.
        </p>
      </header>
      <section className="idea-day-navigation" aria-label="Day for these ideas">
        <div>
          <strong>
            {day.label} · {city?.name ?? "Your city"}
          </strong>
          <small>
            {day.date ?? "Dates open"} · {city?.timeZone ?? "Local time"}
          </small>
          <p>Choose an idea below to schedule it on this day.</p>
        </div>
        <button type="button" className="button button-secondary" onClick={onOpenDay}>
          Open day timeline
        </button>
      </section>
      <OwnPlaceDialog trip={trip} dayId={dayId} onCommand={onCommand} onSaved={resetFilters} />
      <div className="idea-filters">
        <label className="idea-search">
          Find an idea
          <input
            ref={search}
            type="search"
            aria-label="Search place ideas"
            placeholder="Name or detail"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-describedby="ideas-filter-count"
          />
        </label>
        <label>
          Source
          <select
            aria-label="Idea source"
            value={source}
            onChange={(event) => setSource(event.target.value as typeof source)}
          >
            <option value="all">All sources</option>
            <option value="traveler">Added by you</option>
            <option value="qloo">Qloo recommendations</option>
            <option value="demo">Fictional samples</option>
          </select>
        </label>
        <label>
          Kind of place
          <select
            aria-label="Idea category"
            value={category}
            onChange={(event) => setCategory(event.target.value as typeof category)}
          >
            <option value="all">All kinds</option>
            <option value="cafe">Cafés</option>
            <option value="culture">Culture</option>
            <option value="food">Food</option>
            <option value="outdoors">Outdoors</option>
            <option value="shop">Shops</option>
          </select>
        </label>
      </div>
      <div className="idea-filter-summary">
        <p id="ideas-filter-count" role="status">
          Showing {visibleIdeas.length} of {ideas.length} ideas for{" "}
          {getTripDestination(trip, destinationForDay(trip, dayId))?.name ?? day.label}.
        </p>
        {filtered && (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              resetFilters();
              search.current?.focus();
            }}
          >
            Clear idea filters
          </button>
        )}
      </div>
      <section className="idea-schedule" aria-label="Schedule an idea">
        <div className="idea-schedule-fields">
          <label>
            Start time
            <input
              aria-label="Idea visit start time"
              type="time"
              required
              value={time}
              onChange={(event) => {
                setTime(event.target.value);
                setManualTime(true);
                setError(null);
              }}
            />
          </label>
          <label>
            Duration (minutes)
            <input
              aria-label="Idea visit duration"
              type="number"
              min={1}
              max={720}
              step={1}
              required
              value={duration}
              aria-invalid={!validDuration}
              onChange={(event) => {
                setDuration(event.target.value);
                setError(null);
              }}
            />
          </label>
        </div>
        {!validDuration && <p role="status">Choose a whole number from 1 to 720 minutes.</p>}
        {times.length > 0 && (
          <fieldset
            className="idea-schedule-times"
            aria-label="Draft spaces for this idea duration"
          >
            <legend>Try a space in {day.label}</legend>
            {times.map((slot) => (
              <button
                key={slot}
                type="button"
                aria-pressed={slot === time}
                onClick={() => {
                  setTime(slot);
                  setManualTime(true);
                  setError(null);
                }}
              >
                {slot}
              </button>
            ))}
          </fieldset>
        )}
        <p>
          These draft spaces respect current visits and entered travel times. Check opening hours
          and travel between places before you go. You can also enter a time.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {added && addedPlace && (
        <section className="idea-scheduled" aria-label="Last scheduled visit">
          <p role="status">
            {addedPlace.name} is on {trip.days.find((item) => item.id === added.dayId)?.label} at{" "}
            {added.startTime} for {added.durationMinutes}{" "}
            {added.durationMinutes === 1 ? "minute" : "minutes"}.
          </p>
          <button
            ref={addedButton}
            type="button"
            className="button button-secondary"
            data-stop-id={added.id}
            onClick={() => onSelectVisit(added.id)}
          >
            Open added visit
          </button>
        </section>
      )}
      <div className="idea-grid">
        {visibleIdeas.length ? (
          visibleIdeas.map((place) => (
            <article key={place.id}>
              <PlaceIcon category={place.category} />
              <span className="detail-category">
                {place.category} ·{" "}
                {place.source === "qloo"
                  ? `Qloo #${place.taste?.rank}`
                  : place.source === "traveler"
                    ? "Added by you · pin unverified"
                    : "Fictional sample"}
              </span>
              <h3>{place.name}</h3>
              <p>{place.description}</p>
              <button
                type="button"
                className="button button-quiet"
                aria-label={`Preview ${place.name}`}
                onClick={(event) => {
                  previewTrigger.current = event.currentTarget;
                  setPreviewId(place.id);
                }}
              >
                Preview place
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={!time || !validDuration}
                onClick={() => addIdea(place.id)}
              >
                Add to {day.label}
              </button>
              {validOwnPlace(place) && (
                <OwnPlaceDialog
                  trip={trip}
                  dayId={dayId}
                  place={place}
                  onCommand={onCommand}
                  onSaved={resetFilters}
                />
              )}
              <button
                type="button"
                className="button button-quiet"
                aria-label={`Remove idea: ${place.name}`}
                onClick={() => {
                  if (onCommand([{ type: "remove-place-idea", placeId: place.id }]))
                    requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
                }}
              >
                Remove idea
              </button>
            </article>
          ))
        ) : (
          <p className="ideas-empty">
            {ideas.length
              ? "No ideas match these filters. Try another name, source or kind of place."
              : "No unscheduled ideas in this city yet. Add a place you know, find recommendations, or remove a visit to keep it here for later."}
          </p>
        )}
      </div>
      <DayNotesForm key={`${trip.id}:${dayId}`} trip={trip} dayId={dayId} onCommand={onCommand} />
      <IdeaPreview
        place={trip.places.find((place) => place.id === previewId)}
        day={day}
        city={city}
        profile={trip.brief.tasteProfile}
        onClose={() => {
          setPreviewId(null);
          requestAnimationFrame(() => {
            if (previewTrigger.current?.isConnected)
              previewTrigger.current.focus({ preventScroll: true });
            else search.current?.focus({ preventScroll: true });
          });
        }}
      />
    </section>
  );
}
