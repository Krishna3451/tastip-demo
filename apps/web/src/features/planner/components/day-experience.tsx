"use client";

import {
  destinationForDay,
  getDayStops,
  getTripDestination,
  type Trip,
  type TripOperation,
  type TripStop,
} from "@tastip/domain";
import { ArrowLeft, ArrowRight, ArrowUpRight, Clock3, MapPin, Plus, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPlaceLandmark } from "@/lib/place-visual";
import { tripSourceLabel } from "../lib/place-labels";
import { CloudCurtain } from "./cloud-curtain";
import { DayEditor } from "./day-editor";
import { DayLodging } from "./day-lodging";
import { DayTransfers } from "./day-transfers";
import { TimelineVisitCard } from "./timeline-visit-card";

const DayIslandScene = dynamic(
  () => import("@tastip/scene").then((module) => module.DayIslandScene),
  {
    ssr: false,
    loading: () => (
      <div className="day-scene-fallback" role="status">
        <span aria-hidden="true">✦</span>
        <p>Arranging your days…</p>
      </div>
    ),
  },
);

function formatTime(time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours >= 12 ? "PM" : "AM"}`;
}
function endTime(start: string, duration: number) {
  const [hours = 0, minutes = 0] = start.split(":").map(Number);
  const total = hours * 60 + minutes + duration;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function displayDate(date: string | null) {
  return date
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(
        new Date(`${date}T00:00:00Z`),
      )
    : "Dates open";
}

function visitDurationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60),
    remainder = minutes % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${remainder}m`;
}

