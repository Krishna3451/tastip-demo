"use client";

import type { Trip } from "@tastip/domain";
import { useEffect, useRef, useState } from "react";
import type { Command } from "./itinerary";

export function TripBriefEditor({ trip, onCommand }: { trip: Trip; onCommand: Command }) {
  const current = trip.brief.details?.request ?? "";
  const [baseline, setBaseline] = useState({ version: trip.version, request: current });
  const [request, setRequest] = useState(current);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const dirty = request !== baseline.request;
  const stale = baseline.version !== trip.version;
  const unchanged = current === baseline.request;
  useEffect(() => {
    if (dirty || !stale) return;
    setBaseline({ version: trip.version, request: current });
    setRequest(current);
    setSaved(false);
    setError("");
  }, [trip.version, current, dirty, stale]);
  function reload() {
    setBaseline({ version: trip.version, request: current });
    setRequest(current);
    setSaved(false);
    setError("");
    input.current?.focus();
  }
  function save(value: string) {
    if (
      stale ||
      !onCommand([{ type: "set-trip-request", request: value }], baseline.version, trip.id)
    ) {
      setError(
        "Your brief could not be saved. Your text is still here; review the latest trip and try again.",
      );
      return;
    }
    setRequest(value);
    setBaseline({ version: baseline.version + 1, request: value });
    setError("");
    setSaved(true);
  }
  return (
    <form
      className="mt-brief-editor"
      aria-label="Trip brief"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !stale) save(request);
      }}
    >
      <h2>Your trip brief</h2>
      <p>
        Keep what matters for this trip together. Saving your brief keeps scheduled visits in place.
      </p>
      <label>
        What should I keep in mind?
        <textarea
          ref={input}
          aria-label="Trip brief text"
          value={request}
          rows={5}
          maxLength={2000}
          onChange={(event) => {
            setRequest(event.target.value);
            setSaved(false);
            setError("");
          }}
        />
      </label>
      <small>{request.length.toLocaleString()} / 2,000</small>
      {stale && (
        <div className="mt-brief-review" role="status">
          <p>
            Your plan changed.{" "}
            {unchanged
              ? "Your brief draft is still here. Review it with the latest plan before saving."
              : "The saved brief also changed. Reload it before editing again."}
          </p>
          {unchanged && (
            <button
              type="button"
              className="mt-pill outlined"
              onClick={() => {
                setBaseline({ version: trip.version, request: current });
                setError("");
                input.current?.focus();
              }}
            >
              Keep brief draft with latest plan
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && !stale && (
        <p role="status">Trip brief saved. Undo can restore the previous version.</p>
      )}
      <div className="mt-traveler-actions">
        <button type="submit" className="mt-primary" disabled={!dirty || stale}>
          Save trip brief
        </button>
        <button type="button" className="mt-pill outlined" onClick={reload}>
          {stale ? "Reload saved brief" : "Reset brief draft"}
        </button>
        <button
          type="button"
          className="mt-pill outlined"
          disabled={stale || !current}
          onClick={() => save("")}
        >
          Clear saved brief
        </button>
      </div>
    </form>
  );
}
