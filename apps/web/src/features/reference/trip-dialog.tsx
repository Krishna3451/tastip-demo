"use client";

import {
  DESTINATIONS,
  type Destination,
  dateAt,
  isLocalDate,
  type TripBrief,
  type TripRoute,
  validDestination,
} from "@tastip/domain";
import {
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Mic,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { parseChatTripRequest } from "../planner/lib/chat-trip-request";
import guidance from "./planning-guidance.module.css";
import { Modal, Toggle } from "./primitives";

type Counts = { adults: number; children: number; infants: number; pets: number };

export function TripDialog({
  brief,
  onClose,
  onCreate,
  initialPrompt = "",
  firstName,
  onFindPlaces,
  submitLabel = "Create",
  explainPlanning = false,
}: {
  brief: TripBrief;
  onClose: () => void;
  onCreate: (brief: TripBrief, route?: TripRoute, prompt?: string) => void;
  initialPrompt?: string;
  firstName?: string;
  submitLabel?: string;
  onFindPlaces?: (brief: TripBrief, route?: TripRoute, prompt?: string) => void;
  explainPlanning?: boolean;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [popover, setPopover] = useState<"where" | "when" | "who" | null>(null);
  const [roadTrip, setRoadTrip] = useState(false);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Destination[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [review, setReview] = useState<{
    choices: Destination[][];
    ids: string[];
    selected: number[];
    allocation: number[];
    counts: Counts;
    origin: string;
    flexibleMonths: string[];
  } | null>(null);
  const [flexible, setFlexible] = useState(false);
  const [days, setDays] = useState(5);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [counts, setCounts] = useState<Counts>({ adults: 1, children: 0, infants: 0, pets: 0 });
  const [confirmedWhen, setConfirmedWhen] = useState(false);
  const [confirmedWho, setConfirmedWho] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const findPlaces = useRef(false);
  useEffect(() => () => pending.current?.abort(), []);
  const beforePicker = useRef({
    counts,
    days,
    start,
    end,
    flexible,
    selectedMonths,
    destination,
    roadTrip,
  });
  function openPicker(next: "where" | "when" | "who") {
    beforePicker.current = {
      counts,
      days,
      start,
      end,
      flexible,
      selectedMonths,
      destination,
      roadTrip,
    };
    setPopover(next);
  }
  function cancelPicker() {
    const before = beforePicker.current;
    setCounts(before.counts);
    setDestination(before.destination);
    setRoadTrip(before.roadTrip);
    setDays(before.days);
    setStart(before.start);
    setEnd(before.end);
    setFlexible(before.flexible);
    setSelectedMonths(before.selectedMonths);
    setPopover(null);
  }
  function monthMove(offset: number) {
    const next = new Date(year, month + offset, 1);
    setMonth(next.getMonth());
    setYear(next.getFullYear());
  }
  async function search(value: string) {
    pending.current?.abort();
    setSearching(false);
    setQuery(value);
    setError("");
    const presets = DESTINATIONS.filter((city) =>
      `${city.name} ${city.country}`.toLowerCase().includes(value.toLowerCase()),
    );
    setResults(presets);
    if (value.trim().length < 2 || presets.length) return;
    const controller = new AbortController();
    pending.current = controller;
    setSearching(true);
    try {
      const response = await fetch("/api/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Destination search is unavailable.");
      if (!controller.signal.aborted)
        setResults(Array.isArray(body.results) ? body.results.filter(validDestination) : []);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Search is unavailable.");
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  function chooseDate(value: string) {
    if (!start || end || value < start) {
      setStart(value);
      setEnd("");
    } else {
      setEnd(value);
      const duration = Math.round((Date.parse(value) - Date.parse(start)) / 86400000) + 1;
      setDays(duration);
    }
  }
  function createResolved(
    cities: Destination[],
    allocation: number[],
    travelers: Counts,
    origin: string,
    months: string[],
  ) {
    const first = cities[0];
    if (!first) return;
    const total = allocation.reduce((sum, value) => sum + value, 0);
    if (allocation.some((value) => !Number.isInteger(value) || value < 1) || total > 30) {
      setError("Choose at least one day per city and up to 30 days in total.");
      return;
    }
    const stays = cities.map((city, index) => ({
      id: `stay-${index + 1}`,
      destinationId: city.id,
      destination: city,
      days: allocation[index]!,
    }));
    const accept = findPlaces.current && onFindPlaces ? onFindPlaces : onCreate;
    accept(
      {
        ...brief,
        destinationId: first.id,
        destination: first,
        days: total,
        origin: origin || brief.origin,
        partySize: travelers.adults + travelers.children + travelers.infants,
        details: { request: prompt, travelers, flexibleMonths: months },
      },
      {
        startDate: !flexible && isLocalDate(start) ? start : null,
        stays,
        transfers: stays.slice(1).map((stay, index) => ({
          id: `transfer-${index + 1}`,
          fromStayId: stays[index]!.id,
          toStayId: stay.id,
          mode: roadTrip ? ("car" as const) : ("undecided" as const),
        })),
      },
      prompt,
    );
  }
  async function submit(recommendations = false) {
    if (preparing) return;
    findPlaces.current = recommendations;
    const parsed = parseChatTripRequest(prompt, todayISO);
    const finalDays = confirmedWhen ? days : (parsed.days ?? days);
    const travelers = confirmedWho ? counts : parsed.counts;
    const months = confirmedWhen ? (flexible ? selectedMonths : []) : parsed.flexibleMonths;
    if (!Number.isInteger(finalDays) || finalDays < 1 || finalDays > 30) {
      setError("Choose a trip of up to 30 days.");
      return;
    }
    if (
      travelers.adults < 1 ||
      Object.values(travelers).some((value) => value < 0 || value > 20) ||
      travelers.adults + travelers.children + travelers.infants > 20
    ) {
      setError("Choose between 1 and 20 travelers in Who.");
      setPopover("who");
      return;
    }
    const queries = destination ? [destination.name] : parsed.cityQueries;
    if (!queries.length || queries.some((value) => value.length < 2 || value.length > 100)) {
      setError("Choose a destination in Where so we can build the right trip.");
      openPicker("where");
      setResults(DESTINATIONS);
      return;
    }
    if (finalDays < queries.length) {
      setError("Allow at least one day for each city in your trip.");
      return;
    }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setPreparing(true);
    setError("");
    try {
      let requiresReview = false;
      const choices = await Promise.all(
        queries.map(async (query) => {
          const known =
            destination ??
            DESTINATIONS.find((city) => city.name.toLowerCase() === query.toLowerCase());
          if (known) return [known];
          requiresReview = true;
          const response = await fetch("/api/destinations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
            signal: controller.signal,
          });
          const body = await response.json();
          const cities = Array.isArray(body.results)
            ? (body.results.filter(validDestination) as Destination[])
            : [];
          if (!response.ok || !cities.length)
            throw new Error(
              `We couldn’t find “${query}”. Choose a city in Where or use a simpler trip description.`,
            );
          return cities;
        }),
      );
      if (controller.signal.aborted) return;
      const allocation = choices.map(
        (_, index) =>
          Math.floor(finalDays / choices.length) + (index < finalDays % choices.length ? 1 : 0),
      );
      if (requiresReview)
        setReview({
          choices,
          ids: choices.map(() => crypto.randomUUID()),
          selected: choices.map(() => 0),
          allocation,
          counts: travelers,
          origin: parsed.origin,
          flexibleMonths: months,
        });
      else
        createResolved(
          choices.map((cities) => cities[0]!),
          allocation,
          travelers,
          parsed.origin,
          months,
        );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Destination search is unavailable.");
    } finally {
      if (!controller.signal.aborted) setPreparing(false);
    }
  }
  return (
    <Modal title="Create a trip" onClose={onClose} className="mt-trip-dialog">
      <AssistantMarkHeader />
      <h1>
        What should I keep in
        <br />
        mind for this trip{firstName ? `, ${firstName}` : ""}?
      </h1>
      {explainPlanning && (
        <p className={guidance.hint}>
          Start with cities, dates and travelers. Next, confirm your favorites for Qloo and review
          the proposed days before creating a trip.
        </p>
      )}
      <div className="mt-trip-prompt">
        <textarea
          aria-label="What should I keep in mind for this trip?"
          placeholder="5-day Tokyo trip this October"
          value={prompt}
          onChange={(event) => {
            pending.current?.abort();
            setPreparing(false);
            setReview(null);
            setPrompt(event.target.value);
          }}
          maxLength={2000}
        />
        <span>{prompt.length}/2000</span>
        <button
          type="button"
          className="mt-icon"
          aria-label="Dictate trip details"
          onClick={() =>
            setError(
              "Dictation needs a connected voice provider. You can type your trip details here.",
            )
          }
        >
          <Mic size={19} />
        </button>
      </div>
      <div className="mt-trip-detail-heading">
        <span>Have details? Share what you know.</span>
      </div>
      <div className="mt-detail-pills">
        <button
          type="button"
          aria-expanded={popover === "where"}
          onClick={() => {
            openPicker("where");
            setResults(DESTINATIONS);
          }}
        >
          <strong>Where</strong>
          <span>{destination?.name ?? "Select destination"}</span>
        </button>
        <button type="button" aria-expanded={popover === "when"} onClick={() => openPicker("when")}>
          <strong>When</strong>
          <span>
            {confirmedWhen
              ? flexible
                ? `${days} days · Flexible`
                : `${start}${end ? ` – ${end}` : ""}`
              : "Select dates"}
          </span>
        </button>
        <button type="button" aria-expanded={popover === "who"} onClick={() => openPicker("who")}>
          <strong>Who</strong>
          <span>
            {confirmedWho
              ? `${counts.adults + counts.children + counts.infants} travelers`
              : "Add people"}
          </span>
        </button>
      </div>
      {popover === "where" && (
        <Modal title="Where" className="mt-picker-dialog" onClose={cancelPicker}>
          <h2>Where</h2>
          <section className="mt-popover" aria-label="Choose destination">
            <div className="mt-search">
              <Search size={18} />
              <input
                aria-label="Search destinations"
                placeholder="Where do you want to go?"
                value={query}
                onChange={(event) => void search(event.target.value)}
              />
            </div>
            {searching && <p role="status">Finding destinations…</p>}
            <div className="mt-destination-results">
              {results.map((city) => (
                <button
                  type="button"
                  key={city.id}
                  onClick={() => {
                    setDestination(city);
                    setQuery(city.name);
                    setError("");
                  }}
                >
                  <MapPin size={18} />
                  <span>
                    <strong>{city.name}</strong>
                    <small>{city.country}</small>
                  </span>
                  {destination?.id === city.id && <Check size={17} />}
                </button>
              ))}
            </div>
            <div className="mt-where-road-trip">
              <span>Road trip?</span>
              <Toggle label="Road trip?" checked={roadTrip} onChange={setRoadTrip} />
            </div>
            <button
              type="button"
              className="mt-primary"
              disabled={!destination}
              onClick={() => setPopover(null)}
            >
              Save
            </button>
          </section>
        </Modal>
      )}
      {popover === "when" && (
        <Modal title="When" className="mt-picker-dialog mt-when-dialog" onClose={cancelPicker}>
          <h2>When</h2>
          <p className="mt-picker-subtitle">Select dates</p>
          <section className="mt-popover mt-date-picker" aria-label="Trip dates">
            <div className="mt-segmented">
              <button
                type="button"
                className={!flexible ? "selected" : ""}
                onClick={() => setFlexible(false)}
              >
                Dates
              </button>
              <button
                type="button"
                className={flexible ? "selected" : ""}
                onClick={() => setFlexible(true)}
              >
                Flexible
              </button>
            </div>
            {flexible ? (
              <>
                <div className="mt-counter-row">
                  <strong>{days} days</strong>
                  <div>
                    <button
                      type="button"
                      className="mt-icon"
                      disabled={days <= 1}
                      aria-label="Fewer days"
                      onClick={() => setDays(days - 1)}
                    >
                      <Minus size={17} />
                    </button>
                    <button
                      type="button"
                      className="mt-icon"
                      disabled={days >= 30}
                      aria-label="More days"
                      onClick={() => setDays(days + 1)}
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                </div>
                <h3>Travel anytime</h3>
                <div className="mt-month-grid">
                  {Array.from(
                    { length: 12 },
                    (_, index) => new Date(today.getFullYear(), today.getMonth() + index, 1),
                  ).map((date) => {
                    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
                    return (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={selectedMonths.includes(value)}
                        onClick={() =>
                          setSelectedMonths((current) =>
                            current.includes(value)
                              ? current.filter((item) => item !== value)
                              : [...current, value],
                          )
                        }
                      >
                        {date.toLocaleDateString("en", { month: "short", year: "numeric" })}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="mt-calendar-heading">
                  <button
                    type="button"
                    className="mt-icon"
                    aria-label="Previous month"
                    disabled={
                      new Date(year, month, 1) <= new Date(today.getFullYear(), today.getMonth(), 1)
                    }
                    onClick={() => monthMove(-1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span />
                  <button
                    type="button"
                    className="mt-icon"
                    aria-label="Next month"
                    onClick={() => monthMove(1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <div className="mt-calendar-pair">
                  {[new Date(year, month), new Date(year, month + 1)].map((date) => (
                    <DateMonth
                      key={date.toISOString()}
                      year={date.getFullYear()}
                      month={date.getMonth()}
                      start={start}
                      end={end}
                      today={todayISO}
                      onChoose={chooseDate}
                    />
                  ))}
                </div>
              </>
            )}
            <button
              type="button"
              className="mt-primary"
              disabled={!flexible && !start}
              onClick={() => {
                if (!end && start) setEnd(dateAt(start, days - 1));
                setConfirmedWhen(true);
                setPopover(null);
              }}
            >
              Update
            </button>
          </section>
        </Modal>
      )}
      {popover === "who" && (
        <Modal title="Who" className="mt-picker-dialog mt-who-dialog" onClose={cancelPicker}>
          <h2>Who</h2>
          <p className="mt-picker-subtitle">
            {counts.adults + counts.children + counts.infants}{" "}
            {counts.adults + counts.children + counts.infants === 1 ? "traveler" : "travelers"}
          </p>
          <section className="mt-popover" aria-label="Travelers">
            {(
              [
                ["adults", "Adults", "Ages 13 or above"],
                ["children", "Children", "Ages 2–12"],
                ["infants", "Infants", "Under 2"],
                ["pets", "Pets", "Traveling with an animal?"],
              ] as const
            ).map(([key, label, description]) => (
              <div className="mt-counter-row" key={key}>
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                <div>
                  <button
                    type="button"
                    className="mt-icon"
                    aria-label={`Fewer ${label.toLowerCase()}`}
                    disabled={counts[key] <= (key === "adults" ? 1 : 0)}
                    onClick={() => setCounts({ ...counts, [key]: counts[key] - 1 })}
                  >
                    <Minus size={17} />
                  </button>
                  <span>{counts[key]}</span>
                  <button
                    type="button"
                    className="mt-icon"
                    aria-label={`More ${label.toLowerCase()}`}
                    disabled={counts.adults + counts.children + counts.infants + counts.pets >= 20}
                    onClick={() => setCounts({ ...counts, [key]: counts[key] + 1 })}
                  >
                    <Plus size={17} />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="mt-primary"
              onClick={() => {
                setConfirmedWho(true);
                setPopover(null);
              }}
            >
              Update
            </button>
          </section>
        </Modal>
      )}
      {review && (
        <Modal
          title="Review trip details"
          className="mt-trip-review-dialog"
          onClose={() => setReview(null)}
        >
          <h2>Confirm your destinations</h2>
          <p>
            Choose the right city for each part of your trip. Dates stay open until you choose them.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createResolved(
                review.choices.map((cities, index) => cities[review.selected[index]!]!),
                review.allocation,
                review.counts,
                review.origin,
                review.flexibleMonths,
              );
            }}
          >
            {review.choices.map((cities, index) => (
              <div className="mt-route-review-city" key={review.ids[index]}>
                <label>
                  City {index + 1}
                  <select
                    value={review.selected[index]}
                    onChange={(event) =>
                      setReview({
                        ...review,
                        selected: review.selected.map((value, i) =>
                          i === index ? Number(event.target.value) : value,
                        ),
                      })
                    }
                  >
                    {cities.map((city, cityIndex) => (
                      <option value={cityIndex} key={city.id}>
                        {city.name}, {city.country}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Days
                  <input
                    type="number"
                    min={1}
                    max={30}
                    required
                    value={review.allocation[index]}
                    onChange={(event) =>
                      setReview({
                        ...review,
                        allocation: review.allocation.map((value, i) =>
                          i === index ? Number(event.target.value) : value,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
            <p>
              {review.allocation.reduce((sum, value) => sum + value, 0)} days ·{" "}
              {review.counts.adults + review.counts.children + review.counts.infants} travelers
              {review.flexibleMonths.length ? ` · ${review.flexibleMonths.join(", ")}` : ""}
            </p>
            {error && (
              <p role="alert" className="mt-error">
                {error}
              </p>
            )}
            <button className="mt-primary" type="submit">
              Create trip
            </button>
          </form>
        </Modal>
      )}
      {error && !review && (
        <p className="mt-error" role="alert">
          {error}
        </p>
      )}
      <div className="mt-dialog-footer">
        <button
          className="mt-primary"
          type="button"
          disabled={preparing || (!prompt.trim() && !destination)}
          onClick={() => void submit()}
        >
          {preparing ? "Finding destinations…" : submitLabel}
        </button>
        {onFindPlaces && (
          <button
            type="button"
            className="mt-pill outlined"
            disabled={preparing || (!prompt.trim() && !destination)}
            onClick={() => void submit(true)}
          >
            Plan with my favorites
          </button>
        )}
      </div>
    </Modal>
  );
}

function AssistantMarkHeader() {
  return (
    <span className="mt-modal-spark" aria-hidden="true">
      <BriefcaseBusiness size={20} strokeWidth={1.5} />
    </span>
  );
}

function DateMonth({
  year,
  month,
  start,
  end,
  today,
  onChoose,
}: {
  year: number;
  month: number;
  start: string;
  end: string;
  today: string;
  onChoose: (value: string) => void;
}) {
  const first = (new Date(year, month, 1).getDay() + 6) % 7;
  const length = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: first + length }, (_, i) => ({
    key: new Date(year, month, i - first + 1).toISOString(),
    day: i < first ? null : i - first + 1,
  }));
  return (
    <div className="mt-calendar-month">
      <h3>{new Date(year, month).toLocaleDateString("en", { month: "long", year: "numeric" })}</h3>
      <div className="mt-month-grid weekdays">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((value) => (
          <span key={value}>{value}</span>
        ))}
        {cells.map((cell) => {
          const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(cell.day ?? 1).padStart(2, "0")}`;
          return cell.day ? (
            <button
              type="button"
              key={cell.key}
              disabled={value < today}
              className={
                value === start || value === end
                  ? "selected"
                  : start && end && value > start && value < end
                    ? "in-range"
                    : ""
              }
              aria-label={value}
              onClick={() => onChoose(value)}
            >
              {cell.day}
            </button>
          ) : (
            <span key={cell.key} />
          );
        })}
      </div>
    </div>
  );
}
