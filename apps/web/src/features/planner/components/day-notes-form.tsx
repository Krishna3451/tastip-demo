"use client";

import type { Trip, TripOperation } from "@tastip/domain";
import { useEffect, useRef, useState } from "react";

function dayFields(trip: Trip, dayId: string) {
  const day = trip.days.find((item) => item.id === dayId)!;
  return { version: trip.version, label: day.label, note: day.note ?? "" };
}

export function DayNotesForm({
  trip,
  dayId,
  onCommand,
  onSaved,
  onCancel,
  focusOnMount = false,
}: {
  trip: Trip;
  dayId: string;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
  onSaved?: () => void;
  onCancel?: () => void;
  focusOnMount?: boolean;
}) {
  const [baseline, setBaseline] = useState(() => dayFields(trip, dayId));
  const [label, setLabel] = useState(baseline.label);
  const [note, setNote] = useState(baseline.note);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const dirty = label !== baseline.label || note !== baseline.note;
  const stale = baseline.version !== trip.version;
  const accepted = dayFields(trip, dayId);
  const unchanged = accepted.label === baseline.label && accepted.note === baseline.note;

  useEffect(() => {
    if (!focusOnMount) return;
    const frame = requestAnimationFrame(() => {
      const input = titleInput.current;
      // A deferred initial focus must not override a field the user already chose.
      if (!input || input.form?.contains(document.activeElement)) return;
      input.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusOnMount]);
  useEffect(() => {
    if (dirty || baseline.version === trip.version) return;
    const fields = dayFields(trip, dayId);
    setLabel(fields.label);
    setNote(fields.note);
    setBaseline(fields);
    setError(null);
    setSaved(false);
  }, [trip, dayId, dirty, baseline.version]);
  function reload() {
    setLabel(accepted.label);
    setNote(accepted.note);
    setBaseline(accepted);
    setError(null);
    setSaved(false);
    titleInput.current?.focus();
  }
  return (
    <form
      className="day-notes-form"
      aria-label="Day title and private note"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || stale || !label.trim()) return;
        if (onCommand([{ type: "annotate-day", dayId, label, note }], baseline.version, trip.id)) {
          setLabel(label.trim());
          setBaseline({ version: baseline.version + 1, label: label.trim(), note });
          setSaved(true);
          setError(null);
          onSaved?.();
        } else
          setError(
            "This day could not be saved. Your text is still here; check the planner’s message and try again.",
          );
      }}
    >
      {!onSaved && <h3>Make this day yours</h3>}
      <p className="day-notes-privacy">
        Day titles appear on shared links. Your note stays in your private workspace and downloads;
        shared links and your AI companion do not receive it.
      </p>
      <label>
        Day title
        <input
          ref={titleInput}
          aria-label="Day title"
          required
          maxLength={100}
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
            setSaved(false);
            setError(null);
          }}
        />
      </label>
      <label>
        Notes
        <textarea
          aria-label="Day notes"
          maxLength={2000}
          rows={5}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setSaved(false);
            setError(null);
          }}
          placeholder="A sunset you don’t want to miss. A little time for yourself."
        />
      </label>
      <small className="day-notes-counter">{note.length.toLocaleString()} / 2,000</small>
      {stale && dirty && (
        <div className="day-notes-stale" role="status">
          <p>
            Your plan changed. Your day draft is still here.{" "}
            {unchanged
              ? "Review it with the latest plan before saving."
              : "This day’s title or note also changed. Reload the accepted day before editing it."}
          </p>
          {unchanged && (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setBaseline(accepted);
                setError(null);
                titleInput.current?.focus();
              }}
            >
              Keep day draft with latest plan
            </button>
          )}
          <button type="button" className="button button-quiet" onClick={reload}>
            Reload latest day
          </button>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="day-notes-feedback">
          Day updated.
        </p>
      )}
      <div className="day-notes-actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={!dirty || stale || !label.trim()}
        >
          Save day notes
        </button>
        {onCancel ? (
          <button type="button" className="button button-quiet" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          dirty && (
            <button type="button" className="button button-quiet" onClick={reload}>
              Reset day draft
            </button>
          )
        )}
      </div>
    </form>
  );
}
