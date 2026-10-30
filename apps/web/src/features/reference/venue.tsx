"use client";

import { type Place, safePublicLink, type Trip, WEEKDAYS } from "@tastip/domain";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Heart,
  MapPin,
  Plus,
  Share2,
} from "lucide-react";
import { useState } from "react";
import { Modal } from "./primitives";

export function Venue({
  place,
  trip,
  saved,
  onSave,
  onAdd,
  addLabel,
  addDisabled = false,
  onClose,
}: {
  place: Place;
  trip: Trip | null;
  saved: boolean;
  onSave: () => void;
  onAdd: () => void;
  addLabel?: string;
  addDisabled?: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("Overview");
  const [hours, setHours] = useState(false);
  const [message, setMessage] = useState("");
  const inTrip = trip?.stops.some((stop) => stop.placeId === place.id);
  const directions = `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  return (
    <Modal title={place.name} onClose={onClose} className="mt-venue-dialog">
      <div className={`mt-venue-photo category-${place.category}`}>
        {place.facts?.imageUrl ? (
          <img src={place.facts.imageUrl} alt={place.name} referrerPolicy="no-referrer" />
        ) : (
          <MapPin size={60} strokeWidth={1} />
        )}
        <button className="mt-icon" type="button" aria-label="Back to trip" onClick={onClose}>
          <ArrowLeft size={20} />
        </button>
      </div>
      <div className="mt-venue-body">
        <div className="mt-venue-toolbar">
          <button className={`mt-pill ${saved ? "active" : ""}`} type="button" onClick={onSave}>
            <Heart size={16} fill={saved ? "currentColor" : "none"} />
            {saved ? "Saved" : "Save"}
          </button>
          <button className="mt-pill" type="button" onClick={onAdd} disabled={addDisabled}>
            {addDisabled || inTrip ? <Check size={16} /> : <Plus size={16} />}
            {addLabel ?? (inTrip ? "Plan another visit" : "Add to trip")}
          </button>
          <a className="mt-pill" href={directions} target="_blank" rel="noreferrer">
            <MapPin size={16} />
            Directions
          </a>
          <button
            className="mt-icon"
            type="button"
            aria-label="Copy place link"
            onClick={async () => {
              try {
                if (place.facts?.website && safePublicLink(place.facts.website)) {
                  await navigator.clipboard.writeText(place.facts.website);
                  setMessage("Website link copied.");
                } else {
                  await navigator.clipboard.writeText(directions);
                  setMessage("Map link copied.");
                }
              } catch {
                setMessage("Your browser could not copy the link.");
              }
            }}
          >
            <Share2 size={17} />
          </button>
        </div>
        <h1>{place.name}</h1>
        <p className="mt-muted">
          {place.category === "cafe"
            ? "Café"
            : place.category === "food"
              ? "Restaurant"
              : place.category}{" "}
          ·{" "}
          {place.source === "qloo"
            ? "Place details via Qloo"
            : place.source === "traveler"
              ? "Your place · details entered by you"
              : "Fictional sample venue"}
        </p>
        <nav className="mt-tabs" aria-label="Place details">
          {["Overview", "Guides", "Reviews", "Location"].map((name) => (
            <button
              type="button"
              key={name}
              className={tab === name ? "selected" : ""}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        {tab === "Overview" && (
          <>
            <p className="mt-venue-description">{place.description}</p>
            {place.facts?.address && (
              <p className="mt-address">
                <MapPin size={18} />
                {place.facts.address}
              </p>
            )}
            <button
              className="mt-hours-toggle"
              type="button"
              onClick={() => setHours(!hours)}
              aria-expanded={hours}
            >
              Opening hours{" "}
              <span>
                {place.facts?.hours ? "Weekly hours" : "Not available"}
                <ChevronDown size={16} />
              </span>
            </button>
            {hours && (
              <div className="mt-hours">
                {place.facts?.hours ? (
                  WEEKDAYS.map((day) => (
                    <p key={day}>
                      <span>{day}</span>
                      <span>
                        {place.facts?.hours?.[day]
                          ?.map((period) =>
                            period.closed
                              ? "Closed"
                              : `${period.opens ?? "?"}–${period.closes ?? "?"}`,
                          )
                          .join(", ") ?? "Unknown"}
                      </span>
                    </p>
                  ))
                ) : (
                  <p>Check current opening hours with the venue.</p>
                )}
              </div>
            )}
            {place.facts?.website && safePublicLink(place.facts.website) && (
              <a className="mt-website" href={place.facts.website} target="_blank" rel="noreferrer">
                Website <ArrowUpRight size={16} />
              </a>
            )}
            {place.facts?.menuUrl && safePublicLink(place.facts.menuUrl) && (
              <a className="mt-website" href={place.facts.menuUrl} target="_blank" rel="noreferrer">
                Menu <ArrowUpRight size={16} />
              </a>
            )}
            <h2>Good to know</h2>
            <p className="mt-muted">
              Opening hours, accessibility, travel time and availability should be confirmed before
              visiting.
            </p>
          </>
        )}
        {tab === "Guides" && (
          <p className="mt-muted mt-tab-empty">
            No sourced guides are available for this place yet.
          </p>
        )}
        {tab === "Reviews" && (
          <p className="mt-muted mt-tab-empty">
            Reviews are not available from the connected provider.{" "}
            <a href={directions} target="_blank" rel="noreferrer">
              View on Google Maps ↗
            </a>
          </p>
        )}
        {tab === "Location" && (
          <div className="mt-location-card">
            <MapPin size={32} />
            <p>{place.facts?.address ?? `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`}</p>
            <a href={directions} target="_blank" rel="noreferrer" className="mt-primary">
              Open map <ArrowUpRight size={16} />
            </a>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </Modal>
  );
}
