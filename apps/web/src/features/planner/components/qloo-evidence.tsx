"use client";

import type { Trip, TripStop } from "@tastip/domain";
import { ArrowUpRight, ChevronDown, Sparkles } from "lucide-react";
import { qlooDayEvidence } from "../lib/qloo-evidence";

function SelectionEvidence({ evidence }: { evidence: TripStop["selection"] }) {
  return evidence ? (
    <details className="qloo-evidence-source">
      <summary>
        Selection evidence <ChevronDown size={12} aria-hidden="true" />
      </summary>
      <dl>
        <div>
          <dt>Source</dt>
          <dd>Qloo</dd>
        </div>
        <div>
          <dt>Original rank</dt>
          <dd>{evidence.rank} within this response</dd>
        </div>
        <div>
          <dt>Selection query</dt>
          <dd>
            <code>{evidence.queryId}</code>
          </dd>
        </div>
      </dl>
    </details>
  ) : (
    <small className="qloo-evidence-missing">Original visit selection was not recorded.</small>
  );
}

/** Read-only evidence from the accepted trip; this component never fetches or schedules places. */
export function QlooEvidence({
  trip,
  dayId,
  onSelectStop,
  onOpenTaste,
  onOpenIdeas,
}: {
  trip: Trip;
  dayId: string;
  onSelectStop?: (stopId: string) => void;
  onOpenTaste?: () => void;
  onOpenIdeas?: () => void;
}) {
  const selected = qlooDayEvidence(trip, dayId);
  if (!selected) return null;
  const { day, cityName, visits, ideas, sampleVisits, travelerVisits } = selected;
  const favorites = trip.brief.tasteProfile?.seeds ?? [];
  const hasQloo = visits.length + ideas.length > 0;
  return (
    <section className="qloo-evidence" aria-label="Qloo recommendation evidence">
      <header className="qloo-evidence-heading">
        <span className="qloo-evidence-mark" aria-hidden="true">
          <Sparkles size={17} />
        </span>
        <div>
          <p className="qloo-evidence-kicker">YOUR TASTE, IN THE PLAN</p>
          <h3>Qloo in {day.label}</h3>
        </div>
        <span className="qloo-evidence-city">{cityName}</span>
      </header>
      <p className="qloo-evidence-count">
        {visits.length} Qloo {visits.length === 1 ? "visit" : "visits"} in this day
        {ideas.length > 0 && ` · ${ideas.length} more ${ideas.length === 1 ? "idea" : "ideas"}`}
      </p>
      {favorites.length > 0 && (
        <details className="qloo-evidence-favorites">
          <summary>
            <span>
              <strong>Favorites supplied</strong>
              {favorites
                .slice(0, 3)
                .map((seed) => seed.name)
                .join(" · ")}
              {favorites.length > 3 && ` · +${favorites.length - 3} more`}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </summary>
          <ul aria-label="Confirmed favorites in this trip">
            {favorites.map((seed) => (
              <li key={seed.id}>{seed.name}</li>
            ))}
          </ul>
          <p>
            These favorites are saved with this trip. Each visit’s selection record keeps its
            original Qloo rank.
          </p>
        </details>
      )}
      {visits.length > 0 && (
        <ul className="qloo-evidence-visits" aria-label="Qloo visits selected for this day">
          {visits.map(({ place, stop, evidence }) => (
            <li key={stop.id}>
              <div className="qloo-evidence-visit">
                <span className="qloo-evidence-time">{stop.startTime}</span>
                {onSelectStop ? (
                  <button
                    type="button"
                    onClick={() => onSelectStop(stop.id)}
                    aria-label={`Open ${place.name} from Qloo`}
                  >
                    {place.name}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                ) : (
                  <strong>{place.name}</strong>
                )}
                <span className="qloo-evidence-state">In this day</span>
              </div>
              <p className="qloo-evidence-rank">
                Qloo recommendation{evidence ? ` · original rank ${evidence.rank}` : ""}
              </p>
              <SelectionEvidence evidence={evidence} />
            </li>
          ))}
        </ul>
      )}
      {ideas.length > 0 && (
        <details className="qloo-evidence-ideas">
          <summary>
            {ideas.length} Qloo {ideas.length === 1 ? "idea" : "ideas"} in {cityName}, not scheduled
            <ChevronDown size={13} aria-hidden="true" />
          </summary>
          <ul>
            {ideas.map((place) => (
              <li key={place.id}>
                <strong>{place.name}</strong>
                <span>
                  {place.taste ? `Original rank ${place.taste.rank}` : "Rank not recorded"}
                </span>
                {place.taste && (
                  <small>
                    Query <code>{place.taste.queryId}</code>
                  </small>
                )}
              </li>
            ))}
          </ul>
          {onOpenIdeas && (
            <button type="button" className="button button-quiet" onClick={onOpenIdeas}>
              Choose from these ideas <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
        </details>
      )}
      {!hasQloo && (
        <p className="qloo-evidence-empty">
          {favorites.length > 0
            ? "Your favorites are saved. No Qloo visits are selected for this day; review your favorites to explore more places."
            : "Choose cultural favorites to find places with Qloo, then review what goes into your trip."}
        </p>
      )}
      {(sampleVisits > 0 || travelerVisits > 0) && (
        <p className="qloo-evidence-other">
          Also in this day:{" "}
          {[
            sampleVisits > 0 &&
              `${sampleVisits} fictional sample ${sampleVisits === 1 ? "visit" : "visits"}`,
            travelerVisits > 0 &&
              `${travelerVisits} ${travelerVisits === 1 ? "visit" : "visits"} you added`,
          ]
            .filter(Boolean)
            .join(" · ")}
          .
        </p>
      )}
      <footer className="qloo-evidence-footer">
        {hasQloo && (
          <p>Ranks belong to each Qloo response. Times and visit order belong to your draft.</p>
        )}
        {onOpenTaste && (
          <button type="button" className="button button-quiet" onClick={onOpenTaste}>
            {favorites.length ? "Review my favorites" : "Choose my favorites"}
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        )}
      </footer>
    </section>
  );
}
