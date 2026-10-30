"use client";

import {
  applyTripCommand,
  type CommandReceipt,
  createDemoTrip,
  createTripFromPlaces,
  DEFAULT_BRIEF,
  type Place,
  parseStoredTrip,
  type TasteProfile,
  type Trip,
  type TripBrief,
  type TripOperation,
  type TripRoute,
  undoTripCommand,
} from "@tastip/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { acceptLocalCommand } from "./lib/command-session";
import { archiveBeforeLeaving } from "./lib/local-archive";
import { buildPrimaryTripPreview } from "./lib/trip-generation";

const STORAGE_KEY = "tastip.trip.v1";

export function usePlanner(accountId: string | null = null, identityReady = true) {
  const storageKey = accountId ? `${STORAGE_KEY}:${accountId}` : STORAGE_KEY;
  const currentScope = useRef(storageKey);
  const sessionScope = useRef<string | null>(null);
  currentScope.current = storageKey;
  const libraryKey = accountId ? `tastip.library.v1:${accountId}` : "tastip.library.v1";
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const [brief, setBrief] = useState<TripBrief>(DEFAULT_BRIEF);
  const [trip, setTripState] = useState<Trip | null>(null);
  const tripSession = useRef<Trip | null>(null);
  const setTrip = useCallback((next: Trip | null) => {
    tripSession.current = next;
    setTripState(next);
  }, []);
  const hydrated = identityReady && hydratedScope === storageKey;
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 9000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [undo, setUndo] = useState<CommandReceipt | null>(null);
  useEffect(() => {
    if (!identityReady) return;
    sessionScope.current = storageKey;
    setTrip(null);
    setBrief(DEFAULT_BRIEF);
    setUndo(null);
    setNotice(null);
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const candidate: unknown = JSON.parse(stored);
        const restored = parseStoredTrip(candidate);
        if (restored) {
          setTrip(restored);
          setBrief(restored.brief);
          const latest = restored.commandLog?.at(-1);
          if (latest?.afterVersion === restored.version) setUndo(latest);
        } else setNotice("Your saved draft could not be restored. Start a fresh sample trip.");
      }
    } catch {
      setNotice("This browser could not restore your saved draft.");
    }
    setHydratedScope(storageKey);
  }, [setTrip, storageKey, identityReady]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (trip) localStorage.setItem(storageKey, JSON.stringify(trip));
      else localStorage.removeItem(storageKey);
    } catch {
      setNotice("Your draft is open, but this browser could not save it locally.");
    }
  }, [trip, hydrated, storageKey]);
  const create = useCallback(
    (route?: TripRoute, mode: "demo" | "empty" = "demo") => {
      if (currentScope.current !== storageKey || sessionScope.current !== storageKey) return false;
      let created: Trip;
      try {
        const nextBrief = { ...brief, days: route?.stays[0]?.days ?? brief.days };
        created =
          mode === "empty" ? createTripFromPlaces(nextBrief, []) : createDemoTrip(nextBrief);
      } catch (cause) {
        setNotice(
          cause instanceof Error ? cause.message : "Check your trip details before continuing.",
        );
        return false;
      }
      if (route) {
        const result = applyTripCommand(created, {
          id: crypto.randomUUID(),
          baseVersion: created.version,
          operations: [{ type: "set-route", route }],
        });
        if (!result.ok) {
          setNotice(result.error.message);
          return false;
        }
        created = result.trip;
      }
      if (trip) {
        try {
          archiveBeforeLeaving(localStorage, trip, libraryKey);
        } catch (cause) {
          setNotice(
            cause instanceof Error
              ? cause.message
              : "Your draft could not be saved. Keep it open and download a backup.",
          );
          return false;
        }
      }
      setTrip(created);
      setBrief(created.brief);
      setUndo(null);
      setNotice(
        mode === "empty"
          ? "Your blank travel draft is ready. Keep a place you know in Ideas, or find recommendations around your favorites."
          : "Sample journey created. All venues are fictional; nothing is booked.",
      );
      return true;
    },
    [brief, trip, setTrip, libraryKey, storageKey],
  );
  const createFromPlaces = useCallback(
    (
      places: Place[],
      warnings: string[] = [],
      tasteProfile?: TasteProfile,
      entryRoute?: TripRoute,
      briefOverride?: TripBrief,
    ) => {
      const latest = tripSession.current;
      if (currentScope.current !== storageKey || sessionScope.current !== storageKey) return false;
      if ((trip?.id ?? null) !== (latest?.id ?? null) || trip?.version !== latest?.version) {
        setNotice(
          "Your trip changed while these suggestions were being prepared. Reopen the taste interview for the latest plan.",
        );
        return false;
      }
      const route = briefOverride ? entryRoute : (trip?.route ?? entryRoute);
      const nextBrief = { ...(briefOverride ?? brief), ...(tasteProfile ? { tasteProfile } : {}) };
      let created: Trip;
      try {
        created = buildPrimaryTripPreview(nextBrief, places, route);
      } catch (cause) {
        setNotice(
          cause instanceof Error
            ? cause.message
            : "The recommendations could not be validated. Please try again.",
        );
        return false;
      }
      if (trip) {
        try {
          archiveBeforeLeaving(localStorage, trip, libraryKey);
        } catch (cause) {
          setNotice(
            cause instanceof Error
              ? cause.message
              : "Your draft could not be saved. Download a backup before rebuilding.",
          );
          return false;
        }
      }
      setTrip(created);
      setBrief(created.brief);
      setUndo(null);
      setNotice(
        places.length
          ? `Your taste-led draft is ready. Check opening hours and travel before you go.${warnings.length ? " Some candidates stayed outside the day schedule." : ""}`
          : "Your trip is ready to plan. Add places to build your itinerary.",
      );
      return true;
    },
    [brief, trip, setTrip, libraryKey, storageKey],
  );
  const command = useCallback(
    (
      operations: TripOperation[],
      expectedVersion?: number,
      expectedTripId?: string,
      commandId?: string,
    ) => {
      if (sessionScope.current !== currentScope.current) return false;
      const result = acceptLocalCommand(
        tripSession,
        operations,
        expectedVersion,
        expectedTripId,
        commandId,
      );
      if (!result.ok) {
        setNotice(result.error.message);
        return false;
      }
      setTrip(result.trip);
      setBrief(result.trip.brief);
      setUndo(result.receipt);
      setNotice(
        result.replayed
          ? "This change was already applied. Your latest draft is unchanged."
          : "Draft updated. Your other visits stay in place.",
      );
      return true;
    },
    [setTrip],
  );
  const undoLast = useCallback(() => {
    const current = tripSession.current;
    if (!current || !undo) return;
    const result = undoTripCommand(current, undo, crypto.randomUUID());
    if (!result.ok) {
      setNotice(result.error.message);
      return;
    }
    setTrip(result.trip);
    setBrief(result.trip.brief);
    setUndo(null);
    setNotice("Last change undone.");
  }, [undo, setTrip]);
  const openTrip = (candidate: Trip) => {
    if (currentScope.current !== storageKey || sessionScope.current !== storageKey) return false;
    const restored = parseStoredTrip(candidate);
    if (!restored) {
      setNotice("This trip backup could not be validated.");
      return false;
    }
    const latest = tripSession.current;
    if (latest && (latest.id !== restored.id || latest.version !== restored.version)) {
      try {
        archiveBeforeLeaving(localStorage, latest, libraryKey);
      } catch (cause) {
        setNotice(
          cause instanceof Error
            ? cause.message
            : "Save your current draft before opening another trip.",
        );
        return false;
      }
    }
    setTrip(restored);
    setBrief(restored.brief);
    setUndo(null);
    setNotice("Saved trip reopened on this device.");
    return true;
  };
  const acceptPreparedTrip = (
    candidate: Trip,
    expected: { scope: string; tripId: string | null; version: number | null },
  ) => {
    if (
      !hydrated ||
      expected.scope !== libraryKey ||
      currentScope.current !== storageKey ||
      sessionScope.current !== storageKey
    )
      return false;
    const restored = parseStoredTrip(candidate);
    if (!restored) {
      setNotice("This trip preview could not be validated. Your current draft is unchanged.");
      return false;
    }
    const latest = tripSession.current;
    if (latest?.id === restored.id) return latest.version === restored.version;
    if (
      (latest?.id ?? null) !== expected.tripId ||
      (latest?.version ?? null) !== expected.version
    ) {
      setNotice(
        "Your current draft changed. Close this preview and review the latest plan before creating another trip.",
      );
      return false;
    }
    try {
      if (latest) archiveBeforeLeaving(localStorage, latest, libraryKey);
      localStorage.setItem(storageKey, JSON.stringify(restored));
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Your browser could not save this trip. Keep the preview open and try again.",
      );
      return false;
    }
    setTrip(restored);
    setBrief(restored.brief);
    setUndo(null);
    setNotice("Your personal trip is ready. Check opening hours and travel before visiting.");
    return true;
  };
  const reset = () => {
    const latest = tripSession.current;
    if (latest) {
      try {
        archiveBeforeLeaving(localStorage, latest, libraryKey);
      } catch (cause) {
        setNotice(
          cause instanceof Error
            ? cause.message
            : "Your draft could not be saved. Keep it open and download a backup.",
        );
        return false;
      }
    }
    setTrip(null);
    setUndo(null);
    setNotice(latest ? "Your trip is in Saved trips on this device." : null);
    return true;
  };
  return {
    brief: hydrated ? brief : DEFAULT_BRIEF,
    setBrief,
    trip: hydrated ? trip : null,
    hydrated,
    libraryKey,
    notice,
    setNotice,
    create,
    createFromPlaces,
    command,
    canUndo: hydrated && Boolean(undo && trip && undo.afterVersion === trip.version),
    undoLast,
    reset,
    openTrip,
    acceptPreparedTrip,
  };
}
