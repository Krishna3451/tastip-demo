"use client";

import {
  destinationForDay,
  getDayStops,
  getTripDestination,
  getTripRouteTitle,
  parseStoredTrip,
  routeStayDates,
  type Trip,
} from "@tastip/domain";
import {
  ArrowUpRight,
  Check,
  Compass,
  Copy,
  LoaderCircle,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState } from "react";
import { archiveBeforeLeaving } from "../lib/local-archive";
import { placeSourceLabel } from "../lib/place-labels";
import { placeMapUrl, tripTitle, visitEnd } from "../lib/travel-pack";
import { PACE_LABELS } from "../lib/trip-details";
import { TransferBlocks } from "./transfer-plans";

export function ShareTrip({ trip }: { trip: Trip }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copying = useRef(false);
  async function makeOwnCopy() {
    if (copying.current) return;
    copying.current = true;
    setBusy(true);
    setError(null);
    try {
      const restored = parseStoredTrip(trip);
      if (!restored)
        throw new Error(
          "This shared trip could not be validated. Your current draft is unchanged.",
        );
      // Resolve the current browser workspace; never replace another account's draft.
      const response = await fetch("/api/account", { cache: "no-store" });
      const body = await response.json();
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        !("account" in body) ||
        (body.account !== null &&
          (typeof body.account?.id !== "string" || !/^[a-f\d-]{36}$/i.test(body.account.id)))
      )
        throw new Error(
          "Your current travel workspace could not be checked. Try again before making a copy.",
        );
      const owner = body.account?.id as string | undefined;
      const storageKey = owner ? `tastip.trip.v1:${owner}` : "tastip.trip.v1";
      const libraryKey = owner ? `tastip.library.v1:${owner}` : "tastip.library.v1";
      const previous = localStorage.getItem(storageKey);
      if (previous !== null) {
        let current: Trip | null = null;
        try {
          current = parseStoredTrip(JSON.parse(previous));
        } catch {
          /* Leave an unreadable draft untouched. */
        }
        if (!current)
          throw new Error(
            "Your current draft could not be validated. Open Tastip and download a backup before making a copy.",
          );
        archiveBeforeLeaving(localStorage, current, libraryKey);
      }
      const copy: Trip = {
        ...structuredClone(restored),
        id: crypto.randomUUID(),
        version: 1,
        appliedCommandIds: [],
        commandLog: [],
        updatedAt: new Date().toISOString(),
      };
      if (!parseStoredTrip(copy))
        throw new Error(
          "This trip could not become an editable copy. Your current draft is unchanged.",
        );
      localStorage.setItem(storageKey, JSON.stringify(copy));
      window.location.assign("/");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your browser could not keep a copy. Your current draft is unchanged.",
      );
      copying.current = false;
      setBusy(false);
    }
  }
  const nights = trip.route ? trip.days.length - 1 : null;
  return (
    <main className="shared-trip">
      <header className="shared-topbar">
        <a href="/" className="wordmark" aria-label="Tastip home">
          <span className="brand-mark">
            <Compass size={22} />
          </span>
          tastip<span className="wordmark-period">.</span>
        </a>
        <span>
          <ShieldCheck size={14} />
          Read-only travel draft
        </span>
        <a href="/" className="button button-quiet">
          Create your journey
          <ArrowUpRight size={14} />
        </a>
      </header>
      <div className="shared-content">
        <section className="shared-hero" aria-labelledby="shared-title">
          <div>
            <p className="eyebrow">A JOURNEY WORTH SHARING</p>
            <h1 id="shared-title">{tripTitle(trip)}</h1>
            {trip.title && <p className="shared-introduction">{getTripRouteTitle(trip)}</p>}
            <div className="shared-meta">
              <span>
                {trip.days.length} {trip.days.length === 1 ? "day" : "days"}
                {nights !== null ? ` / ${nights} ${nights === 1 ? "night" : "nights"}` : ""}
              </span>
              <span>
                {trip.brief.partySize} {trip.brief.partySize === 1 ? "traveler" : "travelers"}
              </span>
              <span>{trip.days[0]?.date ?? "Dates open"}</span>
              <span>{PACE_LABELS[trip.brief.pace]}</span>
            </div>
            <p className="shared-introduction">
              A collection of good places, little detours and days worth looking forward to. This is
              a read-only snapshot; its owner’s later edits won’t change this copy.
            </p>
          </div>
          <div className="shared-copy-card">
            <span className="account-section-icon">
              <Copy size={22} />
            </span>
            <h2>Make room for your own story.</h2>
            <p>
              Start an editable copy in your travel workspace. Your current draft goes into your
              saved device collection first.
            </p>
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => void makeOwnCopy()}
            >
              {busy ? <LoaderCircle size={15} className="account-spinner" /> : <Copy size={15} />}
              {busy ? "Keeping your draft safe…" : "Make my own copy"}
              <ArrowUpRight size={14} />
            </button>
          </div>
        </section>
        {error && (
          <p role="alert" className="inline-error shared-error">
            {error}
          </p>
        )}
        <div className="shared-draft-note">
          <ShieldCheck size={19} />
          <p>
            <strong>A thoughtful plan, not a reservation.</strong> Confirm opening hours, prices,
            travel time, accessibility and availability with each venue. All visit times are local
            to the listed city.
          </p>
        </div>
        {(trip.lodgings?.length ?? 0) > 0 && (
          <section className="shared-lodging-section" aria-label="Shared lodging ideas">
            <p className="eyebrow">SOMEWHERE TO COME HOME TO</p>
            <h2>Your lodging ideas.</h2>
            <div className="shared-lodging-grid">
              {trip.lodgings?.map((choice) => {
                const stay = trip.route
                  ? routeStayDates(trip.route).find((item) => item.id === choice.stayId)
                  : undefined;
                return (
                  <article key={choice.stayId}>
                    <span className="eyebrow">LODGING IDEA · NOT RESERVED</span>
                    <h3>{choice.candidate.name}</h3>
                    {stay && (
                      <p>
                        {stay.arrival ?? "Dates open"} → {stay.departure ?? "Dates open"} ·{" "}
                        {stay.nights} {stay.nights === 1 ? "night" : "nights"}
                      </p>
                    )}
                    <small>
                      {choice.candidate.source === "traveler"
                        ? "Lodging name entered by traveler. "
                        : "Qloo lodging suggestion. "}
                      Check availability and rates with the property.
                    </small>
                  </article>
                );
              })}
            </div>
          </section>
        )}
        <div className="shared-days">
          {trip.days.map((day, index) => {
            const city = getTripDestination(trip, destinationForDay(trip, day.id));
            const stops = getDayStops(trip, day.id);
            return (
              <section className="shared-day" key={day.id} aria-labelledby={`shared-${day.id}`}>
                <div className="shared-day-heading">
                  <span className="shared-day-number">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="eyebrow">
                      {day.date ?? "DATES OPEN"} · {city?.timeZone ?? "DESTINATION"} LOCAL TIME
                    </p>
                    <h2 id={`shared-${day.id}`}>
                      {day.label} in {city?.name ?? "your destination"}
                    </h2>
                    <span className="shared-day-count">
                      {stops.length} {stops.length === 1 ? "visit" : "visits"} planned · room for
                      the unexpected
                    </span>
                  </div>
                </div>
                <TransferBlocks trip={trip} dayId={day.id} />
                <ol className="shared-timeline">
                  {stops.map((stop) => {
                    const place = trip.places.find((item) => item.id === stop.placeId);
                    return place ? (
                      <li key={stop.id}>
                        <time>
                          {stop.startTime}
                          <span>{visitEnd(stop.startTime, stop.durationMinutes)}</span>
                        </time>
                        <article>
                          <div className="shared-visit-top">
                            <span>
                              {place.category} · {stop.durationMinutes} minutes
                            </span>
                            {stop.pinned && (
                              <span>
                                <Check size={12} />A keeper
                              </span>
                            )}
                          </div>
                          <h3>{place.name}</h3>
                          <p>{place.description}</p>
                          <div className="shared-visit-footer">
                            <small>{placeSourceLabel(place)} · no reservation made</small>
                            {place.source !== "demo" && (
                              <a
                                href={placeMapUrl(place.lat, place.lng)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <MapPin size={13} />
                                Open map
                                <ArrowUpRight size={12} />
                              </a>
                            )}
                          </div>
                        </article>
                      </li>
                    ) : null;
                  })}
                </ol>
                {!stops.length && (
                  <div className="shared-open-day">
                    <Compass size={24} />
                    <p>
                      A little breathing room.<span>No visits are scheduled for this day yet.</span>
                    </p>
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <footer className="shared-footer">
          <span className="wordmark">
            tastip<span className="wordmark-period">.</span>
          </span>
          <p>
            A trip that feels like you.
            <br />
            Read-only snapshot · no booking or live collaboration
          </p>
          <a href="/" className="button button-secondary">
            Plan your own journey
            <ArrowUpRight size={14} />
          </a>
        </footer>
      </div>
    </main>
  );
}
