"use client";

import {
  getTripDestination,
  type LocalTravelTime,
  localTimeEpoch,
  routeStayDates,
  type Trip,
  type TripOperation,
  type TripRoute,
  transfersForDay,
  transferWindow,
  validateTrip,
} from "@tastip/domain";
import { useCallback, useEffect, useRef, useState } from "react";

export function TransferBlocks({
  trip,
  dayId,
  onEditTransfer,
}: {
  trip: Trip;
  dayId: string;
  onEditTransfer?: (id: string) => void;
}) {
  const windows = transfersForDay(trip, dayId);
  if (!windows.length) return null;
  return (
    <div className="transfer-blocks">
      {windows.map(({ transfer, timing, from, to, departureEpoch, arrivalEpoch }) => (
        <aside className="transfer-block" aria-label="Reserved travel time" key={transfer.id}>
          <strong>
            {from.name} → {to.name} · {transfer.mode === "undecided" ? "Travel" : transfer.mode}
          </strong>
          <p>
            {timing.departure.date} {timing.departure.time} {from.timeZone}
            {timing.departure.utcOffset ? ` (UTC${timing.departure.utcOffset})` : ""} →{" "}
            {timing.arrival.date} {timing.arrival.time} {to.timeZone}
            {timing.arrival.utcOffset ? ` (UTC${timing.arrival.utcOffset})` : ""}
          </p>
          <small>
            {Math.round((arrivalEpoch - departureEpoch) / 60_000)} min reserved · Times entered by
            you · Not a reservation
          </small>
          {onEditTransfer && (
            <button
              type="button"
              className="button button-secondary"
              data-transfer-id={transfer.id}
              aria-label={`Edit travel times from ${from.name} to ${to.name}`}
              onClick={() => onEditTransfer(transfer.id)}
            >
              Edit travel times
            </button>
          )}
        </aside>
      ))}
    </div>
  );
}

function travelDraft(trip: Trip, index: number) {
  const transfer = trip.route!.transfers[index]!;
  const arrivalDate = routeStayDates(trip.route!)[index + 1]!.arrival ?? "";
  return {
    version: trip.version,
    departure: structuredClone(transfer.timing?.departure ?? { date: arrivalDate, time: "" }),
    arrival: structuredClone(transfer.timing?.arrival ?? { date: arrivalDate, time: "" }),
  };
}

function sameTime(left: LocalTravelTime, right: LocalTravelTime) {
  return left.date === right.date && left.time === right.time && left.utcOffset === right.utcOffset;
}

