"use client";

import type { TasteSeed } from "@tastip/domain";
import { Check, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProviderFetch } from "@/lib/provider-fetch";
import { Modal } from "./primitives";

const seedTypes = new Set(
  ["artist", "book", "brand", "movie", "person", "place", "podcast", "tv_show", "videogame"].map(
    (type) => `urn:entity:${type}`,
  ),
);
function validSeed(value: unknown): value is TasteSeed {
  if (!value || typeof value !== "object") return false;
  const seed = value as TasteSeed;
  return (
    typeof seed.id === "string" &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(seed.id) &&
    typeof seed.name === "string" &&
    seed.name.trim().length > 0 &&
    seed.name.length <= 300 &&
    typeof seed.type === "string" &&
    seedTypes.has(seed.type)
  );
}
function confirmedSeeds(values: TasteSeed[]) {
  const seen = new Set<string>();
  return values.filter(validSeed).flatMap(({ id, name, type }) => {
    if (seen.has(id) || seen.size >= 20) return [];
    seen.add(id);
    return [{ id, name: name.trim(), type }];
  });
}

export function DiscoveryFavorites({
  initial,
  configured,
  onConfirm,
  onClose,
}: {
  initial: TasteSeed[];
  configured: boolean;
  onConfirm: (seeds: TasteSeed[]) => void;
  onClose: () => void;
}) {
  const providerFetch = useProviderFetch();
  const [selected, setSelected] = useState(() => confirmedSeeds(initial));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TasteSeed[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!configured) {
      pending.current?.abort();
      setBusy(false);
    }
  }, [configured]);

  function stop() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
  }
  async function search() {
    const text = query.trim();
    if (!configured || text.length < 2 || text.length > 200) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setSearched(false);
    setResults([]);
    setError("");
    try {
      const response = await providerFetch("/api/taste/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!body || typeof body !== "object")
        throw new Error("These search results could not be checked. Try searching again.");
      if (!response.ok)
        throw new Error(
          typeof body.error?.message === "string"
            ? body.error.message
            : "Favorite search could not connect. Try again.",
        );
      if (
        !Array.isArray(body.results) ||
        body.results.length > 50 ||
        !body.results.every(validSeed)
      )
        throw new Error("These search results could not be checked. Try searching again.");
      if (controller.signal.aborted || pending.current !== controller) return;
      setResults(confirmedSeeds(body.results));
      setSearched(true);
    } catch (cause) {
      if (!controller.signal.aborted && pending.current === controller)
        setError(cause instanceof Error ? cause.message : "Favorite search could not connect.");
    } finally {
      if (!controller.signal.aborted && pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <Modal title="Your favorites" onClose={onClose} className="mt-picker-dialog">
      <h2>Your favorites</h2>
      <p className="mt-muted">
        Choose artists, books, films or other favorites to guide Qloo’s place recommendations. These
        choices apply to this discovery session.
      </p>
      <h3>Selected favorites · {selected.length}/20</h3>
      {selected.length ? (
        <section className="mt-setup-chips" aria-label="Selected favorites">
          {selected.map((seed) => (
            <button
              key={seed.id}
              type="button"
              aria-label={`Remove ${seed.name} favorite`}
              onClick={() =>
                setSelected((current) => current.filter((item) => item.id !== seed.id))
              }
            >
              {seed.name} <X size={14} aria-hidden="true" />
            </button>
          ))}
        </section>
      ) : (
        <p className="mt-muted">Search and choose at least one favorite.</p>
      )}
      {!configured && (
        <p role="status">
          Qloo is not connected. Search will be available when Qloo is configured.
        </p>
      )}
      <form
        aria-label="Find cultural favorites"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <div className="mt-explore-toolbar">
          <label className="mt-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search favorites"
              placeholder="An artist, book, film…"
              minLength={2}
              maxLength={200}
              value={query}
              disabled={!configured}
              onChange={(event) => {
                stop();
                setQuery(event.target.value);
                setResults([]);
                setSearched(false);
                setError("");
              }}
            />
          </label>
          <button
            type="submit"
            className="mt-pill outlined"
            disabled={!configured || query.trim().length < 2}
          >
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
      </form>
      {busy && (
        <div role="status">
          Searching Qloo…{" "}
          <button type="button" className="mt-pill outlined" onClick={stop}>
            Stop search
          </button>
        </div>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="mt-pill outlined"
            disabled={!configured || query.trim().length < 2}
            onClick={() => void search()}
          >
            Retry search
          </button>
        </div>
      )}
      {searched && !results.length && (
        <p role="status">No favorites found. Try another title or name.</p>
      )}
      {results.length > 0 && (
        <section className="mt-setup-chips" aria-label="Favorite search results">
          {results.map((seed) => {
            const chosen = selected.some((item) => item.id === seed.id);
            return (
              <button
                type="button"
                key={seed.id}
                aria-pressed={chosen}
                disabled={!chosen && selected.length >= 20}
                onClick={() =>
                  setSelected((current) =>
                    current.some((item) => item.id === seed.id)
                      ? current.filter((item) => item.id !== seed.id)
                      : current.length < 20
                        ? [...current, seed]
                        : current,
                  )
                }
              >
                {chosen && <Check size={14} aria-hidden="true" />}
                {seed.name} · {seed.type.replace("urn:entity:", "").replaceAll("_", " ")}
              </button>
            );
          })}
        </section>
      )}
      {selected.length === 20 && <p role="status">You can choose up to 20 favorites.</p>}
      <div className="mt-dialog-footer">
        <button type="button" className="mt-pill outlined" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="mt-primary"
          disabled={!selected.length}
          onClick={() => {
            stop();
            onConfirm(selected.map((seed) => ({ ...seed })));
          }}
        >
          Use these favorites
        </button>
      </div>
    </Modal>
  );
}