export function DayExperience({
  trip,
  dayId,
  onDayChange,
  selectedStopId,
  onSelectStop,
  onFocusChange,
  onFindPlaces,
  onOpenIdeas,
  onCommand,
  onOpenStays,
  onOpenMap,
  focusOnEntry = false,
}: {
  trip: Trip;
  dayId: string;
  onDayChange: (id: string) => void;
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  onFocusChange?: (focused: boolean) => void;
  onFindPlaces?: () => void;
  onOpenIdeas?: (schedule?: Pick<TripStop, "startTime" | "durationMinutes">) => void;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
  onOpenStays: () => void;
  onOpenMap: () => void;
  focusOnEntry?: boolean;
}) {
  const [localFocused, setLocalFocused] = useState(focusOnEntry);
  // Planner owns focus when it supplies feedback. A mount default must not
  // overwrite a day selected by a URL handoff or another planning view.
  const focused = onFocusChange ? focusOnEntry : localFocused;
  const section = useRef<HTMLElement>(null);
  const timelineHeading = useRef<HTMLHeadingElement>(null);
  const overviewHeading = useRef<HTMLHeadingElement>(null);
  const revealTimeline = useCallback(
    () =>
      requestAnimationFrame(() => {
        timelineHeading.current?.focus({ preventScroll: true });
        section.current?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      }),
    [],
  );
  useEffect(() => {
    if (!focusOnEntry) return;
    setLocalFocused(true);
    const frame = revealTimeline();
    return () => cancelAnimationFrame(frame);
  }, [focusOnEntry, revealTimeline]);
  const days = useMemo(
    () =>
      trip.days.map((day, index) => {
        const visits = getDayStops(trip, day.id);
        const names = visits.slice(0, 2).flatMap((stop) => {
          const place = trip.places.find((item) => item.id === stop.placeId);
          return place ? [place.name] : [];
        });
        const visitedPlaces = visits.flatMap((stop) => {
          const place = trip.places.find((item) => item.id === stop.placeId);
          return place ? [place] : [];
        });
        const featured = visitedPlaces.find((place) => getPlaceLandmark(place)) ?? visitedPlaces[0];
        return {
          ...day,
          category: featured?.category,
          landmark: featured ? getPlaceLandmark(featured) : undefined,
          number: index + 1,
          city:
            getTripDestination(trip, destinationForDay(trip, day.id))?.name ?? "Your destination",
          visits: visits.length,
          visitMinutes: visits.reduce((total, stop) => total + stop.durationMinutes, 0),
          preview: `${names.join(" · ")}${visits.length > 2 ? ` · +${visits.length - 2} more` : ""}`,
        };
      }),
    [trip],
  );
  const activeDay = days.find((day) => day.id === dayId) ?? days[0];
  const activeIndex = days.findIndex((day) => day.id === activeDay?.id);
  const pageStart = Math.floor(Math.max(0, activeIndex) / 7) * 7;
  const visibleDays = days.slice(pageStart, pageStart + 7);
  const stops = activeDay ? getDayStops(trip, activeDay.id) : [];
  const city = getTripDestination(trip, destinationForDay(trip, activeDay?.id ?? dayId));
  const scheduled = new Set(trip.stops.map((stop) => stop.placeId));
  const ideaCount = trip.places.filter(
    (place) =>
      !scheduled.has(place.id) &&
      (place.destinationId ?? trip.brief.destinationId) ===
        destinationForDay(trip, activeDay?.id ?? dayId),
  ).length;
  const duration = stops.reduce((sum, stop) => sum + stop.durationMinutes, 0);
  function selectDay(id: string) {
    onDayChange(id);
    setLocalFocused(true);
    onFocusChange?.(true);
    revealTimeline();
  }
  function backToDays() {
    setLocalFocused(false);
    onFocusChange?.(false);
    requestAnimationFrame(() => {
      overviewHeading.current?.focus({ preventScroll: true });
      section.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    });
  }
  function navigateDays(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const choices = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-day-choice]"),
    );
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? choices.length - 1
          : Math.max(0, Math.min(choices.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
    choices[next]?.focus();
  }
  if (!activeDay) return null;
  return (
    <section
      ref={section}
      className={`day-experience ${focused ? "day-experience-focused" : ""}`}
      aria-label="Your floating day journey"
    >
      <CloudCurtain key={`${activeDay.id}:${focused ? "day" : "world"}`} />
      <div className="day-exp-topline">
        <span>
          <span className="day-exp-sparkle" aria-hidden="true">
            ✦
          </span>{" "}
          YOUR DAYS · FROM THE GROUND UP
        </span>
        <span>
          {trip.days.length} {trip.days.length === 1 ? "day" : "days"} · made for your pace
        </span>
      </div>
      <div className="day-exp-title">
        <div className={focused ? "sr-only" : undefined}>
          <p className="eyebrow">{focused ? "STEP INTO YOUR DAY" : "THE DAYS AHEAD"}</p>
          <h2 ref={overviewHeading} tabIndex={-1}>
            {focused ? "Your day, in detail." : "Every day, its own island."}
          </h2>
          <p>
            {focused
              ? "Your visits, timing and plans, together."
              : "Start below. Follow the trail upward. Choose an island to explore the day."}
          </p>
        </div>
        {focused && (
          <nav className="day-exp-day-nav" aria-label="Choose another day" onKeyDown={navigateDays}>
            <span className="day-exp-nav-label">YOUR DAYS</span>
            {visibleDays.map((day) => (
              <button
                key={day.id}
                type="button"
                data-day-choice
                aria-label={`Open ${day.label} schedule in ${day.city}`}
                aria-current={day.id === activeDay.id ? "step" : undefined}
                onClick={() => selectDay(day.id)}
              >
                <span>{String(day.number).padStart(2, "0")}</span>
                <span>{day.city}</span>
              </button>
            ))}
          </nav>
        )}
        {focused ? (
          <button type="button" className="day-exp-back" onClick={backToDays}>
            <ArrowLeft size={16} /> All days
          </button>
        ) : (
          <div className="day-exp-index" aria-hidden="true">
            {String(pageStart + 1).padStart(2, "0")} <span>—</span>{" "}
            {String(pageStart + visibleDays.length).padStart(2, "0")}
          </div>
        )}
      </div>
      <div className="day-exp-stage">
        <div className="day-exp-world">
          <div className="day-exp-ambient ambient-a" aria-hidden="true" />
          <div className="day-exp-ambient ambient-b" aria-hidden="true" />
          <DayIslandScene
            days={visibleDays}
            selectedDayId={activeDay.id}
            focused={focused}
            onSelect={selectDay}
          />
          {focused && (
            <div className="day-exp-focus-caption">
              <span>DAY {String(activeIndex + 1).padStart(2, "0")}</span>
              <strong>{activeDay.city}</strong>
              <small>{displayDate(activeDay.date)}</small>
              <p>
                {stops.length
                  ? `${stops.length} ${stops.length === 1 ? "visit" : "visits"}`
                  : "An open day"}
                {duration > 0 && <> · {visitDurationLabel(duration)}</>}
              </p>
            </div>
          )}
        </div>
        <div className="day-exp-timeline" aria-hidden={!focused} inert={!focused}>
          <div className="day-timeline-inner" key={activeDay.id}>
            <header className="day-timeline-header">
              <div>
                <p className="eyebrow">
                  {displayDate(activeDay.date)} · {city?.timeZone ?? "Local time"}
                </p>
                <h3 ref={timelineHeading} tabIndex={-1}>
                  {activeDay.label} <span>in {activeDay.city}</span>
                </h3>
              </div>
              <div className="day-timeline-tools">
                <button type="button" className="button button-secondary" onClick={onOpenMap}>
                  <MapPin size={14} /> Map this day
                </button>
                <DayEditor
                  key={`day-editor:${trip.id}:${activeDay.id}`}
                  trip={trip}
                  dayId={activeDay.id}
                  onCommand={onCommand}
                />
                <span className="day-timeline-status">
                  <span />{" "}
                  {tripSourceLabel(trip) === "Qloo draft"
                    ? "Taste-led draft"
                    : tripSourceLabel(trip)}
                </span>
              </div>
            </header>
            <div className="day-timeline-summary">
              <span>
                <MapPin size={14} /> {stops.length} {stops.length === 1 ? "place" : "places"}
              </span>
              <span>
                <Clock3 size={14} /> {visitDurationLabel(duration)} in visits
              </span>
              <span>
                <Sparkles size={14} />{" "}
                {trip.brief.pace === "slow"
                  ? "Unhurried"
                  : trip.brief.pace === "full"
                    ? "Make a day of it"
                    : "A little of both"}
              </span>
            </div>
            <p className="day-timeline-disclaimer">
              Your schedule is a draft. Opening hours and travel times still need checking.
            </p>
            <DayTransfers
              key={`${trip.id}:${activeDay.id}`}
              trip={trip}
              dayId={activeDay.id}
              onCommand={onCommand}
            />
            {activeDay.note && (
              <div className="day-timeline-note">
                <span>YOUR PRIVATE NOTE</span>
                <p>{activeDay.note}</p>
              </div>
            )}
            {stops.length === 0 ? (
              <div className="day-timeline-empty">
                <span aria-hidden="true">✦</span>
                <h4>A day waiting to be yours.</h4>
                <p>
                  No places planned for {activeDay.city} yet. Choose an idea, add a place you know
                  or find recommendations to start shaping the day.
                </p>
                {onFindPlaces && (
                  <button type="button" className="button button-primary" onClick={onFindPlaces}>
                    Find places for this day
                  </button>
                )}
                <small>We’ll leave the space open until you choose.</small>
              </div>
            ) : (
              <ol className="day-timeline-events" aria-label={`${activeDay.label} timeline`}>
                {stops.map((stop, index) => {
                  const place = trip.places.find((item) => item.id === stop.placeId);
                  if (!place) return null;
                  const previous = stops[index - 1];
                  const gap = previous
                    ? Number(stop.startTime.slice(0, 2)) * 60 +
                      Number(stop.startTime.slice(3)) -
                      (Number(previous.startTime.slice(0, 2)) * 60 +
                        Number(previous.startTime.slice(3)) +
                        previous.durationMinutes)
                    : 0;
                  return (
                    <li className="day-timeline-event" key={stop.id}>
                      {gap > 0 && (
                        <div className="day-timeline-gap">
                          <span />
                          <p>
                            {gap >= 60
                              ? `${Math.floor(gap / 60)}h${gap % 60 ? ` ${gap % 60}m` : ""}`
                              : `${gap}m`}{" "}
                            unscheduled · allow for travel
                          </p>
                          {previous && onOpenIdeas && (
                            <button
                              type="button"
                              className="button button-quiet"
                              aria-label={`Plan in the gap at ${endTime(previous.startTime, previous.durationMinutes)} on ${activeDay.label}`}
                              onClick={() =>
                                onOpenIdeas({
                                  startTime: endTime(previous.startTime, previous.durationMinutes),
                                  durationMinutes: Math.min(60, gap),
                                })
                              }
                            >
                              <Plus size={13} /> Plan in this gap
                            </button>
                          )}
                        </div>
                      )}
                      <div className="day-timeline-time">
                        <strong>{formatTime(stop.startTime)}</strong>
                        <span>{formatTime(endTime(stop.startTime, stop.durationMinutes))}</span>
                      </div>
                      <TimelineVisitCard
                        place={place}
                        stop={stop}
                        date={activeDay.date}
                        selected={selectedStopId === stop.id}
                        onSelect={onSelectStop}
                      />
                    </li>
                  );
                })}
              </ol>
            )}
            {onOpenIdeas && (
              <section className="day-timeline-add" aria-label="Add a place to this day">
                <div>
                  <strong>Room for another moment.</strong>
                  <p>
                    {ideaCount
                      ? `${ideaCount} ${ideaCount === 1 ? "idea" : "ideas"} in ${activeDay.city}, or add a place you know.`
                      : "Keep a place you know as an idea, then choose its time."}
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => onOpenIdeas()}
                >
                  <Plus size={15} /> Add to this day
                </button>
              </section>
            )}
            <DayLodging trip={trip} dayId={activeDay.id} onOpenStays={onOpenStays} />
            <footer className="day-timeline-footer">
              <button
                type="button"
                onClick={() => {
                  const previous = days[activeIndex - 1];
                  if (previous) selectDay(previous.id);
                }}
                disabled={activeIndex < 1}
              >
                <ArrowLeft size={14} /> Previous day
              </button>
              <span>
                {activeIndex + 1} / {days.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = days[activeIndex + 1];
                  if (next) selectDay(next.id);
                }}
                disabled={activeIndex >= days.length - 1}
              >
                Next day <ArrowRight size={14} />
              </button>
            </footer>
          </div>
        </div>
      </div>
      {!focused && (
        <>
          <p className="day-exp-world-note">
            <span aria-hidden="true">✧</span> A view of your days, not a geographic map.
          </p>
          {days.length > 7 && (
            <nav className="day-exp-pages" aria-label="Journey day groups">
              <button
                type="button"
                className="button button-secondary"
                disabled={pageStart === 0}
                onClick={() => {
                  const previous = days[pageStart - 7];
                  if (previous) onDayChange(previous.id);
                }}
              >
                <ArrowLeft size={14} /> Earlier days
              </button>
              <span role="status">
                Days {pageStart + 1}–{pageStart + visibleDays.length} of {days.length}
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={pageStart + 7 >= days.length}
                onClick={() => {
                  const next = days[pageStart + 7];
                  if (next) onDayChange(next.id);
                }}
              >
                Later days <ArrowRight size={14} />
              </button>
            </nav>
          )}
          <fieldset className="day-exp-day-shelf" aria-label="Choose a day to explore">
            {visibleDays.map((day) => (
              <button
                type="button"
                key={day.id}
                className="day-exp-day-card"
                data-day-choice
                aria-label={day.label}
                aria-current={day.id === activeDay.id ? "step" : undefined}
                aria-describedby={`day-summary-${day.number} day-preview-${day.number}`}
                onClick={() => selectDay(day.id)}
              >
                <span className="day-exp-day-number">{String(day.number).padStart(2, "0")}</span>
                <span>
                  <strong>
                    {day.label} · {day.city}
                  </strong>
                  <small id={`day-summary-${day.number}`}>
                    {displayDate(day.date)} ·{" "}
                    {day.visits
                      ? `${day.visits} ${day.visits === 1 ? "place" : "places"} · ${visitDurationLabel(day.visitMinutes)} in visits`
                      : "Open day"}
                  </small>
                  <span className="day-exp-day-peek" id={`day-preview-${day.number}`}>
                    {day.preview || "Choose this day to add your first place."}
                  </span>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </fieldset>
        </>
      )}
    </section>
  );
}