export function TransferEditor({
  trip,
  index,
  onCommand,
  onSaved,
  onCancel,
  focusOnMount = false,
}: {
  trip: Trip;
  index: number;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
  onSaved?: () => void;
  onCancel?: () => void;
  focusOnMount?: boolean;
}) {
  const route = trip.route!;
  const transfer = route.transfers[index]!;
  const dates = routeStayDates(route);
  const fromStay = dates[index]!;
  const toStay = dates[index + 1]!;
  const existing = transfer.timing;
  const [baseline, setBaseline] = useState(() => travelDraft(trip, index));
  const [departure, setDeparture] = useState<LocalTravelTime>(baseline.departure);
  const [arrival, setArrival] = useState<LocalTravelTime>(baseline.arrival);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const departureDateInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusOnMount) return;
    const frame = requestAnimationFrame(() => departureDateInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusOnMount]);
  const dirty = !sameTime(departure, baseline.departure) || !sameTime(arrival, baseline.arrival);
  const stale = baseline.version !== trip.version;
  const loadLatest = useCallback(() => {
    const latest = travelDraft(trip, index);
    setBaseline(latest);
    setDeparture(latest.departure);
    setArrival(latest.arrival);
    setError("");
    setSaved(false);
  }, [trip, index]);
  useEffect(() => {
    if (!dirty && stale) loadLatest();
  }, [dirty, stale, loadLatest]);
  function applyRoute(nextRoute: TripRoute) {
    const issue = validateTrip({ ...trip, route: nextRoute })[0];
    if (issue) {
      setError(issue.message);
      return;
    }
    if (!onCommand([{ type: "set-route", route: nextRoute }], baseline.version, trip.id)) {
      setError(
        "These travel times could not be applied. Check the planner’s message or reload the latest times.",
      );
      return;
    }
    const latest = travelDraft({ ...trip, route: nextRoute, version: baseline.version + 1 }, index);
    setBaseline(latest);
    setDeparture(latest.departure);
    setArrival(latest.arrival);
    setError("");
    setSaved(true);
    onSaved?.();
  }
  // Resolve destination metadata even before any times are entered.
  const from = getTripDestination(trip, fromStay.destinationId)!;
  const to = getTripDestination(trip, toStay.destinationId)!;
  const fromName = from.name;
  const toName = to.name;
  if (!route.startDate)
    return <p className="route-caveat">Choose trip dates before entering travel times.</p>;
  return (
    <form
      className="route-editor transfer-editor"
      aria-label={`Travel times ${index + 1}`}
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        const timing = { source: "traveler" as const, departure, arrival };
        const nextRoute = structuredClone(route);
        nextRoute.transfers[index] = { ...transfer, timing };
        const nextWindow = transferWindow(nextRoute, index);
        try {
          if (!nextWindow) {
            // Give a specific timezone error instead of silently shifting the supplied time.
            localTimeEpoch(departure, from.timeZone);
            localTimeEpoch(arrival, to.timeZone);
            throw new Error("Check both travel times.");
          }
          if (arrival.date !== toStay.arrival)
            throw new Error(
              `Arrival must be on ${toStay.arrival}, your first day in ${toName}. Change the city route first if needed.`,
            );
          if (
            !fromStay.arrival ||
            !fromStay.departure ||
            departure.date < fromStay.arrival ||
            departure.date > fromStay.departure
          )
            throw new Error(
              `Choose a departure from ${fromStay.arrival} through ${fromStay.departure}.`,
            );
          if (nextWindow.arrivalEpoch <= nextWindow.departureEpoch)
            throw new Error(
              "Arrival must be after departure when both city time zones are taken into account.",
            );
          applyRoute(nextRoute);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Check your travel times.");
        }
      }}
    >
      <h3>
        {fromName} → {toName}
      </h3>
      <p className="route-caveat">
        Enter times from your own travel plan. Arrival falls on {toStay.arrival}. These times
        reserve space; service schedules, check-in buffers and bookings still need checking.
      </p>
      <div className="transfer-time-grid">
        {[
          {
            title: "Departure",
            value: departure,
            set: (value: LocalTravelTime) => {
              setDeparture(value);
              setSaved(false);
              setError("");
            },
            zone: from.timeZone,
          },
          {
            title: "Arrival",
            value: arrival,
            set: (value: LocalTravelTime) => {
              setArrival(value);
              setSaved(false);
              setError("");
            },
            zone: to.timeZone,
          },
        ].map(({ title, value, set, zone }) => (
          <fieldset key={title}>
            <legend>
              {title}
              {zone ? ` · ${zone}` : " · city local time"}
            </legend>
            <label>
              {title} date
              <input
                ref={title === "Departure" ? departureDateInput : undefined}
                type="date"
                value={value.date}
                required
                onChange={(event) => set({ ...value, date: event.target.value })}
              />
            </label>
            <label>
              {title} time
              <input
                type="time"
                value={value.time}
                required
                onChange={(event) => set({ ...value, time: event.target.value })}
              />
            </label>
            <details>
              <summary>Clock-change offset</summary>
              <label>
                {title} UTC offset (optional)
                <input
                  placeholder="e.g. +01:00"
                  value={value.utcOffset ?? ""}
                  pattern="[+-][0-2][0-9]:[0-5][0-9]"
                  onChange={(event) => {
                    const { utcOffset: _offset, ...rest } = value;
                    set(event.target.value ? { ...value, utcOffset: event.target.value } : rest);
                  }}
                />
              </label>
              <small>
                Use the offset shown on your ticket if a clock-change hour occurs twice.
              </small>
            </details>
          </fieldset>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {stale && (
        <p role="status" className="route-caveat">
          Your plan changed. Your entered times are still here. Reload the latest travel times
          before saving.
        </p>
      )}
      {saved && !stale && (
        <p role="status" className="route-caveat">
          Travel times updated. Undo can restore the previous plan.
        </p>
      )}
      <div className="route-actions">
        <button className="button button-primary" type="submit" disabled={stale || !dirty}>
          Save travel times
        </button>
        {existing && (
          <button
            className="button button-quiet"
            type="button"
            disabled={stale}
            onClick={() => {
              const nextRoute = structuredClone(route);
              const { timing: _timing, ...untimed } = transfer;
              nextRoute.transfers[index] = untimed;
              applyRoute(nextRoute);
            }}
          >
            Remove travel times
          </button>
        )}
        {stale && (
          <button
            className="button button-quiet"
            type="button"
            onClick={() => {
              loadLatest();
              departureDateInput.current?.focus();
            }}
          >
            Reload latest travel times
          </button>
        )}
        {onCancel && (
          <button className="button button-quiet" type="button" onClick={onCancel}>
            Cancel travel changes
          </button>
        )}
      </div>
    </form>
  );
}

export function TransferPlans({
  trip,
  onCommand,
}: {
  trip: Trip;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
}) {
  if (!trip.route?.transfers.length) return null;
  return (
    <details className="route-transfers">
      <summary>
        Travel between cities · {trip.route.transfers.filter((transfer) => transfer.timing).length}{" "}
        of {trip.route.transfers.length} timed
      </summary>
      {trip.route.transfers.map((transfer, index) => (
        <TransferEditor
          key={`${trip.id}:${transfer.id}`}
          trip={trip}
          index={index}
          onCommand={onCommand}
        />
      ))}
    </details>
  );
}
