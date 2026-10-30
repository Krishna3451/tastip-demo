"use client";

import { parseStoredTrip, type Trip } from "@tastip/domain";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  Copy,
  Link2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountIdentity } from "../use-account";

type Summary = {
  id: string;
  title: string;
  days: number;
  startDate: string | null;
  revision: number;
  updatedAt: number;
};
type SharedLink = { token: string; path: string; expiresAt: number; createdAt?: number };
type Scope = { accountId: string; tripId: string; snapshot: string };
type Feedback = { scope: Scope; message: string };
type SavedMarker = Scope & { version: number; revision: number };
const equalScope = (left: Scope, right: Scope) =>
  left.accountId === right.accountId &&
  left.tripId === right.tripId &&
  left.snapshot === right.snapshot;
const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;
function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
function summaries(value: unknown): Summary[] {
  if (!Array.isArray(value)) throw new Error("Your saved trip list could not be validated.");
  return value.filter(
    (item): item is Summary =>
      item &&
      typeof item === "object" &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      revision(item.days) &&
      revision(item.revision) &&
      (item.startDate === null || typeof item.startDate === "string") &&
      typeof item.updatedAt === "number",
  );
}
function shareLinks(value: unknown): SharedLink[] {
  if (!Array.isArray(value)) throw new Error("Your read-only links could not be validated.");
  return value.filter(
    (item): item is SharedLink =>
      item &&
      typeof item === "object" &&
      typeof item.token === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(item.token) &&
      item.path === `/share/${item.token}` &&
      typeof item.expiresAt === "number" &&
      item.expiresAt > Date.now() &&
      item.revoked !== true,
  );
}

