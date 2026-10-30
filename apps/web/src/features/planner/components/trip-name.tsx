"use client";

import { getTripTitle, type Trip, type TripOperation } from "@tastip/domain";
import { Pencil, X } from "lucide-react";
import { useRef, useState } from "react";

export function TripName({
  trip,
  defaultTitle,
  onCommand,
}: {
  trip: Trip;
  defaultTitle: string;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [baseVersion, setBaseVersion] = useState(trip.version);
  const [error, setError] = useState<string | null>(null);
  const changed = baseVersion !== trip.version;
  function save(title: string) {
    if (onCommand([{ type: "set-trip-title", title }], baseVersion, trip.id))
      dialog.current?.close();
    else
      setError(
        "The trip name could not be saved. Close this editor and try again with the latest trip.",
      );
  }
  return (
    <div className="trip-name">
      <p className="eyebrow">YOUR LITTLE GETAWAY</p>
      <div className="trip-name-heading">
        <h1 title={trip.title}>{trip.title ?? defaultTitle}</h1>
        <button
          type="button"
          className="trip-name-edit"
          aria-label={trip.title ? "Edit trip name" : "Name this trip"}
          onClick={() => {
            setName(getTripTitle(trip));
            setBaseVersion(trip.version);
            setError(null);
            dialog.current?.showModal();
            input.current?.focus();
          }}
        >
          <Pencil size={15} />
        </button>
      </div>
      <dialog ref={dialog} className="trip-name-dialog" aria-labelledby="trip-name-title">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save(name);
          }}
        >
          <div className="trip-name-dialog-heading">
            <h2 id="trip-name-title">Give this journey a name.</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close trip name editor"
              onClick={() => dialog.current?.close()}
            >
              <X size={18} />
            </button>
          </div>
          <p>You’ll see it in your saved trips, shared snapshots and downloads.</p>
          <label>
            Trip name
            <input
              ref={input}
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {changed && (
            <p role="status">
              Your trip changed. Close and reopen this editor before saving a name.
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="trip-name-actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={changed || !name.trim()}
            >
              Save name
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            {trip.title && (
              <button
                type="button"
                className="button button-quiet"
                disabled={changed}
                onClick={() => save("")}
              >
                Use city names
              </button>
            )}
          </div>
        </form>
      </dialog>
    </div>
  );
}
