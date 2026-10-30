"use client";

import {
  destinationForDay,
  getDayStops,
  getTripDestination,
  type Place,
  type Trip,
  type TripOperation,
  type TripStop,
} from "@tastip/domain";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  Ellipsis,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Plus,
  Share2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DayNotesForm } from "../planner/components/day-notes-form";
import { GeographicPlan } from "../planner/components/geographic-plan";
import { IdeasPanel } from "../planner/components/ideas-panel";
import { RepeatVisit } from "../planner/components/repeat-visit";
import { VisitNote } from "../planner/components/visit-note";
import { VisitSchedule } from "../planner/components/visit-schedule";
import { visitEnd } from "../planner/lib/travel-pack";
import { Modal, Toggle, useSheetDismissal } from "./primitives";

export type Command = (
  operations: TripOperation[],
  expectedVersion?: number,
  expectedTripId?: string,
  commandId?: string,
) => boolean | undefined;

export function Itinerary({
  trip,
  onCommand,
  onPlace,
  onClose,
  onShare,
  onFind,
  onIdeas,
  onTimeline,
  dayId,
  onDayChange,
  initialStopId,
  mode = "itinerary",
}: {
  trip: Trip;
  onCommand: Command;
  onPlace: (place: Place) => void;
  onClose: () => void;
  onShare: () => void;
  onFind: (dayId?: string) => void;
  onIdeas: (dayId: string) => void;
  onTimeline: (dayId: string) => void;
  dayId: string;
  initialStopId?: string;
  onDayChange: (dayId: string) => void;
  mode?: "itinerary" | "ideas" | "calendar";
}) {
  const sheet = useSheetDismissal(onClose);
  useEffect(() => {
    if (mode === "ideas") return;
    const day = sheet.current?.querySelector<HTMLElement>(`[data-day-id="${CSS.escape(dayId)}"]`);
    day?.scrollIntoView({ block: "nearest" });
  }, [dayId, mode, sheet]);
  const [distances, setDistances] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [mapDay, setMapDay] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(initialStopId ?? null);
  useEffect(() => {
    if (initialStopId) setScheduleId(initialStopId);
  }, [initialStopId]);
  const schedule = trip.stops.find((stop) => stop.id === scheduleId);
  const setSchedule = (stop: TripStop | null) => setScheduleId(stop?.id ?? null);
  const [comment, setComment] = useState<TripStop | null>(null);
  const [dayEdit, setDayEdit] = useState<string | null>(null);
  const unscheduled = trip.places.filter(
    (place) => !trip.stops.some((stop) => stop.placeId === place.id),
  );
  function move(stop: TripStop, offset: number) {
    const day = trip.days[trip.days.findIndex((item) => item.id === stop.dayId) + offset];
    if (day)
      onCommand(
        [{ type: "move-stop", stopId: stop.id, dayId: day.id, startTime: stop.startTime }],
        trip.version,
        trip.id,
      );
    setMenu(null);
  }
  return (
    <section
      ref={sheet}
      className="mt-itinerary-sheet"
      aria-label={
        mode === "ideas" ? "Trip ideas" : mode === "calendar" ? "Trip calendar" : "Trip itinerary"
      }
    >
      <div className="mt-sheet-handle" />
      <div className="mt-sheet-top">
        <div>
          <button
            className="mt-icon"
            type="button"
            aria-label="Invite co-travelers"
            onClick={onShare}
          >
            <Users size={19} />
          </button>
          <button className="mt-icon" type="button" aria-label="Share trip" onClick={onShare}>
            <Share2 size={18} />
          </button>
        </div>
        <button type="button" className="mt-icon" aria-label="Close itinerary" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      <h1>{mode === "ideas" ? "Ideas" : mode === "calendar" ? "Calendar" : "Itinerary"}</h1>
      <p className="mt-sheet-description">
        {mode === "ideas"
          ? "A little inspiration for your trip."
          : "A day-by-day plan for your adventure."}
      </p>
      {mode === "ideas" ? (
        <div className="mt-day-ideas">
          <label className="mt-ideas-day-picker">
            Plan a day
            <select
              aria-label="Ideas day"
              value={dayId}
              onChange={(event) => onDayChange(event.target.value)}
            >
              {trip.days.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.label} ·{" "}
                  {getTripDestination(trip, destinationForDay(trip, day.id))?.name ?? "Your city"}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="mt-pill outlined" onClick={() => onFind(dayId)}>
            Find recommendations
          </button>
          <IdeasPanel
            key={`${trip.id}:${dayId}`}
            trip={trip}
            dayId={dayId}
            onCommand={onCommand}
            onSelectVisit={(id) => setScheduleId(id)}
            onOpenDay={() => onTimeline(dayId)}
          />
        </div>
      ) : (
        <div className="mt-ideas-strip">
          <h2>
            Ideas <span>{unscheduled.length}</span>
          </h2>
          <div>
            <button type="button" className="mt-add-idea" onClick={() => onIdeas(dayId)}>
              <Plus size={24} />
              <span>Add</span>
            </button>
            {unscheduled.slice(0, 4).map((place) => (
              <button
                type="button"
                className="mt-idea-mini"
                key={place.id}
                onClick={() => onPlace(place)}
              >
                <MapPin size={23} />
                <span>{place.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {mode !== "ideas" && (
        <>
          <div className="mt-itinerary-options">
            <div>
              <Toggle label="Show distances" checked={distances} onChange={setDistances} />
              <span>Distances</span>
            </div>
            <button
              className="mt-icon"
              type="button"
              aria-label="Itinerary options"
              onClick={onShare}
            >
              <Ellipsis size={21} />
            </button>
          </div>
          {trip.days.map((day, index) => (
            <section
              key={day.id}
              data-day-id={day.id}
              className={`mt-itinerary-day ${mode === "calendar" ? "calendar-day" : ""}`}
            >
              <div className="mt-day-heading">
                <button
                  type="button"
                  aria-expanded={!collapsed.includes(day.id)}
                  onClick={() =>
                    setCollapsed((current) =>
                      current.includes(day.id)
                        ? current.filter((id) => id !== day.id)
                        : [...current, day.id],
                    )
                  }
                >
                  {collapsed.includes(day.id) ? (
                    <ChevronRight size={17} />
                  ) : (
                    <ChevronDown size={17} />
                  )}
                  <span>
                    <strong>
                      {day.date
                        ? new Date(`${day.date}T12:00:00`).toLocaleDateString("en", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })
                        : `Day ${index + 1}`}
                    </strong>
                    <small>
                      {day.label !== `Day ${index + 1}`
                        ? day.label
                        : getTripDestination(trip, destinationForDay(trip, day.id))?.name}
                    </small>
                  </span>
                </button>
                <div>
                  <button
                    type="button"
                    className="mt-icon"
                    aria-label={`Map for day ${index + 1}`}
                    onClick={() => setMapDay(mapDay === day.id ? null : day.id)}
                  >
                    <MapIcon size={17} />
                  </button>
                  <button
                    type="button"
                    className="mt-icon"
                    aria-label={`Edit day ${index + 1}`}
                    onClick={() => setDayEdit(day.id)}
                  >
                    <Ellipsis size={18} />
                  </button>
                </div>
              </div>
              {!collapsed.includes(day.id) && (
                <>
                  <div className="mt-day-stops">
                    {getDayStops(trip, day.id).map((stop, stopIndex) => {
                      const place = trip.places.find((item) => item.id === stop.placeId);
                      if (!place) return null;
                      return (
                        <div key={stop.id} className="mt-stop-wrapper">
                          {distances && stopIndex > 0 && (
                            <p className="mt-distance-note">
                              <span />
                              Travel time unverified
                              <span />
                            </p>
                          )}
                          <article className="mt-stop-card">
                            <button
                              className={`mt-stop-thumb category-${place.category}`}
                              type="button"
                              onClick={() => onPlace(place)}
                              aria-label={`View ${place.name}`}
                            >
                              {place.facts?.imageUrl ? (
                                <img
                                  src={place.facts.imageUrl}
                                  alt=""
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <MapPin size={24} />
                              )}
                            </button>
                            <div className="mt-stop-content">
                              <small>
                                {place.category === "food"
                                  ? "Restaurant"
                                  : place.category === "cafe"
                                    ? "Café"
                                    : place.category}
                              </small>
                              <button
                                type="button"
                                className="mt-stop-title"
                                onClick={() => onPlace(place)}
                              >
                                {place.name}
                              </button>
                              <button
                                type="button"
                                className="mt-stop-time"
                                onClick={() => setSchedule(stop)}
                              >
                                <Clock3 size={12} />
                                {stop.startTime}–{visitEnd(stop.startTime, stop.durationMinutes)}
                              </button>
                              {stop.note && <p className="mt-stop-note">{stop.note}</p>}
                            </div>
                            <div className="mt-stop-actions">
                              <button
                                type="button"
                                className="mt-icon"
                                aria-label={`Comment on ${place.name}`}
                                onClick={() => setComment(stop)}
                              >
                                <MessageCircle size={16} />
                              </button>
                              <button
                                type="button"
                                className="mt-icon"
                                aria-label={`Options for ${place.name}`}
                                aria-expanded={menu === stop.id}
                                onClick={() => setMenu(menu === stop.id ? null : stop.id)}
                              >
                                <Ellipsis size={18} />
                              </button>
                            </div>
                            {menu === stop.id && (
                              <div className="mt-context-menu">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSchedule(stop);
                                    setMenu(null);
                                  }}
                                >
                                  Adjust schedule
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onPlace(place);
                                    setMenu(null);
                                  }}
                                >
                                  Edit details
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setComment(stop);
                                    setMenu(null);
                                  }}
                                >
                                  Add a comment
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onCommand(
                                      [{ type: "remove-stop", stopId: stop.id }],
                                      trip.version,
                                      trip.id,
                                    );
                                    setMenu(null);
                                  }}
                                >
                                  Move to ideas
                                </button>
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() => move(stop, -1)}
                                >
                                  Move to previous day
                                </button>
                                <button
                                  type="button"
                                  disabled={index === trip.days.length - 1}
                                  onClick={() => move(stop, 1)}
                                >
                                  Move to next day
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSchedule(stop);
                                    setMenu(null);
                                  }}
                                >
                                  Add again
                                </button>
                                <button
                                  type="button"
                                  className="mt-danger"
                                  onClick={() => {
                                    onCommand(
                                      [{ type: "remove-stop", stopId: stop.id }],
                                      trip.version,
                                      trip.id,
                                    );
                                    setMenu(null);
                                  }}
                                >
                                  Remove
                                </button>
                              </div>
                            )}
                          </article>
                        </div>
                      );
                    })}
                  </div>
                  {!getDayStops(trip, day.id).length && (
                    <p className="mt-day-empty">Your day is wide open.</p>
                  )}
                  {day.note && <p className="mt-day-note">{day.note}</p>}
                  <button
                    type="button"
                    className="mt-add-stop"
                    aria-label={`Add item to ${day.label}`}
                    onClick={() => onIdeas(day.id)}
                  >
                    <Plus size={17} /> Add item
                  </button>
                  {mapDay === day.id && (
                    <div className="mt-inline-map">
                      <GeographicPlan
                        onOpenDay={() => setMapDay(null)}
                        trip={trip}
                        dayId={day.id}
                        onSelectStop={(id) => {
                          const stop = trip.stops.find((item) => item.id === id);
                          const place = trip.places.find((item) => item.id === stop?.placeId);
                          if (place) onPlace(place);
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </section>
          ))}
        </>
      )}
      {schedule && (
        <ScheduleDialog
          key={schedule.id}
          trip={trip}
          stop={schedule}
          onClose={() => setSchedule(null)}
          onSelectVisit={setScheduleId}
          onCommand={onCommand}
        />
      )}
      {comment && (
        <TextDialog
          title="Add a comment"
          initial={comment.note ?? ""}
          label="Comment"
          onClose={() => setComment(null)}
          onSave={(note) => {
            if (
              onCommand(
                [{ type: "set-stop-note", stopId: comment.id, note }],
                trip.version,
                trip.id,
              )
            )
              setComment(null);
          }}
        />
      )}
      {dayEdit && trip.days.some((day) => day.id === dayEdit) && (
        <Modal
          title="Edit day"
          onClose={() => setDayEdit(null)}
          className="mt-small-dialog mt-tools-dialog"
        >
          <h2>Edit day</h2>
          <DayNotesForm
            trip={trip}
            dayId={dayEdit}
            onCommand={onCommand}
            onSaved={() => setDayEdit(null)}
            onCancel={() => setDayEdit(null)}
            focusOnMount
          />
        </Modal>
      )}
    </section>
  );
}

