"use client";

import {
  destinationForDay,
  getTripDestination,
  MAX_OWN_PLACE_DISTANCE_KM,
  type OwnPlace,
  ownPlaceNearCity,
  type Trip,
  type TripOperation,
  validOwnPlace,
} from "@tastip/domain";
import { MapPinPlus, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";

const PlacePinPicker = dynamic(() => import("./place-pin-picker"), {
  ssr: false,
  loading: () => <p role="status">Opening the pin map…</p>,
});

export function OwnPlaceDialog({
  trip,
  dayId,
  place,
  onCommand,
  onSaved,
}: {
  trip: Trip;
  dayId: string;
  place?: OwnPlace;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
  onSaved?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const city = getTripDestination(trip, place?.destinationId ?? destinationForDay(trip, dayId));
  const [name, setName] = useState("");
  const [category, setCategory] = useState<OwnPlace["category"]>("cafe");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [id, setId] = useState("");
  const [baseVersion, setBaseVersion] = useState(trip.version);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lat = Number(latitude),
    lng = Number(longitude);
  const point =
    latitude.trim() &&
    longitude.trim() &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
      ? { lat, lng }
      : null;
  if (!city) return null;
  function close() {
    dialog.current?.close();
    setOpen(false);
  }
  return (
    <>
      <button
        type="button"
        className="button button-secondary"
        onClick={() => {
          setName(place?.name ?? "");
          setCategory(place?.category ?? "cafe");
          setLatitude(place ? String(place.lat) : "");
          setLongitude(place ? String(place.lng) : "");
          setId(place?.id ?? `traveler:${crypto.randomUUID()}`);
          setBaseVersion(trip.version);
          setError(null);
          setOpen(true);
          dialog.current?.showModal();
          input.current?.focus();
        }}
      >
        <MapPinPlus size={15} />
        {place ? "Edit my place" : "Add a place I know"}
      </button>
      <dialog
        ref={dialog}
        className="own-place-dialog"
        aria-label={place ? "Edit your place and pin" : "Add your own place and pin"}
        onCancel={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const candidate = {
              id,
              destinationId: city.id,
              name: name.trim(),
              category,
              source: "traveler" as const,
              description:
                "A place added by the traveler. Pin location, opening hours and costs are unverified.",
              lat,
              lng,
              practical: { hours: "unknown" as const, cost: "unknown" as const },
            };
            if (!point || !validOwnPlace(candidate) || !ownPlaceNearCity(candidate, city)) {
              setError(
                `Enter a name and choose a pin within ${MAX_OWN_PLACE_DISTANCE_KM} km of ${city.name}.`,
              );
              return;
            }
            if (onCommand([{ type: "set-own-place", place: candidate }], baseVersion, trip.id)) {
              close();
              onSaved?.();
            } else
              setError(
                "This place could not be saved. Close and reopen the editor against your latest plan.",
              );
          }}
        >
          <header>
            <div>
              <p className="eyebrow">A PLACE OF YOUR OWN</p>
              <h2>{place ? "Fine-tune your pin." : "Keep a place you know."}</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close place pin editor"
              onClick={close}
            >
              <X size={18} />
            </button>
          </header>
          <p className="own-place-intro">
            For {city.name}. Your place name and pin appear in shared trip links. Details and
            location are entered by you and remain unverified.
          </p>
          <div className="own-place-fields">
            <label>
              Place name
              <input
                ref={input}
                maxLength={300}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Kind of place
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as OwnPlace["category"])}
              >
                <option value="cafe">Café</option>
                <option value="food">Food</option>
                <option value="culture">Culture</option>
                <option value="outdoors">Outdoors</option>
                <option value="shop">Shop</option>
              </select>
            </label>
          </div>
          {open && (
            <PlacePinPicker
              city={city}
              point={point}
              onPick={(next) => {
                setLatitude(next.lat.toFixed(6));
                setLongitude(next.lng.toFixed(6));
              }}
            />
          )}
          <details className="own-place-coordinates">
            <summary>Enter pin coordinates</summary>
            <div className="own-place-fields">
              <label>
                Latitude
                <input
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  value={latitude}
                  onChange={(event) => setLatitude(event.target.value)}
                />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  value={longitude}
                  onChange={(event) => setLongitude(event.target.value)}
                />
              </label>
            </div>
          </details>
          {point && (
            <p className="own-place-selected" role="status">
              Your pin: {lat.toFixed(5)}, {lng.toFixed(5)}
            </p>
          )}
          {baseVersion !== trip.version && (
            <p role="status">Your plan changed. Close and reopen this editor before saving.</p>
          )}
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="own-place-actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={baseVersion !== trip.version}
            >
              {place ? "Save my place" : "Keep as idea"}
            </button>
            <button type="button" className="button button-quiet" onClick={close}>
              Cancel
            </button>
          </div>
          {!place && <small>Your idea stays unscheduled until you add it to a day.</small>}
        </form>
      </dialog>
    </>
  );
}