export function RemoteTrips({
  trip,
  account,
  onSignIn,
  onOpen,
}: {
  trip: Trip | null;
  account: AccountIdentity | null;
  onSignIn: () => void;
  onOpen: (trip: Trip) => void;
}) {
  const snapshot = useMemo(() => (trip ? JSON.stringify(trip) : ""), [trip]);
  const scope: Scope = { accountId: account?.id ?? "", tripId: trip?.id ?? "", snapshot };
  const current = useRef(scope);
  current.current = scope;
  const pending = useRef(new Set<AbortController>());
  const alive = useRef(true);
  const listSequence = useRef(0);
  const linkSequence = useRef(0);
  const [collection, setCollection] = useState<{ owner: string; items: Summary[] }>({
    owner: "",
    items: [],
  });
  const [links, setLinks] = useState<{ owner: string; tripId: string; items: SharedLink[] }>({
    owner: "",
    tripId: "",
    items: [],
  });
  const [busy, setBusy] = useState<{ scope: Scope; action: string } | null>(null);
  const [error, setError] = useState<Feedback | null>(null);
  const [notice, setNotice] = useState<Feedback | null>(null);
  const [saved, setSaved] = useState<SavedMarker | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const memoryBases = useRef(new Map<string, Record<string, number>>());
  const isCurrent = useCallback(
    (captured: Scope) => alive.current && equalScope(current.current, captured),
    [],
  );
  const feedback = (captured: Scope, text: string, failure = false) => {
    if (isCurrent(captured)) (failure ? setError : setNotice)({ scope: captured, message: text });
  };
  function bases(owner: string): Record<string, number> {
    const remembered = memoryBases.current.get(owner);
    if (remembered) return remembered;
    let parsed: unknown;
    try {
      parsed = JSON.parse(localStorage.getItem(`tastip.server-bases.${owner}`) ?? "{}");
    } catch {
      parsed = {};
    }
    const clean: Record<string, number> = {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      for (const [id, value] of Object.entries(parsed))
        if (revision(value))
          Object.defineProperty(clean, id, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
    memoryBases.current.set(owner, clean);
    return clean;
  }
  function saveBase(owner: string, id: string, next: number) {
    const nextBases = { ...bases(owner), [id]: next };
    memoryBases.current.set(owner, nextBases);
    try {
      localStorage.setItem(`tastip.server-bases.${owner}`, JSON.stringify(nextBases));
    } catch {
      /* Server save is still valid; this tab retains its revision for retries. */
    }
  }
  const request = useCallback(
    async (path: string, body?: unknown, owner = current.current.accountId) => {
      if (!alive.current) throw new DOMException("This trip workspace closed.", "AbortError");
      const controller = new AbortController();
      pending.current.add(controller);
      try {
        const response = await fetch(path, {
          cache: "no-store",
          signal: controller.signal,
          headers: {
            "X-Tastip-Account": owner,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error?.message ?? "Your account trip could not connect.");
        return result;
      } finally {
        pending.current.delete(controller);
      }
    },
    [],
  );
  const refresh = useCallback(
    async (owner: string) => {
      if (!owner) return;
      const sequence = ++listSequence.current;
      setLoading(true);
      try {
        const result = await request("/api/trips", undefined, owner);
        if (
          alive.current &&
          listSequence.current === sequence &&
          current.current.accountId === owner
        )
          setCollection({ owner, items: summaries(result.trips) });
      } catch (cause) {
        if (
          alive.current &&
          listSequence.current === sequence &&
          current.current.accountId === owner &&
          !(cause instanceof DOMException && cause.name === "AbortError")
        )
          setError({
            scope: current.current,
            message: message(cause, "Your saved trips could not load."),
          });
      } finally {
        if (
          alive.current &&
          listSequence.current === sequence &&
          current.current.accountId === owner
        )
          setLoading(false);
      }
    },
    [request],
  );
  const refreshLinks = useCallback(
    async (owner: string, tripId: string) => {
      if (!owner || !tripId) return;
      const sequence = ++linkSequence.current;
      try {
        const result = await request(
          `/api/trips?shares=${encodeURIComponent(tripId)}`,
          undefined,
          owner,
        );
        if (
          alive.current &&
          linkSequence.current === sequence &&
          current.current.accountId === owner &&
          current.current.tripId === tripId
        )
          setLinks({ owner, tripId, items: shareLinks(result.shares) });
      } catch (cause) {
        if (
          alive.current &&
          linkSequence.current === sequence &&
          current.current.accountId === owner &&
          current.current.tripId === tripId &&
          !(cause instanceof DOMException && cause.name === "AbortError")
        )
          setError({
            scope: current.current,
            message: message(cause, "Your read-only links could not load."),
          });
      }
    },
    [request],
  );
  useEffect(() => {
    alive.current = true;
    const owner = account?.id ?? "";
    setSaved(null);
    setBusy(null);
    setError(null);
    setNotice(null);
    setCopied(null);
    if (owner) void refresh(owner);
    return () => {
      alive.current = false;
      for (const controller of pending.current) controller.abort();
      pending.current.clear();
    };
  }, [account?.id, refresh]);
  useEffect(() => {
    if (account?.id && trip?.id) void refreshLinks(account.id, trip.id);
  }, [account?.id, trip?.id, refreshLinks]);

  async function save(asCopy = false) {
    if (!trip || !account || (busy && equalScope(busy.scope, scope))) return;
    const captured = { ...scope };
    const candidate: Trip = asCopy
      ? {
          ...structuredClone(trip),
          id: crypto.randomUUID(),
          version: 1,
          appliedCommandIds: [],
          commandLog: [],
        }
      : structuredClone(trip);
    setBusy({ scope: captured, action: "save" });
    setError(null);
    setNotice(null);
    try {
      const known = bases(captured.accountId);
      const expectedRevision =
        !asCopy && Object.hasOwn(known, candidate.id) ? known[candidate.id] : null;
      const result = await request(
        "/api/trips",
        { action: "save", trip: candidate, expectedRevision },
        captured.accountId,
      );
      if (result.id !== candidate.id || !revision(result.revision))
        throw new Error("The server save acknowledgement did not match this trip.");
      if (current.current.accountId !== captured.accountId) return;
      saveBase(captured.accountId, candidate.id, result.revision);
      if (isCurrent(captured)) {
        if (asCopy) {
          onOpen(candidate);
          setSaved({
            accountId: captured.accountId,
            tripId: candidate.id,
            snapshot: JSON.stringify(candidate),
            version: candidate.version,
            revision: result.revision,
          });
        } else setSaved({ ...captured, version: candidate.version, revision: result.revision });
        feedback(
          captured,
          asCopy
            ? "A new account copy was saved and opened."
            : `Saved this exact draft to your account · revision ${result.revision}.`,
        );
      }
      await refresh(captured.accountId);
    } catch (cause) {
      feedback(captured, message(cause, "Your trip could not save."), true);
    } finally {
      setBusy((value) => (value && equalScope(value.scope, captured) ? null : value));
    }
  }
  async function open(id: string) {
    if (!account || (busy && equalScope(busy.scope, scope))) return;
    const captured = { ...scope };
    setBusy({ scope: captured, action: id });
    setError(null);
    setNotice(null);
    try {
      const body = await request(
        `/api/trips?id=${encodeURIComponent(id)}`,
        undefined,
        captured.accountId,
      );
      const restored = parseStoredTrip(body.trip);
      if (!restored || restored.id !== id || !revision(body.revision))
        throw new Error("This account trip could not be validated.");
      if (!isCurrent(captured)) return;
      saveBase(captured.accountId, id, body.revision);
      onOpen(restored);
      setSaved({
        accountId: captured.accountId,
        tripId: restored.id,
        snapshot: JSON.stringify(restored),
        version: restored.version,
        revision: body.revision,
      });
    } catch (cause) {
      feedback(captured, message(cause, "This trip could not open."), true);
    } finally {
      setBusy((value) => (value && equalScope(value.scope, captured) ? null : value));
    }
  }
  async function createShare() {
    if (
      !trip ||
      !account ||
      !saved ||
      !equalScope(saved, scope) ||
      (busy && equalScope(busy.scope, scope))
    )
      return;
    const captured = { ...scope };
    setBusy({ scope: captured, action: "share" });
    setError(null);
    setNotice(null);
    try {
      const result = await request(
        "/api/trips",
        { action: "share", id: captured.tripId, expectedRevision: saved.revision },
        captured.accountId,
      );
      if (
        typeof result.token !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(result.token) ||
        result.path !== `/share/${result.token}` ||
        typeof result.expiresAt !== "number"
      )
        throw new Error("The read-only link could not be validated.");
      if (!isCurrent(captured)) return;
      setLinks({
        owner: captured.accountId,
        tripId: captured.tripId,
        items: [
          { token: result.token, path: result.path, expiresAt: result.expiresAt },
          ...(links.owner === captured.accountId && links.tripId === captured.tripId
            ? links.items
            : []),
        ],
      });
      feedback(
        captured,
        "Read-only snapshot created. Anyone with the link can view it until it expires or you turn it off.",
      );
      await refreshLinks(captured.accountId, captured.tripId);
    } catch (cause) {
      feedback(captured, message(cause, "The share link could not be created."), true);
    } finally {
      setBusy((value) => (value && equalScope(value.scope, captured) ? null : value));
    }
  }
  async function revoke(token: string) {
    const captured = { ...scope };
    setBusy({ scope: captured, action: token });
    setError(null);
    try {
      const result = await request("/api/trips", { action: "revoke", token }, captured.accountId);
      if (result.revoked !== true) throw new Error("The link could not be turned off.");
      if (!isCurrent(captured)) return;
      setLinks((value) => ({
        ...value,
        items: value.items.filter((item) => item.token !== token),
      }));
      feedback(captured, "This read-only link is now turned off.");
    } catch (cause) {
      feedback(captured, message(cause, "The link could not be turned off."), true);
    } finally {
      setBusy((value) => (value && equalScope(value.scope, captured) ? null : value));
    }
  }
  const activeItems = collection.owner === account?.id ? collection.items : [];
  const activeLinks = links.owner === account?.id && links.tripId === trip?.id ? links.items : [];
  const isBusy = Boolean(busy && equalScope(busy.scope, scope));
  const exactSaved = Boolean(saved && equalScope(saved, scope));
  return (
    <section className="remote-trips" aria-label="Account saved trips">
      <header className="account-section-heading">
        <div>
          <p className="eyebrow">KEEP THE GOOD DAYS</p>
          <h2>Your journeys, close by.</h2>
        </div>
        <span className="account-section-icon">
          <Bookmark size={21} />
        </span>
      </header>
      {!account ? (
        <div className="account-invitation">
          <p>
            Keep a server copy of your trips and make a private, read-only link whenever you choose
            to share. Your device collection still works without an account.
          </p>
          <button type="button" className="button button-primary" onClick={onSignIn}>
            Sign in to save trips
            <ArrowUpRight size={15} />
          </button>
        </div>
      ) : (
        <>
          <p className="account-section-note">
            Signed in as <strong>{account.username}</strong>. These copies live on this Tastip
            server. Your downloads remain an independent backup.
          </p>
          <div className="remote-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={!trip || isBusy}
              onClick={() => void save()}
            >
              {isBusy && busy?.action === "save" ? (
                <LoaderCircle size={15} className="account-spinner" />
              ) : (
                <Bookmark size={15} />
              )}
              Save trip to account
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={!trip || isBusy}
              onClick={() => void save(true)}
            >
              Save as new trip
            </button>
            {exactSaved && (
              <span className="account-saved-mark">
                <Check size={14} />
                This draft is saved
              </span>
            )}
          </div>
          <section className="share-preview" aria-label="Share current account trip">
            <div className="share-preview-heading">
              <Link2 size={20} />
              <h3>A little window into your journey.</h3>
            </div>
            <p>
              Share the trip name, destinations, dates, travelers, pace, places and lodging ideas.
              Your origin, budget, planned costs, interests, cultural favorites, dietary profile,
              feedback, day notes, visit notes and edit history stay private. Each link is a
              read-only snapshot that expires after 30 days. Addresses and links you enter for your
              own lodging ideas also stay private.
            </p>
            <button
              type="button"
              className="button button-secondary"
              disabled={!trip || isBusy || !exactSaved}
              onClick={() => void createShare()}
            >
              Create read-only link
              <ArrowUpRight size={14} />
            </button>
            {trip && !exactSaved && (
              <small className="share-save-hint">
                Save or reopen this exact trip version before creating a link.
              </small>
            )}
            {activeLinks.length > 0 && (
              <div className="owned-share-links">
                {activeLinks.map((link) => (
                  <article key={link.token}>
                    <label>
                      Read-only trip link
                      <input
                        aria-label="Read-only trip link"
                        value={
                          typeof window === "undefined"
                            ? link.path
                            : new URL(link.path, window.location.origin).href
                        }
                        readOnly
                        onFocus={(event) => event.target.select()}
                      />
                    </label>
                    <small>
                      Expires{" "}
                      {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                        link.expiresAt,
                      )}
                    </small>
                    <div className="remote-actions">
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => {
                          const url = new URL(link.path, window.location.origin).href;
                          void navigator.clipboard
                            .writeText(url)
                            .then(() => {
                              if (isCurrent(scope)) {
                                setCopied(link.token);
                                feedback(scope, "Read-only link copied.");
                              }
                            })
                            .catch(() =>
                              feedback(scope, "Copy the link from the field above.", true),
                            );
                        }}
                      >
                        {copied === link.token ? <Check size={14} /> : <Copy size={14} />}
                        {copied === link.token ? "Copied" : "Copy link"}
                      </button>
                      <a
                        className="button button-secondary"
                        href={link.path}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Preview shared trip ↗
                      </a>
                      <button
                        type="button"
                        className="button button-quiet"
                        disabled={isBusy}
                        onClick={() => void revoke(link.token)}
                      >
                        Turn off this link
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <div className="remote-list-heading">
            <h3>Saved to your account</h3>
            <button
              type="button"
              className="button button-quiet"
              disabled={loading}
              onClick={() => void refresh(account.id)}
            >
              {loading ? "Refreshing…" : "Refresh trips"}
            </button>
          </div>
          <div className="remote-trip-list">
            {activeItems.length ? (
              activeItems.map((item) => (
                <article key={item.id}>
                  <span className="eyebrow">{item.days} DAYS · SERVER COPY</span>
                  <h3>{item.title}</h3>
                  <p>
                    {item.startDate ?? "Dates open"} · revision {item.revision}
                  </p>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={isBusy}
                    onClick={() => void open(item.id)}
                  >
                    Open account trip {item.title}
                    <ArrowUpRight size={14} />
                  </button>
                </article>
              ))
            ) : (
              <div className="account-empty">
                <ShieldCheck size={24} />
                <strong>
                  {loading ? "Opening your journeys…" : "Your next good story belongs here."}
                </strong>
                <p>
                  {loading
                    ? "Fetching this account’s saved copies."
                    : "Save the trip you’re working on, then return to it whenever you’re ready."}
                </p>
              </div>
            )}
          </div>
        </>
      )}
      {notice && equalScope(notice.scope, scope) && (
        <p className="account-notice" role="status">
          <Check size={15} />
          {notice.message}
        </p>
      )}
      {error && equalScope(error.scope, scope) && (
        <p role="alert" className="inline-error">
          {error.message}
        </p>
      )}
    </section>
  );
}