export function TextDialog({
  title,
  label,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  label: string;
  initial: string;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Modal title={title} onClose={onClose} className="mt-small-dialog">
      <h2>{title}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value);
        }}
      >
        <label>
          {label}
          <textarea
            aria-label={label}
            value={value}
            maxLength={label === "Day title" ? 100 : label === "Trip title" ? 120 : 2000}
            required={label !== "Comment"}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <button className="mt-primary" type="submit">
          Update
        </button>
      </form>
    </Modal>
  );
}

function ScheduleDialog({
  trip,
  stop,
  onCommand,
  onClose,
  onSelectVisit,
}: {
  trip: Trip;
  stop: TripStop;
  onSelectVisit: (id: string) => void;
  onCommand: Command;
  onClose: () => void;
}) {
  const timeInput = useRef<HTMLInputElement>(null);
  const place = trip.places.find((item) => item.id === stop.placeId);
  return (
    <Modal title="Adjust schedule" onClose={onClose} className="mt-tools-dialog mt-visit-tools">
      <h2>{place?.name ?? "Your visit"}</h2>
      <p className="mt-muted">
        Changes update this visit. Other visits keep their own times and notes.
      </p>
      <fieldset className="mt-traveler-actions" aria-label="Visit protections">
        <button
          type="button"
          className="mt-pill outlined"
          aria-pressed={stop.pinned}
          onClick={() =>
            onCommand(
              [{ type: "pin-stop", stopId: stop.id, pinned: !stop.pinned }],
              trip.version,
              trip.id,
            )
          }
        >
          {stop.pinned ? "Place pinned" : "Keep this place"}
        </button>
        <button
          type="button"
          className="mt-pill outlined"
          aria-pressed={stop.timeLocked}
          onClick={() =>
            onCommand(
              [{ type: "lock-time", stopId: stop.id, timeLocked: !stop.timeLocked }],
              trip.version,
              trip.id,
            )
          }
        >
          {stop.timeLocked ? "Time locked" : "Keep this time"}
        </button>
      </fieldset>
      <VisitSchedule trip={trip} stop={stop} timeInput={timeInput} onCommand={onCommand} />
      <VisitNote
        tripId={trip.id}
        version={trip.version}
        stopId={stop.id}
        placeId={stop.placeId}
        note={stop.note}
        onCommand={onCommand}
      />
      <RepeatVisit trip={trip} stop={stop} onCommand={onCommand} onSelectVisit={onSelectVisit} />
    </Modal>
  );
}
