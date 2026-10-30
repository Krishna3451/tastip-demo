"use client";

import { parseStoredTrip, type Trip } from "@tastip/domain";
import { ArrowUpRight, Bookmark, FolderOpen, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tripTitle } from "../lib/travel-pack";

const LIBRARY_KEY = "tastip.library.v1";
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TRIPS = 12;

export function TripLibrary({
  trip,
  onOpen,
  storageKey = LIBRARY_KEY,
}: {
  trip: Trip | null;
  onOpen: (trip: Trip) => void;
  storageKey?: string;
}) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<Trip | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(stored)) {
        const parsed = stored.slice(0, MAX_TRIPS).map(parseStoredTrip);
        setTrips(parsed.filter((item): item is Trip => Boolean(item)));
        if (parsed.some((item) => !item))
          setNotice("Some saved trips could not be restored. Your current draft is unchanged.");
      }
    } catch {
      setNotice("This browser could not read your saved trips.");
    }
    setHydrated(true);
  }, [storageKey]);
  function save(items: Trip[], message: string) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
      setTrips(items);
      setNotice(message);
    } catch {
      setNotice("This browser could not save the trip. Download a trip backup to keep a copy.");
    }
  }
  function saveCurrent() {
    if (!trip) return;
    const others = trips.filter((item) => item.id !== trip.id);
    if (others.length >= MAX_TRIPS) {
      setNotice(
        "Your browser collection holds 12 trips. Remove one or download a backup before saving another.",
      );
      return;
    }
    save(
      [structuredClone(trip), ...others],
      "Saved to this browser. Your saved copy is ready to reopen.",
    );
  }
  async function importTrip(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_BYTES) throw new Error("Choose a Tastip backup smaller than 5 MB.");
      const restored = parseStoredTrip(JSON.parse(await file.text()));
      if (!restored)
        throw new Error(
          "This file is not a valid Tastip trip backup. Your current draft is unchanged.",
        );
      setPendingOpen(restored);
      setNotice("Backup checked. Review it below before opening.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The backup could not be opened.");
    }
    if (fileInput.current) fileInput.current.value = "";
  }
  return (
    <section className="trip-library" aria-label="Saved trips">
      <div className="travel-tool-heading">
        <div>
          <p className="eyebrow">PLACES TO COME BACK TO</p>
          <h2>Your little collection.</h2>
        </div>
        <Bookmark size={23} aria-hidden="true" />
      </div>
      <p className="travel-tool-note">
        Saved in this browser on this device. Use a backup to move a trip elsewhere; these are not
        public share links. Opening a saved trip replaces your current draft; save it first to keep
        your changes.
      </p>
      <div className="travel-library-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={!trip || !hydrated}
          onClick={saveCurrent}
        >
          <Bookmark size={15} />
          Save current trip
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={15} />
          Import trip backup
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="Import Tastip trip backup"
          onChange={(event) => void importTrip(event.target.files?.[0])}
        />
      </div>
      {pendingOpen && (
        <section className="travel-library-notice" aria-label="Review imported trip">
          <strong>
            {tripTitle(pendingOpen)} · {pendingOpen.days.length} days · draft v{pendingOpen.version}
          </strong>
          <p>
            Opening this backup replaces the current draft. Save your current trip to your
            collection first if you want to keep it.
          </p>
          <div className="travel-library-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                onOpen(pendingOpen);
                setPendingOpen(null);
                setNotice("Backup opened. Save it here to add it to your collection.");
              }}
            >
              Open imported trip
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPendingOpen(null)}
            >
              Keep current draft
            </button>
          </div>
        </section>
      )}
      {!hydrated ? (
        <p role="status">Opening your collection…</p>
      ) : !trips.length ? (
        <div className="travel-library-empty">
          <FolderOpen size={26} />
          <strong>Your next good story starts here.</strong>
          <p>Save your current trip, or import a Tastip backup to pick up where you left off.</p>
        </div>
      ) : (
        <div className="travel-saved-grid">
          {trips.map((saved) => (
            <article key={saved.id} className="travel-saved-card">
              <span className="eyebrow">
                {saved.days.length} DAYS · {saved.brief.partySize} TRAVELERS
              </span>
              <h3>{tripTitle(saved)}</h3>
              <p>
                {saved.days[0]?.date ?? "Dates open"} · saved draft v{saved.version}
              </p>
              <div>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label={`Open saved ${tripTitle(saved)} trip`}
                  onClick={() => {
                    const restored = parseStoredTrip(saved);
                    if (restored) {
                      onOpen(structuredClone(restored));
                      setNotice(
                        "Saved trip opened. Changes to the active draft do not update this saved copy until you save again.",
                      );
                    } else setNotice("This saved trip could not be restored.");
                  }}
                >
                  Open trip
                  <ArrowUpRight size={15} />
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  aria-label={`Remove saved ${tripTitle(saved)} trip`}
                  onClick={() =>
                    save(
                      trips.filter((item) => item.id !== saved.id),
                      "Removed the saved copy. Your current draft is unchanged.",
                    )
                  }
                >
                  Remove copy
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {notice && (
        <p className="travel-library-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
