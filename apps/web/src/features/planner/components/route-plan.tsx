"use client";

import {
  briefDestination,
  type CityStay,
  DESTINATIONS,
  dateAt,
  destinationForDay,
  getTripDestination,
  MAX_CITY_STAYS,
  MAX_TRIP_DAYS,
  routeStayDates,
  type TransferMode,
  type Trip,
  type TripOperation,
  type TripRoute,
} from "@tastip/domain";
import { useEffect, useRef, useState } from "react";
import { DestinationSearch } from "./destination-search";
import { TransferPlans } from "./transfer-plans";

function routeDraft(trip: Trip) {
  return {
    version: trip.version,
    startDate: trip.route?.startDate ?? "",
    stays: structuredClone(
      trip.route?.stays ?? [
        {
          id: "stay-1",
          destinationId: trip.brief.destinationId,
          destination: briefDestination(trip.brief),
          days: trip.days.length,
        },
      ],
    ),
    modes: trip.route?.transfers.map((transfer) => transfer.mode) ?? [],
  };
}

export function RoutePlan({
  trip,
  dayId,
  onCommand,
}: {
  trip: Trip;
  dayId: string;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
}) {
  const cityName = (id: string) => getTripDestination(trip, id)?.name ?? id;
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState(() => routeDraft(trip));
  const [draft, setDraft] = useState(baseline);
  const startDateInput = useRef<HTMLInputElement>(null);
  const { startDate, stays, modes } = draft;
  const setStartDate = (startDate: string) => setDraft((current) => ({ ...current, startDate }));
  const setStays = (stays: CityStay[]) => setDraft((current) => ({ ...current, stays }));
  const setModes = (modes: TransferMode[]) => setDraft((current) => ({ ...current, modes }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const stale = baseline.version !== trip.version;
  useEffect(() => {
    if (!editing || dirty || baseline.version === trip.version) return;
    const latest = routeDraft(trip);
    setDraft(latest);
    setBaseline(latest);
  }, [trip, editing, dirty, baseline.version]);
  function loadLatest() {
    const latest = routeDraft(trip);
    setDraft(latest);
    setBaseline(latest);
  }
  const total = stays.reduce((sum, stay) => sum + stay.days, 0);
  const selectedDay = trip.days.find((day) => day.id === dayId);
  const route: TripRoute | undefined = trip.route;
  return (
    <section data-editing={editing} className="route-plan" aria-label="Dates and city route">
      <div className="route-heading">
        <div>
          <p className="eyebrow">YOUR ROUTE</p>
          <h2>
            {route
              ? route.stays.map((stay) => cityName(stay.destinationId)).join(" → ")
              : `${cityName(trip.brief.destinationId)} · dates open`}
          </h2>
        </div>
        <button
          type="button"
          className="button button-secondary"
          aria-expanded={editing}
          onClick={() => {
            loadLatest();
            setEditing(!editing);
          }}
        >
          {editing ? "Cancel route changes" : "Edit dates & cities"}
        </button>
      </div>
      {route && !editing && (
        <>
          <p>
            {route.startDate
              ? `${route.startDate} — ${dateAt(route.startDate, trip.days.length - 1)}`
              : "Dates open"}{" "}
            · {trip.days.length} days / {trip.days.length - 1} nights
          </p>
          <ol className="route-stays">
            {routeStayDates(route).map((stay, index) => (
              <li key={stay.id}>
                <strong>{cityName(stay.destinationId)}</strong>
                <span>
                  {stay.arrival ?? `Day ${stay.firstDay + 1}`} →{" "}
                  {stay.departure ?? `Day ${stay.firstDay + stay.days}`} · {stay.nights}{" "}
                  {stay.nights === 1 ? "night" : "nights"}
                </span>
                {index > 0 && (
                  <small>
                    Arrive by{" "}
                    {route.transfers[index - 1]?.mode === "undecided"
                      ? "transport to decide"
                      : route.transfers[index - 1]?.mode}{" "}
                    ·{" "}
                    {route.transfers[index - 1]?.timing
                      ? "times entered by you"
                      : "timing to decide"}
                  </small>
                )}
              </li>
            ))}
          </ol>
          <p className="route-caveat">
            Nights describe your city plan. Accommodation and transport are not booked.
          </p>
        </>
      )}
      {editing && (
        <form
          className="route-editor"
          onSubmit={(event) => {
            event.preventDefault();
            const sameDatesAndCities =
              trip.route?.startDate === startDate &&
              JSON.stringify(trip.route.stays) === JSON.stringify(stays);
            const transfers = stays.slice(1).map((stay, index) => ({
              id: `transfer-${stays[index]!.id}-${stay.id}`,
              fromStayId: stays[index]!.id,
              toStayId: stay.id,
              mode: modes[index] ?? ("undecided" as TransferMode),
              ...(sameDatesAndCities &&
              trip.route?.transfers[index]?.mode === (modes[index] ?? "undecided") &&
              trip.route.transfers[index]?.timing
                ? { timing: trip.route.transfers[index]!.timing }
                : {}),
            }));
            if (
              onCommand(
                [{ type: "set-route", route: { startDate: startDate || null, stays, transfers } }],
                baseline.version,
                trip.id,
              )
            )
              setEditing(false);
          }}
        >
          <label>
            Trip start date
            <input
              ref={startDateInput}
              aria-label="Trip start date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          {stays.map((stay, index) => (
            <div key={stay.id} className="route-city-row">
              <label>
                City {index + 1}
                <select
                  aria-label={`City ${index + 1}`}
                  value={stay.destinationId}
                  disabled={index === 0}
                  onChange={(event) =>
                    setStays(
                      stays.map((item) =>
                        item.id === stay.id
                          ? {
                              ...item,
                              destinationId: event.target.value,
                              destination: DESTINATIONS.find(
                                (city) => city.id === event.target.value,
                              ),
                            }
                          : item,
                      ),
                    )
                  }
                >
                  {[
                    ...DESTINATIONS,
                    ...(stay.destination &&
                    !DESTINATIONS.some((city) => city.id === stay.destinationId)
                      ? [stay.destination]
                      : []),
                  ].map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Days
                <input
                  aria-label={`Days in city ${index + 1}`}
                  type="number"
                  min={1}
                  max={MAX_TRIP_DAYS}
                  required
                  value={stay.days}
                  onChange={(event) =>
                    setStays(
                      stays.map((item) =>
                        item.id === stay.id ? { ...item, days: Number(event.target.value) } : item,
                      ),
                    )
                  }
                />
              </label>
              {index > 0 && (
                <label>
                  Get there by
                  <select
                    aria-label={`Transport to city ${index + 1}`}
                    value={modes[index - 1] ?? "undecided"}
                    onChange={(event) =>
                      setModes(
                        Array.from({ length: stays.length - 1 }, (_, i) =>
                          i === index - 1
                            ? (event.target.value as TransferMode)
                            : (modes[i] ?? "undecided"),
                        ),
                      )
                    }
                  >
                    {["undecided", "train", "flight", "car", "bus"].map((mode) => (
                      <option key={mode} value={mode}>
                        {mode === "undecided" ? "Decide later" : mode}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {index > 0 && (
                <div className="route-city-tools">
                  <DestinationSearch
                    label={`Search city ${index + 1}`}
                    value={
                      getTripDestination(trip, stay.destinationId) ??
                      stay.destination ??
                      DESTINATIONS[0]!
                    }
                    onSelect={(city) =>
                      setStays(
                        stays.map((item) =>
                          item.id === stay.id
                            ? { ...item, destinationId: city.id, destination: city }
                            : item,
                        ),
                      )
                    }
                  />
                  {index === stays.length - 1 && (
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => {
                        setStays(stays.slice(0, -1));
                        setModes(modes.slice(0, -1));
                      }}
                    >
                      Remove city
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {stale && (
            <p role="status" className="route-caveat">
              Your plan changed. Your route draft is still here. Reload the latest route before
              saving.
            </p>
          )}
          <div className="route-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={total >= MAX_TRIP_DAYS || stays.length >= MAX_CITY_STAYS}
              onClick={() => {
                const destination = DESTINATIONS.find(
                  (city) => city.id !== stays.at(-1)?.destinationId,
                )!;
                setStays([
                  ...stays,
                  { id: crypto.randomUUID(), destinationId: destination.id, days: 1 },
                ]);
              }}
            >
              Add city
            </button>
            <span>
              {total} {total === 1 ? "day" : "days"} / {Math.max(0, total - 1)}{" "}
              {total === 2 ? "night" : "nights"} · up to {MAX_TRIP_DAYS} days / {MAX_CITY_STAYS}{" "}
              city stays
            </span>
            <button
              type="submit"
              className="button button-primary"
              disabled={stale || !dirty || total < 1 || total > MAX_TRIP_DAYS}
            >
              Save route
            </button>
            {stale && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  loadLatest();
                  startDateInput.current?.focus();
                }}
              >
                Reload latest route
              </button>
            )}
          </div>
          <p className="route-caveat">
            Existing visits stay in their own city. New city days start empty. Arrivals fall on the
            first day in the next city. Changing dates, cities or transport clears the affected
            travel times; enter them again after saving. The final trip day has no overnight stay.
          </p>
        </form>
      )}
      {route && !editing && <TransferPlans trip={trip} onCommand={onCommand} />}
      <div className="route-active-day">
        <strong>
          {selectedDay?.label} · {cityName(destinationForDay(trip, dayId))}
        </strong>
        <span>
          {selectedDay?.date ?? "Date not set"} ·{" "}
          {getTripDestination(trip, destinationForDay(trip, dayId))?.timeZone} local time
        </span>
      </div>
    </section>
  );
}
