"use client";

import { applyTripCommand, dateAt, type Trip } from "@tastip/domain";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { type DragEvent, useMemo, useRef, useState } from "react";
import { tripTitle } from "../planner/lib/travel-pack";
import type { Command } from "./itinerary";
import { EmptyState, useSheetDismissal } from "./primitives";

const VISIT_DRAG_TYPE = "application/x-tastip-visit";
const HOURS = Array.from({ length: 24 }, (_, hour) => ({ id: `hour-${hour}`, hour }));

export function CalendarWorkspace({
  trips,
  onOpen,
  initialDate,
  embedded = false,
  onCommand,
}: {
  trips: Trip[];
  onOpen: (trip: Trip, dayId?: string, stopId?: string) => void;
  initialDate?: string;
  embedded?: boolean;
  onCommand?: Command;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [dropFeedback, setDropFeedback] = useState({ error: "", message: "" });
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const [anchor, setAnchor] = useState(() => {
    if (initialDate) return initialDate;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [view, setView] = useState(embedded ? "Day" : "Week");
  const date = new Date(`${anchor}T12:00:00Z`);
  const offset = view === "Week" ? -date.getUTCDay() : view === "Month" ? 1 - date.getUTCDate() : 0;
  const first = dateAt(anchor, offset);
  const count =
    view === "Week"
      ? 7
      : view === "Month"
        ? new Date(date.getUTCFullYear(), date.getUTCMonth() + 1, 0).getUTCDate()
        : 1;
  const days = useMemo(
    () => Array.from({ length: count }, (_, index) => dateAt(first, index)),
    [first, count],
  );
  function move(direction: number) {
    if (view === "Month") {
      const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + direction, 1));
      setAnchor(next.toISOString().slice(0, 10));
    } else setAnchor(dateAt(anchor, direction * (view === "Week" ? 7 : 1)));
  }
  function dropVisit(event: DragEvent<HTMLElement>, targetDate: string) {
    if (!onCommand || !event.dataTransfer.types.includes(VISIT_DRAG_TYPE)) return;
    event.preventDefault();
    setHoverDay(null);
    setDropFeedback({ error: "", message: "" });
    let value: unknown;
    try {
      value = JSON.parse(event.dataTransfer.getData(VISIT_DRAG_TYPE));
    } catch {
      return;
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("tripId" in value) ||
      !("stopId" in value) ||
      !("version" in value)
    )
      return;
    const trip = trips.find((trip) => trip.id === value.tripId);
    const stop = trip?.stops.find((stop) => stop.id === value.stopId);
    if (!trip || !stop || trip.version !== value.version) {
      setDropFeedback({
        error: "Your plan changed while dragging. Open the latest visit before moving it.",
        message: "",
      });
      return;
    }
    const day = trip.days.find((day) => day.date === targetDate);
    if (!day) {
      setDropFeedback({
        error: "Choose a day already in this trip, or change the trip dates first.",
        message: "",
      });
      return;
    }
    const offset = Math.max(0, event.clientY - event.currentTarget.getBoundingClientRect().top);
    const minutes = Math.min(1425, Math.round((offset / 46) * 4) * 15);
    const startTime = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    if (day.id === stop.dayId && startTime === stop.startTime) return;
    const operations = [{ type: "move-stop" as const, stopId: stop.id, dayId: day.id, startTime }];
    const commandId = crypto.randomUUID();
    const preview = applyTripCommand(trip, {
      id: commandId,
      baseVersion: trip.version,
      operations,
    });
    if (!preview.ok) {
      setDropFeedback({ error: preview.error.message, message: "" });
      return;
    }
    if (!onCommand(operations, trip.version, trip.id, commandId)) {
      setDropFeedback({
        error: "This move was not accepted. Open the latest visit and review its schedule.",
        message: "",
      });
      return;
    }
    setDropFeedback({
      error: "",
      message: `Visit moved to ${day.label} at ${startTime}. Undo can restore its previous time.`,
    });
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-calendar-stop-id="${CSS.escape(stop.id)}"]`)
        ?.focus({ preventScroll: true }),
    );
  }
  return (
    <div
      ref={root}
      className={embedded ? "mt-embedded-calendar" : "mt-page-content mt-global-calendar"}
    >
      {!embedded && (
        <>
          <div className="mt-page-heading">
            <h1>Your calendar</h1>
          </div>
          <nav className="mt-tabs" aria-label="Trips views">
            <Link href="/trips">Trips</Link>
            <Link className="selected" href="/calendar">
              Calendar
            </Link>
            <Link href="/receipts">Receipts</Link>
          </nav>
        </>
      )}
      <div className="mt-calendar-controls">
        <button
          type="button"
          className="mt-icon"
          aria-label="Previous period"
          onClick={() => move(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <label>
          <span>
            {view === "Month"
              ? date.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })
              : `${days[0]}${days.length > 1 ? ` – ${days.at(-1)}` : ""}`}
          </span>
          <input
            type="date"
            aria-label="Choose date"
            value={anchor}
            onChange={(event) => {
              if (event.target.value) setAnchor(event.target.value);
            }}
          />
        </label>
        <button type="button" className="mt-icon" aria-label="Next period" onClick={() => move(1)}>
          <ChevronRight size={18} />
        </button>
        <select
          aria-label="Calendar view"
          value={view}
          onChange={(event) => setView(event.target.value)}
        >
          <option>Day</option>
          <option>Week</option>
          <option>Month</option>
        </select>
      </div>
      {onCommand && view !== "Month" && (
        <p className="mt-calendar-drag-hint">
          Drag a visit to another time, or open it to edit its schedule.
        </p>
      )}
      {dropFeedback.error && (
        <p className="mt-calendar-drag-feedback mt-error" role="alert">
          {dropFeedback.error}
        </p>
      )}
      {dropFeedback.message && (
        <p className="mt-calendar-drag-feedback" role="status">
          {dropFeedback.message}
        </p>
      )}
      <div className="mt-calendar-scroll">
        {view === "Month" ? (
          <div className="mt-calendar-month-view">
            {days.map((day) => (
              <div key={day}>
                <strong>{Number(day.slice(-2))}</strong>
                {trips
                  .filter((trip) => trip.days.some((item) => item.date === day))
                  .map((trip) => (
                    <button
                      key={trip.id}
                      type="button"
                      onClick={() => onOpen(trip, trip.days.find((item) => item.date === day)?.id)}
                    >
                      {tripTitle(trip)}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        ) : (
          <div
            className="mt-week-calendar"
            style={{ gridTemplateColumns: `45px repeat(${count}, minmax(80px, 1fr))` }}
          >
            <div className="mt-time-gutter" />
            {days.map((day) => (
              <div className="mt-calendar-day-label" key={day}>
                {new Date(`${day}T12:00:00Z`).toLocaleDateString("en", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                })}
              </div>
            ))}
            <div className="mt-all-day-label">all-day</div>
            {days.map((day) => (
              <div className="mt-calendar-all-day" key={day}>
                {trips
                  .filter((trip) => trip.days.some((item) => item.date === day))
                  .map((trip) => (
                    <button
                      type="button"
                      key={trip.id}
                      onClick={() => onOpen(trip, trip.days.find((item) => item.date === day)?.id)}
                    >
                      {tripTitle(trip)}
                    </button>
                  ))}
              </div>
            ))}
            <div className="mt-time-column">
              {HOURS.map(({ id, hour }) => (
                <span key={id}>
                  {hour === 0
                    ? "12am"
                    : hour < 12
                      ? `${hour}am`
                      : hour === 12
                        ? "12pm"
                        : `${hour - 12}pm`}
                </span>
              ))}
            </div>
            {days.map((day) => (
              <section
                className="mt-time-day"
                aria-label={`Scheduled visits for ${day}`}
                key={day}
                data-calendar-date={day}
                data-drag-over={hoverDay === day}
                onDragOver={(event) => {
                  if (!onCommand || !event.dataTransfer.types.includes(VISIT_DRAG_TYPE)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setHoverDay(day);
                }}
                onDrop={(event) => dropVisit(event, day)}
              >
                {trips.flatMap((trip) =>
                  trip.days
                    .filter((item) => item.date === day)
                    .flatMap((item) =>
                      trip.stops
                        .filter((stop) => stop.dayId === item.id)
                        .map((stop) => (
                          <button
                            type="button"
                            className="mt-calendar-event"
                            key={`${trip.id}:${stop.id}`}
                            data-calendar-stop-id={stop.id}
                            draggable={Boolean(onCommand)}
                            onDragStart={(event) => {
                              if (!onCommand) return;
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                VISIT_DRAG_TYPE,
                                JSON.stringify({
                                  tripId: trip.id,
                                  stopId: stop.id,
                                  version: trip.version,
                                }),
                              );
                              setDropFeedback({ error: "", message: "" });
                            }}
                            onDragEnd={() => setHoverDay(null)}
                            onClick={() => onOpen(trip, item.id, stop.id)}
                            aria-label={`Open ${trip.places.find((place) => place.id === stop.placeId)?.name ?? "visit"} at ${stop.startTime}`}
                            style={{
                              top: `${((Number(stop.startTime.slice(0, 2)) * 60 + Number(stop.startTime.slice(3))) / 60) * 46}px`,
                              height: `${Math.max(22, (stop.durationMinutes / 60) * 46)}px`,
                            }}
                          >
                            <strong>
                              {trip.places.find((place) => place.id === stop.placeId)?.name ??
                                "Visit"}
                            </strong>
                            <small>{stop.startTime}</small>
                          </button>
                        )),
                    ),
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TripCalendar({
  trip,
  dayId,
  onOpen,
  onClose,
  onDates,
  onCommand,
}: {
  trip: Trip;
  dayId: string;
  onOpen: (trip: Trip, dayId?: string, stopId?: string) => void;
  onClose: () => void;
  onDates: () => void;
  onCommand: Command;
}) {
  const sheet = useSheetDismissal(onClose);
  const date = trip.days.find((day) => day.id === dayId)?.date ?? trip.days[0]?.date;
  return (
    <section ref={sheet} className="mt-itinerary-sheet mt-trip-calendar" aria-label="Trip calendar">
      <div className="mt-sheet-handle" />
      <div className="mt-sheet-top">
        <h1>Calendar</h1>
        <button type="button" className="mt-icon" aria-label="Close calendar" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {date ? (
        <CalendarWorkspace
          trips={[trip]}
          initialDate={date}
          embedded
          onOpen={onOpen}
          onCommand={onCommand}
        />
      ) : (
        <EmptyState
          icon={<CalendarDays size={32} />}
          title="Your dates are still open"
          description="Your itinerary keeps its day order. Choose trip dates to place visits on the calendar."
          action={
            <button type="button" className="mt-primary" onClick={onDates}>
              Choose trip dates
            </button>
          }
        />
      )}
    </section>
  );
}
