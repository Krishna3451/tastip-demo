"use client";

import {
  type Destination,
  nextTasteQuestion,
  type Place,
  type TasteProfile,
  type TasteSeed,
} from "@tastip/domain";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Film,
  MapPin,
  Music2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProviderFetch } from "@/lib/provider-fetch";

export function TasteConnect({
  destinationId,
  destination,
  configured,
  onCreate,
  guided = false,
  initialSeeds = [],
  initialProfile,
  excludedIds = [],
  destinationName,
  replacingDraft = false,
}: {
  destinationId: string;
  destination?: Destination;
  configured: boolean;
  onCreate: (places: Place[], warnings: string[], profile?: TasteProfile) => void;
  guided?: boolean;
  initialSeeds?: TasteSeed[];
  initialProfile?: TasteProfile;
  excludedIds?: string[];
  destinationName?: string;
  replacingDraft?: boolean;
}) {
  const providerFetch = useProviderFetch();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(TasteSeed & { description?: string | null })[]>([]);
  const [selected, setSelected] = useState<TasteSeed[]>(initialSeeds);
  const [step, setStep] = useState(0);
  const [dayStyle, setDayStyle] = useState(initialProfile?.dayStyle ?? "");
  const [categories, setCategories] = useState<Place["category"][]>(
    initialProfile?.categories ?? [],
  );
  const [rhythm, setRhythm] = useState<NonNullable<TasteProfile["rhythm"]>>(
    initialProfile?.rhythm ?? "balanced",
  );
  const [dietary, setDietary] = useState<string[]>(initialProfile?.dietary ?? []);
  const [walking, setWalking] = useState<NonNullable<TasteProfile["walking"]>>(
    initialProfile?.walking ?? "moderate",
  );
  const [lodging, setLodging] = useState(initialProfile?.lodging ?? "No preference yet");
  const question = nextTasteQuestion(selected);
  const [status, setStatus] = useState<"idle" | "searching" | "ranking">("idle");
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Destination changes invalidate pending searches and rankings against the old location.
  useEffect(() => {
    pending.current?.abort();
    setStatus("idle");
    setError(null);
  }, [destinationId]);
  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setStatus("searching");
    setError(null);
    try {
      const response = await providerFetch("/api/taste/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Taste search could not connect.");
      setResults(body.results);
      setSearched(true);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Taste search could not connect.");
    } finally {
      if (!controller.signal.aborted) setStatus("idle");
    }
  }
  async function recommend() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setStatus("ranking");
    setError(null);
    try {
      const response = await providerFetch("/api/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityIds: selected.map((seed) => seed.id),
          destinationId,
          ...(destination?.id.startsWith("geonames-") ? { destination } : {}),
          ...(guided ? { categories, excludedIds } : {}),
        }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Recommendations could not connect.");
      if (!body.selected?.length)
        throw new Error(
          "No matching places for these choices. Try another day style or cultural favorite.",
        );
      if (!controller.signal.aborted)
        onCreate(body.selected, body.warnings ?? [], {
          seeds: selected,
          dayStyle,
          categories,
          rhythm,
          dietary,
          walking,
          lodging,
        });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Recommendations could not connect.");
    } finally {
      if (!controller.signal.aborted) setStatus("idle");
    }
  }
  const content = (
    <>
      {guided && (
        <>
          <fieldset
            className="studio-progress"
            aria-label={`Taste interview step ${step + 1} of 4`}
          >
            {["Your world", "Your kind of day", "Your rhythm", "Make it yours"].map(
              (label, index) => (
                <span key={label} className={index <= step ? "active" : ""}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  {label}
                </span>
              ),
            )}
          </fieldset>
          <p className="eyebrow">A LITTLE ABOUT YOUR WORLD</p>
          <h2 tabIndex={-1} className="studio-title">
            {step === 0 ? (
              <>
                Good taste.
                <br />
                <em>Great detours.</em>
              </>
            ) : step === 1 ? (
              question.title
            ) : step === 2 ? (
              <>
                Your hours.
                <br />
                <em>Your rhythm.</em>
              </>
            ) : (
              <>
                Let’s find your
                <br />
                <em>kind of {destinationName ?? "places"}.</em>
              </>
            )}
          </h2>
          <p className="studio-description">
            {step === 0
              ? "An artist you replay. A film you love. A book you couldn’t put down. Start with something that moves you."
              : step === 1
                ? question.note
                : step === 2
                  ? "Tell us when you feel most alive, and what makes a day comfortable. You can change this later."
                  : "Your favorites meet Qloo’s cultural connections. You choose what makes the final journey."}
          </p>
        </>
      )}
      {(!guided || step === 0) && (
        <>
          {!guided && (
            <p>
              Choose a favorite artist, film, book, brand, or place. Qloo’s actual rankings will
              choose the places in this draft.
            </p>
          )}
          {guided && (
            <div className="culture-hints" aria-hidden="true">
              <span>
                <Music2 size={15} />
                Music
              </span>
              <span>
                <Film size={15} />
                Film
              </span>
              <span>
                <BookOpen size={15} />
                Books
              </span>
              <span>
                <MapPin size={15} />
                Places
              </span>
            </div>
          )}
          {!configured && (
            <p className="provider-note">
              Live taste search needs a Qloo connection. You can still explore the sample journey.
            </p>
          )}
          <form className="taste-search" onSubmit={search}>
            <label className="sr-only" htmlFor={guided ? "studio-taste-query" : "taste-query"}>
              Search a cultural favorite
            </label>
            <input
              id={guided ? "studio-taste-query" : "taste-query"}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearched(false);
              }}
              placeholder="Try an artist, a film, a book…"
              maxLength={160}
            />
            <button
              type="submit"
              className="icon-button"
              aria-label="Search favorites"
              disabled={!configured || status !== "idle" || query.trim().length < 2}
            >
              <Search size={18} />
            </button>
          </form>
          {status === "searching" && <p role="status">Finding matching favorites…</p>}
          {searched && results.length === 0 && <p>No matches. Try a more specific name.</p>}
          <div className="taste-results">
            {results.slice(0, 5).map((seed) => (
              <button
                type="button"
                key={seed.id}
                disabled={status !== "idle"}
                onClick={() => {
                  setSelected((current) =>
                    current.some((item) => item.id === seed.id)
                      ? current.filter((item) => item.id !== seed.id)
                      : current.length < 12
                        ? [...current, seed]
                        : current,
                  );
                  setDayStyle("");
                  setCategories([]);
                }}
                aria-pressed={selected.some((item) => item.id === seed.id)}
              >
                <span>
                  <strong>{seed.name}</strong>
                  <small>{seed.type.split(":").at(-1)?.replaceAll("_", " ")}</small>
                  {seed.description && (
                    <small className="seed-description">{seed.description.slice(0, 180)}</small>
                  )}
                </span>
                {selected.some((item) => item.id === seed.id) ? (
                  <Check size={15} />
                ) : (
                  <span>+</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {selected.length > 0 && (
        <div className="selected-seeds">
          {selected.map((seed) => (
            <button
              key={seed.id}
              type="button"
              disabled={status !== "idle" || (guided && step > 0)}
              onClick={() =>
                setSelected((current) => current.filter((item) => item.id !== seed.id))
              }
              aria-label={`Remove ${seed.name} favorite`}
            >
              {seed.name}
              {(!guided || step === 0) && <X size={12} />}
            </button>
          ))}
        </div>
      )}
      {guided && step === 1 && (
        <div className="day-style-options">
          {[...question.options, { label: "A little of everything", categories: [] }].map(
            (option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={dayStyle === option.label}
                onClick={() => {
                  setDayStyle(option.label);
                  setCategories(option.categories);
                }}
              >
                <span>{option.label}</span>
                <span className="choice-circle">
                  {dayStyle === option.label && <Check size={15} />}
                </span>
              </button>
            ),
          )}
        </div>
      )}
      {guided && step === 2 && (
        <div className="rhythm-questions">
          <fieldset>
            <legend>When should your days come alive?</legend>
            <div className="day-style-options">
              {(
                [
                  ["early", "Early light", "8 AM–7 PM · calm evenings"],
                  ["balanced", "A little of both", "9:30 AM–9 PM · room to linger"],
                  ["late", "Late starts & evenings", "11 AM–11 PM · a slower morning"],
                ] as const
              ).map(([value, title, detail]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={rhythm === value}
                  onClick={() => setRhythm(value)}
                >
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                  <span className="choice-circle">{rhythm === value && <Check size={15} />}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>How much walking feels good?</legend>
            <div className="preference-chips">
              {(
                [
                  ["short", "Short strolls"],
                  ["moderate", "A comfortable mix"],
                  ["long", "Long wandering days"],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={walking === value}
                  onClick={() => setWalking(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p>Saved as your preference. Walking distances still need checking.</p>
          </fieldset>
          <fieldset>
            <legend>Anything to keep in mind at the table?</legend>
            <div className="preference-chips">
              {["Vegetarian", "Vegan", "Gluten-free", "Halal", "No seafood"].map((choice) => (
                <button
                  type="button"
                  key={choice}
                  aria-pressed={dietary.includes(choice)}
                  onClick={() =>
                    setDietary(
                      dietary.includes(choice)
                        ? dietary.filter((item) => item !== choice)
                        : [...dietary, choice],
                    )
                  }
                >
                  {choice}
                </button>
              ))}
            </div>
            <p>
              We’ll keep these in your plan. Confirm ingredients and dietary suitability directly
              with each venue.
            </p>
          </fieldset>
          <label className="lodging-choice">
            Where do you feel at home?
            <select
              aria-label="Accommodation style"
              value={lodging}
              onChange={(event) => setLodging(event.target.value)}
            >
              {[
                "No preference yet",
                "Boutique & character",
                "A little luxury",
                "Apartment & independence",
                "Simple & good value",
                "Close to nature",
              ].map((choice) => (
                <option key={choice}>{choice}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {guided && step === 3 && (
        <div className="taste-receipt">
          <span>
            <Sparkles size={18} /> YOUR TRIP’S STARTING POINT
          </span>
          <strong>{dayStyle || "A little of everything"}</strong>
          <p>
            {selected.length} confirmed cultural favorite{selected.length === 1 ? "" : "s"} ·{" "}
            {destinationName ?? destinationId}
          </p>
          <p>
            Qloo ranks real candidates. Your day style filters the selection; hours, routes and
            costs still need checking.
          </p>
          <p>
            Your rhythm:{" "}
            {rhythm === "early"
              ? "early light, 8 AM–7 PM"
              : rhythm === "late"
                ? "late starts, 11 AM–11 PM"
                : "balanced, 9:30 AM–9 PM"}
            . Walking: {walking}.{" "}
            {dietary.length
              ? `At the table: ${dietary.join(", ")}.`
              : "No dietary preferences selected."}
          </p>
          <p>Accommodation style: {lodging}. Hotel inventory is not included in this draft.</p>
          {excludedIds.length > 0 && (
            <p>
              {excludedIds.length} previously disliked place{excludedIds.length === 1 ? "" : "s"}{" "}
              excluded.
            </p>
          )}
          {replacingDraft && (
            <p>
              This creates a fresh draft and replaces the current itinerary, including any pinned
              visits. Close this window to keep the current draft.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="studio-actions">
        {guided && step > 0 && (
          <button
            type="button"
            className="button button-secondary"
            disabled={status !== "idle"}
            onClick={() => {
              setStep(step - 1);
              setError(null);
            }}
          >
            <ArrowLeft size={16} />
            Back
          </button>
        )}
        {guided && step < 3 ? (
          <button
            type="button"
            className="button button-primary"
            disabled={step === 0 ? selected.length === 0 || status !== "idle" : !dayStyle}
            onClick={() => setStep(step + 1)}
          >
            Continue
            <ArrowRight size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary"
            disabled={!configured || selected.length === 0 || status !== "idle"}
            onClick={() => void recommend()}
          >
            {status === "ranking" ? "Finding your kind of places…" : "Build with my taste"}
            <ArrowRight size={16} />
          </button>
        )}
      </div>
      <p className="taste-footnote">
        Only confirmed favorites and destination filters go to Qloo. Affinity is a suggestion, never
        a guarantee of enjoyment.
      </p>
    </>
  );
  if (guided) return <section className="taste-connect taste-studio">{content}</section>;
  return (
    <details className="taste-connect">
      <summary>
        <span className="tiny-star">✦</span>Tune your trip with Qloo
        <span className="connect-label">{configured ? "CONNECTED" : "SETUP NEEDED"}</span>
      </summary>
      {content}
    </details>
  );
}
