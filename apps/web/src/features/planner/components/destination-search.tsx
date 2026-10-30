"use client";

import type { Destination } from "@tastip/domain";
import { ArrowUpRight, Check, MapPin, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/** Explicit geocoding selection; a query is never accepted as a resolved destination. */
export function DestinationSearch({
  value,
  onSelect,
  label = "Search another city",
}: {
  value: Destination;
  onSelect: (destination: Destination) => void;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Destination[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const request = useRef<AbortController | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const fieldId = useId();
  useEffect(() => () => request.current?.abort(), []);
  async function search() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    setResults([]);
    setSearched(false);
    try {
      const response = await fetch("/api/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "City search is unavailable. Try again.");
      if (!Array.isArray(body.results))
        throw new Error("City search returned an unexpected response. Try again.");
      if (!controller.signal.aborted) {
        setResults(body.results);
        setSearched(true);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "City search is unavailable. Try again.");
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return (
    <details className="destination-search" ref={details}>
      <summary>
        <Search size={13} />
        <span>{label}</span>
        <ArrowUpRight size={13} />
      </summary>
      <div className="destination-search-body">
        <label htmlFor={fieldId}>City or destination</label>
        <div className="destination-search-field">
          <input
            id={fieldId}
            type="search"
            value={query}
            minLength={2}
            maxLength={100}
            placeholder="Porto, Portugal"
            onChange={(event) => {
              request.current?.abort();
              setPending(false);
              setQuery(event.target.value);
              setResults([]);
              setSearched(false);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (query.trim().length >= 2) void search();
              }
            }}
          />
          <button
            type="button"
            disabled={query.trim().length < 2 || pending}
            onClick={() => void search()}
          >
            {pending ? "Searching…" : "Find city"}
          </button>
        </div>
        <p className="destination-search-hint">
          Choose the matching city to confirm its location and local timezone.
        </p>
        {pending && (
          <p className="destination-search-status" role="status">
            Finding matching cities…
          </p>
        )}
        {error && (
          <p className="destination-search-error" role="alert">
            {error}
          </p>
        )}
        {searched && results.length === 0 && (
          <p className="destination-search-status" role="status">
            No matching cities. Try the city name with its country.
          </p>
        )}
        {results.length > 0 && (
          <ul className="destination-search-results" aria-label="Matching destinations">
            {results.map((destination) => (
              <li key={destination.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(destination);
                    setResults([]);
                    setQuery("");
                    setSearched(false);
                    if (details.current) details.current.open = false;
                  }}
                >
                  <MapPin size={16} />
                  <span>
                    <strong>
                      {destination.name}
                      <span>{destination.country ? `, ${destination.country}` : ""}</span>
                    </strong>
                    <small>
                      {destination.timeZone} · {Math.abs(destination.lat).toFixed(2)}°{" "}
                      {destination.lat < 0 ? "S" : "N"}, {Math.abs(destination.lng).toFixed(2)}°{" "}
                      {destination.lng < 0 ? "W" : "E"}
                    </small>
                  </span>
                  {value.id === destination.id ? (
                    <Check size={15} aria-label="Selected city" />
                  ) : (
                    <ArrowUpRight size={14} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {searched && results.length > 0 && (
          <p className="destination-search-source">City locations from Open-Meteo geocoding.</p>
        )}
      </div>
    </details>
  );
}
